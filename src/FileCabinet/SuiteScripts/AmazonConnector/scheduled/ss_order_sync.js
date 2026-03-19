/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script that polls Amazon for new orders and triggers
 *              the Map/Reduce order import process.
 */
define([
    'N/task',
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger',
    '../services/orderService',
    '../services/notificationService'
], function (task, runtime, log, constants, configHelper, logger, orderService, notificationService) {

    const CR = constants.CUSTOM_RECORDS.CONFIG;

    function execute(context) {
        logger.progress(constants.LOG_TYPE.ORDER_SYNC, 'Order sync scheduled script started');

        try {
            const configs = configHelper.getAllConfigs();

            for (const config of configs) {
                if (!config.orderEnabled) {
                    log.debug({ title: 'Order Sync', details: 'Skipping disabled config: ' + config.configId });
                    continue;
                }

                processConfig(config);

                // Check remaining governance
                const remaining = runtime.getCurrentScript().getRemainingUsage();
                if (remaining < 500) {
                    logger.warn(constants.LOG_TYPE.ORDER_SYNC,
                        'Low governance remaining (' + remaining + '), rescheduling');
                    reschedule();
                    return;
                }
            }

            logger.success(constants.LOG_TYPE.ORDER_SYNC, 'Order sync scheduled script completed');
        } catch (e) {
            logger.error(constants.LOG_TYPE.ORDER_SYNC,
                'Order sync failed: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Processes a single config - fetches orders and triggers Map/Reduce.
     */
    function processConfig(config) {
        try {
            // Default to 24 hours ago if no last sync
            const lastSync = config.lastOrderSync
                ? new Date(config.lastOrderSync).toISOString()
                : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

            log.audit({
                title: 'Order Sync',
                details: 'Fetching orders for config ' + config.configId + ' since ' + lastSync
            });

            const orders = orderService.fetchAmazonOrders(config, lastSync);

            if (orders.length === 0) {
                log.debug({ title: 'Order Sync', details: 'No new orders for config ' + config.configId });
                configHelper.updateLastSync(config.configId, CR.FIELDS.LAST_ORDER_SYNC);
                return;
            }

            // Separate new orders from existing orders needing status update
            var newOrders = [];
            var lowGovernance = false;
            for (var i = 0; i < orders.length; i++) {
                // Check governance before each order lookup/update
                var remaining = runtime.getCurrentScript().getRemainingUsage();
                if (remaining < 500) {
                    logger.warn(constants.LOG_TYPE.ORDER_SYNC,
                        'Low governance (' + remaining + ') during order processing, processed ' + i + '/' + orders.length + ' orders');
                    // Add remaining unprocessed orders as new to let MR handle them
                    for (var j = i; j < orders.length; j++) {
                        newOrders.push(orders[j]);
                    }
                    lowGovernance = true;
                    break;
                }

                var existing = orderService.findExistingOrderMap(orders[i].AmazonOrderId);
                if (existing) {
                    // Sync status changes for existing orders
                    try {
                        orderService.syncOrderStatus(config, orders[i], existing);
                    } catch (statusErr) {
                        log.debug({ title: 'Order Status Sync', details: 'Status sync error: ' + statusErr.message });
                    }
                } else {
                    newOrders.push(orders[i]);
                }
            }

            if (newOrders.length === 0) {
                log.debug({ title: 'Order Sync', details: 'No new orders (all existing updated) for config ' + config.configId });
                configHelper.updateLastSync(config.configId, CR.FIELDS.LAST_ORDER_SYNC);
                return;
            }

            log.audit({
                title: 'Order Sync',
                details: 'Found ' + newOrders.length + ' new orders (' + (orders.length - newOrders.length) + ' status updates). Triggering Map/Reduce import.'
            });

            // Trigger Map/Reduce for bulk processing of new orders
            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: constants.SCRIPT_IDS.MR_ORDER_IMPORT,
                deploymentId: constants.DEPLOY_IDS.MR_ORDER_IMPORT,
                params: {
                    custscript_amz_mr_order_data: JSON.stringify({
                        configId: config.configId,
                        orders: newOrders
                    })
                }
            });

            const taskId = mrTask.submit();
            logger.success(constants.LOG_TYPE.ORDER_SYNC,
                'Map/Reduce order import triggered. Task ID: ' + taskId, {
                configId: config.configId,
                details: 'New orders: ' + newOrders.length + ', Status updates: ' + (orders.length - newOrders.length)
            });

            // Only update lastSync if all orders were processed; skip if we broke early due to low governance
            if (!lowGovernance) {
                configHelper.updateLastSync(config.configId, CR.FIELDS.LAST_ORDER_SYNC);
            } else {
                log.audit({ title: 'Order Sync', details: 'Skipping lastSync update due to low governance - remaining orders will be picked up next run' });
                reschedule();
            }

        } catch (e) {
            logger.error(constants.LOG_TYPE.ORDER_SYNC,
                'Order sync failed for config ' + config.configId + ': ' + e.message, {
                configId: config.configId,
                details: e.stack
            });
            notificationService.sendErrorNotification(config,
                'Order Sync Failed', 'Error: ' + e.message);
        }
    }

    /**
     * Reschedules this script when governance is low.
     */
    function reschedule() {
        try {
            const scriptTask = task.create({
                taskType: task.TaskType.SCHEDULED_SCRIPT,
                scriptId: runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId
            });
            scriptTask.submit();
        } catch (e) {
            log.error({ title: 'Reschedule Failed', details: e.message });
        }
    }

    return { execute };
});
