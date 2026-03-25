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
           var amzSettleSearchObj = search.create({
            type: "customrecord_amazon_settlement",
            filters:
            [
["custrecord_amazon_settlement_record","anyof","@NONE@"], 
      "AND", 
      [["custrecord_settlement_tran_type","is","Order"],"OR",["custrecord_settlement_tran_type","is","Refund"]]
            ],
            columns:
            [
              search.createColumn({name: "internalid", label: "Internal Id"}),
               search.createColumn({name: "custrecord_amazon_settlement_id", label: "Settlement ID"}),
               search.createColumn({name: "custrecord_settlement_order_id", label: "Order Id"}),
               search.createColumn({name: "custrecord_amazon_settlement_marketplace", label: "Marketplace"}),
               search.createColumn({name: "custrecord_settlement_tran_type", label: "Transaction Type"}),
               search.createColumn({name: "custrecord_amazon_settlement_merch_id", label: "Merchant Order"}),
               search.createColumn({name: "custrecord_settlement_amt_desc", label: "Amount Description"}),
               search.createColumn({name: "custrecord_settlement_amount", label: "Amount"}),
               search.createColumn({name: "custrecord_settlement_currency", label: "Currency"}),
               search.createColumn({name: "custrecord_settlement_sku", label: "SKU"}),
               search.createColumn({name: "custrecord_settlement_quantity", label: "Quantity"}),
               search.createColumn({name: "custrecord_settlement_post_date", label: "Posted Date"}),
               search.createColumn({name: "custrecord_settlement_post_date_convert", label: "Posted Date (converted)"}),
               search.createColumn({name: "custrecord_settlement_post_period", label: "Posted Period"}),
               search.createColumn({name: "custrecord_amazon_settlement_record", label: "Settlement Record"}),
               search.createColumn({name: "custrecord_amazon_settlement_summary", label: "Settlement Summary Record"}),
               search.createColumn({name: "custrecord_settlement_total", label: "Settlement Total"})
            ]
         });
             
             return amzSettleSearchObj;
    }
 
     function map(context) {
         log.debug('context', context.value);
         var rowJson = JSON.parse(context.value);
         var recId = rowJson.values['internalid'].value;
         var orderId = rowJson.values['custrecord_settlement_order_id'];
         var mktPlace = rowJson.values['custrecord_amazon_settlement_marketplace'];
         var tranType = rowJson.values['custrecord_settlement_tran_type'];

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
            record.submitFields({
	    	    type: 'customrecord_amazon_settlement',
	    	    id: recId,
	    	    values: {
	    	    	custrecord_amazon_settlement_record: headerId
	    	    }});

            if(tranType == 'Order')
            {
            record.submitFields({
	    	    type: 'customrecord_amazon_settlement_header',
	    	    id: headerId,
	    	    values: {
	    	    	custrecord_settlement_data_loaded: true
	    	    }});
            }

            if(tranType == 'Refund')
            {
            record.submitFields({
	    	    type: 'customrecord_amazon_settlement_header',
	    	    id: headerId,
	    	    values: {
	    	    	custrecord_amazon_refund_required: true
	    	    }});
            }
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
                if(tranType == 'order')
                {
                amzRec.setValue({
                    fieldId: 'custrecord_settlement_data_loaded',
                    value: true
                });
                }
                if(tranType == 'Refund')
                {
                amzRec.setValue({
                    fieldId: 'custrecord_amazon_refund_required',
                    value: true
                });
                }

                var amzRecId = amzRec.save();
                record.submitFields({
                    type: 'customrecord_amazon_settlement',
                    id: recId,
                    values: {
                        custrecord_amazon_settlement_record: amzRecId
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