/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Amazon Order operations.
 *              Handles creating/updating NetSuite Sales Orders from Amazon orders.
 */
define([
    'N/record',
    'N/search',
    'N/log',
    '../lib/constants',
    '../lib/amazonClient',
    '../lib/logger'
], function (record, search, log, constants, amazonClient, logger) {

    const OM = constants.CUSTOM_RECORDS.ORDER_MAP;
    const IM = constants.CUSTOM_RECORDS.ITEM_MAP;

    /**
     * Fetches orders from Amazon created after the given date.
     * Handles pagination automatically.
     * @param {Object} config
     * @param {string} createdAfter - ISO 8601 timestamp
     * @returns {Array<Object>} All Amazon orders
     */
    function fetchAmazonOrders(config, createdAfter) {
        const allOrders = [];
        let nextToken = null;

        do {
            const response = amazonClient.getOrders(config, createdAfter, nextToken);
            const payload = response.payload || response;
            const orders = payload.Orders || [];
            allOrders.push(...orders);
            nextToken = payload.NextToken || null;
        } while (nextToken);

        return allOrders;
    }

    /**
     * Checks if an Amazon order already exists in the mapping table.
     * @param {string} amazonOrderId
     * @returns {Object|null} Existing map record or null
     */
    function findExistingOrderMap(amazonOrderId) {
        const results = [];
        search.create({
            type: OM.ID,
            filters: [[OM.FIELDS.ORDER_ID, 'is', amazonOrderId]],
            columns: [OM.FIELDS.NS_SALES_ORDER, OM.FIELDS.STATUS]
        }).run().each(function (result) {
            results.push({
                id: result.id,
                nsOrderId: result.getValue(OM.FIELDS.NS_SALES_ORDER),
                status: result.getValue(OM.FIELDS.STATUS)
            });
            return true;
        });

        return results.length > 0 ? results[0] : null;
    }

    /**
     * Resolves a NetSuite item from an Amazon SKU using the item mapping table.
     * @param {string} sellerSku
     * @param {string} configId
     * @returns {string|null} NetSuite item internal ID or null
     */
    function resolveNetSuiteItem(sellerSku, configId) {
        let nsItemId = null;

        search.create({
            type: IM.ID,
            filters: [
                [IM.FIELDS.SELLER_SKU, 'is', sellerSku],
                'AND',
                [IM.FIELDS.CONFIG, 'anyof', configId]
            ],
            columns: [IM.FIELDS.NS_ITEM]
        }).run().each(function (result) {
            nsItemId = result.getValue(IM.FIELDS.NS_ITEM);
            return false;
        });

        return nsItemId;
    }

    /**
     * Creates a NetSuite Sales Order from an Amazon order.
     * @param {Object} config - Connector config
     * @param {Object} amazonOrder - Amazon order data
     * @param {Array} orderItems - Amazon order items
     * @returns {Object} Result with salesOrderId and orderMapId
     */
    function createSalesOrder(config, amazonOrder, orderItems) {
        const so = record.create({
            type: record.Type.SALES_ORDER,
            isDynamic: true
        });

        // Set header fields
        if (config.customer) {
            so.setValue({ fieldId: 'entity', value: config.customer });
        }
        if (config.subsidiary) {
            so.setValue({ fieldId: 'subsidiary', value: config.subsidiary });
        }
        if (config.location) {
            so.setValue({ fieldId: 'location', value: config.location });
        }

        so.setValue({ fieldId: 'otherrefnum', value: amazonOrder.AmazonOrderId });
        so.setValue({ fieldId: 'memo', value: 'Amazon Order: ' + amazonOrder.AmazonOrderId });

        if (amazonOrder.PurchaseDate) {
            so.setValue({ fieldId: 'trandate', value: new Date(amazonOrder.PurchaseDate) });
        }

        // Set shipping address from Amazon
        if (amazonOrder.ShippingAddress) {
            const addr = amazonOrder.ShippingAddress;
            const shipAddr = so.getSubrecord({ fieldId: 'shippingaddress' });
            if (addr.Name) shipAddr.setValue({ fieldId: 'addressee', value: addr.Name });
            if (addr.AddressLine1) shipAddr.setValue({ fieldId: 'addr1', value: addr.AddressLine1 });
            if (addr.AddressLine2) shipAddr.setValue({ fieldId: 'addr2', value: addr.AddressLine2 });
            if (addr.City) shipAddr.setValue({ fieldId: 'city', value: addr.City });
            if (addr.StateOrRegion) shipAddr.setValue({ fieldId: 'state', value: addr.StateOrRegion });
            if (addr.PostalCode) shipAddr.setValue({ fieldId: 'zip', value: addr.PostalCode });
            if (addr.CountryCode) shipAddr.setValue({ fieldId: 'country', value: addr.CountryCode });
        }

        // Add line items
        const items = orderItems.OrderItems || orderItems;
        for (const item of items) {
            const nsItemId = resolveNetSuiteItem(item.SellerSKU, config.configId);
            if (!nsItemId) {
                logger.warn(constants.LOG_TYPE.ORDER_SYNC,
                    'SKU not mapped: ' + item.SellerSKU + ' for order ' + amazonOrder.AmazonOrderId, {
                    configId: config.configId,
                    amazonRef: amazonOrder.AmazonOrderId
                });
                continue;
            }

            so.selectNewLine({ sublistId: 'item' });
            so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: nsItemId });
            so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: parseInt(item.QuantityOrdered, 10) || 1 });

            if (item.ItemPrice && item.ItemPrice.Amount) {
                so.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    value: parseFloat(item.ItemPrice.Amount) / (parseInt(item.QuantityOrdered, 10) || 1)
                });
            }

            so.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'description',
                value: (item.Title || '').substring(0, 999)
            });

            so.commitLine({ sublistId: 'item' });
        }

        const salesOrderId = so.save({ ignoreMandatoryFields: true });

        // Create order mapping record
        const orderMapId = createOrderMapRecord(config, amazonOrder, salesOrderId);

        return { salesOrderId, orderMapId };
    }

    /**
     * Creates an order mapping custom record.
     */
    function createOrderMapRecord(config, amazonOrder, salesOrderId) {
        const mapRec = record.create({ type: OM.ID });
        mapRec.setValue({ fieldId: 'name', value: amazonOrder.AmazonOrderId });
        mapRec.setValue({ fieldId: OM.FIELDS.ORDER_ID, value: amazonOrder.AmazonOrderId });
        mapRec.setValue({ fieldId: OM.FIELDS.STATUS, value: mapAmazonStatus(amazonOrder.OrderStatus) });
        mapRec.setValue({ fieldId: OM.FIELDS.CONFIG, value: config.configId });
        mapRec.setValue({ fieldId: OM.FIELDS.LAST_SYNCED, value: new Date() });

        if (salesOrderId) {
            mapRec.setValue({ fieldId: OM.FIELDS.NS_SALES_ORDER, value: salesOrderId });
        }
        if (amazonOrder.PurchaseDate) {
            mapRec.setValue({ fieldId: OM.FIELDS.PURCHASE_DATE, value: new Date(amazonOrder.PurchaseDate) });
        }
        if (amazonOrder.OrderTotal) {
            mapRec.setValue({ fieldId: OM.FIELDS.TOTAL, value: parseFloat(amazonOrder.OrderTotal.Amount) });
            mapRec.setValue({ fieldId: OM.FIELDS.CURRENCY, value: amazonOrder.OrderTotal.CurrencyCode });
        }
        if (amazonOrder.BuyerInfo && amazonOrder.BuyerInfo.BuyerEmail) {
            mapRec.setValue({ fieldId: OM.FIELDS.BUYER_EMAIL, value: amazonOrder.BuyerInfo.BuyerEmail });
        }
        if (amazonOrder.FulfillmentChannel) {
            const fc = amazonOrder.FulfillmentChannel === 'AFN'
                ? constants.FULFILLMENT_CHANNEL.AFN
                : constants.FULFILLMENT_CHANNEL.MFN;
            mapRec.setValue({ fieldId: OM.FIELDS.FULFILLMENT_CHANNEL, value: fc });
        }

        return mapRec.save({ ignoreMandatoryFields: true });
    }

    /**
     * Maps Amazon order status string to our custom list value.
     */
    function mapAmazonStatus(status) {
        const map = {
            'Pending': constants.ORDER_STATUS.PENDING,
            'PendingAvailability': constants.ORDER_STATUS.PENDING,
            'Unshipped': constants.ORDER_STATUS.UNSHIPPED,
            'PartiallyShipped': constants.ORDER_STATUS.UNSHIPPED,
            'Shipped': constants.ORDER_STATUS.SHIPPED,
            'Canceled': constants.ORDER_STATUS.CANCELED,
            'Unfulfillable': constants.ORDER_STATUS.CANCELED
        };
        return map[status] || constants.ORDER_STATUS.PENDING;
    }

    /**
     * Updates the status on an existing order mapping record.
     */
    function updateOrderMapStatus(orderMapId, newStatus) {
        record.submitFields({
            type: OM.ID,
            id: orderMapId,
            values: {
                [OM.FIELDS.STATUS]: newStatus,
                [OM.FIELDS.LAST_SYNCED]: new Date()
            }
        });
    }

    return {
        fetchAmazonOrders,
        findExistingOrderMap,
        resolveNetSuiteItem,
        createSalesOrder,
        createOrderMapRecord,
        updateOrderMapStatus,
        mapAmazonStatus
    };
});
