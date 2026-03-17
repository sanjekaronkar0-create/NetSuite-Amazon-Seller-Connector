/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script that detects canceled Amazon orders and
 *              closes/voids the corresponding NetSuite transactions.
 */
define([
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger',
    '../services/cancellationService',
    '../services/notificationService'
], function (runtime, log, constants, configHelper, logger, cancellationService, notificationService) {

    var CR = constants.CUSTOM_RECORDS.CONFIG;

    function execute(context) {
        logger.progress(constants.LOG_TYPE.CANCELLATION, 'Cancellation sync started');

        try {
            var configs = configHelper.getAllConfigs();

            for (var i = 0; i < configs.length; i++) {
                var config = configs[i];

                if (!config.cancelSyncEnabled) {
                    log.debug({ title: 'Cancel Sync', details: 'Skipping disabled config: ' + config.configId });
                    continue;
                }

                processConfig(config);

                if (runtime.getCurrentScript().getRemainingUsage() < 500) {
                    logger.warn(constants.LOG_TYPE.CANCELLATION, 'Low governance, stopping cancellation sync');
                    return;
                }
            }

            logger.success(constants.LOG_TYPE.CANCELLATION, 'Cancellation sync completed');
        } catch (e) {
            logger.error(constants.LOG_TYPE.CANCELLATION,
                'Cancellation sync failed: ' + e.message, { details: e.stack });
        }
    }

    function processConfig(config) {
        try {
            // Default to 24 hours ago if no last sync timestamp
            var lastSync = config.lastOrderSync
                ? new Date(config.lastOrderSync).toISOString()
                : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

            var summary = cancellationService.processCanceledOrders(config, lastSync);

            log.audit({
                title: 'Cancel Sync',
                details: 'Config ' + config.configId + ' - Total: ' + summary.total +
                    ', Canceled: ' + summary.canceled + ', Skipped: ' + summary.skipped +
                    ', Errors: ' + summary.errors
            });

            if (summary.errors > 0) {
                notificationService.sendErrorNotification(config,
                    'Cancellation Sync Errors',
                    '<p>' + summary.errors + ' orders could not be canceled in NetSuite.</p>' +
                    '<p>Check the integration logs for details.</p>');
            }

        } catch (e) {
            logger.error(constants.LOG_TYPE.CANCELLATION,
                'Cancellation sync failed for config ' + config.configId + ': ' + e.message, {
                configId: config.configId,
                details: e.stack
            });
        }
    }

    return { execute };
});
