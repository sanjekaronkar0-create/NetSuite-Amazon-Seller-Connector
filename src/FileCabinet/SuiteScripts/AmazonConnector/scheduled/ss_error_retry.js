/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script that processes the error retry queue.
 *              Picks up failed operations and retries them with exponential backoff.
 */
define([
    'N/runtime',
    'N/log',
    'N/search',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/errorQueue',
    '../lib/logger',
    '../services/orderService',
    '../services/returnService',
    '../services/financialService',
    '../services/fulfillmentService',
    '../services/pricingService',
    '../services/notificationService'
], function (runtime, log, search, constants, configHelper, errorQueue, logger,
    orderService, returnService, financialService, fulfillmentService, pricingService, notificationService) {

    function execute(context) {
        logger.progress(constants.LOG_TYPE.ERROR_RETRY, 'Error retry processing started');

        try {
            const pendingItems = errorQueue.getPendingRetries();

            if (pendingItems.length === 0) {
                log.debug({ title: 'Error Retry', details: 'No pending retries' });
                return;
            }

            log.audit({
                title: 'Error Retry',
                details: 'Processing ' + pendingItems.length + ' pending retries'
            });

            let processed = 0;
            let resolved = 0;
            let failed = 0;

            for (const item of pendingItems) {
                if (runtime.getCurrentScript().getRemainingUsage() < 500) {
                    logger.warn(constants.LOG_TYPE.ERROR_RETRY, 'Low governance, stopping');
                    break;
                }

                try {
                    const success = retryItem(item);
                    if (success) {
                        errorQueue.markResolved(item.id);
                        resolved++;
                    } else {
                        errorQueue.incrementRetry(item.id, item.retryCount, item.maxRetries,
                            'Retry returned false');
                        failed++;
                    }
                } catch (e) {
                    errorQueue.incrementRetry(item.id, item.retryCount, item.maxRetries, e.message);
                    failed++;
                    log.debug({
                        title: 'Error Retry',
                        details: 'Retry failed for ' + item.id + ': ' + e.message
                    });
                }

                processed++;
            }

            logger.success(constants.LOG_TYPE.ERROR_RETRY,
                'Error retry completed: ' + processed + ' processed, ' +
                resolved + ' resolved, ' + failed + ' failed');

            // Send critical alert for items that permanently failed
            sendCriticalAlerts();

        } catch (e) {
            logger.error(constants.LOG_TYPE.ERROR_RETRY,
                'Error retry processing failed: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Retries a single queued item based on its type.
     * @param {Object} item - Error queue item
     * @returns {boolean} true if resolved
     */
    function retryItem(item) {
        const payload = item.payload ? JSON.parse(item.payload) : {};
        const config = item.configId ? configHelper.getConfig(item.configId) : null;

        switch (item.type) {
            case constants.ERROR_QUEUE_TYPE.ORDER_CREATE:
                return retryOrderCreate(config, payload);

            case constants.ERROR_QUEUE_TYPE.FULFILLMENT_SEND:
                return retryFulfillmentSend(config, payload);

            case constants.ERROR_QUEUE_TYPE.RETURN_PROCESS:
                return retryReturnProcess(config, payload);

            case constants.ERROR_QUEUE_TYPE.CREDIT_MEMO_CREATE:
                return retryCreditMemo(config, payload);

            case constants.ERROR_QUEUE_TYPE.DEPOSIT_CREATE:
                return retryDeposit(config, payload);

            case constants.ERROR_QUEUE_TYPE.PRICING_UPDATE:
                return retryPricing(config, payload);

            default:
                log.debug({ title: 'Error Retry', details: 'Unknown retry type: ' + item.type });
                return false;
        }
    }

    function retryOrderCreate(config, payload) {
        if (!config || !payload.order) return false;

        const existing = orderService.findExistingOrderMap(payload.order.AmazonOrderId);
        if (existing) return true; // Already processed

        const result = orderService.createSalesOrder(config, payload.order, payload.items);
        return !!(result.salesOrderId || result.cashSaleId || result.invoiceId);
    }

    function retryFulfillmentSend(config, payload) {
        if (!config || !payload.feedContent) return false;
        fulfillmentService.submitFulfillmentFeed(config, payload.feedContent);
        return true;
    }

    function retryReturnProcess(config, payload) {
        if (!config || !payload.returnData) return false;

        if (returnService.isReturnProcessed(payload.returnData.amazonOrderId, payload.returnData.returnId)) {
            return true;
        }

        const orderLink = returnService.getLinkedOrder(payload.returnData.amazonOrderId);
        if (!orderLink) return false;

        if (orderLink.invoiceId) {
            // Invoice: create Credit Memo directly
            const cmId = returnService.createCreditMemoFromInvoice(config, payload.returnData, orderLink.invoiceId);
            const mapId = returnService.createReturnMapRecord(config, payload.returnData, null, orderLink.orderMapId);
            returnService.updateReturnCreditMemo(mapId, cmId);
        } else {
            const rmaId = returnService.createReturnAuthorization(config, payload.returnData, orderLink.salesOrderId);
            returnService.createReturnMapRecord(config, payload.returnData, rmaId, orderLink.orderMapId);
        }
        return true;
    }

    function retryCreditMemo(config, payload) {
        if (!config || !payload.rmaId) return false;
        financialService.createCreditMemo(config, payload.rmaId, payload.returnData || {});
        return true;
    }

    function retryDeposit(config, payload) {
        if (!config || !payload.settlement) return false;
        financialService.createDeposit(config, payload.settlement, payload.summary || {});
        return true;
    }

    function retryPricing(config, payload) {
        if (!config || !payload.feedContent) return false;
        pricingService.submitPricingFeed(config, payload.feedContent);
        return true;
    }

    /**
     * Sends email alerts for items that permanently failed (exceeded max retries).
     */
    function sendCriticalAlerts() {
        try {
            var EQ = constants.CUSTOM_RECORDS.ERROR_QUEUE;
            var failedByConfig = {};

            // Find recently failed items (failed in the last hour)
            var oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            search.create({
                type: EQ.ID,
                filters: [
                    [EQ.FIELDS.STATUS, 'anyof', [constants.ERROR_QUEUE_STATUS.FAILED]],
                    'AND',
                    ['lastmodified', 'onorafter', oneHourAgo]
                ],
                columns: [
                    EQ.FIELDS.TYPE,
                    EQ.FIELDS.AMAZON_REF,
                    EQ.FIELDS.ERROR_MSG,
                    EQ.FIELDS.RETRY_COUNT,
                    EQ.FIELDS.CONFIG
                ]
            }).run().each(function (result) {
                var configId = result.getValue(EQ.FIELDS.CONFIG) || 'unknown';
                if (!failedByConfig[configId]) failedByConfig[configId] = [];
                failedByConfig[configId].push({
                    type: result.getValue(EQ.FIELDS.TYPE),
                    amazonRef: result.getValue(EQ.FIELDS.AMAZON_REF),
                    errorMsg: result.getValue(EQ.FIELDS.ERROR_MSG),
                    retryCount: result.getValue(EQ.FIELDS.RETRY_COUNT)
                });
                return true;
            });

            for (var configId in failedByConfig) {
                if (configId === 'unknown') continue;
                try {
                    var config = configHelper.getConfig(configId);
                    notificationService.sendCriticalAlert(config, failedByConfig[configId]);
                } catch (e) {
                    log.debug({ title: 'Critical Alert', details: e.message });
                }
            }
        } catch (e) {
            log.debug({ title: 'sendCriticalAlerts', details: e.message });
        }
    }

    return { execute };
});
