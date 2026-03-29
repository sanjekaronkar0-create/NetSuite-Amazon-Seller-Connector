/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Amazon Catalog / Listing operations.
 *              Downloads active listings reports and auto-creates item mappings.
 *              Provides foundation for product listing management.
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
     * Requests an active listings report from Amazon.
     * @param {Object} config
     * @returns {Object} Report creation response
     */
    function requestListingsReport(config) {
        return amazonClient.createReport(config, constants.REPORT_TYPES.ACTIVE_LISTINGS);
    }

    /**
     * Downloads and parses a listings report.
     * @param {Object} config
     * @param {string} reportDocumentId
     * @returns {Array<Object>} Parsed listing entries
     */
    function downloadListingsReport(config, reportDocumentId) {
        const docResponse = amazonClient.getReportDocument(config, reportDocumentId);
        const fileResponse = https.get({ url: docResponse.url });
        if (fileResponse.code !== 200) {
            throw new Error('Failed to download listings report: HTTP ' + fileResponse.code);
        }
        return parseListingsReport(fileResponse.body);
    }

    /**
     * Parses tab-delimited listings report.
     */
    function parseListingsReport(rawData) {
        const lines = rawData.split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split('\t').map(h => h.trim());
        const listings = [];

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const values = lines[i].split('\t');
            const row = {};
            headers.forEach(function (h, idx) {
                row[h] = (values[idx] || '').trim();
            });

            listings.push({
                sellerSku: row['seller-sku'] || row['sku'] || '',
                asin: row['asin1'] || row['asin'] || '',
                title: row['item-name'] || row['product-name'] || row['title'] || '',
                price: parseFloat(row['price'] || '0'),
                quantity: parseInt(row['quantity'] || '0', 10),
                status: row['status'] || row['listing-status'] || 'Active',
                fulfillmentChannel: row['fulfillment-channel'] || 'DEFAULT',
                condition: row['item-condition'] || '',
                openDate: row['open-date'] || ''
            });
        }

        return listings;
    }

    /**
     * Checks if an item mapping already exists for a seller SKU.
     * @param {string} sellerSku
     * @param {string} configId
     * @returns {Object|null} Existing mapping or null
     */
    function findExistingMapping(sellerSku, configId) {
        let result = null;

        search.create({
            type: IM.ID,
            filters: [
                [IM.FIELDS.SELLER_SKU, 'is', sellerSku],
                'AND',
                [IM.FIELDS.CONFIG, 'anyof', configId]
            ],
            columns: [IM.FIELDS.NS_ITEM, IM.FIELDS.ASIN, IM.FIELDS.TITLE]
        }).run().each(function (r) {
            result = {
                mapId: r.id,
                nsItemId: r.getValue(IM.FIELDS.NS_ITEM),
                asin: r.getValue(IM.FIELDS.ASIN),
                title: r.getValue(IM.FIELDS.TITLE)
            };
            return false;
        });

        return result;
    }

    /**
     * Tries to match an Amazon listing to a NetSuite item by SKU/UPC.
     * @param {string} sellerSku
     * @returns {string|null} NS Item internal ID
     */
    function autoMatchNetSuiteItem(sellerSku) {
        let itemId = null;

        // Try matching by item name/number (itemid field)
        search.create({
            type: 'item',
            filters: [
                ['itemid', 'is', sellerSku],
                'OR',
                ['upccode', 'is', sellerSku],
                'OR',
                ['externalid', 'is', sellerSku]
            ],
            columns: ['internalid', 'itemid']
        }).run().each(function (result) {
            itemId = result.id;
            return false;
        });

        return itemId;
    }

    /**
     * Creates or updates an item mapping record from a listing.
     * @param {Object} config
     * @param {Object} listing - Parsed listing data
     * @param {string|null} nsItemId - Matched NS item (null if unmatched)
     * @returns {number} Item mapping record ID
     */
    function upsertItemMapping(config, listing, nsItemId) {
        const existing = findExistingMapping(listing.sellerSku, config.configId);

        if (existing) {
            // Update existing mapping
            const updateValues = {
                [IM.FIELDS.TITLE]: (listing.title || '').substring(0, 300),
                [IM.FIELDS.PRICE]: listing.price || 0,
                [IM.FIELDS.LISTING_STATUS]: listing.status || 'Active',
                [IM.FIELDS.LAST_SYNCED]: new Date()
            };
            if (listing.asin) updateValues[IM.FIELDS.ASIN] = listing.asin;
            if (listing.condition) updateValues[IM.FIELDS.CONDITION] = listing.condition;
            if (listing.fulfillmentChannel) {
                updateValues[IM.FIELDS.FULFILLMENT_CHANNEL] = listing.fulfillmentChannel;
            }

            record.submitFields({
                type: IM.ID,
                id: existing.mapId,
                values: updateValues
            });
            return parseInt(existing.mapId, 10);
        }

        // Create new mapping
        const rec = record.create({ type: IM.ID });
        rec.setValue({ fieldId: 'name', value: (listing.sellerSku + ' - ' + (listing.title || '')).substring(0, 99) });
        rec.setValue({ fieldId: IM.FIELDS.SELLER_SKU, value: listing.sellerSku });
        rec.setValue({ fieldId: IM.FIELDS.CONFIG, value: config.configId });
        rec.setValue({ fieldId: IM.FIELDS.TITLE, value: (listing.title || '').substring(0, 300) });
        rec.setValue({ fieldId: IM.FIELDS.PRICE, value: listing.price || 0 });
        rec.setValue({ fieldId: IM.FIELDS.LISTING_STATUS, value: listing.status || 'Active' });
        rec.setValue({ fieldId: IM.FIELDS.LAST_SYNCED, value: new Date() });

        if (listing.asin) rec.setValue({ fieldId: IM.FIELDS.ASIN, value: listing.asin });
        if (listing.condition) rec.setValue({ fieldId: IM.FIELDS.CONDITION, value: listing.condition });
        if (listing.fulfillmentChannel) {
            rec.setValue({ fieldId: IM.FIELDS.FULFILLMENT_CHANNEL, value: listing.fulfillmentChannel });
        }

        if (nsItemId) {
            rec.setValue({ fieldId: IM.FIELDS.NS_ITEM, value: nsItemId });
            rec.setValue({ fieldId: IM.FIELDS.INV_SYNC, value: true });
        }

        return rec.save({ ignoreMandatoryFields: true });
    }

    /**
     * Gets counts of mapped vs unmapped items for a config.
     * @param {string} configId
     * @returns {Object} { total, mapped, unmapped }
     */
    function getMappingStats(configId) {
        let total = 0;
        let mapped = 0;

        search.create({
            type: IM.ID,
            filters: [
                [IM.FIELDS.CONFIG, 'anyof', configId],
                'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: [IM.FIELDS.NS_ITEM]
        }).run().each(function (result) {
            total++;
            if (result.getValue(IM.FIELDS.NS_ITEM)) mapped++;
            return true;
        });

        return { total, mapped, unmapped: total - mapped };
    }

    return {
        requestListingsReport,
        downloadListingsReport,
        findExistingMapping,
        autoMatchNetSuiteItem,
        upsertItemMapping,
        getMappingStats
    };
});
