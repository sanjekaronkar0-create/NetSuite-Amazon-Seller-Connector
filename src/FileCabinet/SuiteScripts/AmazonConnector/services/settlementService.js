/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Amazon Settlement processing.
 *              Downloads settlement reports and creates NetSuite deposit/journal entries.
 */
define([
    'N/record',
    'N/search',
    'N/file',
    'N/https',
    'N/log',
    '../lib/constants',
    '../lib/amazonClient',
    '../lib/logger'
], function (record, search, file, https, log, constants, amazonClient, logger) {

    const STL = constants.CUSTOM_RECORDS.SETTLEMENT;

    var _settlementFolderId = null;

    /**
     * Fetches available settlement reports from Amazon.
     * @param {Object} config
     * @param {string} startDate - ISO 8601 date
     * @returns {Array<Object>} Settlement report list
     */
    function fetchSettlementReports(config, startDate) {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.fetchSettlementReports: Fetching settlement reports from Amazon for config ' +
            config.configId + ' since ' + startDate);

        const response = amazonClient.getSettlementReports(config, startDate);
        var reports = response.reports || [];

        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.fetchSettlementReports: Amazon returned ' + reports.length + ' report(s) for config ' + config.configId);

        return reports;
    }

    /**
     * Downloads and parses a settlement report.
     * @param {Object} config
     * @param {string} reportDocumentId
     * @returns {Object} Parsed settlement data
     */
    function downloadSettlementReport(config, reportDocumentId) {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.downloadSettlementReport: Fetching report document URL from Amazon for reportDocumentId: ' + reportDocumentId);

        const docResponse = amazonClient.getReportDocument(config, reportDocumentId);
        const downloadUrl = docResponse.url;

        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.downloadSettlementReport: Downloading settlement report file...');

        const fileResponse = https.get({ url: downloadUrl });
        if (fileResponse.code !== 200) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'settlementService.downloadSettlementReport: Download FAILED with HTTP ' + fileResponse.code +
                ' for reportDocumentId: ' + reportDocumentId);
            throw new Error('Failed to download settlement report: HTTP ' + fileResponse.code);
        }

        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.downloadSettlementReport: Report downloaded successfully (' +
            (fileResponse.body ? fileResponse.body.length : 0) + ' bytes). Parsing data...');

        var parsed = parseSettlementData(fileResponse.body);
        parsed.rawData = fileResponse.body;
        return parsed;
    }

    /**
     * Parses tab-delimited settlement report data.
     * @param {string} rawData
     * @returns {Object} Structured settlement data
     */
    function parseSettlementData(rawData) {
        const lines = rawData.split('\n');
        if (lines.length < 2) {
            logger.warn(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'settlementService.parseSettlementData: Report has less than 2 lines (' + lines.length +
                ' line(s)). Returning empty data - the report file may be empty or malformed.');
            return { rows: [], summary: {}, columnAmounts: {}, rowsByMonth: {} };
        }

        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.parseSettlementData: Parsing ' + lines.length + ' line(s) from settlement report');

        const headers = lines[0].split('\t').map(h => h.trim());
        const rows = [];
        const summary = {
            productCharges: 0,
            shippingCredits: 0,
            promoRebates: 0,
            sellingFees: 0,
            fbaFees: 0,
            otherFees: 0,
            refunds: 0,
            totalAmount: 0
        };
        // Track amounts per column name for column-item mapping
        const columnAmounts = {};
        // Track rows grouped by month for BY_MONTH JE grouping
        const rowsByMonth = {};

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;

            const values = lines[i].split('\t');
            const row = {};
            headers.forEach(function (header, idx) {
                row[header] = (values[idx] || '').trim();
            });
            rows.push(row);

            categorizeAmount(row, summary);
            trackColumnAmount(row, columnAmounts);
            groupRowByMonth(row, rowsByMonth);
        }

        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.parseSettlementData: Parsing complete. Rows: ' + rows.length +
            ', Summary - totalAmount: ' + summary.totalAmount +
            ', productCharges: ' + summary.productCharges +
            ', shippingCredits: ' + summary.shippingCredits +
            ', sellingFees: ' + summary.sellingFees +
            ', fbaFees: ' + summary.fbaFees +
            ', promoRebates: ' + summary.promoRebates +
            ', otherFees: ' + summary.otherFees +
            ', refunds: ' + summary.refunds +
            ', unique columns: ' + Object.keys(columnAmounts).length +
            ', months: ' + Object.keys(rowsByMonth).join(', '));

        return { rows, summary, columnAmounts, rowsByMonth };
    }

    /**
     * Groups a settlement row by its posting month (YYYY-MM).
     * Used for the BY_MONTH JE grouping option (ported from old NES_ARES_sch_settlement_charges.js).
     * @param {Object} row - Parsed settlement row
     * @param {Object} rowsByMonth - Map of YYYY-MM to { rows: [], date: Date, columnAmounts: {} }
     */
    function groupRowByMonth(row, rowsByMonth) {
        var amount = parseFloat(row['amount'] || row['total'] || 0);
        if (amount === 0) return;

        // Determine posting date from row
        var dateStr = row['posted-date'] || row['deposit-date'] || row['date'] || '';
        var monthKey = 'unknown';
        var postDate = null;

        if (dateStr) {
            postDate = new Date(dateStr);
            if (!isNaN(postDate.getTime())) {
                var m = postDate.getMonth() + 1;
                monthKey = postDate.getFullYear() + '-' + (m < 10 ? '0' + m : m);
            }
        }

        if (!rowsByMonth[monthKey]) {
            rowsByMonth[monthKey] = { rows: [], date: postDate, columnAmounts: {} };
        }
        rowsByMonth[monthKey].rows.push(row);

        // Also track column amounts per month
        var colName = (row['amount-description'] || row['description'] || row['amount-type'] || row['type'] || '').toLowerCase().trim();
        if (colName) {
            if (!rowsByMonth[monthKey].columnAmounts[colName]) {
                rowsByMonth[monthKey].columnAmounts[colName] = 0;
            }
            rowsByMonth[monthKey].columnAmounts[colName] += amount;
        }
    }

    /**
     * Categorizes a settlement row amount into summary buckets.
     */
    function categorizeAmount(row, summary) {
        const amount = parseFloat(row['amount'] || row['total'] || 0);
        const type = (row['amount-type'] || row['type'] || '').toLowerCase();

        if (type.includes('productcharges') || type.includes('itemcharge')) {
            summary.productCharges += amount;
        } else if (type.includes('shippingcredits') || type.includes('shipping')) {
            summary.shippingCredits += amount;
        } else if (type.includes('promotion') || type.includes('promo')) {
            summary.promoRebates += amount;
        } else if (type.includes('sellingfees') || type.includes('commission')) {
            summary.sellingFees += amount;
        } else if (type.includes('fba') || type.includes('fulfillment')) {
            summary.fbaFees += amount;
        } else if (type.includes('refund')) {
            summary.refunds += amount;
        } else {
            summary.otherFees += amount;
        }

        summary.totalAmount += amount;
    }

    /**
     * Tracks settlement row amounts by their column/amount-description name.
     * This allows column-to-item mappings to create granular journal entry lines.
     * @param {Object} row - Parsed settlement row
     * @param {Object} columnAmounts - Map of column name to accumulated amount
     */
    function trackColumnAmount(row, columnAmounts) {
        const amount = parseFloat(row['amount'] || row['total'] || 0);
        if (amount === 0) return;

        // Use the amount-description or description field as the column key
        var colName = (row['amount-description'] || row['description'] || row['amount-type'] || row['type'] || '').toLowerCase().trim();
        if (!colName) return;

        if (!columnAmounts[colName]) {
            columnAmounts[colName] = 0;
        }
        columnAmounts[colName] += amount;
    }

    /**
     * Checks if a settlement report has already been processed.
     * @param {string} reportId
     * @returns {boolean}
     */
    function isSettlementProcessed(reportId) {
        let found = false;
        search.create({
            type: STL.ID,
            filters: [
                [STL.FIELDS.REPORT_ID, 'is', reportId],
                'AND',
                [STL.FIELDS.STATUS, 'anyof', [constants.SETTLEMENT_STATUS.RECONCILED]]
            ],
            columns: ['internalid']
        }).run().each(function () {
            found = true;
            return false;
        });

        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.isSettlementProcessed: Report ' + reportId +
            (found ? ' has already been RECONCILED - will be skipped' : ' has NOT been reconciled yet - eligible for processing'));

        return found;
    }

    /**
     * Finds an existing settlement record by report ID (any status).
     * Used to reuse records from prior failed runs instead of creating duplicates.
     * @param {string} reportId
     * @returns {string|null} Settlement record internal ID, or null
     */
    function findExistingSettlement(reportId) {
        var existingId = null;
        search.create({
            type: STL.ID,
            filters: [[STL.FIELDS.REPORT_ID, 'is', reportId]],
            columns: ['internalid']
        }).run().each(function (result) {
            existingId = result.id;
            return false;
        });

        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.findExistingSettlement: Report ' + reportId +
            (existingId ? ' - found existing settlement record (ID: ' + existingId + '). Will reuse instead of creating new.' :
                ' - no existing settlement record found. A new one will be created.'));

        return existingId;
    }

    /**
     * Creates a settlement custom record in NetSuite.
     * @param {Object} config
     * @param {Object} report - Amazon report metadata
     * @param {Object} summary - Parsed financial summary
     * @returns {number} Settlement record internal ID
     */
    function createSettlementRecord(config, report, summary) {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.createSettlementRecord: Creating settlement record for report ' + (report.reportId || 'Unknown') +
            '. Config: ' + config.configId +
            ', dateRange: ' + (report.dataStartTime || 'N/A') + ' to ' + (report.dataEndTime || 'N/A') +
            ', totalAmount: ' + (summary.totalAmount || 0));

        const rec = record.create({ type: STL.ID });
        rec.setValue({ fieldId: 'name', value: 'Settlement: ' + (report.reportId || 'Unknown') });
        rec.setValue({ fieldId: STL.FIELDS.REPORT_ID, value: report.reportId });
        rec.setValue({ fieldId: STL.FIELDS.STATUS, value: constants.SETTLEMENT_STATUS.PROCESSING });
        rec.setValue({ fieldId: STL.FIELDS.CONFIG, value: config.configId });

        if (report.dataStartTime) {
            rec.setValue({ fieldId: STL.FIELDS.START_DATE, value: new Date(report.dataStartTime) });
        }
        if (report.dataEndTime) {
            rec.setValue({ fieldId: STL.FIELDS.END_DATE, value: new Date(report.dataEndTime) });
        }

        rec.setValue({ fieldId: STL.FIELDS.TOTAL_AMOUNT, value: summary.totalAmount || 0 });
        rec.setValue({ fieldId: STL.FIELDS.PRODUCT_CHARGES, value: summary.productCharges || 0 });
        rec.setValue({ fieldId: STL.FIELDS.SHIPPING_CREDITS, value: summary.shippingCredits || 0 });
        rec.setValue({ fieldId: STL.FIELDS.PROMO_REBATES, value: summary.promoRebates || 0 });
        rec.setValue({ fieldId: STL.FIELDS.SELLING_FEES, value: summary.sellingFees || 0 });
        rec.setValue({ fieldId: STL.FIELDS.FBA_FEES, value: summary.fbaFees || 0 });
        rec.setValue({ fieldId: STL.FIELDS.OTHER_FEES, value: summary.otherFees || 0 });
        rec.setValue({ fieldId: STL.FIELDS.REFUNDS, value: summary.refunds || 0 });

        var savedId = rec.save({ ignoreMandatoryFields: true });

        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.createSettlementRecord: Settlement record created (ID: ' + savedId +
            ') for report ' + (report.reportId || 'Unknown'));

        return savedId;
    }

    /**
     * Updates settlement record status.
     */
    function updateSettlementStatus(settlementId, status, depositId) {
        const values = { [STL.FIELDS.STATUS]: status };
        if (depositId) {
            values[STL.FIELDS.NS_DEPOSIT] = depositId;
        }
        record.submitFields({
            type: STL.ID,
            id: settlementId,
            values: values
        });
    }

    /**
     * Gets or creates the SettlementReports folder under AmazonConnector.
     * @returns {number} Internal ID of the SettlementReports folder
     */
    function getSettlementFolderId() {
        if (_settlementFolderId) return _settlementFolderId;

        var acSearch = search.create({
            type: 'folder',
            filters: [['name', 'is', 'AmazonConnector']],
            columns: ['internalid']
        });
        var acResults = acSearch.run().getRange({ start: 0, end: 1 });
        if (acResults.length === 0) {
            throw new Error('Cannot find AmazonConnector folder in File Cabinet');
        }
        var parentId = parseInt(acResults[0].id, 10);

        var folderSearch = search.create({
            type: 'folder',
            filters: [
                ['name', 'is', 'SettlementReports'],
                'AND',
                ['parent', 'anyof', parentId]
            ],
            columns: ['internalid']
        });
        var results = folderSearch.run().getRange({ start: 0, end: 1 });
        if (results.length > 0) {
            _settlementFolderId = parseInt(results[0].id, 10);
            return _settlementFolderId;
        }

        var folder = record.create({ type: record.Type.FOLDER });
        folder.setValue({ fieldId: 'name', value: 'SettlementReports' });
        folder.setValue({ fieldId: 'parent', value: parentId });
        _settlementFolderId = folder.save();

        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.getSettlementFolderId: Created SettlementReports folder (ID: ' + _settlementFolderId + ')');

        return _settlementFolderId;
    }

    /**
     * Stores the raw settlement report data as a file in the File Cabinet.
     * @param {string} reportId - Amazon settlement report ID
     * @param {string} rawData - Raw tab-delimited settlement report content
     * @param {number} [settlementId] - Optional settlement record ID to link the file to
     * @returns {number} Internal ID of the stored file
     */
    function storeSettlementFile(reportId, rawData, settlementId) {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.storeSettlementFile: Storing raw settlement data for report ' + reportId +
            ' (' + (rawData ? rawData.length : 0) + ' bytes)');

        var safeReportId = (reportId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
        var fileName = 'settlement_' + safeReportId + '_' + Date.now() + '.tsv';

        var fileObj = file.create({
            name: fileName,
            fileType: file.Type.CSV,
            contents: rawData,
            folder: getSettlementFolderId(),
            isOnline: false
        });

        var fileId = fileObj.save();

        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'settlementService.storeSettlementFile: File saved (ID: ' + fileId + ', name: ' + fileName + ')');

        if (settlementId) {
            try {
                record.submitFields({
                    type: STL.ID,
                    id: settlementId,
                    values: { [STL.FIELDS.SETTLEMENT_FILE]: fileId }
                });
                logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'settlementService.storeSettlementFile: Linked file ' + fileId + ' to settlement record ' + settlementId);
            } catch (e) {
                logger.warn(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'settlementService.storeSettlementFile: Could not link file to settlement record: ' + e.message);
            }
        }

        return fileId;
    }

    return {
        fetchSettlementReports,
        downloadSettlementReport,
        parseSettlementData,
        isSettlementProcessed,
        findExistingSettlement,
        createSettlementRecord,
        updateSettlementStatus,
        storeSettlementFile
    };
});
