/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @description Map/Reduce script that processes settlement flat files from Amazon SP-API:
 *              1. Downloads settlement flat file from Amazon SP-API
 *              2. Creates one customrecord_amz_settlement_line per TSV row
 *              3. Aggregates totals into customrecord_amz_settlement (summary)
 */
define([
    'N/runtime',
    'N/record',
    'N/search',
    'N/format',
    'N/log',
    'N/task',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/errorQueue',
    '../lib/logger',
    '../lib/mrDataHelper',
    '../services/settlementService'
], function (runtime, record, search, format, log, task, constants, configHelper, errorQueue, logger, mrDataHelper,
    settlementService) {

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
     *  - Emit summary record ID to reduce for aggregation
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

            // Emit summary ID to reduce for aggregation
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
     *  1. Aggregate line amounts into summary totals
     *  2. Update summary record with calculated totals
     *  3. Set status to PENDING
     */
    function reduce(context) {
        var summaryId = context.key;

        try {
            // Take the first value to get config info
            var data = JSON.parse(context.values[0]);
            var configId = data.configId;
            var reportId = data.reportId;

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR reduce: Processing summary ' + summaryId +
                ' for report ' + reportId + ', config ' + configId);

            // ---- Step 1: Aggregate line amounts ----
            var totals = recalcSummaryTotals(summaryId);

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR reduce: Aggregated totals for summary ' + summaryId +
                ' - payments: ' + totals.totalPayments +
                ', refunds: ' + totals.totalRefunds +
                ', otherCharges: ' + totals.totalOtherCharges +
                ', total: ' + totals.settlementTotal);

            // ---- Step 2: Update summary record with aggregated totals ----
            var updateValues = {};
            updateValues[STL.FIELDS.TOTAL_PAYMENTS] = totals.totalPayments;
            updateValues[STL.FIELDS.TOTAL_REFUNDS] = totals.totalRefunds;
            updateValues[STL.FIELDS.TOTAL_OTHER] = totals.totalOtherCharges;
            updateValues[STL.FIELDS.TOTAL_AMOUNT] = totals.settlementTotal;
            updateValues[STL.FIELDS.RECALC] = false;
            updateValues[STL.FIELDS.STATUS] = constants.SETTLEMENT_STATUS.PENDING;

            record.submitFields({
                type: STL.ID,
                id: summaryId,
                values: updateValues
            });

            logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement ' + reportId + ' processed with ' + totals.lineCount +
                ' line records. Status set to PENDING.', {
                configId: configId,
                amazonRef: reportId
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
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
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR: Reduce error [' + key + ']: ' + error);
            return true;
        });

        logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement Line MR complete. Map errors: ' + mapErrors + ', Reduce errors: ' + reduceErrors);

        // Trigger settlement reconciliation M/R to process PENDING settlements
        try {
            var mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: constants.SCRIPT_IDS.MR_SETTLE_PROCESS,
                deploymentId: constants.DEPLOY_IDS.MR_SETTLE_PROCESS
            });
            var taskId = mrTask.submit();
            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR summarize: Triggered settlement process MR. Task ID: ' + taskId);
        } catch (triggerErr) {
            logger.warn(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Line MR summarize: Could not trigger settlement process MR: ' + triggerErr.message);
        }
    }

    return { getInputData, map, reduce, summarize };
});
