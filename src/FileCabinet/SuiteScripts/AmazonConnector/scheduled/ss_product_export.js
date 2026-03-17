/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script that exports product data from NetSuite to Amazon.
 *              Reads mapped items and submits Product Data feeds to create/update
 *              Amazon listings from NetSuite item records.
 */
define([
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger',
    '../services/productFeedService',
    '../services/feedTrackingService',
    '../services/notificationService'
], function (runtime, log, constants, configHelper, logger, productFeedService, feedTrackingService, notificationService) {

    function execute(context) {
        logger.progress(constants.LOG_TYPE.CATALOG_SYNC, 'Product export started');

        try {
            var configs = configHelper.getAllConfigs();

            for (var c = 0; c < configs.length; c++) {
                var config = configs[c];
                if (!config.catalogEnabled) continue;

                try {
                    exportProducts(config);
                } catch (e) {
                    logger.error(constants.LOG_TYPE.CATALOG_SYNC,
                        'Product export error for config ' + config.configId + ': ' + e.message, {
                        configId: config.configId,
                        details: e.stack
                    });
                    notificationService.sendErrorNotification(config,
                        'Product Export Failed', 'Error: ' + e.message);
                }
            }

            logger.success(constants.LOG_TYPE.CATALOG_SYNC, 'Product export completed');
        } catch (e) {
            logger.error(constants.LOG_TYPE.CATALOG_SYNC,
                'Product export failed: ' + e.message, { details: e.stack });
        }
    }

    function exportProducts(config) {
        var items = productFeedService.getProductSyncItems(config.configId);

        if (items.length === 0) {
            log.debug({ title: 'Product Export', details: 'No items to export for config ' + config.configId });
            return;
        }

        log.audit({
            title: 'Product Export',
            details: 'Processing ' + items.length + ' items for config ' + config.configId
        });

        // Enrich items with NetSuite details
        var products = [];
        for (var i = 0; i < items.length; i++) {
            if (runtime.getCurrentScript().getRemainingUsage() < 200) {
                logger.warn(constants.LOG_TYPE.CATALOG_SYNC, 'Low governance, stopping product enrichment');
                break;
            }

            var details = productFeedService.getNetSuiteItemDetails(items[i].nsItemId);
            products.push({
                sellerSku: items[i].sellerSku,
                asin: items[i].asin,
                title: items[i].title || details.displayName,
                displayName: details.displayName,
                description: details.description,
                salesDescription: details.salesDescription,
                upc: details.upc,
                brand: details.brand,
                mpn: details.mpn
            });
        }

        if (products.length === 0) return;

        // Build and submit product feed
        var feedXml = productFeedService.buildProductFeedXml(config.sellerId, products);
        var feedResult = productFeedService.submitProductFeed(config, feedXml);

        // Track feed completion
        if (feedResult && feedResult.feedId) {
            var trackResult = feedTrackingService.trackFeedCompletion(config, feedResult.feedId, 'Product');
            if (!trackResult.complete) {
                logger.progress(constants.LOG_TYPE.FEED_TRACKING,
                    'Product feed ' + feedResult.feedId + ' still processing. Will check next run.', {
                    configId: config.configId
                });
            }
        }

        log.audit({
            title: 'Product Export',
            details: 'Submitted ' + products.length + ' products to Amazon for config ' + config.configId
        });
    }

    return { execute };
});
