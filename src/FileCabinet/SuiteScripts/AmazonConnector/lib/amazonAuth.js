/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Handles Amazon SP-API OAuth / LWA token management.
 *              Obtains and caches access tokens using the LWA refresh token flow.
 */
define(['N/https', 'N/cache', 'N/log', './constants'], function (https, cache, log, constants) {

    const TOKEN_CACHE_NAME = 'AMZ_SP_API_TOKEN_CACHE';
    const TOKEN_CACHE_KEY_PREFIX = 'access_token_';
    const TOKEN_TTL = 3000; // ~50 minutes (tokens last 1 hour)

    /**
     * Gets a valid SP-API access token for the given config.
     * Uses N/cache to avoid unnecessary token refreshes.
     * @param {Object} config - Configuration object with SP-API credentials
     * @param {string} config.clientId
     * @param {string} config.clientSecret
     * @param {string} config.refreshToken
     * @param {string} config.configId - Internal ID for cache key
     * @returns {string} Access token
     */
    function getAccessToken(config) {
        const tokenCache = cache.getCache({
            name: TOKEN_CACHE_NAME,
            scope: cache.Scope.PRIVATE
        });

        const cacheKey = TOKEN_CACHE_KEY_PREFIX + config.configId;
        let token = tokenCache.get({ key: cacheKey });

        if (token) {
            return token;
        }

        token = requestNewToken(config);
        tokenCache.put({
            key: cacheKey,
            value: token,
            ttl: TOKEN_TTL
        });

        return token;
    }

    /**
     * Requests a new access token from Amazon LWA.
     * @param {Object} config
     * @returns {string} Access token
     * @throws {Error} If token request fails
     */
    function requestNewToken(config) {
        const payload = {
            grant_type: 'refresh_token',
            refresh_token: config.refreshToken,
            client_id: config.clientId,
            client_secret: config.clientSecret
        };

        const response = https.post({
            url: constants.LWA_TOKEN_URL,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: buildFormBody(payload)
        });

        if (response.code !== 200) {
            const errorMsg = 'LWA Token request failed: HTTP ' + response.code + ' - ' + response.body;
            log.error({ title: 'Amazon Auth Error', details: errorMsg });
            throw new Error(errorMsg);
        }

        const body = JSON.parse(response.body);
        if (!body.access_token) {
            throw new Error('LWA response missing access_token: ' + response.body);
        }

        log.debug({ title: 'Amazon Auth', details: 'New access token obtained for config ' + config.configId });
        return body.access_token;
    }

    /**
     * Invalidates cached token for a config (use when getting 403 from SP-API).
     * @param {string} configId
     */
    function invalidateToken(configId) {
        try {
            const tokenCache = cache.getCache({
                name: TOKEN_CACHE_NAME,
                scope: cache.Scope.PRIVATE
            });
            tokenCache.remove({ key: TOKEN_CACHE_KEY_PREFIX + configId });
        } catch (e) {
            log.debug({ title: 'Token Invalidation', details: e.message });
        }
    }

    /**
     * Builds a URL-encoded form body from an object.
     * @param {Object} params
     * @returns {string}
     */
    function buildFormBody(params) {
        return Object.keys(params)
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
            .join('&');
    }

    return {
        getAccessToken,
        invalidateToken
    };
});
