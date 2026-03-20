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

            for (const config of configs) {
                if (!config.settleEnabled) continue;

                try {
                    const lastSync = config.lastSettleSync
                        ? new Date(config.lastSettleSync).toISOString()
                        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

                    const reports = settlementService.fetchSettlementReports(config, lastSync);

                    // Filter to unprocessed, ready reports
                    var readyReports = [];
                    for (var r = 0; r < reports.length; r++) {
                        if (reports[r].processingStatus === 'DONE' &&
                            !settlementService.isSettlementProcessed(reports[r].reportId)) {
                            readyReports.push(reports[r]);
                        }
                    }

                    if (readyReports.length === 0) {
                        log.debug({ title: 'Settlement Sync', details: 'No new settlement reports for config ' + config.configId });
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
