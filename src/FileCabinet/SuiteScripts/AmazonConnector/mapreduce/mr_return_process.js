/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @description Map/Reduce script for processing Amazon returns in bulk.
 *              Creates Return Authorizations and Credit Memos.
 */
define([
    'N/runtime',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/errorQueue',
    '../lib/logger',
    '../lib/mrDataHelper',
    '../services/returnService',
    '../services/financialService'
], function (runtime, log, constants, configHelper, errorQueue, logger, mrDataHelper,
    returnService, financialService) {

    /**
     * Input stage: receives return data from scheduled script via File Cabinet file.
     */
    function getInputData() {
        const dataParam = runtime.getCurrentScript().getParameter({
            name: 'custscript_amz_mr_return_data'
        });

        if (!dataParam) {
            log.audit({ title: 'MR Return Process', details: 'No return data provided' });
            return [];
        }

        var data = mrDataHelper.readDataFile(dataParam);
        log.audit({
            title: 'MR Return Process - Input',
            details: 'Processing ' + data.returns.length + ' returns for config ' + data.configId
        });

        return data.returns.map(function (ret) {
            return { configId: data.configId, returnData: ret };
        });
    }

    /**
     * Map stage: validate and pass to reduce keyed by order ID.
     */
    function map(context) {
        try {
            const entry = JSON.parse(context.value);
            const returnData = entry.returnData;

            if (!returnData.amazonOrderId) return;

            // Skip if already processed
            if (returnService.isReturnProcessed(returnData.amazonOrderId, returnData.returnId)) {
                log.debug({
                    title: 'MR Return Process',
                    details: 'Already processed: ' + returnData.amazonOrderId
                });
                return;
            }

            context.write({
                key: returnData.amazonOrderId,
                value: JSON.stringify(entry)
            });
        } catch (e) {
            logger.error(constants.LOG_TYPE.RETURN_SYNC,
                'Return map error: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Reduce stage: Create RMA and Credit Memo for each return.
     */
    function reduce(context) {
        const amazonOrderId = context.key;

        try {
            // Aggregate returned items for the same order
            const allSkus = [];
            let configId = null;
            let mergedReturnData = null;

            for (const val of context.values) {
                const entry = JSON.parse(val);
                configId = entry.configId;
                mergedReturnData = entry.returnData;

                if (entry.returnData.sku) {
                    allSkus.push({
                        sku: entry.returnData.sku,
                        quantity: entry.returnData.quantity || 1
                    });
                }
            }

            if (!configId || !mergedReturnData) return;

            const config = configHelper.getConfig(configId);

            // Find linked order (Sales Order or Invoice)
            const orderLink = returnService.getLinkedOrder(amazonOrderId);
            if (!orderLink || (!orderLink.salesOrderId && !orderLink.invoiceId)) {
                logger.warn(constants.LOG_TYPE.RETURN_SYNC,
                    'No linked order for return on order ' + amazonOrderId, {
                    configId: configId,
                    amazonRef: amazonOrderId
                });
                return;
            }

            // Build consolidated return data
            mergedReturnData.returnedSkus = allSkus;

            let rmaId = null;
            let creditMemoId = null;

            if (orderLink.invoiceId) {
                // Invoice path: create Credit Memo directly (no RMA)
                try {
                    creditMemoId = returnService.createCreditMemoFromInvoice(
                        config, mergedReturnData, orderLink.invoiceId
                    );
                } catch (cmErr) {
                    logger.error(constants.LOG_TYPE.RETURN_SYNC,
                        'Credit Memo creation from Invoice failed for ' + amazonOrderId + ': ' + cmErr.message, {
                        configId: configId,
                        amazonRef: amazonOrderId,
                        details: cmErr.stack
                    });
                    errorQueue.enqueue({
                        type: constants.ERROR_QUEUE_TYPE.CREDIT_MEMO_CREATE,
                        amazonRef: amazonOrderId,
                        errorMsg: cmErr.message,
                        configId: configId,
                        payload: JSON.stringify({ invoiceId: orderLink.invoiceId, returnData: mergedReturnData })
                    });
                    throw cmErr;
                }
            } else {
                // Sales Order path: create Return Authorization
                rmaId = returnService.createReturnAuthorization(
                    config, mergedReturnData, orderLink.salesOrderId
                );

                // Create Credit Memo if auto-credit-memo is enabled
                if (config.autoCreditMemo) {
                    try {
                        creditMemoId = financialService.createCreditMemo(config, rmaId, mergedReturnData);
                    } catch (cmErr) {
                        logger.error(constants.LOG_TYPE.RETURN_SYNC,
                            'Credit Memo creation failed for ' + amazonOrderId + ': ' + cmErr.message, {
                            configId: configId,
                            amazonRef: amazonOrderId,
                            details: cmErr.stack
                        });
                        errorQueue.enqueue({
                            type: constants.ERROR_QUEUE_TYPE.CREDIT_MEMO_CREATE,
                            amazonRef: amazonOrderId,
                            errorMsg: cmErr.message,
                            configId: configId,
                            payload: JSON.stringify({ rmaId, returnData: mergedReturnData })
                        });
                    }
                }
            }

            // Create return mapping record
            const mapId = returnService.createReturnMapRecord(
                config, mergedReturnData, rmaId, orderLink.orderMapId
            );

            // Update mapping with credit memo if created
            if (creditMemoId) {
                returnService.updateReturnCreditMemo(mapId, creditMemoId);
            }

            var recordType = rmaId ? 'returnauthorization' : 'creditmemo';
            var recordId = rmaId || creditMemoId;
            logger.success(constants.LOG_TYPE.RETURN_SYNC,
                'Return processed: ' + (rmaId ? 'RMA=' + rmaId : '') +
                (creditMemoId ? (rmaId ? ', ' : '') + 'CM=' + creditMemoId : '') +
                ' for order ' + amazonOrderId, {
                configId: configId,
                recordType: recordType,
                recordId: recordId,
                amazonRef: amazonOrderId
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.RETURN_SYNC,
                'Return reduce error for ' + amazonOrderId + ': ' + e.message, {
                amazonRef: amazonOrderId,
                details: e.stack
            });

            errorQueue.enqueue({
                type: constants.ERROR_QUEUE_TYPE.RETURN_PROCESS,
                amazonRef: amazonOrderId,
                errorMsg: e.message,
                payload: JSON.stringify(context.values[0] ? JSON.parse(context.values[0]) : {})
            });
        }
    }

    function summarize(summary) {
        log.audit({
            title: 'MR Return Process - Summary',
            details: 'Input errors: ' + (summary.inputSummary.error || 'none')
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            logger.error(constants.LOG_TYPE.RETURN_SYNC,
                'Reduce error for order ' + key + ': ' + error, { amazonRef: key });
            return true;
        });
    }

    return { getInputData, map, reduce, summarize };
});
