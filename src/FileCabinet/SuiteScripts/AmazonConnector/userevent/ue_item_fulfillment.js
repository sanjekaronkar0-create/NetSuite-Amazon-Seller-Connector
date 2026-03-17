/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * @description User Event script on Item Fulfillment records.
 *              When a fulfillment is created for an Amazon-linked Sales Order,
 *              automatically sends shipment confirmation to Amazon.
 */
define([
    'N/record',
    'N/log',
    'N/runtime',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger',
    '../services/fulfillmentService',
    '../services/orderService',
    '../lib/errorQueue'
], function (record, log, runtime, constants, configHelper, logger, fulfillmentService, orderService, errorQueue) {

    /**
     * After Submit: Send fulfillment data to Amazon when a fulfillment is created.
     */
    function afterSubmit(context) {
        if (context.type !== context.UserEventType.CREATE) return;

        const fulfillmentRec = context.newRecord;
        const salesOrderId = fulfillmentRec.getValue({ fieldId: 'createdfrom' });

        if (!salesOrderId) return;

        try {
            // Check if this SO is linked to an Amazon order
            const orderLink = fulfillmentService.getAmazonOrderForSalesOrder(salesOrderId);
            if (!orderLink) {
                log.debug({
                    title: 'UE Fulfillment',
                    details: 'SO ' + salesOrderId + ' is not an Amazon order, skipping'
                });
                return;
            }

            // Skip FBA orders - Amazon handles fulfillment
            if (orderLink.fulfillmentChannel === constants.FULFILLMENT_CHANNEL.AFN) {
                log.debug({
                    title: 'UE Fulfillment',
                    details: 'FBA order, skipping fulfillment notification'
                });
                return;
            }

            const config = configHelper.getConfig(orderLink.configId);
            if (!config.fulfillEnabled) {
                log.debug({ title: 'UE Fulfillment', details: 'Fulfillment sync disabled' });
                return;
            }

            // Get tracking info from the fulfillment
            const trackingInfo = fulfillmentService.getTrackingInfo(fulfillmentRec.id);

            // Build and submit fulfillment feed
            const feedXml = fulfillmentService.buildFulfillmentFeedXml(
                config.sellerId,
                orderLink.amazonOrderId,
                trackingInfo
            );

            const feedResult = fulfillmentService.submitFulfillmentFeed(config, feedXml);

            // Update order map status to Shipped
            orderService.updateOrderMapStatus(orderLink.mapId, constants.ORDER_STATUS.SHIPPED);

            logger.success(constants.LOG_TYPE.FULFILLMENT_SYNC,
                'Fulfillment sent to Amazon for order ' + orderLink.amazonOrderId, {
                configId: config.configId,
                recordType: 'itemfulfillment',
                recordId: fulfillmentRec.id,
                amazonRef: orderLink.amazonOrderId,
                details: JSON.stringify(feedResult)
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.FULFILLMENT_SYNC,
                'Error sending fulfillment for SO ' + salesOrderId + ': ' + e.message, {
                recordType: 'itemfulfillment',
                recordId: fulfillmentRec.id,
                details: e.stack
            });
            // Queue for retry
            try {
                errorQueue.enqueue({
                    type: constants.ERROR_QUEUE_TYPE.FULFILLMENT,
                    configId: orderLink ? orderLink.configId : '',
                    amazonRef: orderLink ? orderLink.amazonOrderId : '',
                    nsRecordType: 'itemfulfillment',
                    nsRecordId: fulfillmentRec.id,
                    errorMessage: e.message,
                    errorDetails: e.stack
                });
            } catch (qErr) {
                log.error({ title: 'Error Queue', details: 'Failed to enqueue: ' + qErr.message });
            }
        }
    }

    return { afterSubmit };
});
