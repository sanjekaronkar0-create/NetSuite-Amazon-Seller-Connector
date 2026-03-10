/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script that fetches and processes Amazon settlement reports.
 */
define([
    'N/task',
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger',
    '../services/settlementService'
], function (task, runtime, log, constants, configHelper, logger, settlementService) {

    const CR = constants.CUSTOM_RECORDS.CONFIG;

    function execute(context) {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC, 'Settlement sync started');

        try {
            const configs = configHelper.getAllConfigs();

            for (const config of configs) {
                if (!config.settleEnabled) continue;

                try {
                    const lastSync = config.lastSettleSync
                        ? new Date(config.lastSettleSync).toISOString()
                        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

                    const reports = settlementService.fetchSettlementReports(config, lastSync);

                    log.audit({
                        title: 'Settlement Sync',
                        details: 'Found ' + reports.length + ' reports for config ' + config.configId
                    });

                    for (const report of reports) {
                        if (runtime.getCurrentScript().getRemainingUsage() < 500) {
                            logger.warn(constants.LOG_TYPE.SETTLEMENT_SYNC, 'Low governance, stopping');
                            return;
                        }

                        processSettlementReport(config, report);
                    }

                    configHelper.updateLastSync(config.configId, CR.FIELDS.LAST_SETTLE_SYNC);

                } catch (e) {
                    logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement sync error for config ' + config.configId + ': ' + e.message, {
                        configId: config.configId,
                        details: e.stack
                    });
                }
            }

            logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC, 'Settlement sync completed');
        } catch (e) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement sync failed: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Processes a single settlement report.
     */
    function processSettlementReport(config, report) {
        const reportId = report.reportId;

        if (settlementService.isSettlementProcessed(reportId)) {
            log.debug({ title: 'Settlement Sync', details: 'Report already processed: ' + reportId });
            return;
        }

        try {
            // Check report is done
            if (report.processingStatus !== 'DONE') {
                log.debug({ title: 'Settlement Sync', details: 'Report not ready: ' + reportId });
                return;
            }

            // Download and parse
            const data = settlementService.downloadSettlementReport(config, report.reportDocumentId);

            // Create settlement record
            const settlementId = settlementService.createSettlementRecord(config, report, data.summary);

            // Mark as reconciled
            settlementService.updateSettlementStatus(settlementId, constants.SETTLEMENT_STATUS.RECONCILED);

            logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement report processed: ' + reportId, {
                configId: config.configId,
                recordType: 'customrecord_amz_settlement',
                recordId: settlementId,
                amazonRef: reportId
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Error processing settlement report ' + reportId + ': ' + e.message, {
                configId: config.configId,
                amazonRef: reportId,
                details: e.stack
            });
        }
    }

    return { execute };
});
