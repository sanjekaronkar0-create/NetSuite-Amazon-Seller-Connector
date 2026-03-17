/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Product Feed Export (NetSuite -> Amazon).
 *              Creates/updates Amazon product listings from NetSuite items
 *              using the POST_PRODUCT_DATA feed type.
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

    var IM = constants.CUSTOM_RECORDS.ITEM_MAP;

    /**
     * Gets items that need to be listed/updated on Amazon.
     * Looks for item mappings flagged for product sync.
     * @param {string} configId
     * @returns {Array<Object>}
     */
    function getProductSyncItems(configId) {
        var items = [];

        search.create({
            type: IM.ID,
            filters: [
                [IM.FIELDS.CONFIG, 'anyof', configId],
                'AND',
                ['isinactive', 'is', 'F'],
                'AND',
                [IM.FIELDS.NS_ITEM, 'noneof', '@NONE@']
            ],
            columns: [
                IM.FIELDS.ASIN,
                IM.FIELDS.SELLER_SKU,
                IM.FIELDS.NS_ITEM,
                IM.FIELDS.TITLE
            ]
        }).run().each(function (result) {
            items.push({
                mapId: result.id,
                asin: result.getValue(IM.FIELDS.ASIN),
                sellerSku: result.getValue(IM.FIELDS.SELLER_SKU),
                nsItemId: result.getValue(IM.FIELDS.NS_ITEM),
                title: result.getValue(IM.FIELDS.TITLE)
            });
            return true;
        });

        return items;
    }

    /**
     * Gets detailed item data from NetSuite for a product feed.
     * @param {string|number} itemId
     * @returns {Object} Item details
     */
    function getNetSuiteItemDetails(itemId) {
        var details = {};

        search.create({
            type: 'item',
            filters: [['internalid', 'anyof', itemId]],
            columns: [
                'itemid', 'displayname', 'description', 'salesdescription',
                'baseprice', 'upccode', 'weight', 'weightunit',
                'custitem_brand', 'manufacturer', 'mpn'
            ]
        }).run().each(function (result) {
            details = {
                itemId: result.getValue('itemid'),
                displayName: result.getValue('displayname'),
                description: result.getValue('description'),
                salesDescription: result.getValue('salesdescription'),
                basePrice: parseFloat(result.getValue('baseprice')) || 0,
                upc: result.getValue('upccode'),
                weight: parseFloat(result.getValue('weight')) || 0,
                weightUnit: result.getValue('weightunit'),
                brand: result.getValue('custitem_brand') || result.getValue('manufacturer') || '',
                mpn: result.getValue('mpn') || ''
            };
            return false;
        });

        return details;
    }

    /**
     * Builds a Product Data XML feed for Amazon.
     * @param {string} sellerId
     * @param {Array<Object>} products - Array of product data
     * @returns {string} XML feed
     */
    function buildProductFeedXml(sellerId, products) {
        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ';
        xml += 'xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">\n';
        xml += '  <Header>\n';
        xml += '    <DocumentVersion>1.01</DocumentVersion>\n';
        xml += '    <MerchantIdentifier>' + escapeXml(sellerId) + '</MerchantIdentifier>\n';
        xml += '  </Header>\n';
        xml += '  <MessageType>Product</MessageType>\n';
        xml += '  <PurgeAndReplace>false</PurgeAndReplace>\n';

        products.forEach(function (product, index) {
            xml += '  <Message>\n';
            xml += '    <MessageID>' + (index + 1) + '</MessageID>\n';
            xml += '    <OperationType>Update</OperationType>\n';
            xml += '    <Product>\n';
            xml += '      <SKU>' + escapeXml(product.sellerSku) + '</SKU>\n';

            if (product.upc) {
                xml += '      <StandardProductID>\n';
                xml += '        <Type>UPC</Type>\n';
                xml += '        <Value>' + escapeXml(product.upc) + '</Value>\n';
                xml += '      </StandardProductID>\n';
            }

            xml += '      <DescriptionData>\n';
            xml += '        <Title>' + escapeXml(product.title || product.displayName || product.sellerSku) + '</Title>\n';
            if (product.brand) {
                xml += '        <Brand>' + escapeXml(product.brand) + '</Brand>\n';
            }
            if (product.description || product.salesDescription) {
                xml += '        <Description>' + escapeXml(product.description || product.salesDescription) + '</Description>\n';
            }
            if (product.mpn) {
                xml += '        <MfrPartNumber>' + escapeXml(product.mpn) + '</MfrPartNumber>\n';
            }
            xml += '      </DescriptionData>\n';
            xml += '    </Product>\n';
            xml += '  </Message>\n';
        });

        xml += '</AmazonEnvelope>';
        return xml;
    }

    /**
     * Builds a Product Relationship feed (parent-child/variation).
     * @param {string} sellerId
     * @param {Array<Object>} relationships
     * @returns {string} XML feed
     */
    function buildRelationshipFeedXml(sellerId, relationships) {
        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ';
        xml += 'xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">\n';
        xml += '  <Header>\n';
        xml += '    <DocumentVersion>1.01</DocumentVersion>\n';
        xml += '    <MerchantIdentifier>' + escapeXml(sellerId) + '</MerchantIdentifier>\n';
        xml += '  </Header>\n';
        xml += '  <MessageType>Relationship</MessageType>\n';

        relationships.forEach(function (rel, index) {
            xml += '  <Message>\n';
            xml += '    <MessageID>' + (index + 1) + '</MessageID>\n';
            xml += '    <OperationType>Update</OperationType>\n';
            xml += '    <Relationship>\n';
            xml += '      <ParentSKU>' + escapeXml(rel.parentSku) + '</ParentSKU>\n';

            rel.children.forEach(function (child) {
                xml += '      <Relation>\n';
                xml += '        <SKU>' + escapeXml(child.sku) + '</SKU>\n';
                xml += '        <Type>Variation</Type>\n';
                xml += '      </Relation>\n';
            });

            xml += '    </Relationship>\n';
            xml += '  </Message>\n';
        });

        xml += '</AmazonEnvelope>';
        return xml;
    }

    /**
     * Submits a product feed to Amazon.
     * @param {Object} config
     * @param {string} feedContent - XML feed
     * @param {string} [feedType] - Feed type (default: POST_PRODUCT_DATA)
     * @returns {Object} Feed response
     */
    function submitProductFeed(config, feedContent, feedType) {
        var docResponse = amazonClient.createFeedDocument(config, 'text/xml; charset=UTF-8');
        var feedDocumentId = docResponse.feedDocumentId;
        var uploadUrl = docResponse.url;

        https.put({
            url: uploadUrl,
            headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
            body: feedContent
        });

        var feedResponse = amazonClient.createFeed(
            config,
            feedType || constants.FEED_TYPES.PRODUCT,
            feedDocumentId
        );

        logger.success(constants.LOG_TYPE.CATALOG_SYNC,
            'Product feed submitted: ' + feedResponse.feedId, {
            configId: config.configId
        });

        return feedResponse;
    }

    /**
     * Builds an Image feed for Amazon.
     * @param {string} sellerId
     * @param {Array<Object>} images - Array of { sellerSku, imageUrl, imageType }
     * @returns {string} XML feed
     */
    function buildImageFeedXml(sellerId, images) {
        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ';
        xml += 'xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">\n';
        xml += '  <Header>\n';
        xml += '    <DocumentVersion>1.01</DocumentVersion>\n';
        xml += '    <MerchantIdentifier>' + escapeXml(sellerId) + '</MerchantIdentifier>\n';
        xml += '  </Header>\n';
        xml += '  <MessageType>ProductImage</MessageType>\n';

        images.forEach(function (img, index) {
            xml += '  <Message>\n';
            xml += '    <MessageID>' + (index + 1) + '</MessageID>\n';
            xml += '    <OperationType>Update</OperationType>\n';
            xml += '    <ProductImage>\n';
            xml += '      <SKU>' + escapeXml(img.sellerSku) + '</SKU>\n';
            xml += '      <ImageType>' + escapeXml(img.imageType || 'Main') + '</ImageType>\n';
            xml += '      <ImageLocation>' + escapeXml(img.imageUrl) + '</ImageLocation>\n';
            xml += '    </ProductImage>\n';
            xml += '  </Message>\n';
        });

        xml += '</AmazonEnvelope>';
        return xml;
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
        getProductSyncItems,
        getNetSuiteItemDetails,
        buildProductFeedXml,
        buildRelationshipFeedXml,
        buildImageFeedXml,
        submitProductFeed
    };
});
