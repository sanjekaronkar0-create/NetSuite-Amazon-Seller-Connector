/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script that fetches and processes Amazon settlement reports.
 */
define([
    'N/task',
    'N/record',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger',
    '../services/settlementService',
    '../services/notificationService'
], function (task, record, log, constants, configHelper, logger, settlementService, notificationService) {

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
                        details: 'Found ' + readyReports.length + ' reports. Creating settlement records.'
                    });

                    var STL = constants.CUSTOM_RECORDS.SETTLEMENT;

                    // Create settlement custom records directly with AWAITING_LINES status
                    var createdCount = 0;
                    for (var j = 0; j < readyReports.length; j++) {
                        var rpt = readyReports[j];
                        try {
                            // Check if settlement record already exists
                            var existingId = settlementService.findExistingSettlement(rpt.reportId);
                            if (existingId) {
                                // Update existing record with report doc ID and reset status
                                record.submitFields({
                                    type: STL.ID,
                                    id: existingId,
                                    values: {
                                        [STL.FIELDS.REPORT_DOC_ID]: rpt.reportDocumentId || '',
                                        [STL.FIELDS.STATUS]: constants.SETTLEMENT_STATUS.AWAITING_LINES,
                                        [STL.FIELDS.CONFIG]: config.configId
                                    }
                                });
                                logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                                    'Settlement Sync: Updated existing settlement record ' + existingId +
                                    ' for report ' + rpt.reportId + ' to AWAITING_LINES');
                            } else {
                                var rec = record.create({ type: STL.ID });
                                rec.setValue({ fieldId: 'name', value: 'Settlement: ' + (rpt.reportId || 'Unknown') });
                                rec.setValue({ fieldId: STL.FIELDS.REPORT_ID, value: rpt.reportId });
                                rec.setValue({ fieldId: STL.FIELDS.REPORT_DOC_ID, value: rpt.reportDocumentId || '' });
                                rec.setValue({ fieldId: STL.FIELDS.STATUS, value: constants.SETTLEMENT_STATUS.AWAITING_LINES });
                                rec.setValue({ fieldId: STL.FIELDS.CONFIG, value: config.configId });
                                if (rpt.dataStartTime) {
                                    rec.setValue({ fieldId: STL.FIELDS.START_DATE, value: new Date(rpt.dataStartTime) });
                                }
                                if (rpt.dataEndTime) {
                                    rec.setValue({ fieldId: STL.FIELDS.END_DATE, value: new Date(rpt.dataEndTime) });
                                }
                                var savedId = rec.save({ ignoreMandatoryFields: true });
                                logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                                    'Settlement Sync: Created settlement record ' + savedId +
                                    ' for report ' + rpt.reportId + ' with status AWAITING_LINES');
                            }
                            createdCount++;
                        } catch (recErr) {
                            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                                'Settlement Sync: Error creating record for report ' + rpt.reportId +
                                ': ' + recErr.message);
                        }
                    }

                    // Trigger the Line Processing M/R (it will search for AWAITING_LINES records)
                    if (createdCount > 0) {
                        try {
                            var mrTask = task.create({
                                taskType: task.TaskType.MAP_REDUCE,
                                scriptId: constants.SCRIPT_IDS.MR_SETTLE_LINE,
                                deploymentId: constants.DEPLOY_IDS.MR_SETTLE_LINE
                            });
                            var taskId = mrTask.submit();
                            logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
                                'Settlement Map/Reduce triggered. Task ID: ' + taskId, {
                                configId: config.configId,
                                details: 'Reports: ' + createdCount
                            });
                        } catch (mrErr) {
                            if (mrErr.name === 'MAP_REDUCE_ALREADY_RUNNING' ||
                                (mrErr.message && mrErr.message.indexOf('already running') !== -1)) {
                                logger.warn(constants.LOG_TYPE.SETTLEMENT_SYNC,
                                    'Settlement M/R already running. Records are saved with AWAITING_LINES status ' +
                                    'and will be picked up on next run.');
                            } else {
                                throw mrErr;
                            }
                        }
                    }

                    logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Settlement sync: Created ' + createdCount + ' settlement record(s) for config ' + config.configId, {
                        configId: config.configId,
                        details: 'Reports: ' + createdCount
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
