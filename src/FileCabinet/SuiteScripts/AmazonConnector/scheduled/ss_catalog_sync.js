/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script that syncs Amazon catalog/listings to NetSuite item mappings.
 *              Downloads active listings report and auto-creates/updates item mapping records.
 */
define([
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/amazonClient',
    '../lib/logger',
    '../services/catalogService',
    '../services/notificationService'
], function (runtime, log, constants, configHelper, amazonClient, logger, catalogService, notificationService) {

    function execute(context) {
        logger.progress(constants.LOG_TYPE.CATALOG_SYNC, 'Catalog sync started');

        try {
            const configs = configHelper.getAllConfigs();

            for (const config of configs) {
                if (!config.catalogEnabled) continue;

                try {
                    syncCatalog(config);
                    configHelper.updateLastSync(
                        config.configId,
                        constants.CUSTOM_RECORDS.CONFIG.FIELDS.LAST_CATALOG_SYNC
                    );
                } catch (e) {
                    logger.error(constants.LOG_TYPE.CATALOG_SYNC,
                        'Catalog sync error for config ' + config.configId + ': ' + e.message, {
                        configId: config.configId,
                        details: e.stack
                    });
                    notificationService.sendErrorNotification(config,
                        'Catalog Sync Failed', 'Error: ' + e.message);
                }
            }

            logger.success(constants.LOG_TYPE.CATALOG_SYNC, 'Catalog sync completed');
        } catch (e) {
            logger.error(constants.LOG_TYPE.CATALOG_SYNC,
                'Catalog sync failed: ' + e.message, { details: e.stack });
        }
    }

    function syncCatalog(config) {
        // Request active listings report
        const reportResponse = catalogService.requestListingsReport(config);
        const reportId = reportResponse.reportId;

        if (!reportId) {
            log.debug({ title: 'Catalog Sync', details: 'No report ID returned' });
            return;
        }

        // Poll for report completion
        let report = null;
        let attempts = 0;

        while (attempts < 5) {
            report = amazonClient.getReport(config, reportId);
            if (report.processingStatus === 'DONE') break;
            if (report.processingStatus === 'FATAL' || report.processingStatus === 'CANCELLED') {
                logger.error(constants.LOG_TYPE.CATALOG_SYNC,
                    'Listings report failed: ' + report.processingStatus, {
                    configId: config.configId,
                    amazonRef: reportId
                });
                return;
            }
            attempts++;
        }

        if (!report || report.processingStatus !== 'DONE') {
            logger.warn(constants.LOG_TYPE.CATALOG_SYNC,
                'Listings report not ready. Will retry next run.', {
                configId: config.configId,
                amazonRef: reportId
            });
            return;
        }

        // Download and parse report
        const listings = catalogService.downloadListingsReport(config, report.reportDocumentId);

        log.audit({
            title: 'Catalog Sync',
            details: 'Processing ' + listings.length + ' listings for config ' + config.configId
        });

        let created = 0;
        let updated = 0;
        let autoMatched = 0;

        for (const listing of listings) {
            if (runtime.getCurrentScript().getRemainingUsage() < 200) {
                logger.warn(constants.LOG_TYPE.CATALOG_SYNC, 'Low governance, stopping');
                break;
            }

            if (!listing.sellerSku) continue;

            // Check for existing mapping
            const existing = catalogService.findExistingMapping(listing.sellerSku, config.configId);

            // Try to auto-match to NS item if no mapping exists
            let nsItemId = existing ? existing.nsItemId : null;
            if (!nsItemId) {
                nsItemId = catalogService.autoMatchNetSuiteItem(listing.sellerSku);
                if (nsItemId) autoMatched++;
            }

            catalogService.upsertItemMapping(config, listing, nsItemId);

            if (existing) {
                updated++;
            } else {
                created++;
            }
        }

        logger.success(constants.LOG_TYPE.CATALOG_SYNC,
            'Catalog sync: ' + created + ' created, ' + updated + ' updated, ' +
            autoMatched + ' auto-matched for config ' + config.configId, {
            configId: config.configId
        });

        // Log mapping stats
        const stats = catalogService.getMappingStats(config.configId);
        log.audit({
            title: 'Catalog Sync - Stats',
            details: 'Total: ' + stats.total + ' | Mapped: ' + stats.mapped +
                ' | Unmapped: ' + stats.unmapped
        });
    }

    return { execute };
});
