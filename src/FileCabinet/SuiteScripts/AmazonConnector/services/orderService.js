/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Amazon Order operations.
 *              Handles creating/updating NetSuite Sales Orders, Cash Sales, and Invoices from Amazon orders.
 *              Supports MFN (merchant fulfilled) and AFN (FBA) fulfillment channels.
 */
define([
    'N/record',
    'N/search',
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/amazonClient',
    '../lib/logger',
    '../lib/errorQueue',
    '../lib/configHelper',
    './customerService'
], function (record, search, runtime, log, constants, amazonClient, logger, errorQueue, configHelper, customerService) {

    const OM = constants.CUSTOM_RECORDS.ORDER_MAP;
    const IM = constants.CUSTOM_RECORDS.ITEM_MAP;

    /**
     * Fetches orders from Amazon created after the given date.
     * Handles pagination automatically.
     */
    function fetchAmazonOrders(config, createdAfter) {
        const allOrders = [];
        let nextToken = null;
        let pageCount = 0;
        const PAGINATION_DELAY_MS = 3000;

        do {
            let response;
            try {
                response = amazonClient.getOrders(config, createdAfter, nextToken);
            } catch (fetchErr) {
                // If we already have some orders, return them rather than losing everything
                if (allOrders.length > 0) {
                    logger.warn(constants.LOG_TYPE.ORDER_SYNC,
                        'Order fetch failed on page ' + (pageCount + 1) +
                        ' but returning ' + allOrders.length +
                        ' orders from previous pages. Error: ' + fetchErr.message);
                    return allOrders;
                }
                throw fetchErr;
            }

            const payload = response.payload || response;
            const orders = payload.Orders || [];
            allOrders.push(...orders);
            nextToken = payload.NextToken || null;
            pageCount++;

            if (nextToken) {
                // Check governance before fetching next page
                const remaining = runtime.getCurrentScript().getRemainingUsage();
                if (remaining < 500) {
                    logger.warn(constants.LOG_TYPE.ORDER_SYNC,
                        'Low governance (' + remaining + ') during order fetch, stopping pagination at page ' +
                        pageCount + '. Fetched ' + allOrders.length + ' orders so far.');
                    break;
                }

                // Delay between pagination requests to avoid exhausting burst quota
                log.debug({
                    title: 'Order Pagination',
                    details: 'Page ' + pageCount + ' fetched (' + orders.length +
                        ' orders). Waiting ' + PAGINATION_DELAY_MS + 'ms before next page.'
                });
                amazonClient.busyWait(PAGINATION_DELAY_MS);
            }
        } while (nextToken);

        log.audit({
            title: 'Order Fetch Complete',
            details: 'Fetched ' + allOrders.length + ' orders across ' + pageCount + ' pages'
        });

        log.debug({
            title: 'Fetched Orders Data',
            details: JSON.stringify(allOrders.map(function (o) {
                return {
                    AmazonOrderId: o.AmazonOrderId,
                    OrderStatus: o.OrderStatus,
                    PurchaseDate: o.PurchaseDate,
                    OrderTotal: o.OrderTotal,
                    FulfillmentChannel: o.FulfillmentChannel,
                    MarketplaceId: o.MarketplaceId,
                    IsBusinessOrder: o.IsBusinessOrder,
                    NumberOfItemsShipped: o.NumberOfItemsShipped,
                    NumberOfItemsUnshipped: o.NumberOfItemsUnshipped
                };
            })).substring(0, 3999)
        });

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
            columns: [OM.FIELDS.NS_SALES_ORDER, OM.FIELDS.NS_CASH_SALE, OM.FIELDS.NS_INVOICE, OM.FIELDS.STATUS]
        }).run().each(function (result) {
            results.push({
                id: result.id,
                nsOrderId: result.getValue(OM.FIELDS.NS_SALES_ORDER),
                nsCashSaleId: result.getValue(OM.FIELDS.NS_CASH_SALE),
                nsInvoiceId: result.getValue(OM.FIELDS.NS_INVOICE),
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
        log.debug({
            title: 'createSalesOrder Input: ' + amazonOrder.AmazonOrderId,
            details: JSON.stringify({
                AmazonOrderId: amazonOrder.AmazonOrderId,
                OrderStatus: amazonOrder.OrderStatus,
                FulfillmentChannel: amazonOrder.FulfillmentChannel,
                MarketplaceId: amazonOrder.MarketplaceId,
                OrderTotal: amazonOrder.OrderTotal,
                IsBusinessOrder: amazonOrder.IsBusinessOrder,
                ShippingAddress: amazonOrder.ShippingAddress,
                BuyerInfo: amazonOrder.BuyerInfo,
                itemCount: (orderItems.OrderItems || orderItems).length
            }).substring(0, 3999)
        });

        // Resolve marketplace-specific settings (customer, location, subsidiary, tax, etc.)
        const effectiveConfig = amazonOrder.MarketplaceId
            ? configHelper.resolveMarketplaceSettings(config, amazonOrder.MarketplaceId)
            : config;

        const useCashSale = effectiveConfig.orderType === constants.ORDER_TYPE.CASH_SALE;
        const useInvoice = effectiveConfig.orderType === constants.ORDER_TYPE.INVOICE;
        const isFBA = amazonOrder.FulfillmentChannel === 'AFN';
        const isB2B = amazonOrder.IsBusinessOrder === true || amazonOrder.IsBusinessOrder === 'true';

        // Load column-item mappings if enabled for orders
        var columnItemMap = null;
        if (effectiveConfig.colMapOrders === true || effectiveConfig.colMapOrders === 'T') {
            columnItemMap = configHelper.getColumnItemMap(effectiveConfig.configId, { useInOrders: true });
        }

        const recType = useInvoice ? record.Type.INVOICE : useCashSale ? record.Type.CASH_SALE : record.Type.SALES_ORDER;
        const txn = record.create({ type: recType, isDynamic: true });

        // Resolve customer: marketplace → B2B → FBA → email lookup → create new → default
        const customer = customerService.resolveCustomer(effectiveConfig, amazonOrder, {
            useDefault: true,
            createIfMissing: true
        });
        const location = isFBA && effectiveConfig.fbaLocation ? effectiveConfig.fbaLocation : effectiveConfig.location;

        log.debug({
            title: 'Order Config: ' + amazonOrder.AmazonOrderId,
            details: JSON.stringify({
                customer: customer,
                location: location,
                isFBA: isFBA,
                isB2B: isB2B,
                useCashSale: useCashSale,
                subsidiary: effectiveConfig.subsidiary,
                taxCode: effectiveConfig.taxCode,
                paymentMethod: effectiveConfig.paymentMethod
            })
        });

        if (customer) txn.setValue({ fieldId: 'entity', value: customer });
        if (effectiveConfig.subsidiary) txn.setValue({ fieldId: 'subsidiary', value: effectiveConfig.subsidiary });
        if (location) txn.setValue({ fieldId: 'location', value: location });

        // Set custom form if configured
        if (useInvoice && effectiveConfig.invoiceForm) {
            txn.setValue({ fieldId: 'customform', value: effectiveConfig.invoiceForm });
        } else if (useCashSale && effectiveConfig.cashSaleForm) {
            txn.setValue({ fieldId: 'customform', value: effectiveConfig.cashSaleForm });
        } else if (!useCashSale && !useInvoice && effectiveConfig.salesOrderForm) {
            txn.setValue({ fieldId: 'customform', value: effectiveConfig.salesOrderForm });
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

        if ((useCashSale || useInvoice) && effectiveConfig.paymentMethod) {
            txn.setValue({ fieldId: 'paymentmethod', value: effectiveConfig.paymentMethod });
        }

        // Set shipping address
        if (amazonOrder.ShippingAddress) {
            setShippingAddress(txn, amazonOrder.ShippingAddress);
        }

        // Add line items
        const items = orderItems.OrderItems || orderItems;
        let hasItems = false;

        for (const item of items) {
            const nsItemId = resolveNetSuiteItem(item.SellerSKU, effectiveConfig.configId);
            log.debug({
                title: 'SKU Resolution: ' + item.SellerSKU,
                details: JSON.stringify({
                    sku: item.SellerSKU,
                    nsItemId: nsItemId,
                    qty: item.QuantityOrdered,
                    price: item.ItemPrice,
                    title: (item.Title || '').substring(0, 100)
                })
            });
            if (!nsItemId) {
                logger.warn(constants.LOG_TYPE.ORDER_SYNC,
                    'SKU not mapped: ' + item.SellerSKU + ' for order ' + amazonOrder.AmazonOrderId, {
                    configId: effectiveConfig.configId,
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
            if (effectiveConfig.taxCode) {
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: effectiveConfig.taxCode });
            }

            txn.commitLine({ sublistId: 'item' });
            hasItems = true;
        }

        // Add column-mapped line items (e.g., product sales tax, shipping credits, gift wrap, etc.)
        if (columnItemMap) {
            hasItems = addColumnMappedLines(txn, columnItemMap, items, location, effectiveConfig) || hasItems;
        }

        // Add shipping charge line (fallback if no column mapping for shipping)
        if (effectiveConfig.shippingItem && !(columnItemMap && columnItemMap['shipping credits'])) {
            const shippingTotal = calculateShippingTotal(items);
            if (shippingTotal > 0) {
                txn.selectNewLine({ sublistId: 'item' });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: effectiveConfig.shippingItem });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 1 });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: shippingTotal });
                txn.commitLine({ sublistId: 'item' });
                hasItems = true;
            }
        }

        // Add promotion discount line (fallback if no column mapping for promos)
        if (effectiveConfig.discountItem && !(columnItemMap && columnItemMap['promotional rebates'])) {
            const promoTotal = calculatePromoTotal(items);
            if (promoTotal > 0) {
                txn.selectNewLine({ sublistId: 'item' });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: effectiveConfig.discountItem });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 1 });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: -promoTotal });
                txn.commitLine({ sublistId: 'item' });
            }
        }

        if (!hasItems) {
            throw new Error('No mappable items found for order ' + amazonOrder.AmazonOrderId);
        }

        const txnId = txn.save({ ignoreMandatoryFields: true });
        const orderMapId = createOrderMapRecord(effectiveConfig, amazonOrder, txnId, useCashSale, useInvoice);

        const result = { orderMapId };
        if (useInvoice) {
            result.invoiceId = txnId;
        } else if (useCashSale) {
            result.cashSaleId = txnId;
        } else {
            result.salesOrderId = txnId;
        }
        return result;
    }

    /**
     * Adds line items to a transaction based on column-to-item mappings.
     * Extracts amounts from order item fields that match mapped column names.
     * @param {Object} txn - NetSuite transaction record
     * @param {Object} columnItemMap - Map of lowercase column name to item internal ID
     * @param {Array} items - Amazon order items
     * @param {string|number} location - Location ID
     * @param {Object} config - Effective config
     * @returns {boolean} True if any lines were added
     */
    function addColumnMappedLines(txn, columnItemMap, items, location, config) {
        var addedAny = false;

        // Aggregate amounts by column name across all order items
        var columnAmounts = {};

        for (var i = 0; i < items.length; i++) {
            var item = items[i];

            // Map Amazon order item fields to column names
            var fieldMappings = {
                'product sales tax': item.ItemTax ? parseFloat(item.ItemTax.Amount || 0) : 0,
                'shipping credits': item.ShippingPrice ? parseFloat(item.ShippingPrice.Amount || 0) : 0,
                'shipping credits tax': item.ShippingTax ? parseFloat(item.ShippingTax.Amount || 0) : 0,
                'gift wrap credits': item.GiftWrapPrice ? parseFloat(item.GiftWrapPrice.Amount || 0) : 0,
                'giftwrap credits tax': item.GiftWrapTax ? parseFloat(item.GiftWrapTax.Amount || 0) : 0,
                'promotional rebates': item.PromotionDiscount ? -Math.abs(parseFloat(item.PromotionDiscount.Amount || 0)) : 0,
                'promotional rebates tax': item.PromotionDiscountTax ? -Math.abs(parseFloat(item.PromotionDiscountTax.Amount || 0)) : 0
            };

            for (var colName in fieldMappings) {
                if (fieldMappings.hasOwnProperty(colName) && columnItemMap[colName] && fieldMappings[colName] !== 0) {
                    columnAmounts[colName] = (columnAmounts[colName] || 0) + fieldMappings[colName];
                }
            }
        }

        // Add a line for each column that has a non-zero amount and a mapped item
        for (var col in columnAmounts) {
            if (columnAmounts.hasOwnProperty(col) && columnAmounts[col] !== 0 && columnItemMap[col]) {
                txn.selectNewLine({ sublistId: 'item' });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: columnItemMap[col] });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 1 });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: columnAmounts[col] });
                txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: col });
                if (location) {
                    txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: location });
                }
                if (config.taxCode) {
                    txn.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: config.taxCode });
                }
                txn.commitLine({ sublistId: 'item' });
                addedAny = true;
            }
        }

        return addedAny;
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
    function createOrderMapRecord(config, amazonOrder, txnId, isCashSale, isInvoice) {
        const mapRec = record.create({ type: OM.ID });
        mapRec.setValue({ fieldId: 'name', value: amazonOrder.AmazonOrderId });
        mapRec.setValue({ fieldId: OM.FIELDS.ORDER_ID, value: amazonOrder.AmazonOrderId });
        mapRec.setValue({ fieldId: OM.FIELDS.STATUS, value: mapAmazonStatus(amazonOrder.OrderStatus) });
        mapRec.setValue({ fieldId: OM.FIELDS.CONFIG, value: config.configId });
        mapRec.setValue({ fieldId: OM.FIELDS.LAST_SYNCED, value: new Date() });
        mapRec.setValue({ fieldId: OM.FIELDS.ERROR_COUNT, value: 0 });

        if (isInvoice) {
            mapRec.setValue({ fieldId: OM.FIELDS.NS_INVOICE, value: txnId });
        } else if (isCashSale) {
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

        var txnId = existingMap.nsOrderId || existingMap.nsCashSaleId || existingMap.nsInvoiceId;
        if (!txnId) return;

        var txnType = existingMap.nsOrderId ? record.Type.SALES_ORDER
            : existingMap.nsCashSaleId ? record.Type.CASH_SALE
            : record.Type.INVOICE;

        // Handle specific status transitions
        if (amazonOrder.OrderStatus === 'Canceled') {
            if (existingMap.nsOrderId) {
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
            } else if (existingMap.nsInvoiceId) {
                // Void the Invoice
                try {
                    record.delete({ type: record.Type.INVOICE, id: txnId });
                    logger.success(constants.LOG_TYPE.ORDER_SYNC,
                        'Voided Invoice ' + txnId + ' for canceled Amazon order ' + amazonOrder.AmazonOrderId, {
                        configId: config.configId,
                        recordType: 'invoice',
                        recordId: txnId,
                        amazonRef: amazonOrder.AmazonOrderId
                    });
                } catch (e) {
                    logger.warn(constants.LOG_TYPE.ORDER_SYNC,
                        'Could not void Invoice ' + txnId + ': ' + e.message, {
                        configId: config.configId,
                        amazonRef: amazonOrder.AmazonOrderId
                    });
                }
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
