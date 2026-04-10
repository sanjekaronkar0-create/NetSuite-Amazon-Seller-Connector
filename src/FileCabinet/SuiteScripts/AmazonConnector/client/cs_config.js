/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 * @description Client script for the Amazon Connector dashboard Suitelet.
 *              Handles button clicks and form validation.
 */
define(['N/currentRecord', 'N/ui/dialog'], function (currentRecord, dialog) {

    function pageInit(context) {
        // Dashboard loaded
    }

    /**
     * Triggers a manual sync operation from the dashboard.
     * @param {string} syncType - orders|inventory|settlements|returns
     */
    function triggerSync(syncType) {
        dialog.confirm({
            title: 'Confirm Manual Sync',
            message: 'Are you sure you want to manually trigger a ' + syncType + ' sync? ' +
                'This will run immediately as a background process.'
        }).then(function (result) {
            if (result) {
                const rec = currentRecord.get();
                rec.setValue({ fieldId: 'custpage_action', value: syncType });

                // Submit the form
                var form = document.getElementById('main_form');
                if (form) {
                    form.submit();
                }
            }
        });
    }

    /**
     * Validates the configuration record before save (for custom record form).
     */
    function saveRecord(context) {
        var rec = currentRecord.get();
        var recType = rec.type;

        if (recType === 'customrecord_amz_connector_config') {
            var sellerId = rec.getValue({ fieldId: 'custrecord_amz_cfg_seller_id' });
            var clientId = rec.getValue({ fieldId: 'custrecord_amz_cfg_client_id' });
            var clientSecret = rec.getValue({ fieldId: 'custrecord_amz_cfg_client_secret' });
            var refreshToken = rec.getValue({ fieldId: 'custrecord_amz_cfg_refresh_token' });
            var endpoint = rec.getValue({ fieldId: 'custrecord_amz_cfg_endpoint' });
            var marketplaceId = rec.getValue({ fieldId: 'custrecord_amz_cfg_marketplace_id' });

            if (!sellerId || !clientId || !clientSecret || !refreshToken || !endpoint || !marketplaceId) {
                dialog.alert({
                    title: 'Validation Error',
                    message: 'Please fill in all required SP-API credential fields: ' +
                        'Seller ID, Client ID, Client Secret, Refresh Token, Endpoint, and Marketplace ID.'
                });
                return false;
            }
        }

        return true;
    }

    /**
     * Fetches and imports a single Amazon order by Order ID.
     */
    function lookupOrder() {
        var rec = currentRecord.get();
        var configId = rec.getValue({ fieldId: 'custpage_lookup_config' });
        var orderId = rec.getValue({ fieldId: 'custpage_lookup_order_id' });

        if (!configId || !orderId) {
            dialog.alert({
                title: 'Validation',
                message: 'Please enter both Config Internal ID and Amazon Order ID.'
            });
            return;
        }

        dialog.confirm({
            title: 'Lookup Order',
            message: 'Fetch and import Amazon order ' + orderId + ' using config ' + configId + '?'
        }).then(function (result) {
            if (result) {
                rec.setValue({ fieldId: 'custpage_action', value: 'lookup_order' });
                var form = document.getElementById('main_form');
                if (form) form.submit();
            }
        });
    }

    /**
     * Fetches and imports Amazon orders within a date range.
     */
    function fetchOrdersByDate() {
        var rec = currentRecord.get();
        var configId = rec.getValue({ fieldId: 'custpage_lookup_config' });
        var dateFrom = rec.getValue({ fieldId: 'custpage_lookup_date_from' });
        var dateTo = rec.getValue({ fieldId: 'custpage_lookup_date_to' });

        if (!configId || !dateFrom || !dateTo) {
            dialog.alert({
                title: 'Validation',
                message: 'Please enter Config Internal ID, Date From, and Date To.'
            });
            return;
        }

        dialog.confirm({
            title: 'Fetch Orders by Date',
            message: 'Fetch and import all Amazon orders from ' + dateFrom + ' to ' + dateTo +
                ' using config ' + configId + '?'
        }).then(function (result) {
            if (result) {
                rec.setValue({ fieldId: 'custpage_action', value: 'fetch_orders_daterange' });
                var form = document.getElementById('main_form');
                if (form) form.submit();
            }
        });
    }

    /**
     * Tests connection for the first config or a user-specified config ID.
     */
    function testConnection() {
        dialog.create({
            title: 'Test Connection',
            message: 'Enter the Configuration ID to test:',
            buttons: [
                { label: 'Test', value: 'test' },
                { label: 'Cancel', value: 'cancel' }
            ]
        }).then(function (result) {
            if (result === 'cancel') return;

            // Prompt user for config ID
            var configId = prompt('Enter Configuration Internal ID:');
            if (!configId) return;

            var rec = currentRecord.get();
            rec.setValue({ fieldId: 'custpage_action', value: 'test_connection' });
            rec.setValue({ fieldId: 'custpage_config_id', value: configId });

            var form = document.getElementById('main_form');
            if (form) {
                form.submit();
            }
        });
    }

    return {
        pageInit,
        triggerSync,
        lookupOrder,
        fetchOrdersByDate,
        testConnection,
        saveRecord
    };
});
