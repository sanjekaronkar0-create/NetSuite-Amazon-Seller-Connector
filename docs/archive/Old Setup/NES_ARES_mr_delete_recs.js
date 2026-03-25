/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
 */
define(['N/currentRecord', 'N/email', 'N/error', 'N/format', 'N/log', 'N/record', 'N/search', 'N/transaction', 'N/runtime'],
/**
 * @param {currentRecord} currentRecord
 * @param {email} email
 * @param {error} error
 * @param {format} format
 * @param {log} log
 * @param {record} record
 * @param {search} search
 * @param {transaction} transaction
 */
function(currentRecord, email, error, format, log, record, search, transaction, runtime) {
    var me = runtime.getCurrentScript();
    var recType = me.getParameter({name:'custscript_amz_rec_type'});
    function getInputData() {
 /*             var deleteRecord = record.delete({
            type: 'deposit',
            id: '16040157',
           });*/
          //Delete old AMZ records
          var amzSettleSearchObj = search.create({
            type: recType,
            filters:
            [
               ["created","within","monthsago40","monthsago6"]
            ],
            columns:
            [
               search.createColumn({name: "internalid", label: "Internal ID"})
            ]
         });
            
            return amzSettleSearchObj;
   }

    function map(context) {
        log.debug('context', context.value);
        var rowJson = JSON.parse(context.value);
        var recId = rowJson.values['internalid'].value;
        var deleteRecord = record.delete({
            type: recType,
            id: recId,
           });


    }

    function reduce(context) {

    }

    function summarize(summary) {

    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
    
});