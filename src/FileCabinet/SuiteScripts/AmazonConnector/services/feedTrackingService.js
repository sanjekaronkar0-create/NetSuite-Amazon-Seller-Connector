/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Service module for tracking Amazon feed submission results.
 *              Polls feed status and logs success/failure of submitted feeds.
 */
define([
    'N/search',
    'N/record',
    'N/log',
    '../lib/constants',
    '../lib/amazonClient',
    '../lib/logger',
    '../lib/errorQueue'
], function (search, record, log, constants, amazonClient, logger, errorQueue) {

    /**
     * Checks the status of a submitted feed.
     * @param {Object} config
     * @param {string} feedId
     * @returns {Object} Feed status { feedId, status, processingStatus, resultDocumentId }
     */
    function checkFeedStatus(config, feedId) {
        var response = amazonClient.getFeed(config, feedId);
        return {
            feedId: feedId,
            status: response.processingStatus || 'UNKNOWN',
            resultDocumentId: response.resultFeedDocumentId || null,
            createdTime: response.createdTime,
            processingEndTime: response.processingEndTime
        };
    }

    /**
     * Downloads and parses feed processing result.
     * @param {Object} config
     * @param {string} resultDocumentId
     * @returns {Object} Parsed result with error details
     */
    function getFeedResult(config, resultDocumentId) {
        try {
            var docResponse = amazonClient.getReportDocument(config, resultDocumentId);
            var N_https = require('N/https');
            var fileResponse = N_https.get({ url: docResponse.url });
            if (fileResponse.code !== 200) {
                throw new Error('Failed to download feed result: HTTP ' + fileResponse.code);
            }
            return parseFeedResult(fileResponse.body);
        } catch (e) {
            log.error({ title: 'Feed Result', details: 'Error getting feed result: ' + e.message });
            return { success: false, errors: [e.message] };
        }
    }

    /**
     * Parses XML feed processing result.
     * @param {string} rawData
     * @returns {Object} { messagesProcessed, messagesSuccessful, messagesWithError, errors }
     */
    function parseFeedResult(rawData) {
        var result = {
            messagesProcessed: 0,
            messagesSuccessful: 0,
            messagesWithError: 0,
            messagesWithWarning: 0,
            errors: []
        };

        // Simple XML parsing for feed result
        var processedMatch = rawData.match(/<MessagesProcessed>(\d+)<\/MessagesProcessed>/);
        var successMatch = rawData.match(/<MessagesSuccessful>(\d+)<\/MessagesSuccessful>/);
        var errorMatch = rawData.match(/<MessagesWithError>(\d+)<\/MessagesWithError>/);
        var warningMatch = rawData.match(/<MessagesWithWarning>(\d+)<\/MessagesWithWarning>/);

        if (processedMatch) result.messagesProcessed = parseInt(processedMatch[1], 10);
        if (successMatch) result.messagesSuccessful = parseInt(successMatch[1], 10);
        if (errorMatch) result.messagesWithError = parseInt(errorMatch[1], 10);
        if (warningMatch) result.messagesWithWarning = parseInt(warningMatch[1], 10);

        // Extract individual error messages
        var errorRegex = /<ResultDescription>(.*?)<\/ResultDescription>/g;
        var match;
        while ((match = errorRegex.exec(rawData)) !== null) {
            result.errors.push(match[1]);
        }

        return result;
    }

    /**
     * Tracks a feed submission and logs its result when complete.
     * Call this to poll for feed completion.
     * @param {Object} config
     * @param {string} feedId
     * @param {string} feedType - Type for logging (e.g., 'Inventory', 'Pricing')
     * @returns {Object} Result summary
     */
    function trackFeedCompletion(config, feedId, feedType) {
        var status = checkFeedStatus(config, feedId);

        if (status.status === 'DONE') {
            var result = null;
            if (status.resultDocumentId) {
                result = getFeedResult(config, status.resultDocumentId);
            }

            if (result && result.messagesWithError > 0) {
                logger.warn(constants.LOG_TYPE.FEED_TRACKING,
                    feedType + ' feed ' + feedId + ' completed with ' + result.messagesWithError + ' errors', {
                    configId: config.configId,
                    details: JSON.stringify(result.errors.slice(0, 10))
                });
            } else {
                logger.success(constants.LOG_TYPE.FEED_TRACKING,
                    feedType + ' feed ' + feedId + ' completed successfully. ' +
                    (result ? result.messagesSuccessful + ' messages processed.' : ''), {
                    configId: config.configId
                });
            }

            return { complete: true, result: result };
        }

        if (status.status === 'FATAL') {
            logger.error(constants.LOG_TYPE.FEED_TRACKING,
                feedType + ' feed ' + feedId + ' failed with FATAL status', {
                configId: config.configId
            });

            errorQueue.enqueue({
                type: feedType === 'Inventory' ? constants.ERROR_QUEUE_TYPE.INVENTORY_FEED : constants.ERROR_QUEUE_TYPE.PRICING_UPDATE,
                amazonRef: feedId,
                errorMsg: feedType + ' feed failed with FATAL status',
                configId: config.configId,
                maxRetries: config.maxRetries
            });

            return { complete: true, result: null, fatal: true };
        }

        // Still processing
        return { complete: false, status: status.status };
    }

    return {
        checkFeedStatus,
        getFeedResult,
        parseFeedResult,
        trackFeedCompletion
    };
});
