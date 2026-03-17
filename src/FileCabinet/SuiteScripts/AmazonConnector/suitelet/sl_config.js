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
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger'
], function (serverWidget, search, task, url, runtime, redirect, log, constants, configHelper, logger) {

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
        form.addButton({ id: 'custpage_btn_data_archival', label: 'Run Data Archival', functionName: 'triggerSync("archival")' });

        form.clientScriptModulePath = '../client/cs_config.js';

        // Hidden field for action
        const actionField = form.addField({
            id: 'custpage_action',
            type: serverWidget.FieldType.TEXT,
            label: 'Action'
        });
        actionField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

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
        }).run().each(function (result, idx) {
            sublist.setSublistValue({
                id: 'custpage_stat_status', line: idx,
                value: result.getText({ name: OM.FIELDS.STATUS, summary: search.Summary.GROUP }) || '-'
            });
            sublist.setSublistValue({
                id: 'custpage_stat_count', line: idx,
                value: result.getValue({ name: 'internalid', summary: search.Summary.COUNT }) || '0'
            });
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
                archival: { s: constants.SCRIPT_IDS.SCHED_DATA_ARCHIVAL, d: constants.DEPLOY_IDS.SCHED_DATA_ARCHIVAL }
            };
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
