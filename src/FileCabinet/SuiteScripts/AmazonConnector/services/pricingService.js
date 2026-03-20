/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Amazon Pricing operations.
 *              Pushes NetSuite prices to Amazon via Feeds API.
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
     * Gets all item mappings that have price sync enabled.
     * @param {string} configId
     * @returns {Array<Object>}
     */
    function getPriceSyncItems(configId) {
        const items = [];

        search.create({
            type: IM.ID,
            filters: [
                [IM.FIELDS.CONFIG, 'anyof', configId],
                'AND',
                [IM.FIELDS.PRICE_SYNC, 'is', 'T'],
                'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: [
                IM.FIELDS.ASIN,
                IM.FIELDS.SELLER_SKU,
                IM.FIELDS.NS_ITEM,
                IM.FIELDS.PRICE
            ]
        }).run().each(function (result) {
            items.push({
                mapId: result.id,
                asin: result.getValue(IM.FIELDS.ASIN),
                sellerSku: result.getValue(IM.FIELDS.SELLER_SKU),
                nsItemId: result.getValue(IM.FIELDS.NS_ITEM),
                lastPrice: parseFloat(result.getValue(IM.FIELDS.PRICE)) || 0
            });
            return true;
        });

        return items;
    }

    /**
     * Gets the current base price for a NetSuite item.
     * @param {string|number} itemId
     * @returns {number} Base price
     */
    function getNetSuitePrice(itemId) {
        let price = 0;

        search.create({
            type: 'item',
            filters: [['internalid', 'anyof', itemId]],
            columns: ['baseprice']
        }).run().each(function (result) {
            price = parseFloat(result.getValue('baseprice')) || 0;
            return false;
        });

        return price;
    }

    /**
     * Builds a pricing XML feed for Amazon.
     * @param {string} sellerId
     * @param {Array<Object>} pricingData - Array of { sellerSku, price, currency }
     * @returns {string} XML feed
     */
    function buildPricingFeedXml(sellerId, pricingData) {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ';
        xml += 'xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">\n';
        xml += '  <Header>\n';
        xml += '    <DocumentVersion>1.01</DocumentVersion>\n';
        xml += '    <MerchantIdentifier>' + escapeXml(sellerId) + '</MerchantIdentifier>\n';
        xml += '  </Header>\n';
        xml += '  <MessageType>Price</MessageType>\n';

        pricingData.forEach(function (item, index) {
            xml += '  <Message>\n';
            xml += '    <MessageID>' + (index + 1) + '</MessageID>\n';
            xml += '    <Price>\n';
            xml += '      <SKU>' + escapeXml(item.sellerSku) + '</SKU>\n';
            xml += '      <StandardPrice currency="' + escapeXml(item.currency || 'USD') + '">';
            xml += item.price.toFixed(2) + '</StandardPrice>\n';
            if (item.salePrice) {
                xml += '      <Sale>\n';
                xml += '        <SalePrice currency="' + escapeXml(item.currency || 'USD') + '">';
                xml += item.salePrice.toFixed(2) + '</SalePrice>\n';
                if (item.saleStartDate) {
                    xml += '        <StartDate>' + item.saleStartDate + '</StartDate>\n';
                }
                if (item.saleEndDate) {
                    xml += '        <EndDate>' + item.saleEndDate + '</EndDate>\n';
                }
                xml += '      </Sale>\n';
            }
            xml += '    </Price>\n';
            xml += '  </Message>\n';
        });

        xml += '</AmazonEnvelope>';
        return xml;
    }

    /**
     * Submits a pricing feed to Amazon.
     * @param {Object} config
     * @param {string} feedContent - XML feed
     * @returns {Object} Feed response
     */
    function submitPricingFeed(config, feedContent) {
        const docResponse = amazonClient.createFeedDocument(config, 'text/xml; charset=UTF-8');
        const feedDocumentId = docResponse.feedDocumentId;
        const uploadUrl = docResponse.url;

        var uploadResponse = https.put({
            url: uploadUrl,
            headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
            body: feedContent
        });
        if (uploadResponse.code !== 200) {
            throw new Error('Failed to upload pricing feed to S3: HTTP ' + uploadResponse.code);
        }

        const feedResponse = amazonClient.createFeed(
            config,
            constants.FEED_TYPES.PRICING,
            feedDocumentId
        );

        logger.success(constants.LOG_TYPE.PRICING_SYNC,
            'Pricing feed submitted: ' + feedResponse.feedId, {
            configId: config.configId
        });

        return feedResponse;
    }

    /**
     * Updates item mapping with new price after sync.
     */
    function updateItemMapPrice(mapId, price) {
        record.submitFields({
            type: IM.ID,
            id: mapId,
            values: {
                [IM.FIELDS.PRICE]: price,
                [IM.FIELDS.LAST_SYNCED]: new Date()
            }
        });
    }

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
        getPriceSyncItems,
        getNetSuitePrice,
        buildPricingFeedXml,
        submitPricingFeed,
        updateItemMapPrice
    };
});
