/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Amazon Order operations.
 *              Handles creating/updating NetSuite Sales Orders and Cash Sales from Amazon orders.
 *              Supports MFN (merchant fulfilled) and AFN (FBA) fulfillment channels.
 */
define([
    'N/record',
    'N/search',
    'N/log',
    '../lib/constants',
    '../lib/amazonClient',
    '../lib/logger',
    '../lib/errorQueue',
    './customerService'
], function (record, search, log, constants, amazonClient, logger, errorQueue, customerService) {

    const OM = constants.CUSTOM_RECORDS.ORDER_MAP;
    const IM = constants.CUSTOM_RECORDS.ITEM_MAP;

    /**
     * Fetches orders from Amazon created after the given date.
     * Handles pagination automatically.
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
     */
    function findExistingOrderMap(amazonOrderId) {
        const results = [];
        search.create({
            type: OM.ID,
            filters: [[OM.FIELDS.ORDER_ID, 'is', amazonOrderId]],
            columns: [OM.FIELDS.NS_SALES_ORDER, OM.FIELDS.NS_CASH_SALE, OM.FIELDS.STATUS]
        }).run().each(function (result) {
            results.push({
                id: result.id,
                nsOrderId: result.getValue(OM.FIELDS.NS_SALES_ORDER),
                nsCashSaleId: result.getValue(OM.FIELDS.NS_CASH_SALE),
                status: result.getValue(OM.FIELDS.STATUS)
            });
            return true;
        });

        return results.length > 0 ? results[0] : null;
    }

    /**
     * Resolves a NetSuite item from an Amazon SKU.
     * First checks item mapping table, then falls back to item name/UPC/externalid match.
     */
    function resolveNetSuiteItem(sellerSku, configId) {
        let nsItemId = null;

        // Primary: check item mapping table
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

        // Fallback: try to match by item name/number, UPC, or external ID
        if (!nsItemId) {
            search.create({
                type: 'item',
                filters: [
                    ['itemid', 'is', sellerSku],
                    'OR',
                    ['upccode', 'is', sellerSku],
                    'OR',
                    ['externalid', 'is', sellerSku]
                ],
                columns: ['internalid']
            }).run().each(function (result) {
                nsItemId = result.id;
                return false;
            });
        }

        return nsItemId;
    }

    /**
     * Creates a NetSuite transaction (Sales Order or Cash Sale) from an Amazon order.
     * Supports configurable order type, FBA routing, shipping, discounts, and tax.
     * @param {Object} config - Connector config
     * @param {Object} amazonOrder - Amazon order data
     * @param {Array} orderItems - Amazon order items
     * @returns {Object} Result with salesOrderId/cashSaleId and orderMapId
     */
    function createSalesOrder(config, amazonOrder, orderItems) {
        const useCashSale = config.orderType === constants.ORDER_TYPE.CASH_SALE;
        const isFBA = amazonOrder.FulfillmentChannel === 'AFN';
        const isB2B = amazonOrder.IsBusinessOrder === true || amazonOrder.IsBusinessOrder === 'true';

        const recType = useCashSale ? record.Type.CASH_SALE : record.Type.SALES_ORDER;
        const txn = record.create({ type: recType, isDynamic: true });

        // Resolve customer: B2B → FBA → email lookup → create new → default
        const customer = customerService.resolveCustomer(config, amazonOrder, {
            useDefault: true,
            createIfMissing: true
        });
        const location = isFBA && config.fbaLocation ? config.fbaLocation : config.location;

        if (customer) txn.setValue({ fieldId: 'entity', value: customer });
        if (config.subsidiary) txn.setValue({ fieldId: 'subsidiary', value: config.subsidiary });
        if (location) txn.setValue({ fieldId: 'location', value: location });

        // Set custom form if configured
        if (useCashSale && config.cashSaleForm) {
            txn.setValue({ fieldId: 'customform', value: config.cashSaleForm });
        } else if (!useCashSale && config.salesOrderForm) {
            txn.setValue({ fieldId: 'customform', value: config.salesOrderForm });
        }

        txn.setValue({ fieldId: 'otherrefnum', value: amazonOrder.AmazonOrderId });
        var memoPrefix = isFBA ? 'Amazon FBA Order: ' : 'Amazon Order: ';
        if (isB2B) memoPrefix = 'Amazon B2B Order: ';
        txn.setValue({
            fieldId: 'memo',
            value: memoPrefix + amazonOrder.AmazonOrderId
        });

        // Store gift message if present
        if (amazonOrder.IsGift === true || amazonOrder.IsGift === 'true') {
            var giftMsg = amazonOrder.GiftMessageText || '';
            if (giftMsg) {
                try {
                    txn.setValue({ fieldId: 'custbody_amz_gift_message', value: giftMsg.substring(0, 999) });
                } catch (giftErr) {
                    // Gift message field may not exist - store in memo instead
                    txn.setValue({
                        fieldId: 'memo',
                        value: memoPrefix + amazonOrder.AmazonOrderId + ' | Gift: ' + giftMsg.substring(0, 200)
                    });
                }
            }
        }

        if (amazonOrder.PurchaseDate) {
            txn.setValue({ fieldId: 'trandate', value: new Date(amazonOrder.PurchaseDate) });
        }

        if (useCashSale && config.paymentMethod) {
            txn.setValue({ fieldId: 'paymentmethod', value: config.paymentMethod });
        }

        // Set shipping address
        if (amazonOrder.ShippingAddress) {
            setShippingAddress(txn, amazonOrder.ShippingAddress);
        }

        // Add line items
        const items = orderItems.OrderItems || orderItems;
        let hasItems = false;

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

            txn.selectNewLine({ sublistId: 'item' });
            txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: nsItemId });
            txn.setCurrentSublistValue({
                sublistId: 'item', fieldId: 'quantity',
                value: parseInt(item.QuantityOrdered, 10) || 1
            });

            if (item.ItemPrice && item.ItemPrice.Amount) {
                const qty = parseInt(item.QuantityOrdered, 10) || 1;
                txn.setCurrentSublistValue({
                    sublistId: 'item', fieldId: 'rate',
                    value: parseFloat(item.ItemPrice.Amount) / qty
                });
            }

            txn.setCurrentSublistValue({
                sublistId: 'item', fieldId: 'description',
                value: (item.Title || '').substring(0, 999)
            });

            if (location) {
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: location });
            }
            if (config.taxCode) {
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: config.taxCode });
            }

            txn.commitLine({ sublistId: 'item' });
            hasItems = true;
        }

        // Add shipping charge line
        if (config.shippingItem) {
            const shippingTotal = calculateShippingTotal(items);
            if (shippingTotal > 0) {
                txn.selectNewLine({ sublistId: 'item' });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: config.shippingItem });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 1 });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: shippingTotal });
                txn.commitLine({ sublistId: 'item' });
                hasItems = true;
            }
        }

        // Add promotion discount line
        if (config.discountItem) {
            const promoTotal = calculatePromoTotal(items);
            if (promoTotal > 0) {
                txn.selectNewLine({ sublistId: 'item' });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: config.discountItem });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 1 });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: -promoTotal });
                txn.commitLine({ sublistId: 'item' });
            }
        }

        if (!hasItems) {
            throw new Error('No mappable items found for order ' + amazonOrder.AmazonOrderId);
        }

        const txnId = txn.save({ ignoreMandatoryFields: true });
        const orderMapId = createOrderMapRecord(config, amazonOrder, txnId, useCashSale);

        const result = { orderMapId };
        if (useCashSale) {
            result.cashSaleId = txnId;
        } else {
            result.salesOrderId = txnId;
        }
        return result;
    }

    /**
     * Sets shipping address on a transaction subrecord.
     */
    function setShippingAddress(txn, addr) {
        try {
            const shipAddr = txn.getSubrecord({ fieldId: 'shippingaddress' });
            if (addr.Name) shipAddr.setValue({ fieldId: 'addressee', value: addr.Name });
            if (addr.AddressLine1) shipAddr.setValue({ fieldId: 'addr1', value: addr.AddressLine1 });
            if (addr.AddressLine2) shipAddr.setValue({ fieldId: 'addr2', value: addr.AddressLine2 });
            if (addr.AddressLine3) shipAddr.setValue({ fieldId: 'addr3', value: addr.AddressLine3 });
            if (addr.City) shipAddr.setValue({ fieldId: 'city', value: addr.City });
            if (addr.StateOrRegion) shipAddr.setValue({ fieldId: 'state', value: addr.StateOrRegion });
            if (addr.PostalCode) shipAddr.setValue({ fieldId: 'zip', value: addr.PostalCode });
            if (addr.CountryCode) shipAddr.setValue({ fieldId: 'country', value: addr.CountryCode });
            if (addr.Phone) shipAddr.setValue({ fieldId: 'addrphone', value: addr.Phone });
        } catch (e) {
            log.debug({ title: 'Set Address Error', details: 'Could not set shipping address: ' + e.message });
        }
    }

    /**
     * Calculates total shipping from order items' ShippingPrice.
     */
    function calculateShippingTotal(items) {
        let total = 0;
        for (const item of items) {
            if (item.ShippingPrice && item.ShippingPrice.Amount) {
                total += parseFloat(item.ShippingPrice.Amount);
            }
        }
        return total;
    }

    /**
     * Calculates total promotions from order items' PromotionDiscount.
     */
    function calculatePromoTotal(items) {
        let total = 0;
        for (const item of items) {
            if (item.PromotionDiscount && item.PromotionDiscount.Amount) {
                total += parseFloat(item.PromotionDiscount.Amount);
            }
        }
        return Math.abs(total);
    }

    /**
     * Creates an order mapping custom record.
     */
    function createOrderMapRecord(config, amazonOrder, txnId, isCashSale) {
        const mapRec = record.create({ type: OM.ID });
        mapRec.setValue({ fieldId: 'name', value: amazonOrder.AmazonOrderId });
        mapRec.setValue({ fieldId: OM.FIELDS.ORDER_ID, value: amazonOrder.AmazonOrderId });
        mapRec.setValue({ fieldId: OM.FIELDS.STATUS, value: mapAmazonStatus(amazonOrder.OrderStatus) });
        mapRec.setValue({ fieldId: OM.FIELDS.CONFIG, value: config.configId });
        mapRec.setValue({ fieldId: OM.FIELDS.LAST_SYNCED, value: new Date() });
        mapRec.setValue({ fieldId: OM.FIELDS.ERROR_COUNT, value: 0 });

        if (isCashSale) {
            mapRec.setValue({ fieldId: OM.FIELDS.NS_CASH_SALE, value: txnId });
        } else {
            mapRec.setValue({ fieldId: OM.FIELDS.NS_SALES_ORDER, value: txnId });
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
        if (amazonOrder.BuyerInfo && amazonOrder.BuyerInfo.BuyerName) {
            mapRec.setValue({ fieldId: OM.FIELDS.BUYER_NAME, value: amazonOrder.BuyerInfo.BuyerName });
        }
        if (amazonOrder.FulfillmentChannel) {
            const fc = amazonOrder.FulfillmentChannel === 'AFN'
                ? constants.FULFILLMENT_CHANNEL.AFN
                : constants.FULFILLMENT_CHANNEL.MFN;
            mapRec.setValue({ fieldId: OM.FIELDS.FULFILLMENT_CHANNEL, value: fc });
        }
        if (amazonOrder.MarketplaceId) {
            mapRec.setValue({ fieldId: OM.FIELDS.MARKETPLACE_ID, value: amazonOrder.MarketplaceId });
        }
        if (amazonOrder.ShippingAddress) {
            const addr = amazonOrder.ShippingAddress;
            if (addr.City) mapRec.setValue({ fieldId: OM.FIELDS.SHIP_CITY, value: addr.City });
            if (addr.StateOrRegion) mapRec.setValue({ fieldId: OM.FIELDS.SHIP_STATE, value: addr.StateOrRegion });
            if (addr.CountryCode) mapRec.setValue({ fieldId: OM.FIELDS.SHIP_COUNTRY, value: addr.CountryCode });
        }

        return mapRec.save({ ignoreMandatoryFields: true });
    }

    /**
     * Maps Amazon order status to our custom list value.
     * Covers all documented Amazon order statuses.
     */
    function mapAmazonStatus(status) {
        const map = {
            'Pending': constants.ORDER_STATUS.PENDING,
            'PendingAvailability': constants.ORDER_STATUS.PENDING,
            'Unshipped': constants.ORDER_STATUS.UNSHIPPED,
            'PartiallyShipped': constants.ORDER_STATUS.PARTIALLY_SHIPPED,
            'Shipped': constants.ORDER_STATUS.SHIPPED,
            'InvoiceUnconfirmed': constants.ORDER_STATUS.INVOICE_UNCONFIRMED,
            'Canceled': constants.ORDER_STATUS.CANCELED,
            'Unfulfillable': constants.ORDER_STATUS.UNFULFILLABLE
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

    /**
     * Syncs Amazon order status changes back to the NetSuite transaction.
     * Updates the order map status and optionally closes/updates the NS transaction.
     * @param {Object} config - Connector config
     * @param {Object} amazonOrder - Amazon order with current status
     * @param {Object} existingMap - Existing order map record
     */
    function syncOrderStatus(config, amazonOrder, existingMap) {
        const newStatus = mapAmazonStatus(amazonOrder.OrderStatus);
        const oldStatus = existingMap.status;

        // No change
        if (newStatus === oldStatus) return;

        // Update the mapping record
        updateOrderMapStatus(existingMap.id, newStatus);

        var txnId = existingMap.nsOrderId || existingMap.nsCashSaleId;
        if (!txnId) return;

        var txnType = existingMap.nsOrderId ? record.Type.SALES_ORDER : record.Type.CASH_SALE;

        // Handle specific status transitions
        if (amazonOrder.OrderStatus === 'Canceled' && existingMap.nsOrderId) {
            // Close the Sales Order
            try {
                record.submitFields({
                    type: txnType,
                    id: txnId,
                    values: { orderstatus: 'C' }  // Closed
                });
                logger.success(constants.LOG_TYPE.ORDER_SYNC,
                    'Closed SO ' + txnId + ' for canceled Amazon order ' + amazonOrder.AmazonOrderId, {
                    configId: config.configId,
                    recordType: txnType,
                    recordId: txnId,
                    amazonRef: amazonOrder.AmazonOrderId
                });
            } catch (e) {
                logger.warn(constants.LOG_TYPE.ORDER_SYNC,
                    'Could not close SO ' + txnId + ': ' + e.message, {
                    configId: config.configId,
                    amazonRef: amazonOrder.AmazonOrderId
                });
            }
        }

        // Update memo with status change
        try {
            record.submitFields({
                type: txnType,
                id: txnId,
                values: {
                    custbody_amz_order_status: amazonOrder.OrderStatus
                }
            });
        } catch (e) {
            // custbody_amz_order_status may not exist - not critical
            log.debug({ title: 'Order Status Sync', details: 'Could not update status field: ' + e.message });
        }
    }

    return {
        fetchAmazonOrders,
        findExistingOrderMap,
        resolveNetSuiteItem,
        createSalesOrder,
        createOrderMapRecord,
        updateOrderMapStatus,
        syncOrderStatus,
        mapAmazonStatus
    };
});
