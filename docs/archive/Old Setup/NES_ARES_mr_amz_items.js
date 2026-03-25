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
     function getInputData() {
           //Set last service date w/ last Actual Start Pickup date for pickup customers
           //Set Next Pickup w/ last Scheduled Start Pickup date for pickup customers
           var amzItemSearchObj = search.create({
            type: "customrecord_amazon_order_items",
            filters:
            [
               ["custrecord_amazon_item_header","anyof","@NONE@"]
            ],
            columns:
            [
               search.createColumn({
                  name: "id",
                  sort: search.Sort.ASC,
                  label: "ID"
               }),
               search.createColumn({name: "internalid", label: "Internal Id"}),
               search.createColumn({name: "custrecord_amazon_item_header", label: "Order Header"}),
               search.createColumn({name: "custrecord_amazon_item_order_id", label: "Order Id"}),
               search.createColumn({name: "custrecord_amazon_item_sku", label: "SKU"}),
               search.createColumn({name: "custrecord_amazon_item_marketplace", label: "Marketplace"})
            ]
         });
             
             return amzItemSearchObj;
    }
 
     function map(context) {
         log.debug('context', context.value);
         var rowJson = JSON.parse(context.value);
         var recId = rowJson.values['internalid'].value;
         var orderId = rowJson.values['custrecord_amazon_item_order_id'];
         var mktPlace = rowJson.values['custrecord_amazon_item_marketplace'];
         var sku = rowJson.values['custrecord_amazon_item_sku'];
       
         var headerSearchObj = search.create({
            type: "customrecord_amazon_settlement_header",
            filters:
            [
               ["custrecord_amazon_order_id","is", orderId]
            ],
            columns:
            [
               search.createColumn({name: "internalid", label: "Internal ID"})
            ]
         });

         var results = headerSearchObj.run();
         var resultsSet = results.getRange({start: 0, end: 1000});
         if(resultsSet.length > 0)
         {
            var  headerId = resultsSet[0].getValue({name: 'internalid'});
           
           var itemsSearchObj = search.create({
   type: "customrecord_amazon_order_items",
   filters:
   [
      ["custrecord_amazon_item_header","anyof", headerId], 
      "AND", 
      ["custrecord_amazon_item_sku","is", sku]
   ],
   columns:
   [
      search.createColumn({
         name: "id",
         sort: search.Sort.ASC,
         label: "ID"
      }),
      search.createColumn({name: "internalid", label: "Internal Id"})
   ]
});
           
var searchResultCount = itemsSearchObj.runPaged().count;
           if(searchResultCount > 0)
           {
            record.delete({
            type: 'customrecord_amazon_order_items',
            id: recId,
           });
             return;
           }
           
            record.submitFields({
	    	    type: 'customrecord_amazon_order_items',
	    	    id: recId,
	    	    values: {
	    	    	custrecord_amazon_item_header: headerId
	    	    }});

            record.submitFields({
	    	    type: 'customrecord_amazon_settlement_header',
	    	    id: headerId,
	    	    values: {
	    	    	custrecord_amazon_update_inv: true
	    	    }});
            
         }
         else
         {
            var amzRec = record.create({
                type: 'customrecord_amazon_settlement_header',
                isDynamic: true
                });

            amzRec.setValue({
                    fieldId: 'custrecord_amazon_order_id',
                    value: orderId
                });

                amzRec.setValue({
                    fieldId: 'custrecord_amazon_order_marketplace',
                    value: mktPlace
                });

                amzRec.setValue({
                    fieldId: 'custrecord_amazon_update_inv',
                    value: true
                });

                var amzRecId = amzRec.save();
                record.submitFields({
                    type: 'customrecord_amazon_order_items',
                    id: recId,
                    values: {
                        custrecord_amazon_item_header: amzRecId
                    }});
         }


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