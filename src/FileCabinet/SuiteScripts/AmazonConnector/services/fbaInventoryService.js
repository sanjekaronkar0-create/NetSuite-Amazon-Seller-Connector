/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for FBA Inventory tracking.
 *              Downloads FBA inventory reports from Amazon and updates NetSuite
 *              item records with FBA-specific inventory quantities.
 */
define([
    'N/record',
    'N/search',
    'N/https',
    'N/log',
    '../lib/constants',
    '../lib/amazonClient',
    '../lib/logger'
], function (record, search, https, log, constants, amazonClient, logger) {

    const IM = constants.CUSTOM_RECORDS.ITEM_MAP;

    /**
     * Requests an FBA inventory report from Amazon.
     * @param {Object} config
     * @returns {Object} Report creation response
     */
    function requestFbaInventoryReport(config) {
        return amazonClient.createReport(config, constants.REPORT_TYPES.FBA_INVENTORY);
    }

    /**
     * Downloads and parses an FBA inventory report.
     * @param {Object} config
     * @param {string} reportDocumentId
     * @returns {Array<Object>} Parsed FBA inventory entries
     */
    function downloadFbaInventoryReport(config, reportDocumentId) {
        const docResponse = amazonClient.getReportDocument(config, reportDocumentId);
        const fileResponse = https.get({ url: docResponse.url });
        return parseFbaInventoryReport(fileResponse.body);
    }

    /**
     * Parses tab-delimited FBA inventory report.
     * @param {string} rawData
     * @returns {Array<Object>} Parsed inventory items
     */
    function parseFbaInventoryReport(rawData) {
        const lines = rawData.split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split('\t').map(function (h) { return h.trim(); });
        const items = [];

        for (var i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            var values = lines[i].split('\t');
            var row = {};
            headers.forEach(function (h, idx) {
                row[h] = (values[idx] || '').trim();
            });

            items.push({
                sellerSku: row['sku'] || row['seller-sku'] || '',
                asin: row['asin'] || '',
                fnsku: row['fnsku'] || '',
                productName: row['product-name'] || '',
                condition: row['condition'] || row['item-condition'] || '',
                availableQuantity: parseInt(row['afn-fulfillable-quantity'] || '0', 10),
                inboundQuantity: parseInt(row['afn-inbound-shipped-quantity'] || '0', 10),
                inboundReceiving: parseInt(row['afn-inbound-receiving-quantity'] || '0', 10),
                inboundWorking: parseInt(row['afn-inbound-working-quantity'] || '0', 10),
                reservedQuantity: parseInt(row['afn-reserved-quantity'] || '0', 10),
                unsellableQuantity: parseInt(row['afn-unsellable-quantity'] || '0', 10),
                totalQuantity: parseInt(row['afn-warehouse-quantity'] || '0', 10)
            });
        }

        return items;
    }

    /**
     * Updates NetSuite item mapping records with FBA inventory data.
     * @param {Object} config
     * @param {Array<Object>} fbaItems - Parsed FBA inventory
     * @returns {Object} Summary of updates { updated, skipped, errors }
     */
    function updateFbaInventory(config, fbaItems) {
        var summary = { updated: 0, skipped: 0, errors: 0 };

        fbaItems.forEach(function (fbaItem) {
            if (!fbaItem.sellerSku) {
                summary.skipped++;
                return;
            }

            try {
                // Find existing item mapping
                var existing = findItemMapping(fbaItem.sellerSku, config.configId);
                if (!existing) {
                    summary.skipped++;
                    return;
                }

                // Update the item mapping with FBA quantities
                record.submitFields({
                    type: IM.ID,
                    id: existing.mapId,
                    values: {
                        [IM.FIELDS.LAST_INV_QTY]: fbaItem.availableQuantity,
                        [IM.FIELDS.LAST_SYNCED]: new Date()
                    }
                });

                // Update NetSuite item inventory if FBA location is configured
                if (config.fbaLocation && existing.nsItemId) {
                    updateNetSuiteItemQuantity(existing.nsItemId, config.fbaLocation, fbaItem.availableQuantity);
                }

                summary.updated++;
            } catch (e) {
                log.error({
                    title: 'FBA Inventory Update',
                    details: 'Error updating SKU ' + fbaItem.sellerSku + ': ' + e.message
                });
                summary.errors++;
            }
        });

        logger.success(constants.LOG_TYPE.FBA_INVENTORY,
            'FBA inventory updated: ' + summary.updated + ' items, ' + summary.skipped + ' skipped, ' + summary.errors + ' errors', {
            configId: config.configId
        });

        return summary;
    }

    /**
     * Finds an item mapping by seller SKU and config.
     */
    function findItemMapping(sellerSku, configId) {
        var result = null;
        search.create({
            type: IM.ID,
            filters: [
                [IM.FIELDS.SELLER_SKU, 'is', sellerSku],
                'AND',
                [IM.FIELDS.CONFIG, 'anyof', configId]
            ],
            columns: [IM.FIELDS.NS_ITEM]
        }).run().each(function (r) {
            result = {
                mapId: r.id,
                nsItemId: r.getValue(IM.FIELDS.NS_ITEM)
            };
            return false;
        });
        return result;
    }

    /**
     * Updates a NetSuite Inventory Adjustment for FBA location.
     * Uses inventory detail subrecord to set quantity at FBA warehouse.
     */
    function updateNetSuiteItemQuantity(itemId, locationId, quantity) {
        try {
            // Use inventory adjustment to set FBA quantity
            var adj = record.create({
                type: record.Type.INVENTORY_ADJUSTMENT,
                isDynamic: true
            });

            adj.setValue({ fieldId: 'adjlocation', value: locationId });
            adj.setValue({ fieldId: 'memo', value: 'Amazon FBA Inventory Sync' });

            adj.selectNewLine({ sublistId: 'inventory' });
            adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'item', value: itemId });
            adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'location', value: locationId });
            adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'adjustqtyby', value: quantity });
            adj.commitLine({ sublistId: 'inventory' });

            adj.save({ ignoreMandatoryFields: true });
        } catch (e) {
            log.debug({
                title: 'FBA Qty Update',
                details: 'Could not adjust inventory for item ' + itemId + ': ' + e.message
            });
        }
    }

    /**
     * Gets FBA inventory summary via API (alternative to report).
     * @param {Object} config
     * @returns {Array<Object>} Inventory summaries
     */
    function getFbaInventorySummaries(config) {
        var allItems = [];
        var nextToken = null;

        do {
            var response = amazonClient.getFbaInventory(config, nextToken);
            var payload = response.payload || response;
            var inventories = payload.inventorySummaries || [];
            allItems = allItems.concat(inventories);
            nextToken = (payload.pagination || {}).nextToken || null;
        } while (nextToken);

        return allItems;
    }

    return {
        requestFbaInventoryReport,
        downloadFbaInventoryReport,
        parseFbaInventoryReport,
        updateFbaInventory,
        getFbaInventorySummaries
    };
});
