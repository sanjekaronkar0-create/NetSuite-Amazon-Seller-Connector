/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Loads and manages Amazon Connector configuration records.
 *              Supports all sync toggles, financial accounts, FBA settings,
 *              and multi-marketplace configuration.
 */
define(['N/search', 'N/record', 'N/log', 'N/runtime', './constants'], function (search, record, log, runtime, constants) {

    const CR = constants.CUSTOM_RECORDS.CONFIG;
    const isOneWorld = runtime.isFeatureInEffect({ feature: 'SUBSIDIARIES' });

    /**
     * Loads all active configuration records.
     * @returns {Array<Object>} Array of config objects
     */
    function getAllConfigs() {
        const configs = [];
        // Subsidiary (SELECT → -117) is not searchable in non-OneWorld accounts,
        // so exclude it from search columns and fetch it via lookupFields instead.
        const unsearchableColumns = [CR.FIELDS.SUBSIDIARY, CR.FIELDS.B2B_CUSTOMER];
        const searchColumns = Object.values(CR.FIELDS).filter(function (f) {
            return unsearchableColumns.indexOf(f) === -1;
        });
        search.create({
            type: CR.ID,
            filters: [['isinactive', 'is', 'F']],
            columns: searchColumns
        }).run().each(function (result) {
            const cfg = mapResultToConfig(result);
            if (isOneWorld) {
                try {
                    var looked = search.lookupFields({
                        type: CR.ID,
                        id: result.id,
                        columns: unsearchableColumns
                    });
                    cfg.subsidiary = looked[CR.FIELDS.SUBSIDIARY]
                        ? (looked[CR.FIELDS.SUBSIDIARY][0]
                            ? looked[CR.FIELDS.SUBSIDIARY][0].value
                            : looked[CR.FIELDS.SUBSIDIARY])
                        : null;
                } catch (e) {
                    log.debug({ title: 'getAllConfigs', details: 'Could not look up subsidiary for config ' + result.id + ': ' + e.message });
                    cfg.subsidiary = null;
                }
            }
            try {
                var b2bLookup = search.lookupFields({
                    type: CR.ID,
                    id: result.id,
                    columns: [CR.FIELDS.B2B_CUSTOMER]
                });
                cfg.b2bCustomer = b2bLookup[CR.FIELDS.B2B_CUSTOMER]
                    ? (b2bLookup[CR.FIELDS.B2B_CUSTOMER][0]
                        ? b2bLookup[CR.FIELDS.B2B_CUSTOMER][0].value
                        : b2bLookup[CR.FIELDS.B2B_CUSTOMER])
                    : null;
            } catch (e) {
                log.debug({ title: 'getAllConfigs', details: 'Could not look up B2B customer for config ' + result.id + ': ' + e.message });
                cfg.b2bCustomer = null;
            }
            configs.push(cfg);
            return true;
        });

        return configs;
    }

    /**
     * Loads a single configuration record by internal ID.
     * @param {string|number} configId
     * @returns {Object} Config object
     */
    function getConfig(configId) {
        const rec = record.load({ type: CR.ID, id: configId });
        return mapRecordToConfig(rec, configId);
    }

    /**
     * Updates the last sync timestamp on a config record.
     */
    function updateLastSync(configId, fieldId, timestamp) {
        record.submitFields({
            type: CR.ID,
            id: configId,
            values: { [fieldId]: timestamp || new Date() }
        });
    }

    /**
     * Maps a search result to a config object.
     */
    function mapResultToConfig(result) {
        return {
            configId: result.id,
            // SP-API Credentials
            sellerId: result.getValue(CR.FIELDS.SELLER_ID),
            clientId: result.getValue(CR.FIELDS.CLIENT_ID),
            clientSecret: result.getValue(CR.FIELDS.CLIENT_SECRET),
            refreshToken: result.getValue(CR.FIELDS.REFRESH_TOKEN),
            endpoint: result.getValue(CR.FIELDS.ENDPOINT),
            marketplaceId: result.getValue(CR.FIELDS.MARKETPLACE_ID),
            // NetSuite Mapping
            subsidiary: null,
            location: result.getValue(CR.FIELDS.LOCATION),
            customer: result.getValue(CR.FIELDS.CUSTOMER),
            paymentMethod: result.getValue(CR.FIELDS.PAYMENT_METHOD),
            // Sync Toggles
            orderEnabled: result.getValue(CR.FIELDS.ORDER_ENABLED),
            invEnabled: result.getValue(CR.FIELDS.INV_ENABLED),
            fulfillEnabled: result.getValue(CR.FIELDS.FULFILL_ENABLED),
            settleEnabled: result.getValue(CR.FIELDS.SETTLE_ENABLED),
            returnEnabled: result.getValue(CR.FIELDS.RETURN_ENABLED),
            pricingEnabled: result.getValue(CR.FIELDS.PRICING_ENABLED),
            catalogEnabled: result.getValue(CR.FIELDS.CATALOG_ENABLED),
            // Last Sync Timestamps
            lastOrderSync: result.getValue(CR.FIELDS.LAST_ORDER_SYNC),
            lastInvSync: result.getValue(CR.FIELDS.LAST_INV_SYNC),
            lastSettleSync: result.getValue(CR.FIELDS.LAST_SETTLE_SYNC),
            lastReturnSync: result.getValue(CR.FIELDS.LAST_RETURN_SYNC),
            lastPricingSync: result.getValue(CR.FIELDS.LAST_PRICING_SYNC),
            lastCatalogSync: result.getValue(CR.FIELDS.LAST_CATALOG_SYNC),
            // Order Configuration
            orderType: result.getValue(CR.FIELDS.ORDER_TYPE),
            salesOrderForm: result.getValue(CR.FIELDS.SALES_ORDER_FORM),
            cashSaleForm: result.getValue(CR.FIELDS.CASH_SALE_FORM),
            // Financial Accounts
            settleAccount: result.getValue(CR.FIELDS.SETTLE_ACCOUNT),
            feeAccount: result.getValue(CR.FIELDS.FEE_ACCOUNT),
            fbaFeeAccount: result.getValue(CR.FIELDS.FBA_FEE_ACCOUNT),
            refundAccount: result.getValue(CR.FIELDS.REFUND_ACCOUNT),
            promoAccount: result.getValue(CR.FIELDS.PROMO_ACCOUNT),
            shippingItem: result.getValue(CR.FIELDS.SHIPPING_ITEM),
            discountItem: result.getValue(CR.FIELDS.DISCOUNT_ITEM),
            // FBA Settings
            fbaEnabled: result.getValue(CR.FIELDS.FBA_ENABLED),
            fbaLocation: result.getValue(CR.FIELDS.FBA_LOCATION),
            fbaCustomer: result.getValue(CR.FIELDS.FBA_CUSTOMER),
            b2bCustomer: null,
            // Automation Flags
            autoCreditMemo: result.getValue(CR.FIELDS.AUTO_CREDIT_MEMO),
            autoDeposit: result.getValue(CR.FIELDS.AUTO_DEPOSIT),
            // Tax
            taxItem: result.getValue(CR.FIELDS.TAX_ITEM),
            taxCode: result.getValue(CR.FIELDS.TAX_CODE),
            // Error Retry
            maxRetries: parseInt(result.getValue(CR.FIELDS.MAX_RETRIES), 10) || 3,
            retryDelayMins: parseInt(result.getValue(CR.FIELDS.RETRY_DELAY_MINS), 10) || 30,
            // Multi-marketplace
            additionalMarketplaceIds: result.getValue(CR.FIELDS.ADDITIONAL_MARKETPLACE_IDS),
            // Notification Settings
            notifyOnError: result.getValue(CR.FIELDS.NOTIFY_ON_ERROR),
            notifyEmail: result.getValue(CR.FIELDS.NOTIFY_EMAIL),
            notifyOnSync: result.getValue(CR.FIELDS.NOTIFY_ON_SYNC),
            // Sync Interval Configuration
            orderSyncInterval: parseInt(result.getValue(CR.FIELDS.ORDER_SYNC_INTERVAL), 10) || 15,
            invSyncInterval: parseInt(result.getValue(CR.FIELDS.INV_SYNC_INTERVAL), 10) || 60,
            settleSyncInterval: parseInt(result.getValue(CR.FIELDS.SETTLE_SYNC_INTERVAL), 10) || 1440,
            returnSyncInterval: parseInt(result.getValue(CR.FIELDS.RETURN_SYNC_INTERVAL), 10) || 240,
            pricingSyncInterval: parseInt(result.getValue(CR.FIELDS.PRICING_SYNC_INTERVAL), 10) || 1440,
            catalogSyncInterval: parseInt(result.getValue(CR.FIELDS.CATALOG_SYNC_INTERVAL), 10) || 1440,
            // Log Archival
            logRetentionDays: parseInt(result.getValue(CR.FIELDS.LOG_RETENTION_DAYS), 10) || 90,
            // FBA Inventory
            fbaInvSyncEnabled: result.getValue(CR.FIELDS.FBA_INV_SYNC_ENABLED),
            // Cancellation
            cancelSyncEnabled: result.getValue(CR.FIELDS.CANCEL_SYNC_ENABLED),
            cancelAction: result.getValue(CR.FIELDS.CANCEL_ACTION) || 'close'
        };
    }

    /**
     * Maps a loaded record to a config object.
     */
    function mapRecordToConfig(rec, configId) {
        const getValue = function (fieldId) {
            try { return rec.getValue({ fieldId: fieldId }); } catch (e) { return null; }
        };

        return {
            configId: String(configId),
            sellerId: getValue(CR.FIELDS.SELLER_ID),
            clientId: getValue(CR.FIELDS.CLIENT_ID),
            clientSecret: getValue(CR.FIELDS.CLIENT_SECRET),
            refreshToken: getValue(CR.FIELDS.REFRESH_TOKEN),
            endpoint: getValue(CR.FIELDS.ENDPOINT),
            marketplaceId: getValue(CR.FIELDS.MARKETPLACE_ID),
            subsidiary: isOneWorld ? getValue(CR.FIELDS.SUBSIDIARY) : null,
            location: getValue(CR.FIELDS.LOCATION),
            customer: getValue(CR.FIELDS.CUSTOMER),
            paymentMethod: getValue(CR.FIELDS.PAYMENT_METHOD),
            orderEnabled: getValue(CR.FIELDS.ORDER_ENABLED),
            invEnabled: getValue(CR.FIELDS.INV_ENABLED),
            fulfillEnabled: getValue(CR.FIELDS.FULFILL_ENABLED),
            settleEnabled: getValue(CR.FIELDS.SETTLE_ENABLED),
            returnEnabled: getValue(CR.FIELDS.RETURN_ENABLED),
            pricingEnabled: getValue(CR.FIELDS.PRICING_ENABLED),
            catalogEnabled: getValue(CR.FIELDS.CATALOG_ENABLED),
            lastOrderSync: getValue(CR.FIELDS.LAST_ORDER_SYNC),
            lastInvSync: getValue(CR.FIELDS.LAST_INV_SYNC),
            lastSettleSync: getValue(CR.FIELDS.LAST_SETTLE_SYNC),
            lastReturnSync: getValue(CR.FIELDS.LAST_RETURN_SYNC),
            lastPricingSync: getValue(CR.FIELDS.LAST_PRICING_SYNC),
            lastCatalogSync: getValue(CR.FIELDS.LAST_CATALOG_SYNC),
            orderType: getValue(CR.FIELDS.ORDER_TYPE),
            salesOrderForm: getValue(CR.FIELDS.SALES_ORDER_FORM),
            cashSaleForm: getValue(CR.FIELDS.CASH_SALE_FORM),
            settleAccount: getValue(CR.FIELDS.SETTLE_ACCOUNT),
            feeAccount: getValue(CR.FIELDS.FEE_ACCOUNT),
            fbaFeeAccount: getValue(CR.FIELDS.FBA_FEE_ACCOUNT),
            refundAccount: getValue(CR.FIELDS.REFUND_ACCOUNT),
            promoAccount: getValue(CR.FIELDS.PROMO_ACCOUNT),
            shippingItem: getValue(CR.FIELDS.SHIPPING_ITEM),
            discountItem: getValue(CR.FIELDS.DISCOUNT_ITEM),
            fbaEnabled: getValue(CR.FIELDS.FBA_ENABLED),
            fbaLocation: getValue(CR.FIELDS.FBA_LOCATION),
            fbaCustomer: getValue(CR.FIELDS.FBA_CUSTOMER),
            b2bCustomer: getValue(CR.FIELDS.B2B_CUSTOMER),
            autoCreditMemo: getValue(CR.FIELDS.AUTO_CREDIT_MEMO),
            autoDeposit: getValue(CR.FIELDS.AUTO_DEPOSIT),
            taxItem: getValue(CR.FIELDS.TAX_ITEM),
            taxCode: getValue(CR.FIELDS.TAX_CODE),
            maxRetries: parseInt(getValue(CR.FIELDS.MAX_RETRIES), 10) || 3,
            retryDelayMins: parseInt(getValue(CR.FIELDS.RETRY_DELAY_MINS), 10) || 30,
            additionalMarketplaceIds: getValue(CR.FIELDS.ADDITIONAL_MARKETPLACE_IDS),
            // Notification Settings
            notifyOnError: getValue(CR.FIELDS.NOTIFY_ON_ERROR),
            notifyEmail: getValue(CR.FIELDS.NOTIFY_EMAIL),
            notifyOnSync: getValue(CR.FIELDS.NOTIFY_ON_SYNC),
            // Sync Intervals
            orderSyncInterval: parseInt(getValue(CR.FIELDS.ORDER_SYNC_INTERVAL), 10) || 15,
            invSyncInterval: parseInt(getValue(CR.FIELDS.INV_SYNC_INTERVAL), 10) || 60,
            settleSyncInterval: parseInt(getValue(CR.FIELDS.SETTLE_SYNC_INTERVAL), 10) || 1440,
            returnSyncInterval: parseInt(getValue(CR.FIELDS.RETURN_SYNC_INTERVAL), 10) || 240,
            pricingSyncInterval: parseInt(getValue(CR.FIELDS.PRICING_SYNC_INTERVAL), 10) || 1440,
            catalogSyncInterval: parseInt(getValue(CR.FIELDS.CATALOG_SYNC_INTERVAL), 10) || 1440,
            // Log Archival
            logRetentionDays: parseInt(getValue(CR.FIELDS.LOG_RETENTION_DAYS), 10) || 90,
            // FBA Inventory
            fbaInvSyncEnabled: getValue(CR.FIELDS.FBA_INV_SYNC_ENABLED),
            // Cancellation
            cancelSyncEnabled: getValue(CR.FIELDS.CANCEL_SYNC_ENABLED),
            cancelAction: getValue(CR.FIELDS.CANCEL_ACTION) || 'close'
        };
    }

    return {
        getAllConfigs,
        getConfig,
        updateLastSync
    };
});
