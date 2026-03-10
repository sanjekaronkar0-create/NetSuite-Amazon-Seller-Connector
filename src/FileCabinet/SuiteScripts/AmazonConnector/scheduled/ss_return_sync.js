/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script that syncs Amazon returns and creates
 *              NetSuite Return Authorizations.
 */
define([
    'N/task',
    'N/runtime',
    'N/https',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/amazonClient',
    '../lib/logger',
    '../services/returnService'
], function (task, runtime, https, log, constants, configHelper, amazonClient, logger, returnService) {

    function execute(context) {
        logger.progress(constants.LOG_TYPE.RETURN_SYNC, 'Return sync started');

        try {
            const configs = configHelper.getAllConfigs();

            for (const config of configs) {
                if (!config.returnEnabled) continue;

                try {
                    processReturns(config);
                } catch (e) {
                    logger.error(constants.LOG_TYPE.RETURN_SYNC,
                        'Return sync error for config ' + config.configId + ': ' + e.message, {
                        configId: config.configId,
                        details: e.stack
                    });
                }
            }

            logger.success(constants.LOG_TYPE.RETURN_SYNC, 'Return sync completed');
        } catch (e) {
            logger.error(constants.LOG_TYPE.RETURN_SYNC,
                'Return sync failed: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Processes returns for a single config.
     */
    function processReturns(config) {
        const endDate = new Date().toISOString();
        const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        // Request returns report
        const reportResponse = returnService.requestReturnsReport(config, startDate, endDate);
        const reportId = reportResponse.reportId;

        if (!reportId) {
            log.debug({ title: 'Return Sync', details: 'No report ID returned' });
            return;
        }

        // Poll for report completion (with backoff)
        let report = null;
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            report = amazonClient.getReport(config, reportId);
            if (report.processingStatus === 'DONE') break;
            if (report.processingStatus === 'FATAL' || report.processingStatus === 'CANCELLED') {
                logger.error(constants.LOG_TYPE.RETURN_SYNC,
                    'Returns report failed: ' + report.processingStatus, {
                    configId: config.configId,
                    amazonRef: reportId
                });
                return;
            }
            attempts++;
        }

        if (!report || report.processingStatus !== 'DONE') {
            logger.warn(constants.LOG_TYPE.RETURN_SYNC,
                'Returns report not ready after polling. Will retry next run.', {
                configId: config.configId,
                amazonRef: reportId
            });
            return;
        }

        // Download report
        const docResponse = amazonClient.getReportDocument(config, report.reportDocumentId);
        const fileResponse = https.get({ url: docResponse.url });
        const returnRows = parseReturnReport(fileResponse.body);

        log.audit({
            title: 'Return Sync',
            details: 'Processing ' + returnRows.length + ' return entries'
        });

        for (const returnData of returnRows) {
            if (runtime.getCurrentScript().getRemainingUsage() < 300) {
                logger.warn(constants.LOG_TYPE.RETURN_SYNC, 'Low governance, stopping');
                return;
            }

            processReturnEntry(config, returnData);
        }
    }

    /**
     * Parses a tab-delimited returns report.
     */
    function parseReturnReport(rawData) {
        const lines = rawData.split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split('\t').map(h => h.trim());
        const returns = [];

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const values = lines[i].split('\t');
            const row = {};
            headers.forEach(function (h, idx) {
                row[h] = (values[idx] || '').trim();
            });

            returns.push({
                amazonOrderId: row['order-id'] || row['amazon-order-id'] || '',
                returnId: row['return-request-id'] || '',
                reason: row['reason'] || row['return-reason-code'] || '',
                refundAmount: row['refund-amount'] || '0',
                sku: row['sku'] || row['seller-sku'] || '',
                quantity: parseInt(row['quantity'] || '1', 10)
            });
        }

        return returns;
    }

    /**
     * Processes a single return entry.
     */
    function processReturnEntry(config, returnData) {
        if (!returnData.amazonOrderId) return;

        // Check if already processed
        if (returnService.isReturnProcessed(returnData.amazonOrderId, returnData.returnId)) {
            return;
        }

        // Find linked sales order
        const orderLink = returnService.getLinkedSalesOrder(returnData.amazonOrderId);
        if (!orderLink || !orderLink.salesOrderId) {
            logger.warn(constants.LOG_TYPE.RETURN_SYNC,
                'No linked SO for return on order ' + returnData.amazonOrderId, {
                configId: config.configId,
                amazonRef: returnData.amazonOrderId
            });
            return;
        }

        try {
            // Build return data with SKU info
            returnData.returnedSkus = [{
                sku: returnData.sku,
                quantity: returnData.quantity
            }];

            // Create RMA
            const rmaId = returnService.createReturnAuthorization(
                config, returnData, orderLink.salesOrderId
            );

            // Create mapping record
            returnService.createReturnMapRecord(
                config, returnData, rmaId, orderLink.orderMapId
            );

            logger.success(constants.LOG_TYPE.RETURN_SYNC,
                'Return processed for order ' + returnData.amazonOrderId, {
                configId: config.configId,
                recordType: 'returnauthorization',
                recordId: rmaId,
                amazonRef: returnData.amazonOrderId
            });
        } catch (e) {
            logger.error(constants.LOG_TYPE.RETURN_SYNC,
                'Error processing return for ' + returnData.amazonOrderId + ': ' + e.message, {
                configId: config.configId,
                amazonRef: returnData.amazonOrderId,
                details: e.stack
            });
        }
    }

    return { execute };
});
