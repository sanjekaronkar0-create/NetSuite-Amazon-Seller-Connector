/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @description Map/Reduce script for processing Amazon settlement reports in bulk.
 *              Creates Deposits and Journal Entries for financial reconciliation.
 */
define([
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/errorQueue',
    '../lib/logger',
    '../lib/mrDataHelper',
    '../services/settlementService',
    '../services/financialService'
], function (runtime, log, constants, configHelper, errorQueue, logger, mrDataHelper,
    settlementService, financialService) {

    /**
     * Input stage: gets settlement records pending reconciliation.
     * Parameter contains a File Cabinet file ID when triggered by scheduled script.
     */
    function getInputData() {
        const dataParam = runtime.getCurrentScript().getParameter({
            name: 'custscript_amz_mr_settle_data'
        });

        if (dataParam) {
            return mrDataHelper.readDataFile(dataParam);
        }

        // If no explicit data, find all unreconciled settlements
        return {
            type: 'search',
            id: null,
            filters: [
                [constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.STATUS, 'anyof',
                    [constants.SETTLEMENT_STATUS.PENDING, constants.SETTLEMENT_STATUS.PROCESSING]]
            ],
            columns: [
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.REPORT_ID,
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.TOTAL_AMOUNT,
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.PRODUCT_CHARGES,
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.SHIPPING_CREDITS,
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.PROMO_REBATES,
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.SELLING_FEES,
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.FBA_FEES,
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.OTHER_FEES,
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.REFUNDS,
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.CONFIG,
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.START_DATE,
                constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS.END_DATE
            ],
            type: constants.CUSTOM_RECORDS.SETTLEMENT.ID
        };
    }

    /**
     * Map stage: Pass each settlement to reduce keyed by config ID.
     */
    function map(context) {
        try {
            const STL = constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS;
            const result = JSON.parse(context.value);
            const values = result.values || result;

            var settlementData = {
                settlementId: result.id,
                reportId: values[STL.REPORT_ID],
                totalAmount: parseFloat(values[STL.TOTAL_AMOUNT]) || 0,
                productCharges: parseFloat(values[STL.PRODUCT_CHARGES]) || 0,
                shippingCredits: parseFloat(values[STL.SHIPPING_CREDITS]) || 0,
                promoRebates: parseFloat(values[STL.PROMO_REBATES]) || 0,
                sellingFees: parseFloat(values[STL.SELLING_FEES]) || 0,
                fbaFees: parseFloat(values[STL.FBA_FEES]) || 0,
                otherFees: parseFloat(values[STL.OTHER_FEES]) || 0,
                refunds: parseFloat(values[STL.REFUNDS]) || 0,
                endDate: values[STL.END_DATE]
            };

            // Include parsed column amounts and month groupings if available from data file
            if (values.columnAmounts) settlementData.columnAmounts = values.columnAmounts;
            if (values.rowsByMonth) settlementData.rowsByMonth = values.rowsByMonth;

            context.write({
                key: values[STL.CONFIG] ? values[STL.CONFIG].value || values[STL.CONFIG] : 'unknown',
                value: JSON.stringify(settlementData)
            });
        } catch (e) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement map error: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Reduce stage: Create Deposits/Invoices and Journal Entries per config.
     * Supports configurable settlement transaction type (DEPOSIT or INVOICE)
     * and JE grouping (PER_SETTLEMENT or BY_MONTH).
     */
    function reduce(context) {
        const configId = context.key;

        try {
            const config = configHelper.getConfig(configId);

            // Determine settlement processing mode from config
            const settleTranType = config.settleTranType || constants.SETTLEMENT_TRAN_TYPE.DEPOSIT;
            const jeGrouping = config.jeGrouping || constants.JE_GROUPING.PER_SETTLEMENT;
            const useChargeMap = config.useChargeMap === true || config.useChargeMap === 'T';

            // Load charge account map if enabled
            let chargeAccountMap = null;
            if (useChargeMap) {
                chargeAccountMap = configHelper.getChargeAccountMap(configId);
            }

            for (const val of context.values) {
                const settlement = JSON.parse(val);

                try {
                    const summary = {
                        totalAmount: settlement.totalAmount,
                        productCharges: settlement.productCharges,
                        shippingCredits: settlement.shippingCredits,
                        promoRebates: settlement.promoRebates,
                        sellingFees: settlement.sellingFees,
                        fbaFees: settlement.fbaFees,
                        otherFees: settlement.otherFees,
                        refunds: settlement.refunds
                    };

                    let depositId = null;
                    let invoiceId = null;
                    let journalId = null;
                    let journalIds = [];

                    // Create payment transaction based on configured type
                    if (settleTranType === constants.SETTLEMENT_TRAN_TYPE.INVOICE) {
                        // Invoice mode (like old NES_ARES_sch_amazon_invoices.js)
                        if (config.customer && summary.totalAmount) {
                            invoiceId = financialService.createInvoice(config, settlement, summary);
                        }
                    } else {
                        // Deposit mode (default, existing behavior)
                        if (config.autoDeposit && config.settleAccount && summary.totalAmount) {
                            depositId = financialService.createDeposit(config, settlement, summary);
                        }
                    }

                    // Create Fee Journal Entries based on configured grouping
                    var hasFees = summary.sellingFees || summary.fbaFees || summary.otherFees || summary.promoRebates;
                    var hasAccount = config.feeAccount || (chargeAccountMap && Object.keys(chargeAccountMap.map).length > 0);

                    if (hasFees && hasAccount) {
                        if (jeGrouping === constants.JE_GROUPING.BY_MONTH && settlement.rowsByMonth) {
                            // Split JEs by month (like old NES_ARES_sch_settlement_charges.js)
                            journalIds = financialService.createFeeJournalEntriesByMonth(
                                config, settlement, settlement.rowsByMonth, chargeAccountMap
                            );
                        } else {
                            // Single JE per settlement (default)
                            journalId = financialService.createFeeJournalEntry(
                                config, settlement, summary, settlement.columnAmounts, chargeAccountMap
                            );
                        }
                    }

                    // Update settlement record with all financial references
                    financialService.updateSettlementFinancials(settlement.settlementId, {
                        depositId: depositId,
                        invoiceId: invoiceId,
                        journalId: journalId,
                        journalIds: journalIds
                    });

                    logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
                        'Settlement ' + settlement.reportId + ' reconciled' +
                        (settleTranType === constants.SETTLEMENT_TRAN_TYPE.INVOICE ? ' (Invoice)' : ' (Deposit)') +
                        (jeGrouping === constants.JE_GROUPING.BY_MONTH ? ' [JEs by month]' : ''), {
                        configId: configId,
                        amazonRef: settlement.reportId
                    });

                } catch (e) {
                    logger.error(constants.LOG_TYPE.FINANCIAL_RECON,
                        'Settlement reconciliation error for ' + settlement.reportId + ': ' + e.message, {
                        configId: configId,
                        amazonRef: settlement.reportId,
                        details: e.stack
                    });

                    // Queue for retry
                    errorQueue.enqueue({
                        type: constants.ERROR_QUEUE_TYPE.SETTLEMENT_PROCESS,
                        amazonRef: settlement.reportId,
                        errorMsg: e.message,
                        configId: configId,
                        payload: JSON.stringify({ settlement, summary })
                    });
                }
            }
        } catch (e) {
            logger.error(constants.LOG_TYPE.FINANCIAL_RECON,
                'Reduce error for config ' + configId + ': ' + e.message, {
                configId: configId,
                details: e.stack
            });
        }
    }

    function summarize(summary) {
        log.audit({
            title: 'MR Settlement Process - Summary',
            details: 'Input errors: ' + (summary.inputSummary.error || 'none')
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            logger.error(constants.LOG_TYPE.FINANCIAL_RECON,
                'Reduce error for config ' + key + ': ' + error);
            return true;
        });
    }

    return { getInputData, map, reduce, summarize };
});
