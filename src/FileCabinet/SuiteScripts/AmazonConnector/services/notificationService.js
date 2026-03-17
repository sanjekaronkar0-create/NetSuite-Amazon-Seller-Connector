/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Notification service for the Amazon Connector.
 *              Sends email alerts for sync failures, critical errors, and summary reports.
 *              Configurable per marketplace to control which notifications are sent.
 */
define([
    'N/email',
    'N/runtime',
    'N/search',
    'N/log',
    '../lib/constants',
    '../lib/logger'
], function (email, runtime, search, log, constants, logger) {

    const CR = constants.CUSTOM_RECORDS;

    /**
     * Sends an error notification email.
     * @param {Object} config - Connector config
     * @param {string} subject - Email subject
     * @param {string} body - Email body (HTML)
     */
    function sendErrorNotification(config, subject, body) {
        if (!config.notifyOnError || !config.notifyEmail) return;

        try {
            const author = runtime.getCurrentUser().id;
            const recipients = parseEmailRecipients(config.notifyEmail);

            email.send({
                author: author,
                recipients: recipients,
                subject: '[Amazon Connector] ' + subject,
                body: buildEmailBody(subject, body, config)
            });

            logger.success(constants.LOG_TYPE.NOTIFICATION,
                'Error notification sent: ' + subject, { configId: config.configId });
        } catch (e) {
            log.error({ title: 'Notification Error', details: e.message });
        }
    }

    /**
     * Sends a sync completion summary notification.
     * @param {Object} config
     * @param {string} syncType - Type of sync that completed
     * @param {Object} summary - Sync result summary
     */
    function sendSyncSummary(config, syncType, summary) {
        if (!config.notifyOnSync || !config.notifyEmail) return;

        try {
            const author = runtime.getCurrentUser().id;
            const recipients = parseEmailRecipients(config.notifyEmail);

            const subject = syncType + ' Sync Completed';
            let body = '<h3>' + syncType + ' Sync Summary</h3>';
            body += '<table border="1" cellpadding="5" cellspacing="0">';
            for (const key in summary) {
                body += '<tr><td><strong>' + key + '</strong></td><td>' + summary[key] + '</td></tr>';
            }
            body += '</table>';

            email.send({
                author: author,
                recipients: recipients,
                subject: '[Amazon Connector] ' + subject,
                body: buildEmailBody(subject, body, config)
            });
        } catch (e) {
            log.error({ title: 'Notification Error', details: e.message });
        }
    }

    /**
     * Sends a critical alert for failed items exceeding max retries.
     * @param {Object} config
     * @param {Array<Object>} failedItems - Items that permanently failed
     */
    function sendCriticalAlert(config, failedItems) {
        if (!config.notifyEmail) return;

        try {
            const author = runtime.getCurrentUser().id;
            const recipients = parseEmailRecipients(config.notifyEmail);

            let body = '<h3>Critical: Items Permanently Failed After Max Retries</h3>';
            body += '<p>The following items have exceeded the maximum retry count and require manual attention:</p>';
            body += '<table border="1" cellpadding="5" cellspacing="0">';
            body += '<tr><th>Type</th><th>Amazon Ref</th><th>Error</th><th>Retries</th></tr>';

            failedItems.forEach(function (item) {
                body += '<tr>';
                body += '<td>' + (item.type || '-') + '</td>';
                body += '<td>' + (item.amazonRef || '-') + '</td>';
                body += '<td>' + (item.errorMsg || '-').substring(0, 200) + '</td>';
                body += '<td>' + (item.retryCount || 0) + '</td>';
                body += '</tr>';
            });
            body += '</table>';

            email.send({
                author: author,
                recipients: recipients,
                subject: '[Amazon Connector] CRITICAL: ' + failedItems.length + ' items permanently failed',
                body: buildEmailBody('Critical Alert', body, config)
            });

            logger.warn(constants.LOG_TYPE.NOTIFICATION,
                'Critical alert sent for ' + failedItems.length + ' failed items', {
                configId: config.configId
            });
        } catch (e) {
            log.error({ title: 'Critical Alert Error', details: e.message });
        }
    }

    /**
     * Sends a daily digest of sync activity.
     * @param {Object} config
     */
    function sendDailyDigest(config) {
        if (!config.notifyEmail) return;

        try {
            const author = runtime.getCurrentUser().id;
            const recipients = parseEmailRecipients(config.notifyEmail);

            const stats = getDailySyncStats(config.configId);
            let body = '<h3>Daily Amazon Connector Digest</h3>';
            body += '<p>Activity summary for the last 24 hours:</p>';
            body += '<table border="1" cellpadding="5" cellspacing="0">';
            body += '<tr><th>Metric</th><th>Count</th></tr>';
            body += '<tr><td>Orders Synced</td><td>' + stats.orders + '</td></tr>';
            body += '<tr><td>Inventory Updates</td><td>' + stats.inventory + '</td></tr>';
            body += '<tr><td>Fulfillments Sent</td><td>' + stats.fulfillments + '</td></tr>';
            body += '<tr><td>Returns Processed</td><td>' + stats.returns + '</td></tr>';
            body += '<tr><td>Settlements Processed</td><td>' + stats.settlements + '</td></tr>';
            body += '<tr><td>Errors</td><td>' + stats.errors + '</td></tr>';
            body += '</table>';

            email.send({
                author: author,
                recipients: recipients,
                subject: '[Amazon Connector] Daily Digest - ' + new Date().toLocaleDateString(),
                body: buildEmailBody('Daily Digest', body, config)
            });
        } catch (e) {
            log.error({ title: 'Daily Digest Error', details: e.message });
        }
    }

    /**
     * Gets daily sync statistics from integration logs.
     */
    function getDailySyncStats(configId) {
        const LOG = CR.LOG;
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const stats = { orders: 0, inventory: 0, fulfillments: 0, returns: 0, settlements: 0, errors: 0 };

        search.create({
            type: LOG.ID,
            filters: [
                [LOG.FIELDS.TIMESTAMP, 'onorafter', yesterday],
                'AND',
                [LOG.FIELDS.CONFIG, 'anyof', configId]
            ],
            columns: [
                search.createColumn({ name: LOG.FIELDS.TYPE, summary: search.Summary.GROUP }),
                search.createColumn({ name: LOG.FIELDS.STATUS, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })
            ]
        }).run().each(function (result) {
            const logType = result.getValue({ name: LOG.FIELDS.TYPE, summary: search.Summary.GROUP });
            const status = result.getValue({ name: LOG.FIELDS.STATUS, summary: search.Summary.GROUP });
            const count = parseInt(result.getValue({ name: 'internalid', summary: search.Summary.COUNT }), 10) || 0;

            if (status === constants.LOG_STATUS.ERROR) {
                stats.errors += count;
            }

            switch (logType) {
                case constants.LOG_TYPE.ORDER_SYNC: stats.orders += count; break;
                case constants.LOG_TYPE.INVENTORY_SYNC: stats.inventory += count; break;
                case constants.LOG_TYPE.FULFILLMENT_SYNC: stats.fulfillments += count; break;
                case constants.LOG_TYPE.RETURN_SYNC: stats.returns += count; break;
                case constants.LOG_TYPE.SETTLEMENT_SYNC: stats.settlements += count; break;
            }
            return true;
        });

        return stats;
    }

    /**
     * Builds a formatted HTML email body.
     */
    function buildEmailBody(title, content, config) {
        return '<html><body style="font-family: Arial, sans-serif;">' +
            '<div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">' +
            '<h2 style="color: #333;">Amazon Seller Connector</h2>' +
            '<p><strong>Marketplace:</strong> ' + (config.marketplaceId || 'N/A') +
            ' | <strong>Config ID:</strong> ' + (config.configId || 'N/A') + '</p>' +
            '<hr style="border: 1px solid #ddd;">' +
            content +
            '<hr style="border: 1px solid #ddd;">' +
            '<p style="font-size: 11px; color: #999;">This is an automated notification from the NetSuite Amazon Seller Connector.</p>' +
            '</div></body></html>';
    }

    /**
     * Parses comma-separated email addresses.
     */
    function parseEmailRecipients(emailStr) {
        if (!emailStr) return [];
        return emailStr.split(',').map(function (e) { return e.trim(); }).filter(function (e) { return e; });
    }

    return {
        sendErrorNotification,
        sendSyncSummary,
        sendCriticalAlert,
        sendDailyDigest,
        getDailySyncStats
    };
});
