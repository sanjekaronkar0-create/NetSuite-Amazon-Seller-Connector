/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @description Map/Reduce script that imports Amazon orders into NetSuite as Sales Orders, Cash Sales, or Invoices.
 *              Receives order data from the scheduled order sync script.
 */
define([
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/amazonClient',
    '../lib/logger',
    '../lib/errorQueue',
    '../lib/mrDataHelper',
    '../services/orderService'
], function (runtime, log, constants, configHelper, amazonClient, logger, errorQueue, mrDataHelper, orderService) {

    /**
     * Input stage: Returns the order data passed from the scheduled script.
     * The parameter contains a File Cabinet file ID pointing to a JSON file.
     */
    function getInputData() {
        const dataParam = runtime.getCurrentScript().getParameter({
            name: 'custscript_amz_mr_order_data'
        });

        if (!dataParam) {
            log.audit({ title: 'MR Order Import', details: 'No order data provided' });
            return [];
        }

        var data = mrDataHelper.readDataFile(dataParam);
        log.audit({
            title: 'MR Order Import - Input',
            details: 'Processing ' + data.orders.length + ' orders for config ' + data.configId
        });

        return data.orders.map(function (order) {
            return {
                configId: data.configId,
                order: order
            };
        });
    }

    /**
     * Map stage: Filters orders and routes to reduce by order ID.
     * Skips existing and pending orders. Does NOT make API calls
     * to avoid statement count limits from busyWait rate limiting.
     */
    function map(context) {
        try {
            const entry = JSON.parse(context.value);
            const config = configHelper.getConfig(entry.configId);
            const amazonOrder = entry.order;

            // Check if order already exists
            const existing = orderService.findExistingOrderMap(amazonOrder.AmazonOrderId);
            if (existing) {
                // Update status if changed
                const newStatus = orderService.mapAmazonStatus(amazonOrder.OrderStatus);
                if (existing.status !== newStatus) {
                    orderService.updateOrderMapStatus(existing.id, newStatus);
                }
                log.debug({
                    title: 'MR Order Import',
                    details: 'Order already exists: ' + amazonOrder.AmazonOrderId
                });
                return;
            }

            // Skip pending orders (not yet ready for fulfillment)
            if (amazonOrder.OrderStatus === 'Pending' || amazonOrder.OrderStatus === 'PendingAvailability') {
                log.debug({
                    title: 'MR Order Import',
                    details: 'Skipping pending order: ' + amazonOrder.AmazonOrderId
                });
                return;
            }

            context.write({
                key: amazonOrder.AmazonOrderId,
                value: JSON.stringify({
                    configId: entry.configId,
                    order: amazonOrder
                })
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.ORDER_SYNC,
                'Map stage error: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Reduce stage: Creates the NetSuite transaction (Sales Order, Cash Sale, or Invoice) for each Amazon order.
     */
    function reduce(context) {
        const amazonOrderId = context.key;

        try {
            const data = JSON.parse(context.values[0]);
            const config = configHelper.getConfig(data.configId);
            const amazonOrder = data.order;

            log.debug({
                title: 'Order Data: ' + amazonOrderId,
                details: JSON.stringify(amazonOrder).substring(0, 3999)
            });

            // Fetch order items from Amazon (moved from map stage to avoid
            // statement count limits caused by busyWait in rate limiting)
            let orderItems;
            try {
                const itemsResponse = amazonClient.getOrderItems(config, amazonOrderId);
                orderItems = itemsResponse.payload || itemsResponse;
                log.debug({
                    title: 'Order Items: ' + amazonOrderId,
                    details: JSON.stringify(orderItems).substring(0, 3999)
                });
            } catch (itemsErr) {
                logger.error(constants.LOG_TYPE.ORDER_SYNC,
                    'Failed to get order items for ' + amazonOrderId + ': ' + itemsErr.message, {
                    configId: data.configId,
                    amazonRef: amazonOrderId,
                    details: itemsErr.stack
                });
                errorQueue.enqueue({
                    type: constants.ERROR_QUEUE_TYPE.ORDER_CREATE,
                    amazonRef: amazonOrderId,
                    errorMsg: 'getOrderItems failed: ' + itemsErr.message,
                    configId: data.configId,
                    maxRetries: 3
                });
                return;
            }

            // Try to get shipping address
            let address = null;
            try {
                const addrResponse = amazonClient.getOrderAddress(config, amazonOrderId);
                address = (addrResponse.payload || addrResponse).ShippingAddress;
                log.debug({
                    title: 'Shipping Address: ' + amazonOrderId,
                    details: JSON.stringify(address)
                });
            } catch (addrErr) {
                log.debug({
                    title: 'MR Order Import',
                    details: 'Could not get address for ' + amazonOrderId + ': ' + addrErr.message
                });
            }
            if (address) {
                amazonOrder.ShippingAddress = address;
            }

            // Create NetSuite transaction (Sales Order, Cash Sale, or Invoice)
            const result = orderService.createSalesOrder(config, amazonOrder, orderItems);

            var txnType = result.invoiceId ? 'invoice' : result.cashSaleId ? 'cashsale' : 'salesorder';
            var txnId = result.invoiceId || result.cashSaleId || result.salesOrderId;

            logger.success(constants.LOG_TYPE.ORDER_SYNC,
                txnType + ' created for Amazon order ' + amazonOrderId, {
                configId: data.configId,
                recordType: txnType,
                recordId: txnId,
                amazonRef: amazonOrderId
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.ORDER_SYNC,
                'Failed to create order for Amazon order ' + amazonOrderId + ': ' + e.message, {
                amazonRef: amazonOrderId,
                details: e.stack
            });

            // Enqueue for retry
            errorQueue.enqueue({
                type: constants.ERROR_QUEUE_TYPE.ORDER_CREATE,
                amazonRef: amazonOrderId,
                errorMsg: e.message,
                payload: context.values[0],
                configId: data.configId,
                maxRetries: 3
            });
        }
    }

    /**
     * Summarize stage: Log results.
     */
    function summarize(summary) {
        var mapErrorCount = 0;
        summary.mapSummary.errors.iterator().each(function () {
            mapErrorCount++;
            return true;
        });

        var reduceErrorCount = 0;
        summary.reduceSummary.errors.iterator().each(function (key, error) {
            reduceErrorCount++;
            logger.error(constants.LOG_TYPE.ORDER_SYNC,
                'Reduce error for ' + key + ': ' + error, { amazonRef: key });
            return true;
        });

        log.audit({
            title: 'MR Order Import - Summary',
            details: 'Input: ' + (summary.inputSummary.error || 'none') +
                ' | Map errors: ' + mapErrorCount +
                ' | Reduce errors: ' + reduceErrorCount
        });
    }

    return {
        getInputData,
        map,
        reduce,
        summarize
    };
});
