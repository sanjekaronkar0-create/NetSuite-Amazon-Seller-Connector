/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Amazon Order Cancellation handling.
 *              Detects canceled Amazon orders and closes/voids corresponding
 *              NetSuite Sales Orders, Cash Sales, or Invoices.
 */
define([
    'N/record',
    'N/search',
    'N/log',
    '../lib/constants',
    '../lib/amazonClient',
    '../lib/logger'
], function (record, search, log, constants, amazonClient, logger) {

    const OM = constants.CUSTOM_RECORDS.ORDER_MAP;

    /**
     * Fetches canceled orders from Amazon since the last sync.
     * @param {Object} config
     * @param {string} lastUpdatedAfter - ISO 8601 date
     * @returns {Array<Object>} Canceled orders
     */
    function fetchCanceledOrders(config, lastUpdatedAfter) {
        var allOrders = [];
        var response = amazonClient.getCanceledOrders(config, lastUpdatedAfter);
        var payload = response.payload || response;
        var orders = payload.Orders || [];
        allOrders = allOrders.concat(orders);

        // Handle pagination
        var nextToken = payload.NextToken;
        while (nextToken) {
            response = amazonClient.get({
                config: config,
                path: '/orders/v0/orders',
                params: { NextToken: nextToken, MarketplaceIds: config.marketplaceId }
            });
            payload = response.payload || response;
            orders = payload.Orders || [];
            allOrders = allOrders.concat(orders.filter(function (o) {
                return o.OrderStatus === 'Canceled';
            }));
            nextToken = payload.NextToken || null;
        }

        return allOrders;
    }

    /**
     * Processes a single canceled order.
     * Finds the NetSuite order and closes/voids it based on config.
     * @param {Object} config
     * @param {Object} canceledOrder - Amazon order data
     * @returns {Object} Result { success, action, nsRecordId }
     */
    function processCancellation(config, canceledOrder) {
        var amazonOrderId = canceledOrder.AmazonOrderId;

        // Find existing order mapping
        var existing = null;
        search.create({
            type: OM.ID,
            filters: [[OM.FIELDS.ORDER_ID, 'is', amazonOrderId]],
            columns: [OM.FIELDS.NS_SALES_ORDER, OM.FIELDS.NS_CASH_SALE, OM.FIELDS.NS_INVOICE, OM.FIELDS.STATUS]
        }).run().each(function (result) {
            existing = {
                id: result.id,
                nsSOId: result.getValue(OM.FIELDS.NS_SALES_ORDER),
                nsCashSaleId: result.getValue(OM.FIELDS.NS_CASH_SALE),
                nsInvoiceId: result.getValue(OM.FIELDS.NS_INVOICE),
                status: result.getValue(OM.FIELDS.STATUS)
            };
            return false;
        });

        if (!existing) {
            return { success: true, action: 'skipped', reason: 'Order not found in NetSuite' };
        }

        // Already marked as canceled
        if (existing.status === constants.ORDER_STATUS.CANCELED) {
            return { success: true, action: 'already_canceled' };
        }

        var cancelAction = config.cancelAction || 'close';
        var nsRecordId = existing.nsSOId || existing.nsCashSaleId || existing.nsInvoiceId;
        var recType = existing.nsSOId ? record.Type.SALES_ORDER
            : existing.nsCashSaleId ? record.Type.CASH_SALE
            : record.Type.INVOICE;

        try {
            if (cancelAction === 'close') {
                if (existing.nsInvoiceId) {
                    // Invoices cannot be closed like SOs — void/delete instead
                    record.delete({ type: record.Type.INVOICE, id: nsRecordId });
                } else {
                    closeSalesOrder(recType, nsRecordId);
                }
            }
            // Note: 'void' option not available for all transaction types in NS

            // Update order map status
            record.submitFields({
                type: OM.ID,
                id: existing.id,
                values: {
                    [OM.FIELDS.STATUS]: constants.ORDER_STATUS.CANCELED,
                    [OM.FIELDS.LAST_SYNCED]: new Date()
                }
            });

            logger.success(constants.LOG_TYPE.CANCELLATION,
                'Order canceled in NetSuite: ' + amazonOrderId, {
                configId: config.configId,
                recordType: recType,
                recordId: nsRecordId,
                amazonRef: amazonOrderId
            });

            return { success: true, action: cancelAction, nsRecordId: nsRecordId };
        } catch (e) {
            logger.error(constants.LOG_TYPE.CANCELLATION,
                'Failed to cancel order ' + amazonOrderId + ': ' + e.message, {
                configId: config.configId,
                amazonRef: amazonOrderId,
                details: e.stack
            });
            return { success: false, error: e.message };
        }
    }

    /**
     * Closes a NetSuite Sales Order by setting all lines to closed.
     * @param {string} recType - Record type
     * @param {string|number} recordId - Internal ID
     */
    function closeSalesOrder(recType, recordId) {
        var rec = record.load({ type: recType, id: recordId, isDynamic: true });
        var lineCount = rec.getLineCount({ sublistId: 'item' });

        for (var i = 0; i < lineCount; i++) {
            rec.selectLine({ sublistId: 'item', line: i });
            rec.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'isclosed',
                value: true
            });
            rec.commitLine({ sublistId: 'item' });
        }

        rec.save({ ignoreMandatoryFields: true });
    }

    /**
     * Batch processes all canceled orders for a config.
     * @param {Object} config
     * @param {string} lastUpdatedAfter
     * @returns {Object} Summary { total, canceled, skipped, errors }
     */
    function processCanceledOrders(config, lastUpdatedAfter) {
        var summary = { total: 0, canceled: 0, skipped: 0, errors: 0 };

        var canceledOrders = fetchCanceledOrders(config, lastUpdatedAfter);
        summary.total = canceledOrders.length;

        canceledOrders.forEach(function (order) {
            var result = processCancellation(config, order);
            if (result.success) {
                if (result.action === 'skipped' || result.action === 'already_canceled') {
                    summary.skipped++;
                } else {
                    summary.canceled++;
                }
            } else {
                summary.errors++;
            }
        });

        return summary;
    }

    return {
        processCanceledOrders
    };
});
