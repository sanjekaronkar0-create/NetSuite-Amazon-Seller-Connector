/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * @description Scheduled script that triggers the inventory sync Map/Reduce process
 *              to push NetSuite inventory levels to Amazon.
 */
define([
    'N/task',
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/logger'
], function (task, runtime, log, constants, configHelper, logger) {

    const CR = constants.CUSTOM_RECORDS.CONFIG;

    function execute(context) {
        logger.progress(constants.LOG_TYPE.INVENTORY_SYNC, 'Inventory sync scheduled script started');

        try {
            const configs = configHelper.getAllConfigs();

            for (const config of configs) {
                if (!config.invEnabled) {
                    log.debug({ title: 'Inventory Sync', details: 'Skipping disabled config: ' + config.configId });
                    continue;
                }

                try {
                    const mrTask = task.create({
                        taskType: task.TaskType.MAP_REDUCE,
                        scriptId: constants.SCRIPT_IDS.MR_INV_EXPORT,
                        deploymentId: constants.DEPLOY_IDS.MR_INV_EXPORT,
                        params: {
                            custscript_amz_mr_inv_config_id: config.configId
                        }
                    });

                    const taskId = mrTask.submit();
                    logger.success(constants.LOG_TYPE.INVENTORY_SYNC,
                        'Inventory export Map/Reduce triggered. Task ID: ' + taskId, {
                        configId: config.configId
                    });

                    configHelper.updateLastSync(config.configId, CR.FIELDS.LAST_INV_SYNC);

                } catch (e) {
                    logger.error(constants.LOG_TYPE.INVENTORY_SYNC,
                        'Failed to trigger inventory sync for config ' + config.configId + ': ' + e.message, {
                        configId: config.configId,
                        details: e.stack
                    });
                }
            }

            logger.success(constants.LOG_TYPE.INVENTORY_SYNC, 'Inventory sync scheduled script completed');
        } catch (e) {
            logger.error(constants.LOG_TYPE.INVENTORY_SYNC,
                'Inventory sync failed: ' + e.message, { details: e.stack });
        }
    }

    return { execute };
});
