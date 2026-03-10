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
        form.addButton({ id: 'custpage_btn_sync_orders', label: 'Sync Orders Now', functionName: 'triggerSync("orders")' });
        form.addButton({ id: 'custpage_btn_sync_inventory', label: 'Sync Inventory Now', functionName: 'triggerSync("inventory")' });
        form.addButton({ id: 'custpage_btn_sync_settlements', label: 'Sync Settlements Now', functionName: 'triggerSync("settlements")' });
        form.addButton({ id: 'custpage_btn_sync_returns', label: 'Sync Returns Now', functionName: 'triggerSync("returns")' });

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
        configSublist.addField({ id: 'custpage_cfg_last_order', type: serverWidget.FieldType.TEXT, label: 'Last Order Sync' });
        configSublist.addField({ id: 'custpage_cfg_last_inv', type: serverWidget.FieldType.TEXT, label: 'Last Inv Sync' });

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
            sublist.setSublistValue({ id: 'custpage_cfg_last_order', line: idx, value: config.lastOrderSync || 'Never' });
            sublist.setSublistValue({ id: 'custpage_cfg_last_inv', line: idx, value: config.lastInvSync || 'Never' });
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
            switch (action) {
                case 'orders':
                    triggerScheduledScript(constants.SCRIPT_IDS.SCHED_ORDER_SYNC, constants.DEPLOY_IDS.SCHED_ORDER_SYNC);
                    break;
                case 'inventory':
                    triggerScheduledScript(constants.SCRIPT_IDS.SCHED_INV_SYNC, constants.DEPLOY_IDS.SCHED_INV_SYNC);
                    break;
                case 'settlements':
                    triggerScheduledScript(constants.SCRIPT_IDS.SCHED_SETTLE_SYNC, constants.DEPLOY_IDS.SCHED_SETTLE_SYNC);
                    break;
                case 'returns':
                    triggerScheduledScript(constants.SCRIPT_IDS.SCHED_RETURN_SYNC, constants.DEPLOY_IDS.SCHED_RETURN_SYNC);
                    break;
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

    return { onRequest };
});
