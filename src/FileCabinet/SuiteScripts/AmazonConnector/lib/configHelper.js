/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Loads and manages Amazon Connector configuration records.
 */
define(['N/search', 'N/record', 'N/log', './constants'], function (search, record, log, constants) {

    const CR = constants.CUSTOM_RECORDS.CONFIG;

    /**
     * Loads all active configuration records.
     * @returns {Array<Object>} Array of config objects
     */
    function getAllConfigs() {
        const configs = [];
        const configSearch = search.create({
            type: CR.ID,
            filters: [['isinactive', 'is', 'F']],
            columns: [
                CR.FIELDS.SELLER_ID,
                CR.FIELDS.CLIENT_ID,
                CR.FIELDS.CLIENT_SECRET,
                CR.FIELDS.REFRESH_TOKEN,
                CR.FIELDS.ENDPOINT,
                CR.FIELDS.MARKETPLACE_ID,
                CR.FIELDS.SUBSIDIARY,
                CR.FIELDS.LOCATION,
                CR.FIELDS.ORDER_ENABLED,
                CR.FIELDS.INV_ENABLED,
                CR.FIELDS.FULFILL_ENABLED,
                CR.FIELDS.SETTLE_ENABLED,
                CR.FIELDS.RETURN_ENABLED,
                CR.FIELDS.LAST_ORDER_SYNC,
                CR.FIELDS.LAST_INV_SYNC,
                CR.FIELDS.LAST_SETTLE_SYNC,
                CR.FIELDS.PAYMENT_METHOD,
                CR.FIELDS.CUSTOMER
            ]
        });

        configSearch.run().each(function (result) {
            configs.push(mapResultToConfig(result));
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
        return {
            configId: String(configId),
            sellerId: rec.getValue({ fieldId: CR.FIELDS.SELLER_ID }),
            clientId: rec.getValue({ fieldId: CR.FIELDS.CLIENT_ID }),
            clientSecret: rec.getValue({ fieldId: CR.FIELDS.CLIENT_SECRET }),
            refreshToken: rec.getValue({ fieldId: CR.FIELDS.REFRESH_TOKEN }),
            endpoint: rec.getValue({ fieldId: CR.FIELDS.ENDPOINT }),
            marketplaceId: rec.getValue({ fieldId: CR.FIELDS.MARKETPLACE_ID }),
            subsidiary: rec.getValue({ fieldId: CR.FIELDS.SUBSIDIARY }),
            location: rec.getValue({ fieldId: CR.FIELDS.LOCATION }),
            orderEnabled: rec.getValue({ fieldId: CR.FIELDS.ORDER_ENABLED }),
            invEnabled: rec.getValue({ fieldId: CR.FIELDS.INV_ENABLED }),
            fulfillEnabled: rec.getValue({ fieldId: CR.FIELDS.FULFILL_ENABLED }),
            settleEnabled: rec.getValue({ fieldId: CR.FIELDS.SETTLE_ENABLED }),
            returnEnabled: rec.getValue({ fieldId: CR.FIELDS.RETURN_ENABLED }),
            lastOrderSync: rec.getValue({ fieldId: CR.FIELDS.LAST_ORDER_SYNC }),
            lastInvSync: rec.getValue({ fieldId: CR.FIELDS.LAST_INV_SYNC }),
            lastSettleSync: rec.getValue({ fieldId: CR.FIELDS.LAST_SETTLE_SYNC }),
            paymentMethod: rec.getValue({ fieldId: CR.FIELDS.PAYMENT_METHOD }),
            customer: rec.getValue({ fieldId: CR.FIELDS.CUSTOMER })
        };
    }

    /**
     * Updates the last sync timestamp on a config record.
     * @param {string|number} configId
     * @param {string} fieldId - The timestamp field to update
     * @param {Date} [timestamp] - Defaults to now
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
            sellerId: result.getValue(CR.FIELDS.SELLER_ID),
            clientId: result.getValue(CR.FIELDS.CLIENT_ID),
            clientSecret: result.getValue(CR.FIELDS.CLIENT_SECRET),
            refreshToken: result.getValue(CR.FIELDS.REFRESH_TOKEN),
            endpoint: result.getValue(CR.FIELDS.ENDPOINT),
            marketplaceId: result.getValue(CR.FIELDS.MARKETPLACE_ID),
            subsidiary: result.getValue(CR.FIELDS.SUBSIDIARY),
            location: result.getValue(CR.FIELDS.LOCATION),
            orderEnabled: result.getValue(CR.FIELDS.ORDER_ENABLED),
            invEnabled: result.getValue(CR.FIELDS.INV_ENABLED),
            fulfillEnabled: result.getValue(CR.FIELDS.FULFILL_ENABLED),
            settleEnabled: result.getValue(CR.FIELDS.SETTLE_ENABLED),
            returnEnabled: result.getValue(CR.FIELDS.RETURN_ENABLED),
            lastOrderSync: result.getValue(CR.FIELDS.LAST_ORDER_SYNC),
            lastInvSync: result.getValue(CR.FIELDS.LAST_INV_SYNC),
            lastSettleSync: result.getValue(CR.FIELDS.LAST_SETTLE_SYNC),
            paymentMethod: result.getValue(CR.FIELDS.PAYMENT_METHOD),
            customer: result.getValue(CR.FIELDS.CUSTOMER)
        };
    }

    return {
        getAllConfigs,
        getConfig,
        updateLastSync
    };
});
