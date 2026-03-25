/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/error', 'N/record', 'N/search', 'N/log'],
/**
 * @param {error} error
 * @param {record} record
 * @param {search} search
 */
function(error, record, search, log) {
   
    /**
     * Function definition to be triggered before record is loaded.
     *
     * @param {Object} scriptContext
     * @param {Record} scriptContext.newRecord - New record
     * @param {string} scriptContext.type - Trigger type
     * @param {Form} scriptContext.form - Current form
     * @Since 2015.2
     */
    function beforeLoad(scriptContext) {

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
    function beforeSubmit(context) {

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
    function afterSubmit(context) {
        try{
            var recTrans = context.newRecord;
            var recId = recTrans.id;
            var itRec = record.load({
                type: 'inventoryitem',
                id: recId
            });
        
            var priceSearch = search.create({
                   type: "item",
                   filters:
                   [
                      ["pricing.pricelevel","anyof","6"], 
                      "AND", 
                      ["internalid","anyof", recId], 
              "AND", 
              ["pricing.currency","anyof","1"]
                   ],
                   columns:
                   [
                      search.createColumn({
                         name: "unitprice",
                         join: "pricing",
                         sort: search.Sort.ASC,
                         label: "Unit Price"
                      })
                   ]
                });
            
            var results = priceSearch.run();
            var firstResult = results.getRange({
                start: 0, 
                end: 1
              })[0]; 
            
            var amzPrice = firstResult.getValue(results.columns[0]);
            
            var amzType = recTrans.getValue('custitem_amz_item_type');
            var amzTypeLookUp = search.lookupFields({
                type: 'customrecord_amazon_item_type',
                id: amzType,
                columns: ['custrecord_amz_referral_percent']
            });
            
            var percent = parseFloat(amzTypeLookUp.custrecord_amz_referral_percent)/100;
            log.debug({details: 'Percent = ' + percent});
            var refPrice = amzPrice*percent;
            log.debug({details: 'Price = ' + refPrice});
            itRec.setValue({
                fieldId: 'custitem_referral',
                value: refPrice.toFixed(2)
            });
            
            itRec.setValue({
                fieldId: 'custitem_amazonsalesprice',
                value: amzPrice
            });

            itRec.save();
            } catch(e){log.debug({details: 'Error = ' + e.message});}
    }

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    };
    
});
