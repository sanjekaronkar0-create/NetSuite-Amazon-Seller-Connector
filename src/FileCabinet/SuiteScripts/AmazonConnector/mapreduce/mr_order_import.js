/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @description Map/Reduce script that imports Amazon orders into NetSuite as Sales Orders.
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
    '../services/orderService'
], function (runtime, log, constants, configHelper, amazonClient, logger, errorQueue, orderService) {

    /**
     * Input stage: Returns the order data passed from the scheduled script.
     */
    function getInputData() {
        const dataParam = runtime.getCurrentScript().getParameter({
            name: 'custscript_amz_mr_order_data'
        });

        if (!dataParam) {
            log.audit({ title: 'MR Order Import', details: 'No order data provided' });
            return [];
        }

        const data = JSON.parse(dataParam);
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
     * Map stage: Process each order individually.
     * Fetches order items and maps to the reduce stage by order ID.
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

            // Fetch order items from Amazon
            const orderItems = amazonClient.getOrderItems(config, amazonOrder.AmazonOrderId);

            context.write({
                key: amazonOrder.AmazonOrderId,
                value: JSON.stringify({
                    configId: entry.configId,
                    order: amazonOrder,
                    items: orderItems.payload || orderItems
                })
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.ORDER_SYNC,
                'Map stage error: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Reduce stage: Creates the NetSuite Sales Order for each Amazon order.
     */
    function reduce(context) {
        const amazonOrderId = context.key;

        try {
            const data = JSON.parse(context.values[0]);
            const config = configHelper.getConfig(data.configId);
            const amazonOrder = data.order;
            const orderItems = data.items;

            // Try to get shipping address
            let address = null;
            try {
                const addrResponse = amazonClient.getOrderAddress(config, amazonOrderId);
                address = (addrResponse.payload || addrResponse).ShippingAddress;
            } catch (addrErr) {
                log.debug({
                    title: 'MR Order Import',
                    details: 'Could not get address for ' + amazonOrderId + ': ' + addrErr.message
                });
            }
            if (address) {
                amazonOrder.ShippingAddress = address;
            }

            // Create NetSuite Sales Order
            const result = orderService.createSalesOrder(config, amazonOrder, orderItems);

            logger.success(constants.LOG_TYPE.ORDER_SYNC,
                'Sales Order created for Amazon order ' + amazonOrderId, {
                configId: data.configId,
                recordType: 'salesorder',
                recordId: result.salesOrderId,
                amazonRef: amazonOrderId
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.ORDER_SYNC,
                'Failed to create SO for Amazon order ' + amazonOrderId + ': ' + e.message, {
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
        log.audit({
            title: 'MR Order Import - Summary',
            details: 'Input: ' + summary.inputSummary.error +
                ' | Map errors: ' + summary.mapSummary.errors.iterator().size +
                ' | Reduce errors: ' + summary.reduceSummary.errors.iterator().size
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            logger.error(constants.LOG_TYPE.ORDER_SYNC,
                'Reduce error for ' + key + ': ' + error, { amazonRef: key });
            return true;
        });
    }

    return {
        getInputData,
        map,
        reduce,
        summarize
    };
});
