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
            var fileData = mrDataHelper.readDataFile(dataParam);
            // File contains { configId, reports: [...] }
            // Inject configId into each report so map can key by config
            var reports = fileData.reports || [];
            var configId = fileData.configId;
            for (var i = 0; i < reports.length; i++) {
                reports[i].configId = configId;
            }
            return reports;
        }

        // If no explicit data, find all unreconciled settlements
        return {
            type: constants.CUSTOM_RECORDS.SETTLEMENT.ID,
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
            ]
        };
    }

    /**
     * Map stage: Pass each settlement to reduce keyed by config ID.
     * Includes columnAmounts and orderColumnAmounts when available from file input.
     */
    function map(context) {
        try {
            const STL = constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS;
            const result = JSON.parse(context.value);
            const values = result.values || result;

            // Detect data source: file-based input has 'reportId' directly,
            // search-based input uses NetSuite field IDs as keys.
            var isFileInput = !!values.reportId && !values[STL.REPORT_ID];
            var summary = values.summary || {};

            var payload;
            if (isFileInput) {
                // File-based input: data from ss_settlement_sync with parsed report
                payload = {
                    settlementId: result.id || values.reportId,
                    reportId: values.reportId,
                    totalAmount: parseFloat(summary.totalAmount) || 0,
                    productCharges: parseFloat(summary.productCharges) || 0,
                    shippingCredits: parseFloat(summary.shippingCredits) || 0,
                    promoRebates: parseFloat(summary.promoRebates) || 0,
                    sellingFees: parseFloat(summary.sellingFees) || 0,
                    fbaFees: parseFloat(summary.fbaFees) || 0,
                    otherFees: parseFloat(summary.otherFees) || 0,
                    refunds: parseFloat(summary.refunds) || 0,
                    endDate: values.dataEndTime || values.endDate,
                    columnAmounts: values.columnAmounts || null,
                    orderColumnAmounts: values.orderColumnAmounts || null
                };
            } else {
                // Search-based input: data from settlement custom records
                payload = {
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
            }

            // Determine config key
            var configKey = 'unknown';
            if (isFileInput && values.configId) {
                configKey = values.configId;
            } else if (values[STL.CONFIG]) {
                configKey = values[STL.CONFIG].value || values[STL.CONFIG];
            }

            context.write({
                key: configKey,
                value: JSON.stringify(payload)
            });
        } catch (e) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement map error: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Reduce stage: Create financial records per config.
     * Supports configurable fee mode (journal entry or invoice line items)
     * and payment mode (deposit or customer payment).
     */
    function reduce(context) {
        const configId = context.key;
        const SETTLE_FEE_MODE = constants.SETTLE_FEE_MODE;
        const SETTLE_PAYMENT_MODE = constants.SETTLE_PAYMENT_MODE;

        try {
            const config = configHelper.getConfig(configId);
            var useInvoiceFeeMode = config.settleFeeMode === SETTLE_FEE_MODE.INVOICE;
            var usePaymentMode = config.settlePaymentMode === SETTLE_PAYMENT_MODE.PAYMENT;

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
                    let journalId = null;
                    let paymentId = null;

                    // --- Fee Lines: Invoice mode vs Journal mode ---
                    if (useInvoiceFeeMode && settlement.orderColumnAmounts) {
                        // Add fee lines to each order's invoice
                        var orderColAmts = settlement.orderColumnAmounts;
                        for (var orderId in orderColAmts) {
                            if (!orderColAmts.hasOwnProperty(orderId)) continue;
                            try {
                                financialService.addFeeLinesToInvoice(
                                    config, orderColAmts[orderId], orderId
                                );
                            } catch (invErr) {
                                log.debug({
                                    title: 'Invoice fee line error',
                                    details: 'Order ' + orderId + ': ' + invErr.message
                                });
                            }
                        }
                    } else if (config.feeAccount && (summary.sellingFees || summary.fbaFees || summary.otherFees)) {
                        // Fallback: create Journal Entry (original behavior)
                        journalId = financialService.createFeeJournalEntry(
                            config, settlement, summary, settlement.columnAmounts
                        );
                    }

                    // --- Payment: Customer Payment mode vs Deposit mode ---
                    if (usePaymentMode && settlement.orderColumnAmounts) {
                        // Create customer payment for each order's invoice
                        var orderIds = Object.keys(settlement.orderColumnAmounts);
                        for (var i = 0; i < orderIds.length; i++) {
                            var invoiceId = financialService.findInvoiceByAmazonOrderId(orderIds[i]);
                            if (invoiceId) {
                                try {
                                    paymentId = financialService.createCustomerPayment(
                                        config, invoiceId, settlement
                                    );
                                } catch (payErr) {
                                    log.debug({
                                        title: 'Customer payment error',
                                        details: 'Order ' + orderIds[i] + ': ' + payErr.message
                                    });
                                }
                            }
                        }
                    } else if (config.autoDeposit && config.settleAccount && summary.totalAmount) {
                        // Fallback: create Deposit (original behavior)
                        depositId = financialService.createDeposit(config, settlement, summary);
                    }

                    // Update settlement record
                    financialService.updateSettlementFinancials(
                        settlement.settlementId, depositId, journalId, paymentId
                    );

                    logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
                        'Settlement ' + settlement.reportId + ' reconciled', {
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
                        type: constants.ERROR_QUEUE_TYPE.DEPOSIT_CREATE,
                        amazonRef: settlement.reportId,
                        errorMsg: e.message,
                        configId: configId,
                        payload: JSON.stringify({ settlement: settlement, summary: summary })
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
