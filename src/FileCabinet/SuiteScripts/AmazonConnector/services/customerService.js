/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for Amazon Customer resolution and creation.
 *              Finds existing NetSuite customers by email/name or creates new ones
 *              from Amazon buyer data. Supports B2B order customer routing.
 */
define([
    'N/record',
    'N/search',
    'N/log',
    '../lib/constants',
    '../lib/logger',
    '../lib/configHelper'
], function (record, search, log, constants, logger, configHelper) {

    /**
     * Resolves a NetSuite customer from Amazon buyer data.
     * Strategy: marketplace override → B2B → FBA → find by email → find by name → create new → default
     * When marketplace-specific config exists, its customer settings take precedence.
     * @param {Object} config - Connector config
     * @param {Object} amazonOrder - Amazon order with BuyerInfo and MarketplaceId
     * @param {Object} [options] - Options { useDefault: true, createIfMissing: true }
     * @returns {string|number} NetSuite customer internal ID
     */
    function resolveCustomer(config, amazonOrder, options) {
        options = options || { useDefault: true, createIfMissing: true };
        var isFBA = amazonOrder.FulfillmentChannel === 'AFN';
        var isB2B = amazonOrder.IsBusinessOrder === true || amazonOrder.IsBusinessOrder === 'true';

        // Resolve marketplace-specific settings (overrides config customer/fba/b2b)
        var effectiveConfig = config;
        if (amazonOrder.MarketplaceId) {
            effectiveConfig = configHelper.resolveMarketplaceSettings(config, amazonOrder.MarketplaceId);
        }

        // B2B routing: use dedicated B2B customer if configured
        if (isB2B && effectiveConfig.b2bCustomer) {
            return effectiveConfig.b2bCustomer;
        }

        // FBA routing: use FBA customer if configured
        if (isFBA && effectiveConfig.fbaCustomer) {
            return effectiveConfig.fbaCustomer;
        }

        // Extract buyer info
        var buyerEmail = null;
        var buyerName = null;
        if (amazonOrder.BuyerInfo) {
            buyerEmail = amazonOrder.BuyerInfo.BuyerEmail;
            buyerName = amazonOrder.BuyerInfo.BuyerName;
        }

        // Try to find by email first
        if (buyerEmail) {
            var customerId = findCustomerByEmail(buyerEmail);
            if (customerId) return customerId;
        }

        // Try to find by name (less reliable but worth checking)
        if (buyerName) {
            var byName = findCustomerByName(buyerName);
            if (byName) return byName;
        }

        // Create new customer if enabled
        if (options.createIfMissing && buyerEmail) {
            return createCustomerFromOrder(config, amazonOrder);
        }

        // Fallback to default Amazon customer (marketplace-specific or global)
        if (options.useDefault && effectiveConfig.customer) {
            return effectiveConfig.customer;
        }

        return effectiveConfig.customer || config.customer;
    }

    /**
     * Finds a customer by email address.
     * @param {string} email
     * @returns {string|null} Customer internal ID
     */
    function findCustomerByEmail(email) {
        if (!email) return null;
        var customerId = null;

        search.create({
            type: search.Type.CUSTOMER,
            filters: [
                ['email', 'is', email],
                'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: ['internalid']
        }).run().each(function (result) {
            customerId = result.id;
            return false;
        });

        return customerId;
    }

    /**
     * Finds a customer by company name or individual name.
     * @param {string} name
     * @returns {string|null} Customer internal ID
     */
    function findCustomerByName(name) {
        if (!name) return null;
        var customerId = null;

        search.create({
            type: search.Type.CUSTOMER,
            filters: [
                ['entityid', 'is', name],
                'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: ['internalid']
        }).run().each(function (result) {
            customerId = result.id;
            return false;
        });

        return customerId;
    }

    /**
     * Creates a new NetSuite customer from Amazon order data.
     * @param {Object} config
     * @param {Object} amazonOrder
     * @returns {string|number} New customer internal ID
     */
    function createCustomerFromOrder(config, amazonOrder) {
        var buyer = amazonOrder.BuyerInfo || {};
        var addr = amazonOrder.ShippingAddress || {};
        var isB2B = amazonOrder.IsBusinessOrder === true || amazonOrder.IsBusinessOrder === 'true';

        var cust = record.create({
            type: record.Type.CUSTOMER,
            isDynamic: true
        });

        // Parse name
        var fullName = buyer.BuyerName || addr.Name || 'Amazon Customer';
        var nameParts = fullName.split(' ');
        var firstName = nameParts[0] || 'Amazon';
        var lastName = nameParts.slice(1).join(' ') || 'Customer';

        if (isB2B) {
            cust.setValue({ fieldId: 'isperson', value: 'F' });
            cust.setValue({ fieldId: 'companyname', value: fullName });
        } else {
            cust.setValue({ fieldId: 'isperson', value: 'T' });
            cust.setValue({ fieldId: 'firstname', value: firstName });
            cust.setValue({ fieldId: 'lastname', value: lastName });
        }

        if (buyer.BuyerEmail) {
            cust.setValue({ fieldId: 'email', value: buyer.BuyerEmail });
        }

        if (config.subsidiary) {
            cust.setValue({ fieldId: 'subsidiary', value: config.subsidiary });
        }

        // Set category/channel for reporting
        cust.setValue({
            fieldId: 'comments',
            value: 'Auto-created from Amazon order ' + (amazonOrder.AmazonOrderId || '')
        });

        // Add shipping address if available
        if (addr.Name || addr.AddressLine1) {
            cust.selectNewLine({ sublistId: 'addressbook' });
            cust.setCurrentSublistValue({ sublistId: 'addressbook', fieldId: 'label', value: 'Amazon Shipping' });
            cust.setCurrentSublistValue({ sublistId: 'addressbook', fieldId: 'defaultshipping', value: true });

            var addrSubrec = cust.getCurrentSublistSubrecord({ sublistId: 'addressbook', fieldId: 'addressbookaddress' });
            if (addr.Name) addrSubrec.setValue({ fieldId: 'addressee', value: addr.Name });
            if (addr.AddressLine1) addrSubrec.setValue({ fieldId: 'addr1', value: addr.AddressLine1 });
            if (addr.AddressLine2) addrSubrec.setValue({ fieldId: 'addr2', value: addr.AddressLine2 });
            if (addr.City) addrSubrec.setValue({ fieldId: 'city', value: addr.City });
            if (addr.StateOrRegion) addrSubrec.setValue({ fieldId: 'state', value: addr.StateOrRegion });
            if (addr.PostalCode) addrSubrec.setValue({ fieldId: 'zip', value: addr.PostalCode });
            if (addr.CountryCode) addrSubrec.setValue({ fieldId: 'country', value: addr.CountryCode });
            if (addr.Phone) addrSubrec.setValue({ fieldId: 'addrphone', value: addr.Phone });

            cust.commitLine({ sublistId: 'addressbook' });
        }

        var custId = cust.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.ORDER_SYNC,
            'Customer created: ' + fullName + ' (' + (buyer.BuyerEmail || 'no email') + ')', {
            configId: config.configId,
            recordType: 'customer',
            recordId: custId,
            amazonRef: amazonOrder.AmazonOrderId
        });

        return custId;
    }

    /**
     * Updates an existing customer with latest Amazon address data.
     * @param {string|number} customerId
     * @param {Object} amazonOrder
     */
    function updateCustomerAddress(customerId, amazonOrder) {
        var addr = amazonOrder.ShippingAddress;
        if (!addr) return;

        try {
            var cust = record.load({
                type: record.Type.CUSTOMER,
                id: customerId,
                isDynamic: true
            });

            // Check if address already exists
            var addrCount = cust.getLineCount({ sublistId: 'addressbook' });
            var found = false;
            for (var i = 0; i < addrCount; i++) {
                var label = cust.getSublistValue({ sublistId: 'addressbook', fieldId: 'label', line: i });
                if (label === 'Amazon Shipping') {
                    found = true;
                    break;
                }
            }

            if (!found) {
                cust.selectNewLine({ sublistId: 'addressbook' });
                cust.setCurrentSublistValue({ sublistId: 'addressbook', fieldId: 'label', value: 'Amazon Shipping' });
                cust.setCurrentSublistValue({ sublistId: 'addressbook', fieldId: 'defaultshipping', value: true });

                var addrSubrec = cust.getCurrentSublistSubrecord({ sublistId: 'addressbook', fieldId: 'addressbookaddress' });
                if (addr.Name) addrSubrec.setValue({ fieldId: 'addressee', value: addr.Name });
                if (addr.AddressLine1) addrSubrec.setValue({ fieldId: 'addr1', value: addr.AddressLine1 });
                if (addr.City) addrSubrec.setValue({ fieldId: 'city', value: addr.City });
                if (addr.StateOrRegion) addrSubrec.setValue({ fieldId: 'state', value: addr.StateOrRegion });
                if (addr.PostalCode) addrSubrec.setValue({ fieldId: 'zip', value: addr.PostalCode });
                if (addr.CountryCode) addrSubrec.setValue({ fieldId: 'country', value: addr.CountryCode });

                cust.commitLine({ sublistId: 'addressbook' });
                cust.save({ ignoreMandatoryFields: true });
            }
        } catch (e) {
            log.debug({ title: 'Customer Address Update', details: e.message });
        }
    }

    return {
        resolveCustomer,
        findCustomerByEmail,
        findCustomerByName,
        createCustomerFromOrder,
        updateCustomerAddress
    };
});
