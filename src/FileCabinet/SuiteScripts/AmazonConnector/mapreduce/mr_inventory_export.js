/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @description Map/Reduce script that reads NetSuite inventory quantities
 *              and submits inventory feeds to Amazon.
 */
define([
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger',
    '../services/inventoryService'
], function (runtime, log, constants, configHelper, logger, inventoryService) {

    /**
     * Input stage: Get all item mappings for the config.
     */
    function getInputData() {
        const configId = runtime.getCurrentScript().getParameter({
            name: 'custscript_amz_mr_inv_config_id'
        });

        if (!configId) {
            log.error({ title: 'MR Inventory Export', details: 'No config ID provided' });
            return [];
        }

        const items = inventoryService.getInventorySyncItems(configId);
        log.audit({
            title: 'MR Inventory Export - Input',
            details: 'Processing ' + items.length + ' items for config ' + configId
        });

        return items.map(function (item) {
            item.configId = configId;
            return item;
        });
    }

    /**
     * Map stage: Get current NetSuite quantity for each item.
     */
    function map(context) {
        try {
            const item = JSON.parse(context.value);
            const config = configHelper.getConfig(item.configId);

            const currentQty = inventoryService.getAvailableQuantity(
                item.nsItemId,
                config.location
            );

            // Only sync if quantity changed
            if (currentQty !== item.lastQty) {
                context.write({
                    key: item.configId,
                    value: JSON.stringify({
                        mapId: item.mapId,
                        sellerSku: item.sellerSku,
                        quantity: currentQty,
                        previousQty: item.lastQty
                    })
                });
            }
        } catch (e) {
            logger.error(constants.LOG_TYPE.INVENTORY_SYNC,
                'Map stage error: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Reduce stage: Batch inventory updates by config and submit feed.
     */
    function reduce(context) {
        const configId = context.key;

        try {
            const config = configHelper.getConfig(configId);
            const inventoryData = context.values.map(v => JSON.parse(v));

            if (inventoryData.length === 0) return;

            log.audit({
                title: 'MR Inventory Export - Reduce',
                details: 'Submitting feed for ' + inventoryData.length + ' items'
            });

            // Build and submit the feed
            const feedXml = inventoryService.buildInventoryFeedXml(
                config.sellerId,
                inventoryData
            );

            const feedResult = inventoryService.submitInventoryFeed(config, feedXml);

            // Update item mapping records with new quantities
            for (const item of inventoryData) {
                inventoryService.updateItemMapQuantity(item.mapId, item.quantity);
            }

            logger.success(constants.LOG_TYPE.INVENTORY_SYNC,
                'Inventory feed submitted: ' + inventoryData.length + ' items updated', {
                configId: configId,
                details: JSON.stringify(feedResult)
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.INVENTORY_SYNC,
                'Reduce error for config ' + configId + ': ' + e.message, {
                configId: configId,
                details: e.stack
            });
        }
    }

    /**
     * Summarize stage.
     */
    function summarize(summary) {
        log.audit({
            title: 'MR Inventory Export - Summary',
            details: 'Completed. Reduce errors: ' + summary.reduceSummary.errors.iterator().size
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            logger.error(constants.LOG_TYPE.INVENTORY_SYNC,
                'Inventory reduce error for config ' + key + ': ' + error);
            return true;
        });
    }

    return {
        getInputData,
        map,
        reduce,
        summarize
    };
});
