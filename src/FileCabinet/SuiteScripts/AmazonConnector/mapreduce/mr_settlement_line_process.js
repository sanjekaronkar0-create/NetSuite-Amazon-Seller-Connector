/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @description Map/Reduce script that replicates the old settlement process:
 *              1. Downloads settlement flat file from Amazon SP-API
 *              2. Creates one customrecord_amz_settlement_line per TSV row
 *              3. Aggregates totals into customrecord_amz_settlement (summary)
 *              4. Creates Journal Entries for other charges grouped by month
 *              Replaces both the old Jitterbit import and NES_ARES_sch_amz_summary/settlement_charges scripts.
 */
define([
    'N/runtime',
    'N/record',
    'N/search',
    'N/format',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/errorQueue',
    '../lib/logger',
    '../lib/mrDataHelper',
    '../services/settlementService',
    '../services/financialService'
], function (runtime, record, search, format, log, constants, configHelper, errorQueue, logger, mrDataHelper,
    settlementService, financialService) {

    const STL = constants.CUSTOM_RECORDS.SETTLEMENT;
    const SL = constants.CUSTOM_RECORDS.SETTLEMENT_LINE;

    /**
     * Input stage: reads data file parameter written by ss_settlement_sync.js.
     * Returns list of settlement reports to process.
     */
    function getInputData() {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement Line MR getInputData: Starting input stage');

        const dataParam = runtime.getCurrentScript().getParameter({
            name: 'custscript_amz_mr_stl_line_data'
        });

        if (dataParam) {
            var fileData = mrDataHelper.readDataFile(dataParam);
            var configId = fileData.configId;
            var reports = fileData.reports || [];

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR getInputData: Found ' + reports.length +
                ' report(s) for config ' + configId);

            for (var i = 0; i < reports.length; i++) {
                reports[i]._configId = configId;
            }
            return reports;
        }

        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement Line MR getInputData: No data file parameter. Nothing to process.');
        return [];
    }

    /**
     * Map stage: For each settlement report:
     *  - Download the TSV from Amazon
     *  - Create/find summary record (customrecord_amz_settlement)
     *  - Create one customrecord_amz_settlement_line per TSV row
     *  - Emit summary record ID to reduce for aggregation + JE creation
     */
    function map(context) {
        try {
            var report = JSON.parse(context.value);
            var configId = report._configId;

            if (!configId) {
                logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'Settlement Line MR map: No configId for report ' + (report.reportId || 'unknown'));
                return;
            }

            var config = configHelper.getConfig(configId);

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR map: Downloading report ' + report.reportId +
                ' (docId: ' + report.reportDocumentId + ')');

            var parsed = settlementService.downloadSettlementReport(config, report.reportDocumentId);

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR map: Parsed ' + parsed.rows.length + ' rows from report ' + report.reportId);

            // Create or find summary record
            var existingId = settlementService.findExistingSettlement(report.reportId);
            var summaryId;
            if (existingId) {
                summaryId = existingId;
                logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'Settlement Line MR map: Reusing existing summary record ' + existingId);
            } else {
                summaryId = settlementService.createSettlementRecord(config, report, parsed.summary);
                logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'Settlement Line MR map: Created summary record ' + summaryId);
            }

            // Store raw settlement file
            if (parsed.rawData) {
                try {
                    settlementService.storeSettlementFile(report.reportId, parsed.rawData, summaryId);
                } catch (fileErr) {
                    logger.warn(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement Line MR map: Could not store file: ' + fileErr.message);
                }
            }

            // Extract settlement-level fields from the first row (like old process)
            var firstRow = parsed.rows.length > 0 ? parsed.rows[0] : {};
            var settlementTotal = firstRow['total-amount'] || firstRow['settlement-total'] || '';
            var depositDate = firstRow['deposit-date'] || '';
            var startDate = firstRow['settlement-start-date'] || report.dataStartTime || '';
            var endDate = firstRow['settlement-end-date'] || report.dataEndTime || '';
            var currency = firstRow['currency'] || '';

            // Update summary with settlement-level metadata
            var summaryUpdates = {};
            if (settlementTotal) summaryUpdates[STL.FIELDS.EXPECTED_TOTAL] = parseFloat(settlementTotal) || 0;
            if (depositDate) summaryUpdates[STL.FIELDS.DEPOSIT_DATE] = depositDate;
            if (currency) summaryUpdates[STL.FIELDS.CURRENCY] = currency;
            summaryUpdates[STL.FIELDS.RECALC] = true;

            if (Object.keys(summaryUpdates).length > 0) {
                record.submitFields({
                    type: STL.ID,
                    id: summaryId,
                    values: summaryUpdates
                });
            }

            // Create one settlement line record per TSV row
            var lineCount = 0;
            for (var i = 0; i < parsed.rows.length; i++) {
                try {
                    createSettlementLine(configId, summaryId, report.reportId, parsed.rows[i]);
                    lineCount++;
                } catch (lineErr) {
                    logger.warn(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement Line MR map: Error creating line ' + i + ': ' + lineErr.message);
                }
            }

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR map: Created ' + lineCount + ' line records for report ' + report.reportId);

            // Emit summary ID to reduce for aggregation + JE creation
            context.write({
                key: summaryId,
                value: JSON.stringify({
                    summaryId: summaryId,
                    configId: configId,
                    reportId: report.reportId,
                    settlementId: report.reportId,
                    endDate: endDate || report.dataEndTime
                })
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR map error: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Creates a single customrecord_amz_settlement_line from a parsed TSV row.
     * Maps TSV column names to custom record fields (like old Jitterbit import).
     */
    function createSettlementLine(configId, summaryId, reportSettlementId, row) {
        var rec = record.create({ type: SL.ID });

        var settlementId = row['settlement-id'] || reportSettlementId || '';
        var orderId = row['order-id'] || '';
        var marketplace = row['marketplace-name'] || '';
        var tranType = row['transaction-type'] || '';
        var amountType = row['amount-type'] || '';
        var amountDesc = row['amount-description'] || '';
        var amount = parseFloat(row['amount'] || row['total'] || 0);
        var currency = row['currency'] || '';
        var sku = row['sku'] || '';
        var quantity = row['quantity-purchased'] || '';
        var postDate = row['posted-date'] || row['posted-date-time'] || '';
        var merchantId = row['merchant-order-id'] || '';
        var promoId = row['promotion-id'] || '';

        rec.setValue({ fieldId: SL.FIELDS.SETTLEMENT_ID, value: settlementId });
        rec.setValue({ fieldId: SL.FIELDS.ORDER_ID, value: orderId });
        rec.setValue({ fieldId: SL.FIELDS.MARKETPLACE, value: marketplace });
        rec.setValue({ fieldId: SL.FIELDS.TRAN_TYPE, value: tranType });
        rec.setValue({ fieldId: SL.FIELDS.AMOUNT_TYPE, value: amountType });
        rec.setValue({ fieldId: SL.FIELDS.AMOUNT_DESC, value: amountDesc });
        rec.setValue({ fieldId: SL.FIELDS.AMOUNT, value: amount });
        rec.setValue({ fieldId: SL.FIELDS.CURRENCY, value: currency });
        rec.setValue({ fieldId: SL.FIELDS.SKU, value: sku });
        rec.setValue({ fieldId: SL.FIELDS.QUANTITY, value: quantity });
        rec.setValue({ fieldId: SL.FIELDS.POST_DATE, value: postDate });
        rec.setValue({ fieldId: SL.FIELDS.MERCHANT_ID, value: merchantId });
        rec.setValue({ fieldId: SL.FIELDS.PROMO_ID, value: promoId });
        rec.setValue({ fieldId: SL.FIELDS.SUMMARY, value: summaryId });
        rec.setValue({ fieldId: SL.FIELDS.CONFIG, value: configId });

        // Convert posted date to NS date format (ported from old NES_ARES_sch_amz_summary.js)
        if (postDate) {
            try {
                var nsDate = convertPostDate(postDate);
                if (nsDate) {
                    rec.setValue({ fieldId: SL.FIELDS.POST_DATE_NS, value: nsDate });

                    // Look up accounting period
                    var periodId = lookupAccountingPeriod(nsDate);
                    if (periodId) {
                        rec.setValue({ fieldId: SL.FIELDS.POST_PERIOD, value: periodId });
                    }
                }
            } catch (dateErr) {
                // Non-fatal - line still gets created without converted date
            }
        }

        return rec.save({ ignoreMandatoryFields: true });
    }

    /**
     * Converts a raw posted date string to a NetSuite Date object.
     * Handles ISO 8601 format (2020-01-15T00:00:00+00:00) and DD.MM.YYYY format.
     * Ported from old NES_ARES_sch_amz_summary.js date conversion logic.
     */
    function convertPostDate(dateStr) {
        if (!dateStr) return null;

        var d;
        if (dateStr.indexOf('T') !== -1 || dateStr.indexOf('-') !== -1) {
            // ISO 8601 format: 2020-01-15T00:00:00+00:00
            d = new Date(dateStr);
        } else if (dateStr.indexOf('.') !== -1) {
            // DD.MM.YYYY format
            var parts = dateStr.split('.');
            d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        } else {
            d = new Date(dateStr);
        }

        if (isNaN(d.getTime())) return null;
        return d;
    }

    /**
     * Looks up the NetSuite accounting period that contains a given date.
     * Ported from old NES_ARES_sch_amz_summary.js period lookup logic.
     */
    function lookupAccountingPeriod(nsDate) {
        if (!nsDate) return null;

        var formattedDate = format.format({ value: nsDate, type: format.Type.DATE });

        var periodSearch = search.create({
            type: 'accountingperiod',
            filters: [
                ['isquarter', 'is', 'F'],
                'AND',
                ['isyear', 'is', 'F'],
                'AND',
                ['startdate', 'onorbefore', formattedDate],
                'AND',
                ['enddate', 'onorafter', formattedDate]
            ],
            columns: [
                search.createColumn({ name: 'periodname', sort: search.Sort.ASC })
            ]
        });

        var results = periodSearch.run().getRange({ start: 0, end: 1 });
        if (results && results.length > 0) {
            return results[0].id;
        }
        return null;
    }

    /**
     * Reduce stage: For each summary record:
     *  1. Aggregate line amounts into summary totals (like old NES_ARES_sch_amz_summary.js recalc)
     *  2. Based on settleTranType config:
     *     - INVOICE mode: Create invoice with fee lines + Customer Payment (like old NES_ARES_sch_amazon_invoices.js)
     *     - DEPOSIT mode: Create deposit + fee JEs
     *  3. Create JEs for other/unmapped charges grouped by month
     */
    function reduce(context) {
        var summaryId = context.key;

        try {
            // Take the first value to get config info
            var data = JSON.parse(context.values[0]);
            var configId = data.configId;
            var reportId = data.reportId;

            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement Line MR reduce: Processing summary ' + summaryId +
                ' for report ' + reportId + ', config ' + configId);

            var config = configHelper.getConfig(configId);

            // Determine settlement processing mode from config (matches old mr_settlement_process.js)
            var settleTranType = config.settleTranType || constants.SETTLEMENT_TRAN_TYPE.DEPOSIT;
            var useChargeMap = config.useChargeMap === true || config.useChargeMap === 'T';

            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement Line MR reduce: Config ' + configId + ' settings - ' +
                'tranType: ' + (settleTranType === constants.SETTLEMENT_TRAN_TYPE.INVOICE ? 'INVOICE' : 'DEPOSIT') +
                ', useChargeMap: ' + useChargeMap +
                ', autoDeposit: ' + (config.autoDeposit || false) +
                ', settleAccount: ' + (config.settleAccount || 'NOT SET') +
                ', feeAccount: ' + (config.feeAccount || 'NOT SET') +
                ', customer: ' + (config.customer || 'NOT SET'));

            // Load charge account map if enabled
            var chargeAccountMap = null;
            if (useChargeMap) {
                chargeAccountMap = configHelper.getChargeAccountMap(configId);
                logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                    'Settlement Line MR reduce: Loaded charge account map with ' +
                    (chargeAccountMap && chargeAccountMap.map ? Object.keys(chargeAccountMap.map).length : 0) +
                    ' mapping(s)');
            }

            // Load column-item map for INVOICE mode (maps fee descriptions → Other Charge items)
            var columnItemMap = null;
            if (settleTranType === constants.SETTLEMENT_TRAN_TYPE.INVOICE) {
                columnItemMap = configHelper.getColumnItemMap(configId, { useInSettle: true });
                logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                    'Settlement Line MR reduce: Loaded column-item map with ' +
                    (columnItemMap ? Object.keys(columnItemMap).length : 0) + ' mapping(s) for invoice fee lines');
            }

            // ---- Step 1: Aggregate line amounts (replicates old recalc logic) ----
            var totals = recalcSummaryTotals(summaryId);

            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement Line MR reduce: Aggregated totals for summary ' + summaryId +
                ' - payments: ' + totals.totalPayments +
                ', refunds: ' + totals.totalRefunds +
                ', otherCharges: ' + totals.totalOtherCharges +
                ', total: ' + totals.settlementTotal);

            // Update summary record with aggregated totals
            var updateValues = {};
            updateValues[STL.FIELDS.TOTAL_PAYMENTS] = totals.totalPayments;
            updateValues[STL.FIELDS.TOTAL_REFUNDS] = totals.totalRefunds;
            updateValues[STL.FIELDS.TOTAL_OTHER] = totals.totalOtherCharges;
            updateValues[STL.FIELDS.TOTAL_AMOUNT] = totals.settlementTotal;
            updateValues[STL.FIELDS.PRODUCT_CHARGES] = totals.totalPayments;
            updateValues[STL.FIELDS.REFUNDS] = totals.totalRefunds;
            updateValues[STL.FIELDS.OTHER_FEES] = totals.totalOtherCharges;
            updateValues[STL.FIELDS.RECALC] = false;

            record.submitFields({
                type: STL.ID,
                id: summaryId,
                values: updateValues
            });

            // Check no_je flag and get currency
            var summaryRec = search.lookupFields({
                type: STL.ID,
                id: summaryId,
                columns: [STL.FIELDS.NO_JE, STL.FIELDS.EXPECTED_TOTAL, STL.FIELDS.CURRENCY]
            });
            var noJe = summaryRec[STL.FIELDS.NO_JE] === true || summaryRec[STL.FIELDS.NO_JE] === 'T';
            var currency = summaryRec[STL.FIELDS.CURRENCY] || '';

            var depositId = null;
            var invoiceId = null;
            var paymentId = null;
            var journalId = null;
            var journalIds = [];

            // Build settlement object for financialService calls
            var settlement = {
                reportId: reportId,
                endDate: data.endDate,
                totalAmount: totals.settlementTotal
            };
            var summary = {
                totalAmount: totals.settlementTotal,
                productCharges: totals.totalPayments,
                sellingFees: 0,
                fbaFees: 0,
                otherFees: totals.totalOtherCharges,
                promoRebates: 0,
                shippingCredits: 0,
                refunds: totals.totalRefunds
            };

            // ---- Step 2: Create financial transactions based on configured type ----
            if (settleTranType === constants.SETTLEMENT_TRAN_TYPE.INVOICE) {
                // INVOICE mode: fees go directly on the invoice as Other Charge items
                // then create Customer Payment (like old NES_ARES_sch_amazon_invoices.js updateInvoices)
                if (config.customer) {
                    // Build columnAmounts from settlement lines for granular invoice lines
                    var columnAmounts = buildColumnAmountsFromLines(summaryId);
                    settlement.columnAmounts = columnAmounts;

                    logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                        'Settlement Line MR reduce: Creating INVOICE with fee lines for settlement ' + reportId +
                        '. Customer: ' + config.customer + ', totalAmount: ' + summary.totalAmount +
                        ', columnAmounts: ' + (columnAmounts ? Object.keys(columnAmounts).length + ' entries' : 'NONE'));

                    var invoiceResult = financialService.createInvoice(
                        config, settlement, summary, columnAmounts, columnItemMap
                    );
                    invoiceId = invoiceResult.invoiceId;

                    logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                        'Settlement Line MR reduce: Invoice created (ID: ' + invoiceId + ') for settlement ' + reportId +
                        (invoiceResult.unmappedFees && Object.keys(invoiceResult.unmappedFees).length > 0
                            ? '. Unmapped fees: ' + Object.keys(invoiceResult.unmappedFees).join(', ')
                            : '. All fees mapped to invoice lines'));

                    // Create Customer Payment against the invoice
                    if (invoiceId && summary.totalAmount) {
                        try {
                            paymentId = financialService.createSettlementPayment(config, invoiceId, settlement);
                            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement Line MR reduce: Customer Payment created (ID: ' + paymentId + ') for settlement ' + reportId);
                        } catch (payErr) {
                            logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                                'Settlement Line MR reduce: Customer Payment creation failed for settlement ' + reportId +
                                ': ' + payErr.message + '. Invoice ' + invoiceId + ' was created but remains open.');
                        }
                    }

                    // Create JE only for unmapped fees (charges without a column-item mapping)
                    var unmappedFees = invoiceResult.unmappedFees || {};
                    if (Object.keys(unmappedFees).length > 0 && useChargeMap) {
                        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                            'Settlement Line MR reduce: Creating JE for ' + Object.keys(unmappedFees).length +
                            ' unmapped fee(s) for settlement ' + reportId);
                        var unmappedSummary = { sellingFees: 0, fbaFees: 0, otherFees: 0, promoRebates: 0 };
                        for (var uf in unmappedFees) {
                            if (unmappedFees.hasOwnProperty(uf)) unmappedSummary.otherFees += unmappedFees[uf];
                        }
                        journalId = financialService.createFeeJournalEntry(
                            config, settlement, unmappedSummary, unmappedFees, chargeAccountMap
                        );
                    }
                } else {
                    logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                        'Settlement Line MR reduce: Skipping invoice creation for settlement ' + reportId +
                        '. Reason: customer not configured on config', {
                        configId: configId,
                        amazonRef: reportId
                    });
                }
            } else {
                // DEPOSIT mode (default, existing behavior)
                if (config.autoDeposit && config.settleAccount && totals.settlementTotal) {
                    logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                        'Settlement Line MR reduce: Creating DEPOSIT for settlement ' + reportId +
                        '. settleAccount: ' + config.settleAccount + ', totalAmount: ' + summary.totalAmount);
                    depositId = financialService.createDeposit(config, settlement, summary);
                    logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                        'Settlement Line MR reduce: Deposit created (ID: ' + depositId + ') for settlement ' + reportId);
                } else {
                    logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                        'Settlement Line MR reduce: Skipping deposit creation for settlement ' + reportId +
                        '. Reason: ' +
                        (!config.autoDeposit ? 'autoDeposit is disabled' : '') +
                        (!config.settleAccount ? ((!config.autoDeposit ? ', ' : '') + 'settleAccount not configured') : '') +
                        (!totals.settlementTotal ? (((!config.autoDeposit || !config.settleAccount) ? ', ' : '') + 'totalAmount is 0 or empty') : ''), {
                        configId: configId,
                        amazonRef: reportId
                    });
                }

                // Create JEs for other charges (DEPOSIT mode only — in INVOICE mode fees are on the invoice)
                if (!noJe && totals.totalOtherCharges !== 0) {
                    journalIds = createOtherChargeJEsFromLines(config, summaryId, reportId, currency);
                    if (journalIds.length > 0) {
                        journalId = journalIds[0];
                        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                            'Settlement Line MR reduce: Created ' + journalIds.length +
                            ' JE(s) for other charges: ' + journalIds.join(', '));
                    }
                }
            }

            // ---- Step 3: Mark as reconciled ----
            financialService.updateSettlementFinancials(summaryId, {
                depositId: depositId,
                invoiceId: invoiceId,
                journalId: journalId,
                journalIds: journalIds
            });

            logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement ' + reportId + ' reconciled with ' + totals.lineCount + ' line records.' +
                (settleTranType === constants.SETTLEMENT_TRAN_TYPE.INVOICE
                    ? ' (Invoice' + (paymentId ? ' + Payment' : '') + ')'
                    : ' (Deposit' + (depositId ? ': ' + depositId : '') + ')') +
                (journalIds.length ? ' JEs: ' + journalIds.join(',') : (journalId ? ' JE: ' + journalId : '')), {
                configId: configId,
                amazonRef: reportId
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement Line MR reduce error for summary ' + summaryId + ': ' + e.message, {
                details: e.stack
            });

            errorQueue.enqueue({
                type: constants.ERROR_QUEUE_TYPE.SETTLEMENT_PROCESS,
                amazonRef: summaryId,
                errorMsg: e.message,
                configId: context.values[0] ? JSON.parse(context.values[0]).configId : '',
                payload: JSON.stringify({ summaryId: summaryId })
            });
        }
    }

    /**
     * Aggregates settlement line amounts into summary totals.
     * Replicates the old NES_ARES_sch_amz_summary.js recalc logic using CASE WHEN SQL formulas.
     * - Total Payments = SUM(amount) WHERE tran_type='Order' AND marketplace != 'Non-Amazon'
     * - Total Refunds = SUM(amount) WHERE tran_type='Refund'
     * - Total Other Charges = SUM(amount) WHERE NOT (Order/Refund/Previous Reserve) AND marketplace != 'Non-Amazon'
     * - Settlement Total = SUM(all amounts)
     */
    function recalcSummaryTotals(summaryId) {
        var lineSearch = search.create({
            type: SL.ID,
            filters: [
                [SL.FIELDS.SUMMARY, 'anyof', summaryId]
            ],
            columns: [
                search.createColumn({ name: SL.FIELDS.SUMMARY, summary: search.Summary.GROUP }),
                // Total Payments: Orders from Amazon marketplace
                search.createColumn({
                    name: 'formulanumeric',
                    summary: search.Summary.SUM,
                    formula: "CASE WHEN ({" + SL.FIELDS.TRAN_TYPE + "} = 'Order' AND {" + SL.FIELDS.MARKETPLACE + "} != 'Non-Amazon') THEN {" + SL.FIELDS.AMOUNT + "} ELSE 0 END"
                }),
                // Total Refunds
                search.createColumn({
                    name: 'formulanumeric',
                    summary: search.Summary.SUM,
                    formula: "CASE WHEN {" + SL.FIELDS.TRAN_TYPE + "} = 'Refund' THEN {" + SL.FIELDS.AMOUNT + "} ELSE 0 END"
                }),
                // Total Other Charges (not Order, not Refund, not Previous Reserve, and not Non-Amazon for Order/Refund)
                search.createColumn({
                    name: 'formulanumeric',
                    summary: search.Summary.SUM,
                    formula: "CASE WHEN (({" + SL.FIELDS.TRAN_TYPE + "} = 'Refund' OR {" + SL.FIELDS.TRAN_TYPE + "} = 'Order' OR {" + SL.FIELDS.AMOUNT_DESC + "} = 'Previous Reserve Amount Balance') AND {" + SL.FIELDS.MARKETPLACE + "} != 'Non-Amazon') THEN 0 ELSE {" + SL.FIELDS.AMOUNT + "} END"
                }),
                // Settlement Total (all amounts)
                search.createColumn({
                    name: SL.FIELDS.AMOUNT,
                    summary: search.Summary.SUM
                }),
                // Line count
                search.createColumn({
                    name: 'internalid',
                    summary: search.Summary.COUNT
                })
            ]
        });

        var results = lineSearch.run().getRange({ start: 0, end: 1 });

        if (!results || results.length === 0) {
            return { totalPayments: 0, totalRefunds: 0, totalOtherCharges: 0, settlementTotal: 0, lineCount: 0 };
        }

        var columns = results[0].getAllColumns();
        return {
            totalPayments: parseFloat(results[0].getValue(columns[1])) || 0,
            totalRefunds: parseFloat(results[0].getValue(columns[2])) || 0,
            totalOtherCharges: parseFloat(results[0].getValue(columns[3])) || 0,
            settlementTotal: parseFloat(results[0].getValue(columns[4])) || 0,
            lineCount: parseInt(results[0].getValue(columns[5]), 10) || 0
        };
    }

    /**
     * Builds columnAmounts (fee description → amount) from settlement lines for INVOICE mode.
     * Aggregates amounts by amount_description for lines that are NOT Order/Refund type,
     * providing the same data structure that the old mr_settlement_process.js passed to createInvoice.
     * @param {string|number} summaryId - Settlement summary record internal ID
     * @returns {Object} Map of amount_description → total amount
     */
    function buildColumnAmountsFromLines(summaryId) {
        var columnAmounts = {};
        var lineSearch = search.create({
            type: SL.ID,
            filters: [
                [SL.FIELDS.SUMMARY, 'anyof', summaryId],
                'AND',
                [SL.FIELDS.TRAN_TYPE, 'isnot', 'Order'],
                'AND',
                [SL.FIELDS.TRAN_TYPE, 'isnot', 'Refund']
            ],
            columns: [
                search.createColumn({ name: SL.FIELDS.AMOUNT_DESC, summary: search.Summary.GROUP }),
                search.createColumn({ name: SL.FIELDS.AMOUNT, summary: search.Summary.SUM })
            ]
        });

        lineSearch.run().each(function (result) {
            var desc = result.getValue(result.getAllColumns()[0]);
            var amount = parseFloat(result.getValue(result.getAllColumns()[1])) || 0;
            if (desc && amount !== 0) {
                columnAmounts[desc] = (columnAmounts[desc] || 0) + amount;
            }
            return true;
        });

        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'buildColumnAmountsFromLines: Built ' + Object.keys(columnAmounts).length +
            ' column amount entries for summary ' + summaryId);

        return columnAmounts;
    }

    /**
     * Creates Journal Entries for "other charges" from settlement lines, grouped by posting month.
     * Replicates the exact logic from old NES_ARES_sch_settlement_charges.js:
     * - Searches settlement lines that are NOT Order/Refund (or are Non-Amazon marketplace)
     * - Groups by marketplace, amount_desc, posting month
     * - Creates one JE per month
     * - Each JE line: credit = charge amount, account from charge_map lookup
     * - Balancing debit line to settlement/cash account
     */
    function createOtherChargeJEsFromLines(config, summaryId, settlementId, currency) {
        var jeIds = [];

        // Search for other charge lines grouped by month (like old scheduled script)
        var chargeSearch = search.create({
            type: SL.ID,
            filters: [
                [SL.FIELDS.SUMMARY, 'anyof', summaryId],
                'AND',
                [
                    [[SL.FIELDS.TRAN_TYPE, 'isnot', 'Order'], 'AND', [SL.FIELDS.TRAN_TYPE, 'isnot', 'Refund']],
                    'OR',
                    [SL.FIELDS.MARKETPLACE, 'is', 'Non-Amazon']
                ],
                'AND',
                [SL.FIELDS.AMOUNT_DESC, 'isnotempty', ''],
                'AND',
                [SL.FIELDS.AMOUNT, 'notequalto', '0.00']
            ],
            columns: [
                search.createColumn({ name: SL.FIELDS.MARKETPLACE, summary: search.Summary.GROUP }),
                search.createColumn({ name: SL.FIELDS.AMOUNT_DESC, summary: search.Summary.GROUP }),
                search.createColumn({
                    name: 'formulatext',
                    summary: search.Summary.GROUP,
                    formula: "TO_CHAR({" + SL.FIELDS.POST_DATE_NS + "}, 'MONTH, YYYY')"
                }),
                search.createColumn({
                    name: SL.FIELDS.POST_DATE_NS,
                    summary: search.Summary.MAX,
                    sort: search.Sort.ASC
                }),
                search.createColumn({ name: SL.FIELDS.AMOUNT, summary: search.Summary.SUM }),
                search.createColumn({ name: SL.FIELDS.AMOUNT_TYPE, summary: search.Summary.GROUP })
            ]
        });

        var chargeResults = [];
        chargeSearch.run().each(function (result) {
            chargeResults.push(result);
            return true;
        });

        if (chargeResults.length === 0) {
            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement Line MR: No other charge lines found for summary ' + summaryId);
            return jeIds;
        }

        // Load charge account map
        var chargeAccountMap = null;
        var useChargeMap = config.useChargeMap === true || config.useChargeMap === 'T';
        if (useChargeMap) {
            chargeAccountMap = configHelper.getChargeAccountMap(config.configId, currency);
        }

        // Determine NS currency ID for JE (like old process hardcoded mapping)
        var nsCurrency = resolveCurrencyId(currency);

        // Create JEs grouped by month (same logic as old NES_ARES_sch_settlement_charges.js)
        var currentJe = null;
        var currentTotal = 0;
        var prevMonth = '';

        for (var y = 0; y < chargeResults.length; y++) {
            var columns = chargeResults[y].getAllColumns();
            var amt = parseFloat(chargeResults[y].getValue(columns[4])) || 0;
            if (amt === 0) continue;

            var marketplace = chargeResults[y].getValue(columns[0]);
            var desc = chargeResults[y].getValue(columns[1]);
            var month = chargeResults[y].getValue(columns[2]);
            var maxDate = chargeResults[y].getValue(columns[3]);
            var amtType = chargeResults[y].getValue(columns[5]);

            // Override desc for specific amount types (like old process)
            if (amtType === 'Cost of Advertising' || amtType === 'CouponRedemptionFee') {
                desc = amtType;
            }
            if (marketplace === 'Non-Amazon') {
                desc = 'AMAZON FBA FEES (WEBSITE)';
            }

            // When month changes, save current JE and start new one
            if (month !== prevMonth && currentJe !== null) {
                // Add balancing debit line
                addBalancingDebitLine(currentJe, config, currentTotal, settlementId);
                var savedJeId = currentJe.save({ ignoreMandatoryFields: true });
                jeIds.push(savedJeId);
                currentJe = null;
                currentTotal = 0;
            }

            // Create new JE if needed
            if (currentJe === null) {
                currentJe = record.create({
                    type: record.Type.JOURNAL_ENTRY,
                    isDynamic: true
                });
                if (nsCurrency) {
                    currentJe.setValue({ fieldId: 'currency', value: nsCurrency });
                }
                if (config.subsidiary) {
                    currentJe.setValue({ fieldId: 'subsidiary', value: config.subsidiary });
                }
                currentJe.setValue({
                    fieldId: 'memo',
                    value: 'Other Charges for Settlement: ' + settlementId
                });
                // Set trandate from the first charge result's max date
                if (maxDate) {
                    currentJe.setValue({ fieldId: 'trandate', value: new Date(maxDate) });
                }
            }

            prevMonth = month;
            currentTotal = parseFloat((Number(currentTotal) + Number(amt)).toFixed(2));

            // Look up account for this charge description
            var acct = lookupChargeAccount(desc, chargeAccountMap, config);

            if (acct) {
                currentJe.selectNewLine({ sublistId: 'line' });
                currentJe.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: acct });
                currentJe.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: Math.abs(amt) });
                currentJe.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: desc + ' - ' + settlementId });
                currentJe.commitLine({ sublistId: 'line' });
            }
        }

        // Save final JE
        if (currentJe !== null) {
            addBalancingDebitLine(currentJe, config, currentTotal, settlementId);
            var finalJeId = currentJe.save({ ignoreMandatoryFields: true });
            jeIds.push(finalJeId);
        }

        return jeIds;
    }

    /**
     * Adds a balancing debit line to a JE (like old process: debit to cash/settlement account).
     */
    function addBalancingDebitLine(je, config, total, settlementId) {
        var debitAccount = config.settleAccount || config.feeAccount;
        if (!debitAccount) return;

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: debitAccount });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.abs(total) });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Cash - ' + settlementId });
        je.commitLine({ sublistId: 'line' });
    }

    /**
     * Looks up the GL account for a charge description using the charge account map.
     * Falls back to config fee account if no mapping found.
     * Replicates old lookupAcct() function from NES_ARES_sch_settlement_charges.js.
     */
    function lookupChargeAccount(description, chargeAccountMap, config) {
        if (chargeAccountMap && chargeAccountMap.map) {
            var key = description.toLowerCase().trim();
            if (chargeAccountMap.map[key]) {
                return chargeAccountMap.map[key];
            }
            if (chargeAccountMap.defaultAccount) {
                return chargeAccountMap.defaultAccount;
            }
        }
        return config.feeAccount || null;
    }

    /**
     * Resolves a currency code string to a NetSuite internal currency ID.
     * Mirrors old hardcoded mapping from NES_ARES_sch_settlement_charges.js.
     */
    function resolveCurrencyId(currencyCode) {
        if (!currencyCode) return null;
        var map = {
            'USD': '1',
            'CAD': '3',
            'MXN': '5'
        };
        return map[currencyCode.toUpperCase()] || null;
    }

    function summarize(summary) {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement Line MR summarize: Execution completed');

        if (summary.inputSummary.error) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR: Input error: ' + summary.inputSummary.error);
        }

        var mapErrors = 0;
        summary.mapSummary.errors.iterator().each(function (key, error) {
            mapErrors++;
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR: Map error [' + key + ']: ' + error);
            return true;
        });

        var reduceErrors = 0;
        summary.reduceSummary.errors.iterator().each(function (key, error) {
            reduceErrors++;
            logger.error(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement Line MR: Reduce error [' + key + ']: ' + error);
            return true;
        });

        logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement Line MR complete. Map errors: ' + mapErrors + ', Reduce errors: ' + reduceErrors);
    }

    return { getInputData, map, reduce, summarize };
});
