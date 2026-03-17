/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 * @description RESTlet endpoint for receiving Amazon notifications/webhooks.
 *              Can also be used for external system integrations and manual triggers.
 */
define([
    'N/log',
    'N/task',
    '../lib/constants',
    '../lib/logger',
    '../services/orderService'
], function (log, task, constants, logger, orderService) {

    /**
     * GET handler - Returns connector status and health check info.
     */
    function get(requestParams) {
        return {
            status: 'active',
            connector: 'Amazon Seller Connector',
            version: '2.0.0',
            timestamp: new Date().toISOString(),
            endpoints: {
                GET: 'Health check / status',
                POST: 'Process Amazon notification (ORDER_STATUS_CHANGE, RETURN_CREATED, TRIGGER_SYNC)',
                PUT: 'Update order status'
            },
            syncTypes: [
                'orders', 'inventory', 'settlements', 'returns',
                'pricing', 'catalog', 'cancellations', 'fba_inventory',
                'errors', 'archival'
            ],
            features: [
                'Multi-marketplace support',
                'Configurable sync toggles per data type',
                'Item-level inventory/price sync control',
                'FBA and MFN order routing',
                'Automatic error retry with exponential backoff',
                'Email notifications for sync failures',
                'FBA inventory tracking',
                'Order cancellation sync',
                'Data archival/cleanup',
                'Feed result tracking',
                'SP-API rate limiting'
            ]
        };
    }

    /**
     * POST handler - Receives Amazon event notifications.
     * Supports order status updates, return notifications, etc.
     */
    function post(requestBody) {
        try {
            log.audit({
                title: 'AMZ Webhook POST',
                details: JSON.stringify(requestBody).substring(0, 3999)
            });

            const eventType = requestBody.NotificationType || requestBody.eventType || requestBody.type;

            switch (eventType) {
                case 'ORDER_STATUS_CHANGE':
                    return handleOrderStatusChange(requestBody);

                case 'RETURN_CREATED':
                    return handleReturnNotification(requestBody);

                case 'TRIGGER_SYNC':
                    return handleManualTrigger(requestBody);

                default:
                    logger.warn(constants.LOG_TYPE.API_CALL,
                        'Unknown webhook event type: ' + eventType, {
                        details: JSON.stringify(requestBody)
                    });
                    return {
                        success: false,
                        message: 'Unknown event type: ' + eventType
                    };
            }
        } catch (e) {
            logger.error(constants.LOG_TYPE.API_CALL,
                'Webhook processing error: ' + e.message, { details: e.stack });
            return { success: false, error: e.message };
        }
    }

    /**
     * PUT handler - Update order mapping status.
     */
    function put(requestBody) {
        try {
            const amazonOrderId = requestBody.amazonOrderId;
            const newStatus = requestBody.status;

            if (!amazonOrderId || !newStatus) {
                return { success: false, message: 'amazonOrderId and status are required' };
            }

            const existing = orderService.findExistingOrderMap(amazonOrderId);
            if (!existing) {
                return { success: false, message: 'Order not found: ' + amazonOrderId };
            }

            orderService.updateOrderMapStatus(existing.id, newStatus);
            return { success: true, message: 'Order status updated', orderMapId: existing.id };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Handles order status change notifications.
     */
    function handleOrderStatusChange(data) {
        const orderId = data.AmazonOrderId || data.amazonOrderId;
        if (!orderId) {
            return { success: false, message: 'Missing AmazonOrderId' };
        }

        const existing = orderService.findExistingOrderMap(orderId);
        if (existing) {
            const newStatus = orderService.mapAmazonStatus(data.OrderStatus || data.status);
            orderService.updateOrderMapStatus(existing.id, newStatus);
            return { success: true, message: 'Order status updated', orderMapId: existing.id };
        }

        return { success: true, message: 'Order not found in system, will be picked up on next sync' };
    }

    /**
     * Handles return created notifications.
     */
    function handleReturnNotification(data) {
        logger.progress(constants.LOG_TYPE.RETURN_SYNC,
            'Return notification received for order: ' + (data.AmazonOrderId || 'unknown'), {
            amazonRef: data.AmazonOrderId,
            details: JSON.stringify(data)
        });

        // Trigger return sync
        try {
            const scriptTask = task.create({
                taskType: task.TaskType.SCHEDULED_SCRIPT,
                scriptId: constants.SCRIPT_IDS.SCHED_RETURN_SYNC,
                deploymentId: constants.DEPLOY_IDS.SCHED_RETURN_SYNC
            });
            scriptTask.submit();
        } catch (e) {
            log.debug({ title: 'Return Trigger', details: e.message });
        }

        return { success: true, message: 'Return notification received and sync triggered' };
    }

    /**
     * Handles manual sync trigger requests from external systems.
     * Supports all sync types: orders, inventory, settlements, returns,
     * pricing, catalog, cancellations, fba_inventory, errors, archival.
     */
    function handleManualTrigger(data) {
        const syncType = data.syncType;
        const scriptMap = {
            orders: { scriptId: constants.SCRIPT_IDS.SCHED_ORDER_SYNC, deployId: constants.DEPLOY_IDS.SCHED_ORDER_SYNC },
            inventory: { scriptId: constants.SCRIPT_IDS.SCHED_INV_SYNC, deployId: constants.DEPLOY_IDS.SCHED_INV_SYNC },
            settlements: { scriptId: constants.SCRIPT_IDS.SCHED_SETTLE_SYNC, deployId: constants.DEPLOY_IDS.SCHED_SETTLE_SYNC },
            returns: { scriptId: constants.SCRIPT_IDS.SCHED_RETURN_SYNC, deployId: constants.DEPLOY_IDS.SCHED_RETURN_SYNC },
            pricing: { scriptId: constants.SCRIPT_IDS.SCHED_PRICING_SYNC, deployId: constants.DEPLOY_IDS.SCHED_PRICING_SYNC },
            catalog: { scriptId: constants.SCRIPT_IDS.SCHED_CATALOG_SYNC, deployId: constants.DEPLOY_IDS.SCHED_CATALOG_SYNC },
            cancellations: { scriptId: constants.SCRIPT_IDS.SCHED_CANCEL_SYNC, deployId: constants.DEPLOY_IDS.SCHED_CANCEL_SYNC },
            fba_inventory: { scriptId: constants.SCRIPT_IDS.SCHED_FBA_INV_SYNC, deployId: constants.DEPLOY_IDS.SCHED_FBA_INV_SYNC },
            errors: { scriptId: constants.SCRIPT_IDS.SCHED_ERROR_RETRY, deployId: constants.DEPLOY_IDS.SCHED_ERROR_RETRY },
            archival: { scriptId: constants.SCRIPT_IDS.SCHED_DATA_ARCHIVAL, deployId: constants.DEPLOY_IDS.SCHED_DATA_ARCHIVAL }
        };

        const scriptInfo = scriptMap[syncType];
        if (!scriptInfo) {
            return {
                success: false,
                message: 'Invalid syncType. Available: ' + Object.keys(scriptMap).join(', ')
            };
        }

        const scriptTask = task.create({
            taskType: task.TaskType.SCHEDULED_SCRIPT,
            scriptId: scriptInfo.scriptId,
            deploymentId: scriptInfo.deployId
        });
        const taskId = scriptTask.submit();

        return { success: true, message: syncType + ' sync triggered', taskId: taskId };
    }

    return { get, post, put };
});
