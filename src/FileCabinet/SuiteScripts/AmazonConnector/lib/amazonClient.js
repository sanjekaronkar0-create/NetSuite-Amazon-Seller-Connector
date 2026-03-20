/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Core Amazon SP-API HTTP client. Provides methods for all
 *              SP-API endpoints used by the connector (Orders, Feeds, Reports, etc.).
 */
define(['N/https', 'N/log', './amazonAuth', './constants', './logger'],
    function (https, log, amazonAuth, constants, logger) {

    /**
     * Makes an authenticated SP-API GET request.
     * @param {Object} options
     * @param {Object} options.config - Connector config
     * @param {string} options.path - API path (e.g., /orders/v0/orders)
     * @param {Object} [options.params] - Query parameters
     * @returns {Object} Parsed JSON response
     */
    function get(options) {
        return makeRequest('GET', options);
    }

    /**
     * Makes an authenticated SP-API POST request.
     */
    function post(options) {
        return makeRequest('POST', options);
    }

    /**
     * Makes an authenticated SP-API PUT request.
     */
    function put(options) {
        return makeRequest('PUT', options);
    }

    // Track last request time per endpoint for rate limiting
    const lastRequestTime = {};

    // 429 retry configuration
    const RETRY_429_MAX_ATTEMPTS = 3;
    const RETRY_429_DELAYS = [5000, 15000, 30000]; // 5s, 15s, 30s exponential backoff

    /**
     * Blocks execution for the specified number of milliseconds using a busy-wait loop.
     * This is the only delay option in SuiteScript 2.x (no sleep/setTimeout).
     * Does NOT consume governance units.
     * @param {number} ms - Milliseconds to wait
     */
    function busyWait(ms) {
        var start = Date.now();
        var iterations = 0;
        // Cap iterations to stay under NetSuite script statement limits.
        // Prevents governance errors when called from Map/Reduce stages.
        var MAX_ITERATIONS = 200000;
        while (Date.now() - start < ms) {
            iterations++;
            if (iterations >= MAX_ITERATIONS) {
                break;
            }
        }
    }

    /**
     * Determines the rate limit key for a given API path.
     */
    function getRateLimitKey(path) {
        if (path.includes('/orders/') && path.includes('/orderItems')) return 'ORDER_ITEMS_GET';
        if (path.includes('/orders/') && path.includes('/address')) return 'ORDER_ADDRESS_GET';
        if (path.includes('/orders/') && path.includes('/buyerInfo')) return 'ORDER_BUYER_INFO_GET';
        if (path.includes('/orders/')) return 'ORDERS_GET';
        if (path.includes('/feeds/') && path.includes('/documents')) return 'FEEDS_POST';
        if (path.includes('/feeds/')) return 'FEEDS_GET';
        if (path.includes('/reports/') && path.includes('/documents')) return 'REPORTS_DOCUMENT_GET';
        if (path.includes('/reports/')) return 'REPORTS_GET';
        return 'DEFAULT';
    }

    /**
     * Enforces SP-API rate limits by delaying if needed.
     * Uses token bucket algorithm based on burst limits.
     */
    function enforceRateLimit(path) {
        const key = getRateLimitKey(path);
        const limit = constants.RATE_LIMITS[key] || constants.RATE_LIMITS.DEFAULT;
        const minInterval = 1000 / limit.rate; // Minimum ms between requests

        // For high-burst endpoints, use a shorter effective interval based on burst capacity
        // rather than the sustained rate (e.g., ~6s for ORDERS_GET instead of 60s)
        const effectiveMinInterval = limit.burst > 10
            ? Math.max(1000, minInterval / limit.burst * 2)
            : minInterval;

        const now = Date.now();
        const last = lastRequestTime[key] || 0;
        const elapsed = now - last;

        if (elapsed < effectiveMinInterval) {
            const waitTime = Math.min(effectiveMinInterval - elapsed, 60000);
            log.debug({
                title: 'SP-API Rate Limit',
                details: 'Enforcing rate limit for ' + key +
                    '. Waiting ' + waitTime + 'ms (elapsed: ' + elapsed +
                    'ms, min: ' + effectiveMinInterval + 'ms)'
            });
            busyWait(waitTime);
        }

        lastRequestTime[key] = Date.now();
    }

    /**
     * Core request method with token management, rate limiting, and retry logic.
     */
    function makeRequest(method, options) {
        const config = options.config;
        const endpoint = config.endpoint || constants.SP_API_ENDPOINTS.NORTH_AMERICA;
        let url = endpoint + options.path;

        if (options.params) {
            url += '?' + buildQueryString(options.params);
        }

        // Enforce rate limits
        enforceRateLimit(options.path);

        let token = amazonAuth.getAccessToken(config);
        let response = executeRequest(method, url, token, options.body);

        // If 403, try refreshing token once
        if (response.code === 403) {
            log.debug({ title: 'SP-API 403', details: 'Refreshing token and retrying' });
            amazonAuth.invalidateToken(config.configId);
            token = amazonAuth.getAccessToken(config);
            response = executeRequest(method, url, token, options.body);
        }

        // Handle 429 Too Many Requests - fail fast and let the error queue retry.
        // Previously used busyWait spin-loops (5-30s) which consumed excessive
        // script statements and caused governance errors in Map/Reduce stages.
        // The error queue retries with proper exponential backoff (30+ minutes),
        // by which time Amazon's rate limits have genuinely reset.
        if (response.code === 429) {
            var rateLimitKey = getRateLimitKey(options.path);
            lastRequestTime[rateLimitKey] = Date.now();
            log.audit({
                title: 'SP-API 429 Rate Limited',
                details: 'Rate limited on ' + options.path +
                    '. Failing fast for error queue retry.'
            });
        }

        if (response.code < 200 || response.code >= 300) {
            const errorMsg = 'SP-API ' + method + ' ' + options.path +
                ' failed: HTTP ' + response.code + ' - ' + response.body;
            logger.error(constants.LOG_TYPE.API_CALL, errorMsg, {
                configId: config.configId,
                details: response.body
            });
            throw new Error(errorMsg);
        }

        logger.success(constants.LOG_TYPE.API_CALL,
            'SP-API ' + method + ' ' + options.path + ' succeeded', {
            configId: config.configId
        });

        return JSON.parse(response.body);
    }

    /**
     * Executes the raw HTTP request.
     */
    function executeRequest(method, url, token, body) {
        const headers = {
            'x-amz-access-token': token,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        const requestOptions = { url, headers };

        if (body) {
            requestOptions.body = JSON.stringify(body);
        }

        switch (method) {
            case 'GET': return https.get(requestOptions);
            case 'POST': return https.post(requestOptions);
            case 'PUT': return https.put(requestOptions);
            default: return https.get(requestOptions);
        }
    }

    /**
     * Builds URL query string from object.
     */
    function buildQueryString(params) {
        return Object.keys(params)
            .filter(key => params[key] !== null && params[key] !== undefined)
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
            .join('&');
    }

    // ============================================================
    // Amazon SP-API Service Methods
    // ============================================================

    /**
     * Gets orders from Amazon within a date range.
     * @param {Object} config - Connector config
     * @param {string} createdAfter - ISO 8601 date
     * @param {string} [nextToken] - Pagination token
     * @returns {Object} Orders API response
     */
    function getOrders(config, createdAfter, nextToken) {
        const params = {
            MarketplaceIds: config.marketplaceId,
            CreatedAfter: createdAfter
        };
        if (nextToken) {
            params.NextToken = nextToken;
        }
        return get({ config, path: '/orders/v0/orders', params });
    }

    /**
     * Gets order items for a specific order.
     * @param {Object} config
     * @param {string} orderId - Amazon Order ID
     * @returns {Object} Order items response
     */
    function getOrderItems(config, orderId) {
        return get({ config, path: '/orders/v0/orders/' + orderId + '/orderItems' });
    }

    /**
     * Gets order buyer info.
     */
    function getOrderBuyerInfo(config, orderId) {
        return get({ config, path: '/orders/v0/orders/' + orderId + '/buyerInfo' });
    }

    /**
     * Gets order shipping address.
     */
    function getOrderAddress(config, orderId) {
        return get({ config, path: '/orders/v0/orders/' + orderId + '/address' });
    }

    /**
     * Creates a feed document (for inventory/fulfillment feeds).
     * @param {Object} config
     * @param {string} contentType
     * @returns {Object} Feed document response with upload URL
     */
    function createFeedDocument(config, contentType) {
        return post({
            config,
            path: '/feeds/2021-06-30/documents',
            body: { contentType: contentType || 'text/xml; charset=UTF-8' }
        });
    }

    /**
     * Creates a feed submission.
     * @param {Object} config
     * @param {string} feedType
     * @param {string} feedDocumentId
     * @returns {Object} Feed response
     */
    function createFeed(config, feedType, feedDocumentId) {
        return post({
            config,
            path: '/feeds/2021-06-30/feeds',
            body: {
                feedType: feedType,
                marketplaceIds: [config.marketplaceId],
                inputFeedDocumentId: feedDocumentId
            }
        });
    }

    /**
     * Gets feed result.
     */
    function getFeed(config, feedId) {
        return get({ config, path: '/feeds/2021-06-30/feeds/' + feedId });
    }

    /**
     * Requests a report.
     * @param {Object} config
     * @param {string} reportType
     * @param {Object} [dataOptions] - Additional report options (startDate, endDate)
     * @returns {Object} Report response
     */
    function createReport(config, reportType, dataOptions) {
        const body = {
            reportType: reportType,
            marketplaceIds: [config.marketplaceId]
        };
        if (dataOptions) {
            if (dataOptions.startDate) body.dataStartTime = dataOptions.startDate;
            if (dataOptions.endDate) body.dataEndTime = dataOptions.endDate;
        }
        return post({ config, path: '/reports/2021-06-30/reports', body });
    }

    /**
     * Gets report status.
     */
    function getReport(config, reportId) {
        return get({ config, path: '/reports/2021-06-30/reports/' + reportId });
    }

    /**
     * Gets report document (download URL).
     */
    function getReportDocument(config, reportDocumentId) {
        return get({ config, path: '/reports/2021-06-30/documents/' + reportDocumentId });
    }

    /**
     * Gets returns for the seller.
     * Uses Reports API with GET_FBA_MYI_ALL_INVENTORY_DATA or similar.
     */
    function getReturnsReport(config, startDate, endDate) {
        return createReport(config, 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA', {
            startDate,
            endDate
        });
    }

    /**
     * Gets settlement reports list.
     */
    function getSettlementReports(config, startDate) {
        const params = {
            reportTypes: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2',
            marketplaceIds: config.marketplaceId,
            createdSince: startDate
        };
        return get({ config, path: '/reports/2021-06-30/reports', params });
    }

    /**
     * Gets FBA inventory summaries.
     * @param {Object} config
     * @param {string} [nextToken] - Pagination token
     * @returns {Object} FBA inventory response
     */
    function getFbaInventory(config, nextToken) {
        const params = {
            granularityType: 'Marketplace',
            granularityId: config.marketplaceId,
            marketplaceIds: config.marketplaceId
        };
        if (nextToken) params.nextToken = nextToken;
        return get({ config, path: '/fba/inventory/v1/summaries', params });
    }

    /**
     * Gets canceled orders within a date range.
     * @param {Object} config
     * @param {string} lastUpdatedAfter - ISO 8601 date
     * @returns {Object} Orders response (canceled only)
     */
    function getCanceledOrders(config, lastUpdatedAfter) {
        const params = {
            MarketplaceIds: config.marketplaceId,
            LastUpdatedAfter: lastUpdatedAfter,
            OrderStatuses: 'Canceled'
        };
        return get({ config, path: '/orders/v0/orders', params });
    }

    /**
     * Gets feed processing result document.
     * @param {Object} config
     * @param {string} feedId
     * @returns {Object} Feed result
     */
    function getFeedResult(config, feedId) {
        const feed = getFeed(config, feedId);
        if (feed.resultFeedDocumentId) {
            return getReportDocument(config, feed.resultFeedDocumentId);
        }
        return feed;
    }

    return {
        get,
        post,
        put,
        busyWait,
        getOrders,
        getOrderItems,
        getOrderBuyerInfo,
        getOrderAddress,
        createFeedDocument,
        createFeed,
        getFeed,
        getFeedResult,
        createReport,
        getReport,
        getReportDocument,
        getReturnsReport,
        getSettlementReports,
        getFbaInventory,
        getCanceledOrders
    };
});
