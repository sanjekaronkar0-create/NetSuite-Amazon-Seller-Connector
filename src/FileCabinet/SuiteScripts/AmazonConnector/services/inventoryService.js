/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Inventory sync operations.
 *              Reads NetSuite inventory and pushes to Amazon via Feeds API.
 */
define([
    'N/search',
    'N/record',
    'N/https',
    'N/log',
    '../lib/constants',
    '../lib/amazonClient',
    '../lib/logger'
], function (search, record, https, log, constants, amazonClient, logger) {

    const IM = constants.CUSTOM_RECORDS.ITEM_MAP;

    /**
     * Gets all item mappings that have inventory sync enabled for a config.
     * @param {string} configId
     * @returns {Array<Object>} Item mappings with NS item details
     */
    function getInventorySyncItems(configId) {
        const items = [];

        search.create({
            type: IM.ID,
            filters: [
                [IM.FIELDS.CONFIG, 'anyof', configId],
                'AND',
                [IM.FIELDS.INV_SYNC, 'is', 'T'],
                'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: [
                IM.FIELDS.ASIN,
                IM.FIELDS.SELLER_SKU,
                IM.FIELDS.NS_ITEM,
                IM.FIELDS.LAST_INV_QTY
            ]
        }).run().each(function (result) {
            items.push({
                mapId: result.id,
                asin: result.getValue(IM.FIELDS.ASIN),
                sellerSku: result.getValue(IM.FIELDS.SELLER_SKU),
                nsItemId: result.getValue(IM.FIELDS.NS_ITEM),
                lastQty: parseInt(result.getValue(IM.FIELDS.LAST_INV_QTY), 10) || 0
            });
            return true;
        });

        return items;
    }

    /**
     * Gets the available quantity for a NetSuite item at a given location.
     * @param {string|number} itemId - NetSuite item internal ID
     * @param {string|number} [locationId] - Specific location, or all if omitted
     * @returns {number} Available quantity
     */
    function getAvailableQuantity(itemId, locationId) {
        const filters = [['internalid', 'anyof', itemId]];
        if (locationId) {
            filters.push('AND', ['inventorylocation', 'anyof', locationId]);
        }

        let qty = 0;
        search.create({
            type: 'item',
            filters: filters,
            columns: [
                search.createColumn({ name: 'locationquantityavailable', summary: 'SUM' })
            ]
        }).run().each(function (result) {
            qty = parseInt(result.getValue({
                name: 'locationquantityavailable',
                summary: 'SUM'
            }), 10) || 0;
            return false;
        });

        return Math.max(0, qty);
    }

    /**
     * Builds an XML inventory feed for Amazon SP-API.
     * @param {string} sellerId
     * @param {Array<Object>} inventoryData - Array of { sellerSku, quantity }
     * @returns {string} XML feed content
     */
    function buildInventoryFeedXml(sellerId, inventoryData) {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ';
        xml += 'xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">\n';
        xml += '  <Header>\n';
        xml += '    <DocumentVersion>1.01</DocumentVersion>\n';
        xml += '    <MerchantIdentifier>' + escapeXml(sellerId) + '</MerchantIdentifier>\n';
        xml += '  </Header>\n';
        xml += '  <MessageType>Inventory</MessageType>\n';

        inventoryData.forEach(function (item, index) {
            xml += '  <Message>\n';
            xml += '    <MessageID>' + (index + 1) + '</MessageID>\n';
            xml += '    <OperationType>Update</OperationType>\n';
            xml += '    <Inventory>\n';
            xml += '      <SKU>' + escapeXml(item.sellerSku) + '</SKU>\n';
            xml += '      <Quantity>' + item.quantity + '</Quantity>\n';
            xml += '      <FulfillmentLatency>2</FulfillmentLatency>\n';
            xml += '    </Inventory>\n';
            xml += '  </Message>\n';
        });

        xml += '</AmazonEnvelope>';
        return xml;
    }

    /**
     * Submits an inventory feed to Amazon.
     * @param {Object} config
     * @param {string} feedContent - XML feed content
     * @returns {Object} Feed submission result
     */
    function submitInventoryFeed(config, feedContent) {
        // Step 1: Create feed document
        const docResponse = amazonClient.createFeedDocument(config, 'text/xml; charset=UTF-8');
        const feedDocumentId = docResponse.feedDocumentId;
        const uploadUrl = docResponse.url;

        // Step 2: Upload feed content to S3
        var uploadResponse = https.put({
            url: uploadUrl,
            headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
            body: feedContent
        });
        if (uploadResponse.code !== 200) {
            throw new Error('Failed to upload inventory feed to S3: HTTP ' + uploadResponse.code);
        }

        // Step 3: Create feed
        const feedResponse = amazonClient.createFeed(
            config,
            'POST_INVENTORY_AVAILABILITY_DATA',
            feedDocumentId
        );

        logger.success(constants.LOG_TYPE.INVENTORY_SYNC,
            'Inventory feed submitted: ' + feedResponse.feedId, {
            configId: config.configId,
            details: JSON.stringify(feedResponse)
        });

        return feedResponse;
    }

    /**
     * Updates the last synced quantity on the item mapping record.
     */
    function updateItemMapQuantity(mapId, quantity) {
        record.submitFields({
            type: IM.ID,
            id: mapId,
            values: {
                [IM.FIELDS.LAST_INV_QTY]: quantity,
                [IM.FIELDS.LAST_SYNCED]: new Date()
            }
        });
    }

    /**
     * Escapes special XML characters.
     */
    function escapeXml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    return {
        getInventorySyncItems,
        getAvailableQuantity,
        buildInventoryFeedXml,
        submitInventoryFeed,
        updateItemMapQuantity
    };
});
