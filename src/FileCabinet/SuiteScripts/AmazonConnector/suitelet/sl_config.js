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
    '../lib/constants',
    '../lib/configHelper',
    '../lib/mrDataHelper',
    '../lib/logger',
    '../services/connectionTestService',
    '../services/orderService'
], function (serverWidget, search, task, url, runtime, redirect, log, format, constants, configHelper, mrDataHelper, logger, connectionTestService, orderService) {

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
     * Fetches the order header from Amazon SP-API, then triggers MR import
     * which fetches order items, address, and creates the NetSuite transaction.
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

            // Fetch order header from Amazon SP-API (/orders/v0/orders/{orderId})
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

            // Write order to temp file — MR import will fetch items + address from Amazon
            var fileId = mrDataHelper.writeDataFile({
                configId: configId,
                orders: [orderData]
            }, 'order_lookup');

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
                    'Order Lookup: Map/Reduce import is already running. ' +
                    'Order ' + orderId + ' temp file cleaned up. Try again in a few minutes.');
                return;
            }

            logger.success(constants.LOG_TYPE.ORDER_SYNC,
                'Order Lookup: Order ' + orderId + ' fetched from Amazon and MR import triggered (Task: ' + taskId + '). ' +
                'Check Recent Integration Logs for import results.', {
                configId: configId,
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
