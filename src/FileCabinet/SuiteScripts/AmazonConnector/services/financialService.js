/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Financial reconciliation service.
 *              Creates Invoices, Credit Memos, Payments, and Refunds for Amazon settlements and returns.
 */
define([
    'N/record',
    'N/search',
    'N/log',
    '../lib/constants',
    '../lib/logger'
], function (record, search, log, constants, logger) {

    const STL = constants.CUSTOM_RECORDS.SETTLEMENT;

    // ========================================================================
    // Currency / Promotion helpers
    // ========================================================================

    /**
     * Converts an Amazon marketplace name to a NetSuite currency internal ID.
     * @param {string} marketplace - e.g. 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com'
     * @returns {string} NetSuite currency ID ('1'=USD, '3'=CAD, '5'=MXN)
     */
    function resolveCurrencyId(marketplace) {
        if (!marketplace) return '1';
        var mp = marketplace.toLowerCase();
        if (mp === 'amazon.ca') return '3';
        if (mp === 'amazon.com.mx') return '5';
        return '1';
    }

    /**
     * Remaps promotion descriptions so they are distinguishable from regular descriptions.
     * @param {string} amountType - e.g. 'Promotion'
     * @param {string} desc - e.g. 'Shipping', 'Principal'
     * @returns {string} Possibly remapped description
     */
    function remapPromotionDesc(amountType, desc) {
        if (amountType === 'Promotion') {
            if (desc === 'Shipping') return 'Promotion - Shipping';
            if (desc === 'Principal') return 'Promotion - Principal';
        }
        return desc;
    }

    // ========================================================================
    // Item / Invoice look-ups
    // ========================================================================

    /**
     * Searches for a NetSuite item by name/SKU.
     * Ported from old NES_ARES_sch_amazon_invoices.js logic.
     * @param {string} sku - The SKU / item name to search for
     * @returns {string|null} Internal ID of the first matching item, or null
     */
    function lookupItem(sku) {
        if (!sku) return null;
        try {
            var results = search.create({
                type: 'item',
                filters: [
                    ['name', 'haskeywords', sku],
                    'AND',
                    ['name', 'is', sku],
                    'AND',
                    ['custitem_status', 'anyof', ['5', '4', '10', '6', '11', '9']]
                ],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });

            if (results && results.length > 0) {
                return results[0].id;
            }
        } catch (e) {
            log.debug({ title: 'lookupItem', details: 'Error looking up item for SKU ' + sku + ': ' + e.message });
        }
        return null;
    }

    /**
     * Looks up a fee/charge item from the charge map based on description and marketplace.
     * @param {string} desc - Fee description (e.g. 'FBAPerUnitFulfillmentFee')
     * @param {string} marketplace - Marketplace name (e.g. 'Amazon.ca')
     * @param {Object} chargeMap - { map: { descLower: { itemUs, itemCa, itemMx } }, ... }
     * @returns {string|null} NetSuite item internal ID, or null
     */
    function lookupSettlementItem(desc, marketplace, chargeMap) {
        if (!desc || !chargeMap || !chargeMap.map) return null;
        var key = desc.toLowerCase().trim();
        var entry = chargeMap.map[key];
        if (!entry) return null;

        var mp = (marketplace || '').toLowerCase();
        if (mp === 'amazon.ca') return entry.itemCa || null;
        if (mp === 'amazon.com.mx') return entry.itemMx || null;
        return entry.itemUs || null;
    }

    /**
     * Finds an existing invoice by otherrefnum (Amazon order ID).
     * @param {string} orderId - Amazon order ID
     * @returns {string|null} Invoice internal ID, or null
     */
    function lookupInvoice(orderId) {
        if (!orderId) return null;
        try {
            var results = search.create({
                type: 'invoice',
                filters: [
                    ['otherrefnum', 'equalto', orderId],
                    'AND',
                    ['type', 'anyof', 'CustInvc'],
                    'AND',
                    ['mainline', 'is', 'T']
                ],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });

            if (results && results.length > 0) {
                return results[0].id;
            }
        } catch (e) {
            log.debug({ title: 'lookupInvoice', details: 'Error looking up invoice for order ' + orderId + ': ' + e.message });
        }
        return null;
    }

    // ========================================================================
    // Settlement Invoice creation
    // ========================================================================

    /**
     * Creates an invoice for a single Amazon order from settlement lines.
     * Follows old NES_ARES_sch_amazon_invoices.js logic.
     *
     * @param {Object} config - Connector config (customer, location, subsidiary, settleInvForm, etc.)
     * @param {string} orderId - Amazon order ID
     * @param {Array}  orderLines - Settlement line objects for this order
     * @param {string} marketplace - Marketplace name (e.g. 'Amazon.com')
     * @param {Object} chargeMap - Charge-map object { map: { descLower: { itemUs, itemCa, itemMx } } }
     * @returns {{ invoiceId: number, paymentTotal: number }}
     */
    function createSettlementInvoice(config, orderId, orderLines, marketplace, chargeMap) {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'financialService.createSettlementInvoice: Creating invoice for order ' + orderId +
            ', marketplace ' + (marketplace || 'unknown') + ', lines: ' + (orderLines ? orderLines.length : 0));

        var inv = record.create({
            type: record.Type.INVOICE,
            isDynamic: true
        });

        // --- Header fields ---
        if (config.customer) {
            inv.setValue({ fieldId: 'entity', value: config.customer });
        }

        var currencyId = resolveCurrencyId(marketplace);
        inv.setValue({ fieldId: 'currency', value: currencyId });

        if (config.location) {
            inv.setValue({ fieldId: 'location', value: config.location });
        }
        if (config.subsidiary) {
            inv.setValue({ fieldId: 'subsidiary', value: config.subsidiary });
        }
        if (config.settleInvForm) {
            inv.setValue({ fieldId: 'customform', value: config.settleInvForm });
        }

        inv.setValue({ fieldId: 'otherrefnum', value: orderId });
        inv.setValue({ fieldId: 'shippingcost', value: 0 });

        // Determine trandate as the earliest post_date from the order lines
        var earliestDate = null;
        for (var d = 0; d < orderLines.length; d++) {
            var pd = orderLines[d].post_date || orderLines[d].postDate;
            if (pd) {
                var parsed = new Date(pd);
                if (!isNaN(parsed.getTime()) && (earliestDate === null || parsed < earliestDate)) {
                    earliestDate = parsed;
                }
            }
        }
        inv.setValue({ fieldId: 'trandate', value: earliestDate || new Date() });

        // --- Line items ---
        var paymentTotal = 0;
        var lineCount = 0;

        for (var i = 0; i < orderLines.length; i++) {
            var line = orderLines[i];
            var amountType = line.amountType || line.amount_type || '';
            var desc = line.amountDesc || line.desc || line.amount_desc || '';
            var amount = parseFloat(line.amount) || 0;
            var sku = line.sku || '';
            var promoId = line.promoId || line.promo_id || '';
            var orderLineId = line.orderLineId || line.order_line_id || '';

            // Always add to payment total
            paymentTotal += amount;

            // Apply promotion remapping
            desc = remapPromotionDesc(amountType, desc);

            // Set promotion ID on invoice header if present
            if (promoId) {
                try {
                    inv.setValue({ fieldId: 'custbody_promotion_id', value: promoId });
                } catch (e) {
                    // Field may not exist in all environments
                }
            }

            // Skip Principal lines that are NOT promotions (added to paymentTotal only)
            if (desc === 'Principal' && amountType !== 'Promotion') {
                continue;
            }

            // Look up fee item from charge map
            var itemId = lookupSettlementItem(desc, marketplace, chargeMap);
            if (!itemId) {
                logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'financialService.createSettlementInvoice: No item found for desc=' + desc +
                    ', marketplace=' + marketplace + ', order=' + orderId + '. Skipping line.');
                continue;
            }

            // Deduplication: check if line already exists via custcol_celigo_etail_order_line_id
            if (orderLineId) {
                var existingLine = inv.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'custcol_celigo_etail_order_line_id',
                    value: orderLineId
                });
                if (existingLine !== -1) {
                    continue;
                }
            }

            // Add line
            inv.selectNewLine({ sublistId: 'item' });
            inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemId });
            inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: desc });
            inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 1 });
            inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: amount });
            if (orderLineId) {
                inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_celigo_etail_order_line_id', value: orderLineId });
            }
            inv.commitLine({ sublistId: 'item' });
            lineCount++;
        }

        if (lineCount === 0) {
            logger.warn(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'financialService.createSettlementInvoice: No lines added for order ' + orderId +
                '. Skipping invoice creation - check charge map configuration.');
            return { invoiceId: null, paymentTotal: paymentTotal };
        }

        var invoiceId = inv.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement invoice created for order ' + orderId, {
            recordType: 'invoice',
            recordId: invoiceId,
            amazonRef: orderId,
            lineCount: lineCount
        });

        return { invoiceId: invoiceId, paymentTotal: paymentTotal };
    }

    // ========================================================================
    // Settlement Credit Memo creation
    // ========================================================================

    /**
     * Creates a credit memo for refund lines from a settlement.
     * Follows old refund creation logic.
     *
     * @param {Object} config - Connector config
     * @param {string} orderId - Amazon order ID
     * @param {Array}  refundLines - Settlement refund line objects
     * @param {string} marketplace - Marketplace name
     * @param {Object} chargeMap - Charge-map object
     * @returns {number} Credit memo internal ID
     */
    function createSettlementCreditMemo(config, orderId, refundLines, marketplace, chargeMap) {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'financialService.createSettlementCreditMemo: Creating credit memo for order ' + orderId +
            ', marketplace ' + (marketplace || 'unknown') + ', lines: ' + (refundLines ? refundLines.length : 0));

        var cm = record.create({
            type: record.Type.CREDIT_MEMO,
            isDynamic: true
        });

        // --- Header fields ---
        if (config.customer) {
            cm.setValue({ fieldId: 'entity', value: config.customer });
        }

        var currencyId = resolveCurrencyId(marketplace);
        cm.setValue({ fieldId: 'currency', value: currencyId });

        if (config.location) {
            cm.setValue({ fieldId: 'location', value: config.location });
        }

        cm.setValue({ fieldId: 'otherrefnum', value: orderId });
        cm.setValue({ fieldId: 'shippingcost', value: 0 });

        // --- Line items ---
        var lineCount = 0;

        for (var i = 0; i < refundLines.length; i++) {
            var line = refundLines[i];
            var amountType = line.amountType || line.amount_type || '';
            var desc = line.amountDesc || line.desc || line.amount_desc || '';
            var amount = parseFloat(line.amount) || 0;
            var sku = line.sku || '';
            var orderLineId = line.orderLineId || line.order_line_id || '';

            // Skip zero-amount tax / withheld-tax lines
            if ((desc === 'Tax' || amountType === 'ItemWithheldTax') && amount === 0) {
                continue;
            }

            // Apply promotion remapping
            desc = remapPromotionDesc(amountType, desc);

            // Determine item
            var itemId = null;
            if (desc === 'Principal' && amountType !== 'Promotion') {
                // For principal refund lines, look up the actual catalog item by SKU
                itemId = lookupItem(sku);
            } else {
                // For fee/promotion refund lines, use charge map
                itemId = lookupSettlementItem(desc, marketplace, chargeMap);
            }

            if (!itemId) {
                logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'financialService.createSettlementCreditMemo: No item found for desc=' + desc +
                    ', sku=' + sku + ', marketplace=' + marketplace + ', order=' + orderId + '. Skipping line.');
                continue;
            }

            // Negate the amount for credit memo
            var negatedAmount = -amount;

            // Deduplication via custcol_celigo_etail_order_line_id
            if (orderLineId) {
                var existingLine = cm.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'custcol_celigo_etail_order_line_id',
                    value: orderLineId
                });
                if (existingLine !== -1) {
                    continue;
                }
            }

            // Add line
            cm.selectNewLine({ sublistId: 'item' });
            cm.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemId });
            cm.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: desc });
            cm.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 1 });
            cm.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: negatedAmount });
            if (orderLineId) {
                cm.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_celigo_etail_order_line_id', value: orderLineId });
            }
            cm.commitLine({ sublistId: 'item' });
            lineCount++;
        }

        if (lineCount === 0) {
            logger.warn(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'financialService.createSettlementCreditMemo: No lines added for order ' + orderId +
                '. Skipping credit memo creation - check charge map configuration.');
            return null;
        }

        var creditMemoId = cm.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement credit memo created for order ' + orderId, {
            recordType: 'creditmemo',
            recordId: creditMemoId,
            amazonRef: orderId,
            lineCount: lineCount
        });

        return creditMemoId;
    }

    // ========================================================================
    // Settlement Refund creation
    // ========================================================================

    /**
     * Creates a customer refund applied to a credit memo.
     *
     * @param {Object} config - Connector config (paymentMethod, refundPayAcct)
     * @param {number} creditMemoId - Credit memo internal ID to transform
     * @param {string|number} settlementId - Settlement record ID for reference
     * @returns {number} Customer refund internal ID
     */
    function createSettlementRefund(config, creditMemoId, settlementId) {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'financialService.createSettlementRefund: Creating customer refund from credit memo ' + creditMemoId +
            ', settlement ' + settlementId);

        var refund = record.transform({
            fromType: record.Type.CREDIT_MEMO,
            fromId: creditMemoId,
            toType: record.Type.CUSTOMER_REFUND,
            isDynamic: true
        });

        if (config.paymentMethod) {
            refund.setValue({ fieldId: 'paymentmethod', value: config.paymentMethod });
        }
        if (config.refundPayAcct) {
            refund.setValue({ fieldId: 'account', value: config.refundPayAcct });
        }

        try {
            refund.setValue({ fieldId: 'custbody_amz_settlement_id', value: settlementId });
        } catch (e) {
            // Field may not exist in all environments
        }

        // Find and apply the credit memo line
        var lineCount = refund.getLineCount({ sublistId: 'apply' });
        for (var i = 0; i < lineCount; i++) {
            var applyId = refund.getSublistValue({ sublistId: 'apply', fieldId: 'internalid', line: i });
            if (String(applyId) === String(creditMemoId)) {
                refund.selectLine({ sublistId: 'apply', line: i });
                refund.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
                refund.commitLine({ sublistId: 'apply' });
                break;
            }
        }

        var refundId = refund.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement refund created from credit memo ' + creditMemoId, {
            recordType: 'customerrefund',
            recordId: refundId,
            amazonRef: String(settlementId)
        });

        return refundId;
    }

    // ========================================================================
    // Kept functions (existing logic)
    // ========================================================================

    /**
     * Creates a Customer Payment against a settlement invoice.
     * Matches old process: transform invoice to payment, set undepfunds = T.
     * @param {Object} config - Connector config
     * @param {number} invoiceId - NetSuite Invoice internal ID
     * @param {Object} settlement - Settlement data with reportId, totalAmount
     * @param {string} [payDate] - Payment date (defaults to settlement end date)
     * @returns {number} Customer Payment record ID
     */
    function createSettlementPayment(config, invoiceId, settlement, payDate) {
        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'financialService.createSettlementPayment: Creating customer payment for invoice ' + invoiceId +
            ', settlement ' + settlement.reportId + ', totalAmount: ' + (settlement.totalAmount || 0));

        var payRec = record.transform({
            fromType: record.Type.INVOICE,
            fromId: invoiceId,
            toType: record.Type.CUSTOMER_PAYMENT,
            isDynamic: true
        });

        payRec.setValue({
            fieldId: 'payment',
            value: Math.abs(settlement.totalAmount || 0)
        });
        payRec.setValue({
            fieldId: 'trandate',
            value: payDate ? new Date(payDate) : (settlement.endDate ? new Date(settlement.endDate) : new Date())
        });
        payRec.setValue({ fieldId: 'undepfunds', value: 'T' });
        payRec.setValue({
            fieldId: 'memo',
            value: 'Amazon Settlement Payment: ' + (settlement.reportId || 'Unknown')
        });

        if (config.paymentMethod) {
            payRec.setValue({ fieldId: 'paymentmethod', value: config.paymentMethod });
        }

        // Apply to the specific invoice
        var lineCount = payRec.getLineCount({ sublistId: 'apply' });
        for (var i = 0; i < lineCount; i++) {
            var applyId = payRec.getSublistValue({ sublistId: 'apply', fieldId: 'internalid', line: i });
            if (String(applyId) === String(invoiceId)) {
                payRec.selectLine({ sublistId: 'apply', line: i });
                payRec.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
                payRec.commitLine({ sublistId: 'apply' });
                break;
            }
        }

        var paymentId = payRec.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
            'Customer Payment created for settlement ' + settlement.reportId, {
            configId: config.configId,
            recordType: 'customerpayment',
            recordId: paymentId,
            amazonRef: settlement.reportId
        });

        return paymentId;
    }

    /**
     * Creates a Credit Memo from a Return Authorization.
     * @param {Object} config
     * @param {number} rmaId - NetSuite Return Authorization ID
     * @param {Object} returnData - Amazon return info
     * @returns {number} Credit Memo ID
     */
    function createCreditMemo(config, rmaId, returnData) {
        const cm = record.transform({
            fromType: record.Type.RETURN_AUTHORIZATION,
            fromId: rmaId,
            toType: record.Type.CREDIT_MEMO,
            isDynamic: true
        });

        cm.setValue({
            fieldId: 'memo',
            value: 'Amazon Refund: ' + (returnData.returnId || returnData.amazonOrderId)
        });

        // Override refund amount if provided by Amazon
        if (returnData.refundAmount) {
            const lineCount = cm.getLineCount({ sublistId: 'item' });
            if (lineCount > 0) {
                cm.selectLine({ sublistId: 'item', line: 0 });
                const qty = cm.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' }) || 1;
                cm.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    value: parseFloat(returnData.refundAmount) / qty
                });
                cm.commitLine({ sublistId: 'item' });
            }
        }

        const cmId = cm.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.RETURN_SYNC,
            'Credit Memo created for return ' + (returnData.returnId || returnData.amazonOrderId), {
            configId: config.configId,
            recordType: 'creditmemo',
            recordId: cmId,
            amazonRef: returnData.amazonOrderId
        });

        return cmId;
    }

    /**
     * Creates a Customer Refund from a Credit Memo.
     * @param {Object} config
     * @param {number} creditMemoId
     * @returns {number} Customer Refund ID
     */
    function createCustomerRefund(config, creditMemoId) {
        const refund = record.transform({
            fromType: record.Type.CREDIT_MEMO,
            fromId: creditMemoId,
            toType: record.Type.CUSTOMER_REFUND,
            isDynamic: true
        });

        if (config.paymentMethod) {
            refund.setValue({ fieldId: 'paymentmethod', value: config.paymentMethod });
        }

        refund.setValue({
            fieldId: 'memo',
            value: 'Amazon Refund Processing'
        });

        return refund.save({ ignoreMandatoryFields: true });
    }

    /**
     * Updates a settlement record with financial reconciliation references.
     * Supports the new NS_INVOICE and NS_JOURNALS fields for configurable settlement processing.
     */
    function updateSettlementFinancials(settlementId, options) {
        options = options || {};
        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'financialService.updateSettlementFinancials: Marking settlement ' + settlementId + ' as RECONCILED. ' +
            'depositId: ' + (options.depositId || 'none') +
            ', invoiceId: ' + (options.invoiceId || 'none') +
            ', journalId: ' + (options.journalId || 'none') +
            ', journalIds: ' + (options.journalIds && options.journalIds.length ? options.journalIds.join(',') : 'none'));

        const values = { [STL.FIELDS.STATUS]: constants.SETTLEMENT_STATUS.RECONCILED };

        if (options.depositId) values[STL.FIELDS.NS_DEPOSIT] = options.depositId;
        if (options.invoiceId) values[STL.FIELDS.NS_INVOICE] = options.invoiceId;
        if (options.journalId) values[STL.FIELDS.NS_JOURNAL] = options.journalId;
        if (options.journalIds && options.journalIds.length > 0) {
            values[STL.FIELDS.NS_JOURNALS] = options.journalIds.join(',');
            // Also set the first JE as the primary reference
            if (!options.journalId) {
                values[STL.FIELDS.NS_JOURNAL] = options.journalIds[0];
            }
        }

        record.submitFields({
            type: STL.ID,
            id: settlementId,
            values: values
        });
    }

    // ========================================================================
    // Public API
    // ========================================================================

    return {
        createSettlementInvoice,
        createSettlementCreditMemo,
        createSettlementRefund,
        lookupInvoice,
        createSettlementPayment,
        createCreditMemo,
        createCustomerRefund,
        updateSettlementFinancials
    };
});
