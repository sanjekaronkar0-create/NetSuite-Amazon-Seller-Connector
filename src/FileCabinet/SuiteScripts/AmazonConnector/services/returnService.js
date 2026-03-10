/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Amazon Returns/Refunds processing.
 *              Creates NetSuite Return Authorizations and Credit Memos from Amazon return data.
 */
define([
    'N/record',
    'N/search',
    'N/log',
    '../lib/constants',
    '../lib/amazonClient',
    '../lib/logger'
], function (record, search, log, constants, amazonClient, logger) {

    const RM = constants.CUSTOM_RECORDS.RETURN_MAP;
    const OM = constants.CUSTOM_RECORDS.ORDER_MAP;

    /**
     * Fetches return data from Amazon using Reports API.
     * @param {Object} config
     * @param {string} startDate
     * @param {string} endDate
     * @returns {Object} Report creation response
     */
    function requestReturnsReport(config, startDate, endDate) {
        return amazonClient.getReturnsReport(config, startDate, endDate);
    }

    /**
     * Checks if a return has already been processed.
     * @param {string} amazonOrderId
     * @param {string} returnId
     * @returns {boolean}
     */
    function isReturnProcessed(amazonOrderId, returnId) {
        let found = false;
        const filters = [[RM.FIELDS.AMAZON_ORDER_ID, 'is', amazonOrderId]];
        if (returnId) {
            filters.push('AND', [RM.FIELDS.RETURN_ID, 'is', returnId]);
        }

        search.create({
            type: RM.ID,
            filters: filters,
            columns: ['internalid']
        }).run().each(function () {
            found = true;
            return false;
        });

        return found;
    }

    /**
     * Gets the NetSuite sales order linked to an Amazon order.
     * @param {string} amazonOrderId
     * @returns {Object|null} Order mapping with NS sales order ID
     */
    function getLinkedSalesOrder(amazonOrderId) {
        let result = null;

        search.create({
            type: OM.ID,
            filters: [[OM.FIELDS.ORDER_ID, 'is', amazonOrderId]],
            columns: [OM.FIELDS.NS_SALES_ORDER, OM.FIELDS.CONFIG]
        }).run().each(function (r) {
            result = {
                orderMapId: r.id,
                salesOrderId: r.getValue(OM.FIELDS.NS_SALES_ORDER),
                configId: r.getValue(OM.FIELDS.CONFIG)
            };
            return false;
        });

        return result;
    }

    /**
     * Creates a NetSuite Return Authorization from an Amazon return.
     * @param {Object} config
     * @param {Object} returnData - Amazon return info
     * @param {string} salesOrderId - NS Sales Order internal ID
     * @returns {number} Return Authorization ID
     */
    function createReturnAuthorization(config, returnData, salesOrderId) {
        const rma = record.transform({
            fromType: record.Type.SALES_ORDER,
            fromId: salesOrderId,
            toType: record.Type.RETURN_AUTHORIZATION,
            isDynamic: true
        });

        rma.setValue({
            fieldId: 'memo',
            value: 'Amazon Return: ' + (returnData.returnId || returnData.amazonOrderId)
        });

        // Zero out lines not being returned, mark returned items
        const lineCount = rma.getLineCount({ sublistId: 'item' });
        for (let i = lineCount - 1; i >= 0; i--) {
            rma.selectLine({ sublistId: 'item', line: i });

            if (returnData.returnedSkus && returnData.returnedSkus.length > 0) {
                const sku = rma.getCurrentSublistText({ sublistId: 'item', fieldId: 'item' });
                const matchedReturn = returnData.returnedSkus.find(s => s.sku === sku);

                if (matchedReturn) {
                    rma.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        value: matchedReturn.quantity || 1
                    });
                } else {
                    rma.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        value: 0
                    });
                }
                rma.commitLine({ sublistId: 'item' });
            }
        }

        return rma.save({ ignoreMandatoryFields: true });
    }

    /**
     * Creates a return mapping custom record.
     * @param {Object} config
     * @param {Object} returnData
     * @param {number} rmaId - NetSuite RMA ID
     * @param {string} orderMapId
     * @returns {number} Return mapping record ID
     */
    function createReturnMapRecord(config, returnData, rmaId, orderMapId) {
        const rec = record.create({ type: RM.ID });
        rec.setValue({ fieldId: 'name', value: 'Return: ' + returnData.amazonOrderId });
        rec.setValue({ fieldId: RM.FIELDS.AMAZON_ORDER_ID, value: returnData.amazonOrderId });
        rec.setValue({ fieldId: RM.FIELDS.STATUS, value: constants.RETURN_STATUS.PROCESSED });
        rec.setValue({ fieldId: RM.FIELDS.CONFIG, value: config.configId });
        rec.setValue({ fieldId: RM.FIELDS.DATE, value: new Date() });

        if (returnData.returnId) {
            rec.setValue({ fieldId: RM.FIELDS.RETURN_ID, value: returnData.returnId });
        }
        if (returnData.reason) {
            rec.setValue({ fieldId: RM.FIELDS.REASON, value: returnData.reason });
        }
        if (returnData.refundAmount) {
            rec.setValue({ fieldId: RM.FIELDS.REFUND_AMOUNT, value: parseFloat(returnData.refundAmount) });
        }
        if (rmaId) {
            rec.setValue({ fieldId: RM.FIELDS.NS_RMA, value: rmaId });
        }
        if (orderMapId) {
            rec.setValue({ fieldId: RM.FIELDS.ORDER_MAP, value: orderMapId });
        }

        return rec.save({ ignoreMandatoryFields: true });
    }

    /**
     * Updates return map status.
     */
    function updateReturnStatus(returnMapId, status) {
        record.submitFields({
            type: RM.ID,
            id: returnMapId,
            values: { [RM.FIELDS.STATUS]: status }
        });
    }

    return {
        requestReturnsReport,
        isReturnProcessed,
        getLinkedSalesOrder,
        createReturnAuthorization,
        createReturnMapRecord,
        updateReturnStatus
    };
});
