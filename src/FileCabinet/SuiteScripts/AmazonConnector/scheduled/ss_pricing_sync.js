/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script that syncs pricing from NetSuite to Amazon.
 *              Reads base prices and pushes via Feeds API.
 */
define([
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger',
    '../services/pricingService',
    '../services/feedTrackingService',
    '../services/notificationService'
], function (runtime, log, constants, configHelper, logger, pricingService, feedTrackingService, notificationService) {

    function execute(context) {
        logger.progress(constants.LOG_TYPE.PRICING_SYNC, 'Pricing sync started');

        try {
            const configs = configHelper.getAllConfigs();

            for (const config of configs) {
                if (!config.pricingEnabled) continue;

                try {
                    syncPricing(config);
                    configHelper.updateLastSync(
                        config.configId,
                        constants.CUSTOM_RECORDS.CONFIG.FIELDS.LAST_PRICING_SYNC
                    );
                } catch (e) {
                    logger.error(constants.LOG_TYPE.PRICING_SYNC,
                        'Pricing sync error for config ' + config.configId + ': ' + e.message, {
                        configId: config.configId,
                        details: e.stack
                    });
                    notificationService.sendErrorNotification(config,
                        'Pricing Sync Failed', 'Error: ' + e.message);
                }
            }

            logger.success(constants.LOG_TYPE.PRICING_SYNC, 'Pricing sync completed');
        } catch (e) {
            logger.error(constants.LOG_TYPE.PRICING_SYNC,
                'Pricing sync failed: ' + e.message, { details: e.stack });
        }
    }

    function syncPricing(config) {
        const items = pricingService.getPriceSyncItems(config.configId);

        if (items.length === 0) {
            log.debug({ title: 'Pricing Sync', details: 'No items with price sync enabled' });
            return;
        }

        const pricingData = [];

        for (const item of items) {
            if (runtime.getCurrentScript().getRemainingUsage() < 200) {
                logger.warn(constants.LOG_TYPE.PRICING_SYNC, 'Low governance, stopping');
                break;
            }

            const currentPrice = pricingService.getNetSuitePrice(item.nsItemId);

            // Only sync if price changed
            if (currentPrice !== item.lastPrice && currentPrice > 0) {
                // Use marketplace-specific currency instead of hardcoded USD
                var currency = constants.MARKETPLACE_CURRENCY[config.marketplaceId] || 'USD';
                pricingData.push({
                    sellerSku: item.sellerSku,
                    price: currentPrice,
                    currency: currency,
                    mapId: item.mapId
                });
            }
        }

        if (pricingData.length === 0) {
            log.debug({ title: 'Pricing Sync', details: 'No price changes detected' });
            return;
        }

        // Build and submit feed
        const feedXml = pricingService.buildPricingFeedXml(config.sellerId, pricingData);
        var feedResult = pricingService.submitPricingFeed(config, feedXml);

        // Track feed completion
        if (feedResult && feedResult.feedId) {
            feedTrackingService.trackFeedCompletion(config, feedResult.feedId, 'Pricing');
        }

        // Update item mappings with new prices
        for (const item of pricingData) {
            pricingService.updateItemMapPrice(item.mapId, item.price);
        }

        log.audit({
            title: 'Pricing Sync',
            details: 'Updated ' + pricingData.length + ' item prices for config ' + config.configId
        });
    }

    return { execute };
});
