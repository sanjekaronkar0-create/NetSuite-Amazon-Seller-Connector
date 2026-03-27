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
    '../lib/mrDataHelper',
    '../services/settlementService',
    '../services/notificationService'
], function (task, runtime, log, constants, configHelper, logger, mrDataHelper, settlementService, notificationService) {

    const CR = constants.CUSTOM_RECORDS.CONFIG;

    function execute(context) {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC, 'Settlement sync started');

        try {
            const configs = configHelper.getAllConfigs();

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Sync: Found ' + configs.length + ' config(s) to evaluate');

            for (const config of configs) {
                if (!config.settleEnabled) {
                    logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement Sync: Skipping config ' + config.configId + ' - settleEnabled is false');
                    continue;
                }

                try {
                    const lastSync = config.lastSettleSync
                        ? new Date(config.lastSettleSync).toISOString()
                        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

                    logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement Sync: Processing config ' + config.configId +
                        '. Fetching reports since ' + lastSync);

                    const reports = settlementService.fetchSettlementReports(config, lastSync);

                    logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement Sync: Config ' + config.configId + ' - ' + reports.length +
                        ' report(s) returned from Amazon. Filtering for unprocessed DONE reports...');

                    // Filter to unprocessed, ready reports
                    var readyReports = [];
                    for (var r = 0; r < reports.length; r++) {
                        if (reports[r].processingStatus !== 'DONE') {
                            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                                'Settlement Sync: Report ' + reports[r].reportId + ' skipped - processingStatus is "' +
                                reports[r].processingStatus + '" (not DONE yet)');
                            continue;
                        }
                        if (settlementService.isSettlementProcessed(reports[r].reportId)) {
                            // isSettlementProcessed already logs
                            continue;
                        }
                        readyReports.push(reports[r]);
                    }

                    if (readyReports.length === 0) {
                        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                            'Settlement Sync: No new settlement reports to process for config ' + config.configId +
                            '. All reports are either not DONE or already reconciled.');
                        configHelper.updateLastSync(config.configId, CR.FIELDS.LAST_SETTLE_SYNC);
                        continue;
                    }

                    log.audit({
                        title: 'Settlement Sync',
                        details: 'Found ' + readyReports.length + ' reports. Triggering Map/Reduce processing.'
                    });

                    // Write settlement data to File Cabinet (script params are too small for JSON)
                    var fileId = mrDataHelper.writeDataFile({
                        configId: config.configId,
                        reports: readyReports
                    }, 'settlements');

                    // Delegate bulk processing to Map/Reduce
                    var mrTask = task.create({
                        taskType: task.TaskType.MAP_REDUCE,
                        scriptId: constants.SCRIPT_IDS.MR_SETTLE_PROCESS,
                        deploymentId: constants.DEPLOY_IDS.MR_SETTLE_PROCESS,
                        params: {
                            custscript_amz_mr_settle_data: String(fileId)
                        }
                    });

                    var taskId = mrDataHelper.submitMrTask(mrTask, constants.LOG_TYPE.SETTLEMENT_SYNC, logger);
                    if (!taskId) {
                        mrDataHelper.deleteTempFile(fileId);
                        continue;
                    }

                    logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement Map/Reduce triggered. Task ID: ' + taskId, {
                        configId: config.configId,
                        details: 'Reports: ' + readyReports.length
                    });

                    configHelper.updateLastSync(config.configId, CR.FIELDS.LAST_SETTLE_SYNC);

                } catch (e) {
                    logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement sync error for config ' + config.configId + ': ' + e.message, {
                        configId: config.configId,
                        details: e.stack
                    });
                    notificationService.sendErrorNotification(config,
                        'Settlement Sync Failed', 'Error: ' + e.message);
                }
            }

            logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC, 'Settlement sync completed');
        } catch (e) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement sync failed: ' + e.message, { details: e.stack });
        }
    }

    return { execute };
});
