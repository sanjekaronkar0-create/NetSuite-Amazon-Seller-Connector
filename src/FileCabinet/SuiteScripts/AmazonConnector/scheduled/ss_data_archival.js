/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script for data archival and cleanup.
 *              Removes old integration logs, resolved error queue entries,
 *              and archived order mappings to prevent record bloat.
 *              Retention period is configurable per marketplace config.
 */
define([
    'N/search',
    'N/record',
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger'
], function (search, record, runtime, log, constants, configHelper, logger) {

    var CR = constants.CUSTOM_RECORDS;

    function execute(context) {
        logger.progress(constants.LOG_TYPE.DATA_ARCHIVAL, 'Data archival process started');

        try {
            var configs = configHelper.getAllConfigs();
            var retentionDays = 90; // Default retention

            // Use the lowest configured retention across all configs
            configs.forEach(function (config) {
                var configRetention = parseInt(config.logRetentionDays, 10);
                if (configRetention > 0 && configRetention < retentionDays) {
                    retentionDays = configRetention;
                }
            });

            var cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

            log.audit({
                title: 'Data Archival',
                details: 'Archiving records older than ' + retentionDays + ' days (before ' + cutoffDate.toISOString() + ')'
            });

            var logsDeleted = archiveOldLogs(cutoffDate);
            var errorsDeleted = archiveResolvedErrors(cutoffDate);

            logger.success(constants.LOG_TYPE.DATA_ARCHIVAL,
                'Data archival completed: ' + logsDeleted + ' logs and ' + errorsDeleted + ' error queue entries removed', {
                details: 'Retention: ' + retentionDays + ' days. Cutoff: ' + cutoffDate.toISOString()
            });
        } catch (e) {
            logger.error(constants.LOG_TYPE.DATA_ARCHIVAL,
                'Data archival failed: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Deletes old integration log records beyond retention period.
     * Only deletes successful logs; keeps errors for longer review.
     */
    function archiveOldLogs(cutoffDate) {
        var LOG = CR.LOG;
        var deleted = 0;

        search.create({
            type: LOG.ID,
            filters: [
                [LOG.FIELDS.TIMESTAMP, 'before', cutoffDate],
                'AND',
                [LOG.FIELDS.STATUS, 'anyof', [constants.LOG_STATUS.SUCCESS, constants.LOG_STATUS.IN_PROGRESS]]
            ],
            columns: ['internalid']
        }).run().each(function (result) {
            // Check governance
            if (runtime.getCurrentScript().getRemainingUsage() < 100) return false;

            try {
                record.delete({ type: LOG.ID, id: result.id });
                deleted++;
            } catch (e) {
                log.debug({ title: 'Archive Log', details: 'Could not delete log ' + result.id + ': ' + e.message });
            }
            return true;
        });

        // Also delete old error logs (2x retention period)
        var errorCutoff = new Date(cutoffDate.getTime() - cutoffDate.getTime() / 2);
        search.create({
            type: LOG.ID,
            filters: [
                [LOG.FIELDS.TIMESTAMP, 'before', errorCutoff],
                'AND',
                [LOG.FIELDS.STATUS, 'anyof', [constants.LOG_STATUS.ERROR, constants.LOG_STATUS.WARNING]]
            ],
            columns: ['internalid']
        }).run().each(function (result) {
            if (runtime.getCurrentScript().getRemainingUsage() < 100) return false;
            try {
                record.delete({ type: LOG.ID, id: result.id });
                deleted++;
            } catch (e) {
                log.debug({ title: 'Archive Error Log', details: e.message });
            }
            return true;
        });

        return deleted;
    }

    /**
     * Deletes resolved/failed error queue entries beyond retention.
     */
    function archiveResolvedErrors(cutoffDate) {
        var EQ = CR.ERROR_QUEUE;
        var deleted = 0;

        search.create({
            type: EQ.ID,
            filters: [
                [EQ.FIELDS.CREATED, 'before', cutoffDate],
                'AND',
                [EQ.FIELDS.STATUS, 'anyof', [constants.ERROR_QUEUE_STATUS.RESOLVED, constants.ERROR_QUEUE_STATUS.FAILED]]
            ],
            columns: ['internalid']
        }).run().each(function (result) {
            if (runtime.getCurrentScript().getRemainingUsage() < 100) return false;
            try {
                record.delete({ type: EQ.ID, id: result.id });
                deleted++;
            } catch (e) {
                log.debug({ title: 'Archive Error', details: e.message });
            }
            return true;
        });

        return deleted;
    }

    return { execute };
});
