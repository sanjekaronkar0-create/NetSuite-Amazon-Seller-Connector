/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script that pulls FBA inventory levels from Amazon
 *              and updates NetSuite item records at the configured FBA location.
 */
define([
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger',
    '../lib/amazonClient',
    '../services/fbaInventoryService',
    '../services/notificationService'
], function (runtime, log, constants, configHelper, logger, amazonClient, fbaInventoryService, notificationService) {

    var CR = constants.CUSTOM_RECORDS.CONFIG;

    function execute(context) {
        logger.progress(constants.LOG_TYPE.FBA_INVENTORY, 'FBA inventory sync started');

        try {
            var configs = configHelper.getAllConfigs();

            for (var i = 0; i < configs.length; i++) {
                var config = configs[i];

                if (!config.fbaEnabled || !config.fbaInvSyncEnabled) {
                    log.debug({ title: 'FBA Inv Sync', details: 'Skipping disabled config: ' + config.configId });
                    continue;
                }

                processFbaInventory(config);

                if (runtime.getCurrentScript().getRemainingUsage() < 500) {
                    logger.warn(constants.LOG_TYPE.FBA_INVENTORY, 'Low governance, stopping FBA sync');
                    return;
                }
            }

            logger.success(constants.LOG_TYPE.FBA_INVENTORY, 'FBA inventory sync completed');
        } catch (e) {
            logger.error(constants.LOG_TYPE.FBA_INVENTORY,
                'FBA inventory sync failed: ' + e.message, { details: e.stack });
        }
    }

    function processFbaInventory(config) {
        try {
            // Request FBA inventory report
            var reportResponse = fbaInventoryService.requestFbaInventoryReport(config);
            var reportId = reportResponse.reportId;

            if (!reportId) {
                logger.warn(constants.LOG_TYPE.FBA_INVENTORY,
                    'No report ID returned for FBA inventory request', { configId: config.configId });
                return;
            }

            // Poll for report completion (up to 5 attempts)
            var attempts = 0;
            var maxAttempts = 5;
            var reportStatus;

            while (attempts < maxAttempts) {
                reportStatus = amazonClient.getReport(config, reportId);
                if (reportStatus.processingStatus === 'DONE') break;
                if (reportStatus.processingStatus === 'FATAL' || reportStatus.processingStatus === 'CANCELLED') {
                    logger.error(constants.LOG_TYPE.FBA_INVENTORY,
                        'FBA inventory report failed: ' + reportStatus.processingStatus, { configId: config.configId });
                    return;
                }
                attempts++;
            }

            if (!reportStatus || reportStatus.processingStatus !== 'DONE') {
                logger.warn(constants.LOG_TYPE.FBA_INVENTORY,
                    'FBA inventory report not ready after polling', { configId: config.configId });
                return;
            }

            // Download and process report
            var fbaItems = fbaInventoryService.downloadFbaInventoryReport(config, reportStatus.reportDocumentId);
            var summary = fbaInventoryService.updateFbaInventory(config, fbaItems);

            // Send notification if configured
            notificationService.sendSyncSummary(config, 'FBA Inventory', summary);

        } catch (e) {
            logger.error(constants.LOG_TYPE.FBA_INVENTORY,
                'FBA inventory processing failed for config ' + config.configId + ': ' + e.message, {
                configId: config.configId,
                details: e.stack
            });
            notificationService.sendErrorNotification(config,
                'FBA Inventory Sync Failed', 'Error: ' + e.message);
        }
    }

    return { execute };
});
