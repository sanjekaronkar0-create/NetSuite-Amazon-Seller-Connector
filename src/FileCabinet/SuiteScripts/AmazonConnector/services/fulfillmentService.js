/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Fulfillment sync.
 *              Sends shipment confirmations from NetSuite to Amazon when items are fulfilled.
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

    const OM = constants.CUSTOM_RECORDS.ORDER_MAP;

    /**
     * Gets the Amazon Order ID for a NetSuite Sales Order.
     * @param {string|number} salesOrderId
     * @returns {Object|null} Order mapping info
     */
    function getAmazonOrderForSalesOrder(salesOrderId) {
        let result = null;

        search.create({
            type: OM.ID,
            filters: [[OM.FIELDS.NS_SALES_ORDER, 'anyof', salesOrderId]],
            columns: [OM.FIELDS.ORDER_ID, OM.FIELDS.CONFIG, OM.FIELDS.FULFILLMENT_CHANNEL]
        }).run().each(function (r) {
            result = {
                mapId: r.id,
                amazonOrderId: r.getValue(OM.FIELDS.ORDER_ID),
                configId: r.getValue(OM.FIELDS.CONFIG),
                fulfillmentChannel: r.getValue(OM.FIELDS.FULFILLMENT_CHANNEL)
            };
            return false;
        });

        return result;
    }

    /**
     * Extracts tracking info from an item fulfillment record.
     * @param {number|string} fulfillmentId
     * @returns {Object} Tracking details
     */
    function getTrackingInfo(fulfillmentId) {
        const fulfillment = record.load({
            type: record.Type.ITEM_FULFILLMENT,
            id: fulfillmentId
        });

        const packageCount = fulfillment.getLineCount({ sublistId: 'package' });
        const packages = [];

        for (let i = 0; i < packageCount; i++) {
            packages.push({
                trackingNumber: fulfillment.getSublistValue({
                    sublistId: 'package',
                    fieldId: 'packagetrackingnumber',
                    line: i
                }),
                carrier: fulfillment.getSublistValue({
                    sublistId: 'package',
                    fieldId: 'packagecarrier',
                    line: i
                }),
                shipMethod: fulfillment.getSublistValue({
                    sublistId: 'package',
                    fieldId: 'packageshipmethod',
                    line: i
                })
            });
        }

        return {
            shipDate: fulfillment.getValue({ fieldId: 'trandate' }),
            shipMethod: fulfillment.getValue({ fieldId: 'shipmethod' }),
            trackingNumbers: packages
                .map(p => p.trackingNumber)
                .filter(t => t),
            carrier: mapCarrier(fulfillment.getText({ fieldId: 'shipmethod' })),
            packages
        };
    }

    /**
     * Builds an order fulfillment XML feed for Amazon.
     * @param {string} sellerId
     * @param {string} amazonOrderId
     * @param {Object} trackingInfo
     * @returns {string} XML feed
     */
    function buildFulfillmentFeedXml(sellerId, amazonOrderId, trackingInfo) {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ';
        xml += 'xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">\n';
        xml += '  <Header>\n';
        xml += '    <DocumentVersion>1.01</DocumentVersion>\n';
        xml += '    <MerchantIdentifier>' + escapeXml(sellerId) + '</MerchantIdentifier>\n';
        xml += '  </Header>\n';
        xml += '  <MessageType>OrderFulfillment</MessageType>\n';
        xml += '  <Message>\n';
        xml += '    <MessageID>1</MessageID>\n';
        xml += '    <OrderFulfillment>\n';
        xml += '      <AmazonOrderID>' + escapeXml(amazonOrderId) + '</AmazonOrderID>\n';
        xml += '      <FulfillmentDate>' + formatDate(trackingInfo.shipDate) + '</FulfillmentDate>\n';

        if (trackingInfo.trackingNumbers.length > 0) {
            xml += '      <FulfillmentData>\n';
            xml += '        <CarrierName>' + escapeXml(trackingInfo.carrier) + '</CarrierName>\n';
            xml += '        <ShippingMethod>Standard</ShippingMethod>\n';
            xml += '        <ShipperTrackingNumber>' +
                escapeXml(trackingInfo.trackingNumbers[0]) + '</ShipperTrackingNumber>\n';
            xml += '      </FulfillmentData>\n';

            // Send additional tracking numbers as separate FulfillmentData blocks
            for (var i = 1; i < trackingInfo.trackingNumbers.length; i++) {
                var pkg = trackingInfo.packages[i] || {};
                var pkgCarrier = pkg.carrier ? mapCarrier(pkg.carrier) : trackingInfo.carrier;
                xml += '      <FulfillmentData>\n';
                xml += '        <CarrierName>' + escapeXml(pkgCarrier) + '</CarrierName>\n';
                xml += '        <ShippingMethod>Standard</ShippingMethod>\n';
                xml += '        <ShipperTrackingNumber>' +
                    escapeXml(trackingInfo.trackingNumbers[i]) + '</ShipperTrackingNumber>\n';
                xml += '      </FulfillmentData>\n';
            }
        }

        xml += '    </OrderFulfillment>\n';
        xml += '  </Message>\n';
        xml += '</AmazonEnvelope>';
        return xml;
    }

    /**
     * Submits a fulfillment feed to Amazon.
     * @param {Object} config
     * @param {string} feedContent - XML feed
     * @returns {Object} Feed submission result
     */
    function submitFulfillmentFeed(config, feedContent) {
        const docResponse = amazonClient.createFeedDocument(config, 'text/xml; charset=UTF-8');
        const feedDocumentId = docResponse.feedDocumentId;
        const uploadUrl = docResponse.url;

        var uploadResponse = https.put({
            url: uploadUrl,
            headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
            body: feedContent
        });
        if (uploadResponse.code !== 200) {
            throw new Error('Failed to upload fulfillment feed to S3: HTTP ' + uploadResponse.code);
        }

        const feedResponse = amazonClient.createFeed(
            config,
            'POST_ORDER_FULFILLMENT_DATA',
            feedDocumentId
        );

        logger.success(constants.LOG_TYPE.FULFILLMENT_SYNC,
            'Fulfillment feed submitted for order: ' + feedResponse.feedId, {
            configId: config.configId
        });

        return feedResponse;
    }

    /**
     * Maps NetSuite ship method to Amazon carrier name.
     * Uses comprehensive carrier map from constants.
     */
    function mapCarrier(shipMethodText) {
        if (!shipMethodText) return 'Other';
        const text = shipMethodText.toLowerCase();

        const carrierMap = constants.CARRIER_MAP;
        for (const key in carrierMap) {
            if (text.includes(key)) return carrierMap[key];
        }

        return 'Other';
    }

    /**
     * Formats a Date to ISO 8601 string.
     */
    function formatDate(date) {
        if (!date) return new Date().toISOString();
        if (date instanceof Date) return date.toISOString();
        return new Date(date).toISOString();
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
        getAmazonOrderForSalesOrder,
        getTrackingInfo,
        buildFulfillmentFeedXml,
        submitFulfillmentFeed,
        mapCarrier
    };
});
