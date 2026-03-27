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
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement MR getInputData: Starting input stage');

        const dataParam = runtime.getCurrentScript().getParameter({
            name: 'custscript_amz_mr_settle_data'
        });

        if (dataParam) {
            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement MR getInputData: Reading data file (File Cabinet ID: ' + dataParam + ')');

            var fileData = mrDataHelper.readDataFile(dataParam);
            var configId = fileData.configId;
            var reports = fileData.reports || [];

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement MR getInputData: Found ' + reports.length +
                ' report(s) for config ' + configId + ' from data file');

            // Embed configId in each report so map() can access it,
            // and return the array so MR iterates individual reports
            for (var i = 0; i < reports.length; i++) {
                reports[i]._configId = configId;
                reports[i]._fromFile = true;
            }
            return reports;
        }

        // If no explicit data, find all unreconciled settlements
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement MR getInputData: No data file parameter found. Searching for unreconciled settlement records (PENDING/PROCESSING status)');

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
     */
    function map(context) {
        try {
            const STL = constants.CUSTOM_RECORDS.SETTLEMENT.FIELDS;
            const result = JSON.parse(context.value);

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement MR map: Processing entry' +
                (result._fromFile ? ' (from file)' : ' (from search)') +
                ' - Report ID: ' + (result.reportId || result.values?.[STL.REPORT_ID] || 'unknown'));

            // File-based data: report metadata from scheduled script
            // Download the report, parse it, create settlement record, then emit
            if (result._fromFile) {
                var configId = result._configId;
                if (!configId) {
                    logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement MR map: Report ' + (result.reportId || 'unknown') + ' has no config assigned, skipping. ' +
                        'This means the data file did not contain a configId.');
                    return;
                }

                logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'Settlement MR map: Loading config ' + configId + ' for report ' + result.reportId);

                var config = configHelper.getConfig(configId);

                logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'Settlement MR map: Downloading settlement report from Amazon (reportDocumentId: ' + result.reportDocumentId + ')');

                var parsed = settlementService.downloadSettlementReport(config, result.reportDocumentId);

                logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'Settlement MR map: Report downloaded and parsed. Summary - totalAmount: ' + (parsed.summary.totalAmount || 0) +
                    ', productCharges: ' + (parsed.summary.productCharges || 0) +
                    ', sellingFees: ' + (parsed.summary.sellingFees || 0) +
                    ', fbaFees: ' + (parsed.summary.fbaFees || 0) +
                    ', rows parsed: ' + (parsed.rows ? parsed.rows.length : 0));

                // Reuse existing settlement record if one exists from a prior failed run
                logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'Settlement MR map: Checking if settlement record already exists for report ' + result.reportId);

                var existingId = settlementService.findExistingSettlement(result.reportId);
                var settlementId;
                if (existingId) {
                    settlementId = existingId;
                    logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement MR map: Reusing existing settlement record (ID: ' + existingId + ') from a prior run for report ' + result.reportId);
                } else {
                    settlementId = settlementService.createSettlementRecord(config, result, parsed.summary);
                    logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement MR map: Created new settlement record (ID: ' + settlementId + ') for report ' + result.reportId);
                }

                // Strip raw rows from rowsByMonth — only columnAmounts and date
                // are needed by reduce, and rows can push values over NetSuite's 10MB limit
                var compactRowsByMonth = null;
                if (parsed.rowsByMonth) {
                    compactRowsByMonth = {};
                    for (var mk in parsed.rowsByMonth) {
                        if (!parsed.rowsByMonth.hasOwnProperty(mk)) continue;
                        compactRowsByMonth[mk] = {
                            date: parsed.rowsByMonth[mk].date,
                            columnAmounts: parsed.rowsByMonth[mk].columnAmounts
                        };
                    }
                }

                var settlementData = {
                    settlementId: settlementId,
                    reportId: result.reportId,
                    totalAmount: parsed.summary.totalAmount || 0,
                    productCharges: parsed.summary.productCharges || 0,
                    shippingCredits: parsed.summary.shippingCredits || 0,
                    promoRebates: parsed.summary.promoRebates || 0,
                    sellingFees: parsed.summary.sellingFees || 0,
                    fbaFees: parsed.summary.fbaFees || 0,
                    otherFees: parsed.summary.otherFees || 0,
                    refunds: parsed.summary.refunds || 0,
                    endDate: result.dataEndTime || null,
                    columnAmounts: parsed.columnAmounts || null,
                    rowsByMonth: compactRowsByMonth
                };

                logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'Settlement MR map: Emitting settlement data to reduce stage. Key (configId): ' + configId +
                    ', settlementId: ' + settlementId + ', reportId: ' + result.reportId);

                context.write({
                    key: configId,
                    value: JSON.stringify(settlementData)
                });
                return;
            }

            // Search-based data: existing settlement records with NetSuite field IDs
            const values = result.values || result;

            var configValue = values[STL.CONFIG] ? values[STL.CONFIG].value || values[STL.CONFIG] : null;
            if (!configValue) {
                logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'Settlement MR map: Settlement ' + (values[STL.REPORT_ID] || result.id) +
                    ' has no config assigned, skipping. The settlement record is missing the config field reference.', {
                    details: 'Settlement ID: ' + result.id
                });
                return;
            }

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement MR map: Emitting search-based settlement (ID: ' + result.id +
                ', reportId: ' + values[STL.REPORT_ID] + ') to reduce stage. Key (configId): ' + configValue);

            var searchSettlementData = {
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

            // Include parsed column amounts and month groupings if available
            if (values.columnAmounts) searchSettlementData.columnAmounts = values.columnAmounts;
            if (values.rowsByMonth) searchSettlementData.rowsByMonth = values.rowsByMonth;

            context.write({
                key: configValue,
                value: JSON.stringify(searchSettlementData)
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

        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'Settlement MR reduce: Starting reduce for config ' + configId +
            '. Number of settlements to process: ' + context.values.length);

        try {
            const config = configHelper.getConfig(configId);

            // Determine settlement processing mode from config
            const settleTranType = config.settleTranType || constants.SETTLEMENT_TRAN_TYPE.DEPOSIT;
            const jeGrouping = config.jeGrouping || constants.JE_GROUPING.PER_SETTLEMENT;
            const useChargeMap = config.useChargeMap === true || config.useChargeMap === 'T';

            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement MR reduce: Config ' + configId + ' settings - ' +
                'tranType: ' + (settleTranType === constants.SETTLEMENT_TRAN_TYPE.INVOICE ? 'INVOICE' : 'DEPOSIT') +
                ', jeGrouping: ' + (jeGrouping === constants.JE_GROUPING.BY_MONTH ? 'BY_MONTH' : 'PER_SETTLEMENT') +
                ', useChargeMap: ' + useChargeMap +
                ', autoDeposit: ' + (config.autoDeposit || false) +
                ', settleAccount: ' + (config.settleAccount || 'NOT SET') +
                ', feeAccount: ' + (config.feeAccount || 'NOT SET') +
                ', customer: ' + (config.customer || 'NOT SET'));

            // Load charge account map if enabled
            let chargeAccountMap = null;
            if (useChargeMap) {
                chargeAccountMap = configHelper.getChargeAccountMap(configId);
                logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                    'Settlement MR reduce: Loaded charge account map with ' +
                    (chargeAccountMap && chargeAccountMap.map ? Object.keys(chargeAccountMap.map).length : 0) +
                    ' mapping(s), defaultAccount: ' + (chargeAccountMap && chargeAccountMap.defaultAccount ? chargeAccountMap.defaultAccount : 'NONE'));
            }

            for (const val of context.values) {
                const settlement = JSON.parse(val);

                logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                    'Settlement MR reduce: Processing settlement reportId: ' + settlement.reportId +
                    ', settlementId: ' + settlement.settlementId +
                    ', totalAmount: ' + settlement.totalAmount);

                let summary = null;
                try {
                    summary = {
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
                            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement MR reduce: Creating INVOICE for settlement ' + settlement.reportId +
                                '. Customer: ' + config.customer + ', totalAmount: ' + summary.totalAmount);
                            invoiceId = financialService.createInvoice(config, settlement, summary);
                            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement MR reduce: Invoice created (ID: ' + invoiceId + ') for settlement ' + settlement.reportId);
                        } else {
                            logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement MR reduce: Skipping invoice creation for settlement ' + settlement.reportId +
                                '. Reason: ' + (!config.customer ? 'customer not configured on config' : '') +
                                (!summary.totalAmount ? ((!config.customer ? ', ' : '') + 'totalAmount is 0 or empty') : ''), {
                                configId: configId,
                                amazonRef: settlement.reportId
                            });
                        }
                    } else {
                        // Deposit mode (default, existing behavior)
                        if (config.autoDeposit && config.settleAccount && summary.totalAmount) {
                            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement MR reduce: Creating DEPOSIT for settlement ' + settlement.reportId +
                                '. settleAccount: ' + config.settleAccount + ', totalAmount: ' + summary.totalAmount);
                            depositId = financialService.createDeposit(config, settlement, summary);
                            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement MR reduce: Deposit created (ID: ' + depositId + ') for settlement ' + settlement.reportId);
                        } else {
                            logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement MR reduce: Skipping deposit creation for settlement ' + settlement.reportId +
                                '. Reason: ' +
                                (!config.autoDeposit ? 'autoDeposit is disabled' : '') +
                                (!config.settleAccount ? ((!config.autoDeposit ? ', ' : '') + 'settleAccount not configured') : '') +
                                (!summary.totalAmount ? (((!config.autoDeposit || !config.settleAccount) ? ', ' : '') + 'totalAmount is 0 or empty') : ''), {
                                configId: configId,
                                amazonRef: settlement.reportId
                            });
                        }
                    }

                    // Create Fee Journal Entries based on configured grouping
                    var hasFees = summary.sellingFees || summary.fbaFees || summary.otherFees || summary.promoRebates;
                    var hasAccount = config.feeAccount || (chargeAccountMap && Object.keys(chargeAccountMap.map).length > 0);

                    logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                        'Settlement MR reduce: Fee JE check for settlement ' + settlement.reportId +
                        ' - sellingFees: ' + (summary.sellingFees || 0) +
                        ', fbaFees: ' + (summary.fbaFees || 0) +
                        ', otherFees: ' + (summary.otherFees || 0) +
                        ', promoRebates: ' + (summary.promoRebates || 0) +
                        ', hasFees: ' + !!hasFees +
                        ', hasAccount: ' + !!hasAccount);

                    if (hasFees && hasAccount) {
                        if (jeGrouping === constants.JE_GROUPING.BY_MONTH && settlement.rowsByMonth) {
                            var monthKeys = Object.keys(settlement.rowsByMonth);
                            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement MR reduce: Creating BY_MONTH fee JEs for settlement ' + settlement.reportId +
                                '. Months found: ' + monthKeys.join(', '));
                            // Split JEs by month (like old NES_ARES_sch_settlement_charges.js)
                            journalIds = financialService.createFeeJournalEntriesByMonth(
                                config, settlement, settlement.rowsByMonth, chargeAccountMap
                            );
                            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement MR reduce: Created ' + journalIds.length + ' monthly JE(s) for settlement ' + settlement.reportId +
                                '. JE IDs: ' + journalIds.join(', '));
                        } else {
                            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement MR reduce: Creating single fee JE (PER_SETTLEMENT) for settlement ' + settlement.reportId +
                                (settlement.columnAmounts ? '. Column amounts available for granular lines' : '. Using summary-based fee lines'));
                            // Single JE per settlement (default)
                            journalId = financialService.createFeeJournalEntry(
                                config, settlement, summary, settlement.columnAmounts, chargeAccountMap
                            );
                            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement MR reduce: Fee JE ' + (journalId ? 'created (ID: ' + journalId + ')' : 'was NOT created (no fee lines)') +
                                ' for settlement ' + settlement.reportId);
                        }
                    } else {
                        logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                            'Settlement MR reduce: Skipping fee JE creation for settlement ' + settlement.reportId +
                            '. Reason: ' + (!hasFees ? 'no fees found in settlement' : 'no fee account configured'), {
                            configId: configId,
                            amazonRef: settlement.reportId
                        });
                    }

                    logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                        'Settlement MR reduce: Updating settlement record ' + settlement.settlementId + ' to RECONCILED status. ' +
                        'depositId: ' + (depositId || 'none') +
                        ', invoiceId: ' + (invoiceId || 'none') +
                        ', journalId: ' + (journalId || 'none') +
                        ', journalIds: ' + (journalIds.length ? journalIds.join(',') : 'none'));

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
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement MR summarize: Map/Reduce execution completed. Reviewing results...');

        // Log input stage errors
        if (summary.inputSummary.error) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement MR summarize: Input stage error: ' + summary.inputSummary.error);
        } else {
            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement MR summarize: Input stage completed successfully (no errors)');
        }

        // Log map stage errors
        var mapErrorCount = 0;
        summary.mapSummary.errors.iterator().each(function (key, error) {
            mapErrorCount++;
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement MR summarize: Map error for key ' + key + ': ' + error);
            return true;
        });
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement MR summarize: Map stage completed with ' + mapErrorCount + ' error(s)');

        // Log reduce stage errors
        var reduceErrorCount = 0;
        summary.reduceSummary.errors.iterator().each(function (key, error) {
            reduceErrorCount++;
            logger.error(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement MR summarize: Reduce error for config ' + key + ': ' + error);
            return true;
        });
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement MR summarize: Reduce stage completed with ' + reduceErrorCount + ' error(s)');

        logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement MR summarize: Full execution finished. Map errors: ' + mapErrorCount +
            ', Reduce errors: ' + reduceErrorCount);
    }

    return { getInputData, map, reduce, summarize };
});
