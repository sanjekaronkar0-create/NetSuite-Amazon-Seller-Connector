/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for testing Amazon SP-API connection and credentials.
 *              Validates credentials, endpoint connectivity, and marketplace access.
 */
define([
    'N/https',
    'N/log',
    '../lib/constants',
    '../lib/amazonAuth',
    '../lib/amazonClient',
    '../lib/logger'
], function (https, log, constants, amazonAuth, amazonClient, logger) {

    /**
     * Tests the full SP-API connection for a config.
     * Validates: token acquisition, orders API access, marketplace connectivity.
     * @param {Object} config - Connector config object
     * @returns {Object} Test results { success, steps, errors }
     */
    function testConnection(config) {
        var results = {
            success: true,
            steps: [],
            errors: []
        };

        // Step 1: Validate required fields
        var fieldsValid = validateRequiredFields(config);
        results.steps.push(fieldsValid);
        if (!fieldsValid.success) {
            results.success = false;
            results.errors.push(fieldsValid.message);
            return results;
        }

        // Step 2: Test token acquisition
        var tokenResult = testTokenAcquisition(config);
        results.steps.push(tokenResult);
        if (!tokenResult.success) {
            results.success = false;
            results.errors.push(tokenResult.message);
            return results;
        }

        // Step 3: Test Orders API access
        var ordersResult = testOrdersApi(config);
        results.steps.push(ordersResult);
        if (!ordersResult.success) {
            results.success = false;
            results.errors.push(ordersResult.message);
        }

        // Step 4: Test Feeds API access
        var feedsResult = testFeedsApi(config);
        results.steps.push(feedsResult);
        if (!feedsResult.success) {
            results.errors.push(feedsResult.message);
            // Not fatal - some sellers may not have feeds access
        }

        if (results.success) {
            logger.success(constants.LOG_TYPE.API_CALL,
                'Connection test passed for config ' + config.configId, {
                configId: config.configId
            });
        }

        return results;
    }

    /**
     * Validates all required configuration fields are present.
     */
    function validateRequiredFields(config) {
        var missing = [];
        if (!config.sellerId) missing.push('Seller ID');
        if (!config.clientId) missing.push('Client ID');
        if (!config.clientSecret) missing.push('Client Secret');
        if (!config.refreshToken) missing.push('Refresh Token');
        if (!config.endpoint) missing.push('SP-API Endpoint');
        if (!config.marketplaceId) missing.push('Marketplace ID');

        if (missing.length > 0) {
            return {
                step: 'Validate Required Fields',
                success: false,
                message: 'Missing required fields: ' + missing.join(', ')
            };
        }

        // Validate endpoint is a known SP-API endpoint
        var validEndpoints = Object.values(constants.SP_API_ENDPOINTS);
        if (validEndpoints.indexOf(config.endpoint) === -1) {
            return {
                step: 'Validate Required Fields',
                success: false,
                message: 'Invalid SP-API endpoint: ' + config.endpoint +
                    '. Must be one of: ' + validEndpoints.join(', ')
            };
        }

        // Validate marketplace ID
        var validMarketplaces = Object.values(constants.MARKETPLACE_IDS);
        if (validMarketplaces.indexOf(config.marketplaceId) === -1) {
            return {
                step: 'Validate Required Fields',
                success: false,
                message: 'Unknown marketplace ID: ' + config.marketplaceId
            };
        }

        return {
            step: 'Validate Required Fields',
            success: true,
            message: 'All required fields present'
        };
    }

    /**
     * Tests token acquisition from Amazon LWA.
     */
    function testTokenAcquisition(config) {
        try {
            // Invalidate any cached token first
            amazonAuth.invalidateToken(config.configId);

            var token = amazonAuth.getAccessToken(config);
            if (token) {
                return {
                    step: 'Token Acquisition',
                    success: true,
                    message: 'Access token acquired successfully'
                };
            }
            return {
                step: 'Token Acquisition',
                success: false,
                message: 'Token acquired but was empty'
            };
        } catch (e) {
            return {
                step: 'Token Acquisition',
                success: false,
                message: 'Failed to acquire token: ' + e.message
            };
        }
    }

    /**
     * Tests Orders API access by fetching recent orders.
     */
    function testOrdersApi(config) {
        try {
            var oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            var response = amazonClient.getOrders(config, oneDayAgo);
            return {
                step: 'Orders API Access',
                success: true,
                message: 'Orders API accessible. Found ' +
                    ((response.payload || response).Orders || []).length + ' recent orders.'
            };
        } catch (e) {
            return {
                step: 'Orders API Access',
                success: false,
                message: 'Orders API error: ' + e.message
            };
        }
    }

    /**
     * Tests Feeds API access.
     */
    function testFeedsApi(config) {
        try {
            // Just try to list recent feeds
            amazonClient.get({
                config: config,
                path: '/feeds/2021-06-30/feeds',
                params: { feedTypes: 'POST_INVENTORY_AVAILABILITY_DATA', pageSize: 1 }
            });
            return {
                step: 'Feeds API Access',
                success: true,
                message: 'Feeds API accessible'
            };
        } catch (e) {
            return {
                step: 'Feeds API Access',
                success: false,
                message: 'Feeds API error: ' + e.message
            };
        }
    }

    return {
        testConnection,
        validateRequiredFields,
        testTokenAcquisition,
        testOrdersApi
    };
});
