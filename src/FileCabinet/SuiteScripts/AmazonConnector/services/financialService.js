/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Financial reconciliation service.
 *              Creates Deposits, Journal Entries, and Credit Memos for Amazon settlements and returns.
 */
define([
    'N/record',
    'N/search',
    'N/log',
    '../lib/constants',
    '../lib/logger'
], function (record, search, log, constants, logger) {

    const STL = constants.CUSTOM_RECORDS.SETTLEMENT;

    /**
     * Creates a NetSuite Deposit from Amazon settlement data.
     * @param {Object} config - Connector config with account mappings
     * @param {Object} settlement - Settlement record data
     * @param {Object} summary - Financial summary (productCharges, fees, etc.)
     * @returns {number} Deposit record ID
     */
    function createDeposit(config, settlement, summary) {
        const deposit = record.create({
            type: record.Type.DEPOSIT,
            isDynamic: true
        });

        if (config.subsidiary) {
            deposit.setValue({ fieldId: 'subsidiary', value: config.subsidiary });
        }
        if (config.settleAccount) {
            deposit.setValue({ fieldId: 'account', value: config.settleAccount });
        }

        deposit.setValue({
            fieldId: 'trandate',
            value: settlement.endDate ? new Date(settlement.endDate) : new Date()
        });
        deposit.setValue({
            fieldId: 'memo',
            value: 'Amazon Settlement: ' + (settlement.reportId || 'Unknown')
        });

        // Add deposit line for net settlement amount
        deposit.selectNewLine({ sublistId: 'other' });
        deposit.setCurrentSublistValue({
            sublistId: 'other',
            fieldId: 'account',
            value: config.settleAccount
        });
        deposit.setCurrentSublistValue({
            sublistId: 'other',
            fieldId: 'amount',
            value: Math.abs(summary.totalAmount || 0)
        });
        deposit.setCurrentSublistValue({
            sublistId: 'other',
            fieldId: 'memo',
            value: 'Amazon Settlement Deposit'
        });
        deposit.commitLine({ sublistId: 'other' });

        const depositId = deposit.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
            'Deposit created for settlement ' + settlement.reportId, {
            configId: config.configId,
            recordType: 'deposit',
            recordId: depositId,
            amazonRef: settlement.reportId
        });

        return depositId;
    }

    /**
     * Creates a Journal Entry to record Amazon fees from a settlement.
     * Debits fee expense accounts and credits the settlement clearing account.
     * @param {Object} config
     * @param {Object} settlement
     * @param {Object} summary
     * @returns {number} Journal Entry ID
     */
    function createFeeJournalEntry(config, settlement, summary) {
        const je = record.create({
            type: record.Type.JOURNAL_ENTRY,
            isDynamic: true
        });

        if (config.subsidiary) {
            je.setValue({ fieldId: 'subsidiary', value: config.subsidiary });
        }
        je.setValue({
            fieldId: 'trandate',
            value: settlement.endDate ? new Date(settlement.endDate) : new Date()
        });
        je.setValue({
            fieldId: 'memo',
            value: 'Amazon Fees - Settlement: ' + (settlement.reportId || 'Unknown')
        });

        let lineIdx = 0;

        // Selling Fees (debit expense account)
        if (summary.sellingFees && config.feeAccount) {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: config.feeAccount });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.abs(summary.sellingFees) });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Amazon Selling Fees' });
            je.commitLine({ sublistId: 'line' });
            lineIdx++;
        }

        // FBA Fees (debit FBA expense account)
        if (summary.fbaFees && config.fbaFeeAccount) {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: config.fbaFeeAccount });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.abs(summary.fbaFees) });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Amazon FBA Fees' });
            je.commitLine({ sublistId: 'line' });
            lineIdx++;
        }

        // Promo Rebates (debit promo expense account)
        if (summary.promoRebates && config.promoAccount) {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: config.promoAccount });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.abs(summary.promoRebates) });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Amazon Promotional Rebates' });
            je.commitLine({ sublistId: 'line' });
            lineIdx++;
        }

        // Other Fees
        if (summary.otherFees && config.feeAccount) {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: config.feeAccount });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.abs(summary.otherFees) });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Amazon Other Fees' });
            je.commitLine({ sublistId: 'line' });
            lineIdx++;
        }

        // If no fee lines, skip JE creation
        if (lineIdx === 0) {
            log.debug({ title: 'Financial Service', details: 'No fee lines to journal for settlement ' + settlement.reportId });
            return null;
        }

        // Credit line: settlement/clearing account
        const totalDebits = Math.abs(summary.sellingFees || 0) + Math.abs(summary.fbaFees || 0) +
            Math.abs(summary.promoRebates || 0) + Math.abs(summary.otherFees || 0);

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: config.settleAccount });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: totalDebits });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Amazon Settlement Clearing' });
        je.commitLine({ sublistId: 'line' });

        const jeId = je.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
            'Fee Journal Entry created for settlement ' + settlement.reportId, {
            configId: config.configId,
            recordType: 'journalentry',
            recordId: jeId,
            amazonRef: settlement.reportId
        });

        return jeId;
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
     */
    function updateSettlementFinancials(settlementId, depositId, journalId) {
        const values = { [STL.FIELDS.STATUS]: constants.SETTLEMENT_STATUS.RECONCILED };
        if (depositId) values[STL.FIELDS.NS_DEPOSIT] = depositId;
        if (journalId) values[STL.FIELDS.NS_JOURNAL] = journalId;

        record.submitFields({
            type: STL.ID,
            id: settlementId,
            values: values
        });
    }

    return {
        createDeposit,
        createFeeJournalEntry,
        createCreditMemo,
        createCustomerRefund,
        updateSettlementFinancials
    };
});
