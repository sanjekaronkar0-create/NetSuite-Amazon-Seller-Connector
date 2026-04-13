/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * @description Configuration and Dashboard Suitelet for the Amazon Connector.
 *              Provides a UI to manage marketplace configurations, view sync status,
 *              and manually trigger sync operations.
 */
define([
    'N/ui/serverWidget',
    'N/search',
    'N/task',
    'N/url',
    'N/runtime',
    'N/redirect',
    'N/log',
    'N/format',
    'N/record',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/mrDataHelper',
    '../lib/logger',
    '../lib/amazonClient',
    '../services/connectionTestService',
    '../services/orderService',
    '../services/financialService'
], function (serverWidget, search, task, url, runtime, redirect, log, format, record, constants, configHelper, mrDataHelper, logger, amazonClient, connectionTestService, orderService, financialService) {

    const CR = constants.CUSTOM_RECORDS;

    function onRequest(context) {
        if (context.request.method === 'GET') {
            renderDashboard(context);
        } else {
            handleAction(context);
        }
    }

    /**
     * Renders the main dashboard page.
     */
    function renderDashboard(context) {
        const form = serverWidget.createForm({ title: 'Amazon Seller Connector - Dashboard' });

        // Add action buttons
        form.addButton({ id: 'custpage_btn_sync_orders', label: 'Sync Orders', functionName: 'triggerSync("orders")' });
        form.addButton({ id: 'custpage_btn_sync_inventory', label: 'Sync Inventory', functionName: 'triggerSync("inventory")' });
        form.addButton({ id: 'custpage_btn_sync_settlements', label: 'Sync Settlements', functionName: 'triggerSync("settlements")' });
        form.addButton({ id: 'custpage_btn_sync_returns', label: 'Sync Returns', functionName: 'triggerSync("returns")' });
        form.addButton({ id: 'custpage_btn_sync_pricing', label: 'Sync Pricing', functionName: 'triggerSync("pricing")' });
        form.addButton({ id: 'custpage_btn_sync_catalog', label: 'Sync Catalog', functionName: 'triggerSync("catalog")' });
        form.addButton({ id: 'custpage_btn_retry_errors', label: 'Retry Errors', functionName: 'triggerSync("errors")' });
        form.addButton({ id: 'custpage_btn_sync_cancel', label: 'Sync Cancellations', functionName: 'triggerSync("cancellations")' });
        form.addButton({ id: 'custpage_btn_sync_fba_inv', label: 'Sync FBA Inventory', functionName: 'triggerSync("fba_inventory")' });
        form.addButton({ id: 'custpage_btn_product_export', label: 'Export Products', functionName: 'triggerSync("product_export")' });
        form.addButton({ id: 'custpage_btn_data_archival', label: 'Run Data Archival', functionName: 'triggerSync("archival")' });
        form.addButton({ id: 'custpage_btn_test_conn', label: 'Test Connection', functionName: 'testConnection()' });

        form.clientScriptModulePath = '../client/cs_config.js';

        // Hidden field for action
        const actionField = form.addField({
            id: 'custpage_action',
            type: serverWidget.FieldType.TEXT,
            label: 'Action'
        });
        actionField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        var configIdField = form.addField({
            id: 'custpage_config_id',
            type: serverWidget.FieldType.TEXT,
            label: 'Config ID'
        });
        configIdField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        // -- Configurations Tab --
        const configTab = form.addTab({ id: 'custpage_tab_configs', label: 'Marketplace Configurations' });

        const configSublist = form.addSublist({
            id: 'custpage_sl_configs',
            type: serverWidget.SublistType.LIST,
            label: 'Active Configurations',
            tab: 'custpage_tab_configs'
        });

        configSublist.addField({ id: 'custpage_cfg_id', type: serverWidget.FieldType.TEXT, label: 'ID' });
        configSublist.addField({ id: 'custpage_cfg_name', type: serverWidget.FieldType.TEXT, label: 'Name' });
        configSublist.addField({ id: 'custpage_cfg_marketplace', type: serverWidget.FieldType.TEXT, label: 'Marketplace ID' });
        configSublist.addField({ id: 'custpage_cfg_seller', type: serverWidget.FieldType.TEXT, label: 'Seller ID' });
        configSublist.addField({ id: 'custpage_cfg_orders', type: serverWidget.FieldType.TEXT, label: 'Orders' });
        configSublist.addField({ id: 'custpage_cfg_inventory', type: serverWidget.FieldType.TEXT, label: 'Inventory' });
        configSublist.addField({ id: 'custpage_cfg_fulfillment', type: serverWidget.FieldType.TEXT, label: 'Fulfillment' });
        configSublist.addField({ id: 'custpage_cfg_settlements', type: serverWidget.FieldType.TEXT, label: 'Settlements' });
        configSublist.addField({ id: 'custpage_cfg_returns', type: serverWidget.FieldType.TEXT, label: 'Returns' });
        configSublist.addField({ id: 'custpage_cfg_pricing', type: serverWidget.FieldType.TEXT, label: 'Pricing' });
        configSublist.addField({ id: 'custpage_cfg_catalog', type: serverWidget.FieldType.TEXT, label: 'Catalog' });
        configSublist.addField({ id: 'custpage_cfg_cancel', type: serverWidget.FieldType.TEXT, label: 'Cancellations' });
        configSublist.addField({ id: 'custpage_cfg_fba_inv', type: serverWidget.FieldType.TEXT, label: 'FBA Inventory' });
        configSublist.addField({ id: 'custpage_cfg_notify', type: serverWidget.FieldType.TEXT, label: 'Notifications' });
        configSublist.addField({ id: 'custpage_cfg_last_order', type: serverWidget.FieldType.TEXT, label: 'Last Order Sync' });
        configSublist.addField({ id: 'custpage_cfg_last_inv', type: serverWidget.FieldType.TEXT, label: 'Last Inv Sync' });
        configSublist.addField({ id: 'custpage_cfg_last_settle', type: serverWidget.FieldType.TEXT, label: 'Last Settle Sync' });
        configSublist.addField({ id: 'custpage_cfg_last_return', type: serverWidget.FieldType.TEXT, label: 'Last Return Sync' });
        configSublist.addField({ id: 'custpage_cfg_last_pricing', type: serverWidget.FieldType.TEXT, label: 'Last Pricing Sync' });
        configSublist.addField({ id: 'custpage_cfg_last_catalog', type: serverWidget.FieldType.TEXT, label: 'Last Catalog Sync' });

        populateConfigs(configSublist);

        // -- Recent Logs Tab --
        const logTab = form.addTab({ id: 'custpage_tab_logs', label: 'Recent Integration Logs' });

        const logSublist = form.addSublist({
            id: 'custpage_sl_logs',
            type: serverWidget.SublistType.LIST,
            label: 'Last 50 Logs',
            tab: 'custpage_tab_logs'
        });

        logSublist.addField({ id: 'custpage_log_date', type: serverWidget.FieldType.TEXT, label: 'Date' });
        logSublist.addField({ id: 'custpage_log_type', type: serverWidget.FieldType.TEXT, label: 'Type' });
        logSublist.addField({ id: 'custpage_log_status', type: serverWidget.FieldType.TEXT, label: 'Status' });
        logSublist.addField({ id: 'custpage_log_message', type: serverWidget.FieldType.TEXT, label: 'Message' });
        logSublist.addField({ id: 'custpage_log_ref', type: serverWidget.FieldType.TEXT, label: 'Amazon Ref' });

        populateLogs(logSublist);

        // -- Order Statistics Tab --
        const statsTab = form.addTab({ id: 'custpage_tab_stats', label: 'Order Statistics' });

        const statsSublist = form.addSublist({
            id: 'custpage_sl_stats',
            type: serverWidget.SublistType.LIST,
            label: 'Order Summary',
            tab: 'custpage_tab_stats'
        });

        statsSublist.addField({ id: 'custpage_stat_status', type: serverWidget.FieldType.TEXT, label: 'Status' });
        statsSublist.addField({ id: 'custpage_stat_count', type: serverWidget.FieldType.TEXT, label: 'Count' });

        populateOrderStats(statsSublist);

        // -- Error Queue Tab --
        const errorTab = form.addTab({ id: 'custpage_tab_errors', label: 'Error Queue' });

        const errorSublist = form.addSublist({
            id: 'custpage_sl_errors',
            type: serverWidget.SublistType.LIST,
            label: 'Pending Errors',
            tab: 'custpage_tab_errors'
        });

        errorSublist.addField({ id: 'custpage_err_id', type: serverWidget.FieldType.TEXT, label: 'ID' });
        errorSublist.addField({ id: 'custpage_err_type', type: serverWidget.FieldType.TEXT, label: 'Type' });
        errorSublist.addField({ id: 'custpage_err_ref', type: serverWidget.FieldType.TEXT, label: 'Amazon Ref' });
        errorSublist.addField({ id: 'custpage_err_msg', type: serverWidget.FieldType.TEXT, label: 'Error' });
        errorSublist.addField({ id: 'custpage_err_retries', type: serverWidget.FieldType.TEXT, label: 'Retries' });
        errorSublist.addField({ id: 'custpage_err_status', type: serverWidget.FieldType.TEXT, label: 'Status' });
        errorSublist.addField({ id: 'custpage_err_next', type: serverWidget.FieldType.TEXT, label: 'Next Retry' });

        populateErrorQueue(errorSublist);

        // -- Order Lookup Tab --
        form.addTab({ id: 'custpage_tab_lookup', label: 'Order Lookup' });

        // Instructions
        var instrField = form.addField({
            id: 'custpage_lookup_instructions',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' ',
            container: 'custpage_tab_lookup'
        });
        instrField.defaultValue = '<div style="padding:10px 0;font-size:13px;">' +
            '<b>Single Order Lookup:</b> Enter Config ID + Amazon Order ID, then click <b>Lookup Order</b>.<br>' +
            '<b>Date Range Fetch:</b> Enter Config ID + Date From + Date To, then click <b>Fetch Orders by Date</b>.<br>' +
            'Results will appear in the <i>Recent Integration Logs</i> tab after processing.</div>';

        // Config ID field (shared by both operations)
        var cfgField = form.addField({
            id: 'custpage_lookup_config',
            type: serverWidget.FieldType.TEXT,
            label: 'Config Internal ID (required)',
            container: 'custpage_tab_lookup'
        });
        cfgField.setHelpText({ help: 'Enter the internal ID of the Amazon connector config record to use for API authentication.' });

        // --- Single Order fields ---
        var orderField = form.addField({
            id: 'custpage_lookup_order_id',
            type: serverWidget.FieldType.TEXT,
            label: 'Amazon Order ID (for single order lookup)',
            container: 'custpage_tab_lookup'
        });
        orderField.setHelpText({ help: 'Enter the Amazon Order ID (e.g. 114-1234567-1234567) to fetch and import a single order.' });

        // --- Date Range fields ---
        var dateFromField = form.addField({
            id: 'custpage_lookup_date_from',
            type: serverWidget.FieldType.DATE,
            label: 'Date From (for date range fetch)',
            container: 'custpage_tab_lookup'
        });
        dateFromField.setHelpText({ help: 'Start date for fetching orders from Amazon.' });

        var dateToField = form.addField({
            id: 'custpage_lookup_date_to',
            type: serverWidget.FieldType.DATE,
            label: 'Date To (for date range fetch)',
            container: 'custpage_tab_lookup'
        });
        dateToField.setHelpText({ help: 'End date for fetching orders from Amazon.' });

        form.addButton({
            id: 'custpage_btn_lookup_order',
            label: 'Lookup Order',
            functionName: 'lookupOrder()'
        });
        form.addButton({
            id: 'custpage_btn_fetch_daterange',
            label: 'Fetch Orders by Date',
            functionName: 'fetchOrdersByDate()'
        });

        // --- Settlement Processing fields ---
        var settleInstrField = form.addField({
            id: 'custpage_settle_instructions',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' ',
            container: 'custpage_tab_lookup'
        });
        settleInstrField.defaultValue = '<div style="padding:10px 0;font-size:13px;border-top:1px solid #ccc;margin-top:10px;">' +
            '<b>Settlement Processing:</b> Enter Config ID + Settlement Report ID, then click <b>Process Settlement</b>.<br>' +
            'This will process only that settlement — updating invoices with charges, creating payments, and handling refunds.</div>';

        var settleReportField = form.addField({
            id: 'custpage_settle_report_id',
            type: serverWidget.FieldType.TEXT,
            label: 'Settlement Report ID',
            container: 'custpage_tab_lookup'
        });
        settleReportField.setHelpText({ help: 'Enter the Amazon settlement report ID to process a specific settlement.' });

        form.addButton({
            id: 'custpage_btn_process_settlement',
            label: 'Process Settlement',
            functionName: 'processSettlement()'
        });

        // -- Item Mapping Stats Tab --
        const mappingTab = form.addTab({ id: 'custpage_tab_mapping', label: 'Item Mapping' });

        const mappingSublist = form.addSublist({
            id: 'custpage_sl_mapping',
            type: serverWidget.SublistType.LIST,
            label: 'Mapping Summary',
            tab: 'custpage_tab_mapping'
        });

        mappingSublist.addField({ id: 'custpage_map_config', type: serverWidget.FieldType.TEXT, label: 'Config' });
        mappingSublist.addField({ id: 'custpage_map_total', type: serverWidget.FieldType.TEXT, label: 'Total Items' });
        mappingSublist.addField({ id: 'custpage_map_mapped', type: serverWidget.FieldType.TEXT, label: 'Mapped' });
        mappingSublist.addField({ id: 'custpage_map_unmapped', type: serverWidget.FieldType.TEXT, label: 'Unmapped' });

        populateMappingStats(mappingSublist);

        context.response.writePage(form);
    }

    /**
     * Populates the configurations sublist.
     */
    function populateConfigs(sublist) {
        const configs = configHelper.getAllConfigs();
        configs.forEach(function (config, idx) {
            sublist.setSublistValue({ id: 'custpage_cfg_id', line: idx, value: config.configId });
            sublist.setSublistValue({ id: 'custpage_cfg_marketplace', line: idx, value: config.marketplaceId || '-' });
            sublist.setSublistValue({ id: 'custpage_cfg_seller', line: idx, value: config.sellerId || '-' });
            sublist.setSublistValue({ id: 'custpage_cfg_orders', line: idx, value: config.orderEnabled ? 'Enabled' : 'Disabled' });
            sublist.setSublistValue({ id: 'custpage_cfg_inventory', line: idx, value: config.invEnabled ? 'Enabled' : 'Disabled' });
            sublist.setSublistValue({ id: 'custpage_cfg_fulfillment', line: idx, value: config.fulfillEnabled ? 'Enabled' : 'Disabled' });
            sublist.setSublistValue({ id: 'custpage_cfg_settlements', line: idx, value: config.settleEnabled ? 'Enabled' : 'Disabled' });
            sublist.setSublistValue({ id: 'custpage_cfg_returns', line: idx, value: config.returnEnabled ? 'Enabled' : 'Disabled' });
            sublist.setSublistValue({ id: 'custpage_cfg_pricing', line: idx, value: config.pricingEnabled ? 'Enabled' : 'Disabled' });
            sublist.setSublistValue({ id: 'custpage_cfg_catalog', line: idx, value: config.catalogEnabled ? 'Enabled' : 'Disabled' });
            sublist.setSublistValue({ id: 'custpage_cfg_cancel', line: idx, value: config.cancelSyncEnabled ? 'Enabled' : 'Disabled' });
            sublist.setSublistValue({ id: 'custpage_cfg_fba_inv', line: idx, value: config.fbaInvSyncEnabled ? 'Enabled' : 'Disabled' });
            sublist.setSublistValue({ id: 'custpage_cfg_notify', line: idx, value: config.notifyOnError ? 'Enabled' : 'Disabled' });
            sublist.setSublistValue({ id: 'custpage_cfg_last_order', line: idx, value: config.lastOrderSync || 'Never' });
            sublist.setSublistValue({ id: 'custpage_cfg_last_inv', line: idx, value: config.lastInvSync || 'Never' });
            sublist.setSublistValue({ id: 'custpage_cfg_last_settle', line: idx, value: config.lastSettleSync || 'Never' });
            sublist.setSublistValue({ id: 'custpage_cfg_last_return', line: idx, value: config.lastReturnSync || 'Never' });
            sublist.setSublistValue({ id: 'custpage_cfg_last_pricing', line: idx, value: config.lastPricingSync || 'Never' });
            sublist.setSublistValue({ id: 'custpage_cfg_last_catalog', line: idx, value: config.lastCatalogSync || 'Never' });
        });
    }

    /**
     * Populates the recent logs sublist.
     */
    function populateLogs(sublist) {
        const LOG = CR.LOG;
        let line = 0;

        search.create({
            type: LOG.ID,
            filters: [],
            columns: [
                search.createColumn({ name: LOG.FIELDS.TIMESTAMP, sort: search.Sort.DESC }),
                search.createColumn({ name: LOG.FIELDS.TYPE }),
                search.createColumn({ name: LOG.FIELDS.STATUS }),
                search.createColumn({ name: LOG.FIELDS.MESSAGE }),
                search.createColumn({ name: LOG.FIELDS.AMAZON_REF })
            ]
        }).run().getRange({ start: 0, end: 50 }).forEach(function (result) {
            sublist.setSublistValue({
                id: 'custpage_log_date', line: line,
                value: result.getValue(LOG.FIELDS.TIMESTAMP) || '-'
            });
            sublist.setSublistValue({
                id: 'custpage_log_type', line: line,
                value: result.getText(LOG.FIELDS.TYPE) || '-'
            });
            sublist.setSublistValue({
                id: 'custpage_log_status', line: line,
                value: result.getText(LOG.FIELDS.STATUS) || '-'
            });
            sublist.setSublistValue({
                id: 'custpage_log_message', line: line,
                value: (result.getValue(LOG.FIELDS.MESSAGE) || '-').substring(0, 200)
            });
            sublist.setSublistValue({
                id: 'custpage_log_ref', line: line,
                value: result.getValue(LOG.FIELDS.AMAZON_REF) || '-'
            });
            line++;
        });
    }

    /**
     * Populates order statistics.
     */
    function populateOrderStats(sublist) {
        const OM = CR.ORDER_MAP;
        let line = 0;

        search.create({
            type: OM.ID,
            filters: [],
            columns: [
                search.createColumn({
                    name: OM.FIELDS.STATUS,
                    summary: search.Summary.GROUP
                }),
                search.createColumn({
                    name: 'internalid',
                    summary: search.Summary.COUNT
                })
            ]
        }).run().each(function (result) {
            sublist.setSublistValue({
                id: 'custpage_stat_status', line: line,
                value: result.getText({ name: OM.FIELDS.STATUS, summary: search.Summary.GROUP }) || '-'
            });
            sublist.setSublistValue({
                id: 'custpage_stat_count', line: line,
                value: result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0'
            });
            line++;
            return true;
        });
    }

    /**
     * Handles POST actions (manual sync triggers).
     */
    function handleAction(context) {
        const action = context.request.parameters.custpage_action;

        try {
            const syncMap = {
                orders: { s: constants.SCRIPT_IDS.SCHED_ORDER_SYNC, d: constants.DEPLOY_IDS.SCHED_ORDER_SYNC },
                inventory: { s: constants.SCRIPT_IDS.SCHED_INV_SYNC, d: constants.DEPLOY_IDS.SCHED_INV_SYNC },
                settlements: { s: constants.SCRIPT_IDS.SCHED_SETTLE_SYNC, d: constants.DEPLOY_IDS.SCHED_SETTLE_SYNC },
                returns: { s: constants.SCRIPT_IDS.SCHED_RETURN_SYNC, d: constants.DEPLOY_IDS.SCHED_RETURN_SYNC },
                pricing: { s: constants.SCRIPT_IDS.SCHED_PRICING_SYNC, d: constants.DEPLOY_IDS.SCHED_PRICING_SYNC },
                catalog: { s: constants.SCRIPT_IDS.SCHED_CATALOG_SYNC, d: constants.DEPLOY_IDS.SCHED_CATALOG_SYNC },
                errors: { s: constants.SCRIPT_IDS.SCHED_ERROR_RETRY, d: constants.DEPLOY_IDS.SCHED_ERROR_RETRY },
                cancellations: { s: constants.SCRIPT_IDS.SCHED_CANCEL_SYNC, d: constants.DEPLOY_IDS.SCHED_CANCEL_SYNC },
                fba_inventory: { s: constants.SCRIPT_IDS.SCHED_FBA_INV_SYNC, d: constants.DEPLOY_IDS.SCHED_FBA_INV_SYNC },
                archival: { s: constants.SCRIPT_IDS.SCHED_DATA_ARCHIVAL, d: constants.DEPLOY_IDS.SCHED_DATA_ARCHIVAL },
                product_export: { s: constants.SCRIPT_IDS.SCHED_PRODUCT_EXPORT, d: constants.DEPLOY_IDS.SCHED_PRODUCT_EXPORT }
            };
            if (action === 'test_connection') {
                var configId = context.request.parameters.custpage_config_id;
                if (configId) {
                    var config = configHelper.getConfig(configId);
                    var testResults = connectionTestService.testConnection(config);
                    var statusMsg = testResults.success ? 'Connection test PASSED' : 'Connection test FAILED';
                    for (var s = 0; s < testResults.steps.length; s++) {
                        statusMsg += '\n' + testResults.steps[s].step + ': ' +
                            (testResults.steps[s].success ? 'OK' : 'FAILED') +
                            ' - ' + testResults.steps[s].message;
                    }
                    logger.success(constants.LOG_TYPE.API_CALL, statusMsg, { configId: configId });
                }
            }

            if (action === 'lookup_order') {
                handleLookupOrder(context);
            }

            if (action === 'fetch_orders_daterange') {
                handleFetchOrdersByDateRange(context);
            }

            if (action === 'process_settlement') {
                handleProcessSettlement(context);
            }

            const syncInfo = syncMap[action];
            if (syncInfo) {
                triggerScheduledScript(syncInfo.s, syncInfo.d);
            }
        } catch (e) {
            log.error({ title: 'Dashboard Action Error', details: e.message });
        }

        // Redirect back to dashboard
        redirect.toSuitelet({
            scriptId: runtime.getCurrentScript().id,
            deploymentId: runtime.getCurrentScript().deploymentId
        });
    }

    /**
     * Triggers a scheduled script on-demand.
     */
    function triggerScheduledScript(scriptId, deploymentId) {
        const scriptTask = task.create({
            taskType: task.TaskType.SCHEDULED_SCRIPT,
            scriptId: scriptId,
            deploymentId: deploymentId
        });
        const taskId = scriptTask.submit();
        logger.success(constants.LOG_TYPE.API_CALL,
            'Manual sync triggered: ' + scriptId + ' (Task: ' + taskId + ')');
    }

    /**
     * Handles single order lookup by Amazon Order ID.
     * Fetches order header, items, and address from Amazon SP-API,
     * then creates the NetSuite transaction directly (no Map/Reduce needed for one order).
     */
    function handleLookupOrder(context) {
        var configId = context.request.parameters.custpage_lookup_config;
        var orderId = context.request.parameters.custpage_lookup_order_id;

        if (!configId || !orderId) {
            logger.error(constants.LOG_TYPE.ORDER_SYNC,
                'Order Lookup: Config ID and Amazon Order ID are both required. ' +
                'Go to the Order Lookup tab and fill in both fields.');
            return;
        }

        try {
            var config = configHelper.getConfig(configId);
            if (!config) {
                logger.error(constants.LOG_TYPE.ORDER_SYNC,
                    'Order Lookup: Config not found for ID ' + configId +
                    '. Verify the internal ID on the Order Lookup tab.');
                return;
            }

            // Check if order already exists in NetSuite (order map record)
            var existing = orderService.findExistingOrderMap(orderId);
            if (existing) {
                var existingTxn = existing.nsInvoiceId || existing.nsCashSaleId || existing.nsOrderId;
                logger.progress(constants.LOG_TYPE.ORDER_SYNC,
                    'Order Lookup: Order ' + orderId + ' already exists in NetSuite (transaction ID: ' +
                    existingTxn + ', status: ' + existing.status + '). Skipping import.');
                return;
            }

            // Check if a transaction already exists by otherrefnum (catches orders from old system)
            var existingTxnSearch = search.create({
                type: 'transaction',
                filters: [
                    ['otherrefnum', 'equalto', orderId],
                    'AND',
                    ['type', 'anyof', ['CustInvc', 'SalesOrd', 'CashSale']],
                    'AND',
                    ['mainline', 'is', 'T']
                ],
                columns: ['internalid', 'type', 'tranid']
            }).run().getRange({ start: 0, end: 1 });

            if (existingTxnSearch && existingTxnSearch.length > 0) {
                var txnType = existingTxnSearch[0].getText('type') || '';
                var txnTranId = existingTxnSearch[0].getValue('tranid') || existingTxnSearch[0].id;
                logger.progress(constants.LOG_TYPE.ORDER_SYNC,
                    'Order Lookup: A ' + txnType + ' (ID: ' + txnTranId +
                    ') already exists for Amazon order ' + orderId + '. Skipping import.');
                return;
            }

            // Step 1: Fetch order header from Amazon SP-API
            logger.progress(constants.LOG_TYPE.ORDER_SYNC,
                'Order Lookup: Fetching order ' + orderId + ' from Amazon...');

            var orderData = orderService.fetchSingleOrder(config, orderId);
            if (!orderData) {
                logger.error(constants.LOG_TYPE.ORDER_SYNC,
                    'Order Lookup: Amazon returned no data for order ' + orderId +
                    '. Verify the order ID is correct.');
                return;
            }

            logger.progress(constants.LOG_TYPE.ORDER_SYNC,
                'Order Lookup: Fetched order ' + orderId +
                ' (Status: ' + (orderData.OrderStatus || 'unknown') +
                ', Total: ' + (orderData.OrderTotal ? orderData.OrderTotal.Amount : 'N/A') +
                ', Channel: ' + (orderData.FulfillmentChannel || 'unknown') + ')');

            // Step 2: Fetch order items from Amazon SP-API
            var orderItems;
            try {
                var itemsResponse = amazonClient.getOrderItems(config, orderId);
                orderItems = itemsResponse.payload || itemsResponse;
            } catch (itemsErr) {
                logger.error(constants.LOG_TYPE.ORDER_SYNC,
                    'Order Lookup: Failed to fetch items for ' + orderId + ': ' + itemsErr.message, {
                    configId: configId, amazonRef: orderId
                });
                return;
            }

            // Step 3: Fetch shipping address from Amazon SP-API
            try {
                var addrResponse = amazonClient.getOrderAddress(config, orderId);
                var address = (addrResponse.payload || addrResponse).ShippingAddress;
                if (address) {
                    orderData.ShippingAddress = address;
                }
            } catch (addrErr) {
                log.debug({
                    title: 'Order Lookup',
                    details: 'Could not get address for ' + orderId + ': ' + addrErr.message
                });
            }

            // Step 4: Create NetSuite transaction directly (Sales Order, Cash Sale, or Invoice)
            var result = orderService.createSalesOrder(config, orderData, orderItems);

            var txnType = result.invoiceId ? 'Invoice' : result.cashSaleId ? 'Cash Sale' : 'Sales Order';
            var txnId = result.invoiceId || result.cashSaleId || result.salesOrderId;

            logger.success(constants.LOG_TYPE.ORDER_SYNC,
                'Order Lookup: ' + txnType + ' #' + txnId + ' created for Amazon order ' + orderId, {
                configId: configId,
                recordType: txnType.toLowerCase().replace(' ', ''),
                recordId: txnId,
                amazonRef: orderId
            });
        } catch (e) {
            var errMsg = e.message || String(e);
            var isNotFound = errMsg.indexOf('404') !== -1 || errMsg.indexOf('not found') !== -1;
            var isRateLimit = errMsg.indexOf('429') !== -1 || errMsg.indexOf('rate') !== -1;

            if (isNotFound) {
                logger.error(constants.LOG_TYPE.ORDER_SYNC,
                    'Order Lookup: Amazon order ' + orderId + ' not found (404). ' +
                    'Verify the order ID is correct and belongs to this seller account.', {
                    configId: configId, amazonRef: orderId
                });
            } else if (isRateLimit) {
                logger.warn(constants.LOG_TYPE.ORDER_SYNC,
                    'Order Lookup: Amazon API rate limit hit for order ' + orderId + '. Try again in a minute.', {
                    configId: configId, amazonRef: orderId
                });
            } else {
                logger.error(constants.LOG_TYPE.ORDER_SYNC,
                    'Order Lookup failed for ' + orderId + ': ' + errMsg, {
                    configId: configId, details: e.stack
                });
            }
        }
    }

    /**
     * Handles fetching orders from Amazon within a date range and triggering MR import.
     * Uses Amazon SP-API /orders/v0/orders with CreatedAfter + CreatedBefore params.
     */
    function handleFetchOrdersByDateRange(context) {
        var configId = context.request.parameters.custpage_lookup_config;
        var dateFrom = context.request.parameters.custpage_lookup_date_from;
        var dateTo = context.request.parameters.custpage_lookup_date_to;

        if (!configId || !dateFrom || !dateTo) {
            logger.error(constants.LOG_TYPE.ORDER_SYNC,
                'Date Range Fetch: Config ID, Date From, and Date To are all required. ' +
                'Go to the Order Lookup tab and fill in all three fields.');
            return;
        }

        try {
            var config = configHelper.getConfig(configId);
            if (!config) {
                logger.error(constants.LOG_TYPE.ORDER_SYNC,
                    'Date Range Fetch: Config not found for ID ' + configId +
                    '. Verify the internal ID on the Order Lookup tab.');
                return;
            }

            // Convert NetSuite dates to ISO 8601
            var parsedFrom = format.parse({ value: dateFrom, type: format.Type.DATE });
            var parsedTo = format.parse({ value: dateTo, type: format.Type.DATE });
            // Set dateTo to end of day
            parsedTo.setHours(23, 59, 59, 999);

            var isoFrom = parsedFrom.toISOString();
            var isoTo = parsedTo.toISOString();

            logger.progress(constants.LOG_TYPE.ORDER_SYNC,
                'Date Range Fetch: Fetching orders from Amazon (' + isoFrom + ' to ' + isoTo + ')...');

            // Fetch orders from Amazon SP-API with pagination
            var orders = orderService.fetchOrdersByDateRange(config, isoFrom, isoTo);

            if (!orders || orders.length === 0) {
                logger.progress(constants.LOG_TYPE.ORDER_SYNC,
                    'Date Range Fetch: No orders found from ' + dateFrom + ' to ' + dateTo +
                    ' for config ' + configId + '. The date range may be empty or the marketplace has no orders.');
                return;
            }

            // Filter out orders that already exist in NetSuite
            var newOrders = [];
            for (var i = 0; i < orders.length; i++) {
                var existing = orderService.findExistingOrderMap(orders[i].AmazonOrderId);
                if (!existing) {
                    newOrders.push(orders[i]);
                }
            }

            if (newOrders.length === 0) {
                logger.progress(constants.LOG_TYPE.ORDER_SYNC,
                    'Date Range Fetch: Found ' + orders.length + ' orders but all already exist in NetSuite. No import needed.');
                return;
            }

            // Write to temp file — MR import will fetch items + address for each order
            var fileId = mrDataHelper.writeDataFile({
                configId: configId,
                orders: newOrders
            }, 'daterange_orders');

            var mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: constants.SCRIPT_IDS.MR_ORDER_IMPORT,
                deploymentId: constants.DEPLOY_IDS.MR_ORDER_IMPORT,
                params: {
                    custscript_amz_mr_order_data: String(fileId)
                }
            });

            var taskId = mrDataHelper.submitMrTask(mrTask, constants.LOG_TYPE.ORDER_SYNC, logger);
            if (!taskId) {
                mrDataHelper.deleteTempFile(fileId);
                logger.warn(constants.LOG_TYPE.ORDER_SYNC,
                    'Date Range Fetch: Map/Reduce import is already running. ' +
                    newOrders.length + ' orders not imported. Try again in a few minutes.');
                return;
            }

            logger.success(constants.LOG_TYPE.ORDER_SYNC,
                'Date Range Fetch: Found ' + orders.length + ' orders (' + newOrders.length +
                ' new, ' + (orders.length - newOrders.length) + ' already in NetSuite). ' +
                'MR import triggered (Task: ' + taskId + '). Check Recent Integration Logs for results.', {
                configId: configId,
                details: 'Date range: ' + dateFrom + ' to ' + dateTo
            });
        } catch (e) {
            var errMsg = e.message || String(e);
            if (errMsg.indexOf('429') !== -1) {
                logger.warn(constants.LOG_TYPE.ORDER_SYNC,
                    'Date Range Fetch: Amazon API rate limit hit. Try again in a minute.', {
                    configId: configId
                });
            } else {
                logger.error(constants.LOG_TYPE.ORDER_SYNC,
                    'Date Range Fetch failed: ' + errMsg, {
                    configId: configId, details: e.stack
                });
            }
        }
    }

    /**
     * Handles processing a single settlement by report ID.
     * Finds the settlement, iterates its order headers, and for each:
     *   - Finds the existing invoice
     *   - Adds settlement charge lines as items
     *   - Creates customer payment
     */
    function handleProcessSettlement(context) {
        var configId = context.request.parameters.custpage_lookup_config;
        var reportId = context.request.parameters.custpage_settle_report_id;

        if (!configId || !reportId) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Process Settlement: Config ID and Settlement Report ID are both required.');
            return;
        }

        try {
            var config = configHelper.getConfig(configId);
            if (!config) {
                logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'Process Settlement: Config not found for ID ' + configId);
                return;
            }

            var STL = CR.SETTLEMENT;
            var SH = CR.SETTLE_HEADER;
            var SL = CR.SETTLEMENT_LINE;

            // Step 1: Find the settlement summary record by report ID
            var settlementId = null;
            search.create({
                type: STL.ID,
                filters: [[STL.FIELDS.REPORT_ID, 'is', reportId]],
                columns: ['internalid']
            }).run().each(function (result) {
                settlementId = result.id;
                return false;
            });

            if (!settlementId) {
                logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                    'Process Settlement: No settlement record found for report ID ' + reportId +
                    '. Verify the report ID is correct.');
                return;
            }

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Process Settlement: Found settlement ' + settlementId + ' for report ' + reportId +
                '. Processing order headers...');

            // Step 2: Get charge map
            var chargeMap = configHelper.getChargeAccountMap(configId);

            // Step 3: Search settle headers for this settlement with UPDATE_INV = T
            var ordersProcessed = 0;
            var ordersSkipped = 0;
            var totalLinesAdded = 0;

            search.create({
                type: SH.ID,
                filters: [
                    [SH.FIELDS.SUMMARY, 'anyof', settlementId],
                    'AND',
                    [SH.FIELDS.UPDATE_INV, 'is', 'T']
                ],
                columns: [SH.FIELDS.ORDER_ID, SH.FIELDS.MARKETPLACE, SH.FIELDS.INVOICE_REC]
            }).run().each(function (headerResult) {
                var headerId = headerResult.id;
                var orderId = headerResult.getValue(SH.FIELDS.ORDER_ID);
                var marketplace = headerResult.getValue(SH.FIELDS.MARKETPLACE) || '';

                try {
                    // Skip Non-Amazon
                    if (marketplace === 'Non-Amazon') {
                        record.submitFields({
                            type: SH.ID, id: headerId,
                            values: { [SH.FIELDS.UPDATE_INV]: false }
                        });
                        return true;
                    }

                    var effectiveConfig = configHelper.resolveMarketplaceSettingsByName(config, marketplace);

                    // Get settlement lines for this order
                    var orderLines = [];
                    search.create({
                        type: SL.ID,
                        filters: [
                            [SL.FIELDS.SUMMARY, 'anyof', settlementId],
                            'AND',
                            [SL.FIELDS.ORDER_ID, 'is', orderId],
                            'AND',
                            [SL.FIELDS.TRAN_TYPE, 'is', 'Order'],
                            'AND',
                            [SL.FIELDS.PROCESSED, 'is', 'F']
                        ],
                        columns: [
                            'internalid',
                            SL.FIELDS.AMOUNT_TYPE,
                            SL.FIELDS.AMOUNT_DESC,
                            SL.FIELDS.AMOUNT,
                            SL.FIELDS.SKU,
                            SL.FIELDS.QUANTITY,
                            SL.FIELDS.POST_DATE_NS,
                            SL.FIELDS.PROMO_ID
                        ]
                    }).run().each(function (lineResult) {
                        orderLines.push({
                            id: lineResult.id,
                            amountType: lineResult.getValue(SL.FIELDS.AMOUNT_TYPE),
                            amountDesc: lineResult.getValue(SL.FIELDS.AMOUNT_DESC),
                            amount: lineResult.getValue(SL.FIELDS.AMOUNT),
                            sku: lineResult.getValue(SL.FIELDS.SKU),
                            postDateNs: lineResult.getValue(SL.FIELDS.POST_DATE_NS),
                            orderLineId: lineResult.id
                        });
                        return true;
                    });

                    if (!orderLines || orderLines.length === 0) {
                        record.submitFields({
                            type: SH.ID, id: headerId,
                            values: { [SH.FIELDS.UPDATE_INV]: false }
                        });
                        return true;
                    }

                    // Find existing invoice
                    var existingInvId = null;
                    try {
                        var invLookup = search.lookupFields({
                            type: SH.ID, id: headerId,
                            columns: [SH.FIELDS.INVOICE_REC]
                        });
                        var invVal = invLookup[SH.FIELDS.INVOICE_REC];
                        if (Array.isArray(invVal) && invVal.length > 0) existingInvId = invVal[0].value;
                        else if (invVal) existingInvId = invVal;
                    } catch (ignore) { }

                    if (!existingInvId) {
                        existingInvId = financialService.lookupInvoice(orderId);
                        if (existingInvId) {
                            record.submitFields({
                                type: SH.ID, id: headerId,
                                values: { [SH.FIELDS.INVOICE_REC]: existingInvId }
                            });
                        }
                    }

                    if (!existingInvId) {
                        logger.warn(constants.LOG_TYPE.SETTLEMENT_SYNC,
                            'Process Settlement: No invoice found for order ' + orderId + '. Skipping.');
                        record.submitFields({
                            type: SH.ID, id: headerId,
                            values: { [SH.FIELDS.ERROR]: 'No invoice found for this order.' }
                        });
                        ordersSkipped++;
                        return true;
                    }

                    // Update invoice with settlement fee lines
                    var updateResult = financialService.updateInvoiceLines(
                        effectiveConfig, existingInvId, orderLines, marketplace, chargeMap
                    );

                    // Skip payment if no lines were added and descriptions were missing
                    if (updateResult.linesAdded === 0 && updateResult.skippedDescs && updateResult.skippedDescs.length > 0) {
                        var missingDescs = updateResult.skippedDescs.join(', ');
                        logger.warn(constants.LOG_TYPE.SETTLEMENT_SYNC,
                            'Process Settlement: No lines added for order ' + orderId +
                            '. Missing items for: ' + missingDescs);
                        record.submitFields({
                            type: SH.ID, id: headerId,
                            values: {
                                [SH.FIELDS.ERROR]: 'Missing charge map items: ' + missingDescs,
                                [SH.FIELDS.INVOICE_ERROR]: 'Missing charge map items: ' + missingDescs
                            }
                        });
                        ordersSkipped++;
                        return true;
                    }

                    // Create customer payment
                    var paymentId = null;
                    if (updateResult.paymentTotal != null && updateResult.paymentTotal !== 0) {
                        var settlement = {
                            reportId: reportId,
                            totalAmount: updateResult.paymentTotal,
                            endDate: orderLines[0].postDateNs || new Date()
                        };
                        paymentId = financialService.createSettlementPayment(
                            effectiveConfig, existingInvId, settlement, orderLines[0].postDateNs
                        );
                    }

                    // Mark settlement lines as processed
                    for (var i = 0; i < orderLines.length; i++) {
                        try {
                            record.submitFields({
                                type: SL.ID,
                                id: orderLines[i].id,
                                values: { [SL.FIELDS.PROCESSED]: true }
                            });
                        } catch (markErr) {
                            log.debug({ title: 'Process Settlement',
                                details: 'Could not mark line ' + orderLines[i].id + ' as processed: ' + markErr.message });
                        }
                    }

                    // Update header
                    var headerUpdates = {
                        [SH.FIELDS.UPDATE_INV]: false,
                        [SH.FIELDS.DATA_LOADED]: true,
                        [SH.FIELDS.SETTLED]: true,
                        [SH.FIELDS.ERROR]: '',
                        [SH.FIELDS.INVOICE_ERROR]: ''
                    };
                    if (existingInvId) headerUpdates[SH.FIELDS.INVOICE_REC] = existingInvId;
                    if (paymentId) headerUpdates[SH.FIELDS.PAYMENT_REC] = [paymentId];
                    if (effectiveConfig.customer) headerUpdates[SH.FIELDS.CUSTOMER] = effectiveConfig.customer;
                    record.submitFields({ type: SH.ID, id: headerId, values: headerUpdates });

                    ordersProcessed++;
                    totalLinesAdded += updateResult.linesAdded || 0;

                    logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Process Settlement: Order ' + orderId + ' — Invoice ' + existingInvId +
                        ', Payment ' + (paymentId || 'none') + ', Lines: ' + (updateResult.linesAdded || 0));

                } catch (orderErr) {
                    logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                        'Process Settlement: Error for order ' + orderId + ': ' + orderErr.message);
                    try {
                        record.submitFields({
                            type: SH.ID, id: headerId,
                            values: { [SH.FIELDS.ERROR]: orderErr.message }
                        });
                    } catch (ignore) { }
                    ordersSkipped++;
                }

                return true;
            });

            logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Process Settlement complete for report ' + reportId + ': ' +
                ordersProcessed + ' order(s) processed, ' + ordersSkipped + ' skipped, ' +
                totalLinesAdded + ' total lines added.', {
                configId: configId,
                amazonRef: reportId
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Process Settlement failed for report ' + reportId + ': ' + (e.message || String(e)), {
                configId: configId,
                details: e.stack
            });
        }
    }

    /**
     * Populates the error queue tab.
     */
    function populateErrorQueue(sublist) {
        const EQ = CR.ERROR_QUEUE;
        let line = 0;

        search.create({
            type: EQ.ID,
            filters: [
                [EQ.FIELDS.STATUS, 'anyof', [
                    constants.ERROR_QUEUE_STATUS.PENDING,
                    constants.ERROR_QUEUE_STATUS.RETRYING
                ]]
            ],
            columns: [
                search.createColumn({ name: EQ.FIELDS.TYPE }),
                search.createColumn({ name: EQ.FIELDS.AMAZON_REF }),
                search.createColumn({ name: EQ.FIELDS.ERROR_MSG }),
                search.createColumn({ name: EQ.FIELDS.RETRY_COUNT }),
                search.createColumn({ name: EQ.FIELDS.STATUS }),
                search.createColumn({ name: EQ.FIELDS.NEXT_RETRY })
            ]
        }).run().getRange({ start: 0, end: 50 }).forEach(function (result) {
            sublist.setSublistValue({ id: 'custpage_err_id', line: line, value: result.id });
            sublist.setSublistValue({ id: 'custpage_err_type', line: line, value: result.getValue(EQ.FIELDS.TYPE) || '-' });
            sublist.setSublistValue({ id: 'custpage_err_ref', line: line, value: result.getValue(EQ.FIELDS.AMAZON_REF) || '-' });
            sublist.setSublistValue({ id: 'custpage_err_msg', line: line, value: (result.getValue(EQ.FIELDS.ERROR_MSG) || '-').substring(0, 150) });
            sublist.setSublistValue({ id: 'custpage_err_retries', line: line, value: result.getValue(EQ.FIELDS.RETRY_COUNT) || '0' });
            sublist.setSublistValue({ id: 'custpage_err_status', line: line, value: result.getText(EQ.FIELDS.STATUS) || '-' });
            sublist.setSublistValue({ id: 'custpage_err_next', line: line, value: result.getValue(EQ.FIELDS.NEXT_RETRY) || '-' });
            line++;
        });
    }

    /**
     * Populates item mapping statistics per config.
     */
    function populateMappingStats(sublist) {
        const IM = CR.ITEM_MAP;
        const configs = configHelper.getAllConfigs();

        configs.forEach(function (config, idx) {
            let total = 0;
            let mapped = 0;

            search.create({
                type: IM.ID,
                filters: [
                    [IM.FIELDS.CONFIG, 'anyof', config.configId],
                    'AND',
                    ['isinactive', 'is', 'F']
                ],
                columns: [IM.FIELDS.NS_ITEM]
            }).run().each(function (result) {
                total++;
                if (result.getValue(IM.FIELDS.NS_ITEM)) mapped++;
                return true;
            });

            sublist.setSublistValue({ id: 'custpage_map_config', line: idx, value: config.configId + ' (' + (config.marketplaceId || '-') + ')' });
            sublist.setSublistValue({ id: 'custpage_map_total', line: idx, value: String(total) });
            sublist.setSublistValue({ id: 'custpage_map_mapped', line: idx, value: String(mapped) });
            sublist.setSublistValue({ id: 'custpage_map_unmapped', line: idx, value: String(total - mapped) });
        });
    }

    return { onRequest };
});
