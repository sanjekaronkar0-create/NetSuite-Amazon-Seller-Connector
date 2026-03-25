/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/currentRecord', 'N/error', 'N/format', 'N/log', 'N/record', 'N/search', 'N/transaction', 'N/ui/serverWidget'],
/**
 * @param {currentRecord} currentRecord
 * @param {error} error
 * @param {format} format
 * @param {log} log
 * @param {record} record
 * @param {search} search
 * @param {transaction} transaction
 * @param {serverWidget} serverWidget
 */
function(currentRecord, error, format, log, record, search, transaction, serverWidget) {
   
    /**
     * Function definition to be triggered before record is loaded.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.newRecord - New record
     * @param {string} scriptContext.type - Trigger type
     * @param {Form} scriptContext.form - Current form
     * @Since 2015.2
     */
    function beforeLoad(context) {
            var form = context.form;
            var nomeFornecedor = form.getSublist({ id: 'expense' }).getField({
                id: 'memo'
            });
            nomeFornecedor.updateDisplayType({displayType: serverWidget.FieldDisplayType.DISABLED});
        
    }

    /**
     * Function definition to be triggered before record is loaded.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.newRecord - New record
     * @param {Record} scriptContext.oldRecord - Old record
     * @param {string} scriptContext.type - Trigger type
     * @Since 2015.2
     */
    function beforeSubmit(scriptContext) {

    }

    /**
     * Function definition to be triggered before record is loaded.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.newRecord - New record
     * @param {Record} scriptContext.oldRecord - Old record
     * @param {string} scriptContext.type - Trigger type
     * @Since 2015.2
     */
    function afterSubmit(scriptContext) {

    }

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    };
    
});
