/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/error', 'N/record', 'N/search', 'N/transaction', 'N/format','N/log'],
/**
 * @param {error} error
 * @param {record} record
 * @param {search} search
 * @param {transaction} transaction
 */
function(error, record, search, transaction, format, log) {
   
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
    var recTrans = context.newRecord;
        var lines = recTrans.getLineCount({"sublistId" : "item"});
    var qtyTot = 0;
    var itemArr = [];
    log.debug({details: 'Line Count = ' + lines});
    for(var x = 0; x < lines; x++)
    	{
    	var itemType = recTrans.getSublistValue({"sublistId" : "item", "fieldId" : "itemtype", "line" : x});
    	log.debug({details: 'Item = ' + itemType});
    	var qty = recTrans.getSublistValue({"sublistId" : "item", "fieldId" : "quantity", "line" : x});
    	var item = recTrans.getSublistValue({"sublistId" : "item", "fieldId" : "item", "line" : x});
    	if(itemType == 'InvtPart')
    		{
    		qtyTot = Number(qtyTot) + Number(qty);
    		if(itemArr.indexOf(item) == '-1' && lines > 1)
    			{
    			itemArr.push(item);
    			}
    		}
        
    	}
      
    recTrans.setValue({
    	fieldId: 'custbody_total_units',
    	value: qtyTot
    });
    
    if(itemArr.length == 1){itemArr = '';}
    
    recTrans.setValue({
    	fieldId: 'custbody_products_sold',
    	value: itemArr
    });
    
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
        var amzUrl = 'AWSAccessKeyId=AKIAIVGMZZYWTTCL35KQ&Action=CreateFulfillmentOrder&SellerId=A1S731XAYKTTWV&MWSAuthToken=amzn.mws.98a8b1de-2ad7-a013-da9f-3df9ebc39b7e&SignatureMethod=HmacSHA256&SignatureVersion=2&SellerFulfillmentOrderId=';
        var recTrans = context.newRecord;
        var orderSource = recTrans.getValue('custbody_order_source');
        if(orderSource != 'Shopify') {return;}
        var recId = recTrans.id;
        var tranId = recTrans.getValue('tranid');
    	var date = new Date(recTrans.getValue('trandate'));
    	date = format.format({value: date, type: format.Type.DATE});
    	var y = date.substring(6, 12);
    	var d = date.substring(3, 5);
    	var m = date.substring(0,2);
    	date = y + '-' + m + '-' + d;
        var po = recTrans.getValue('otherrefnum');
        po = po.replace('#', '');
        var invoiceSearchObj = search.create({
        	   type: "invoice",
        	   filters:
        	   [
        	      ["type","anyof","CustInvc"], 
        	      "AND", 
        	      ["mainline","is","T"], 
        	      "AND", 
        	      ["internalidnumber","equalto", recId]
        	   ],
        	   columns:
        	   [
        	      search.createColumn({name: "billaddress1", label: "Billing Address 1"}),
        	      search.createColumn({name: "billaddress2", label: "Billing Address 2"}),
        	      search.createColumn({name: "billaddressee", label: "Billing Addressee"}),
        	      search.createColumn({name: "billcity", label: "Billing City"}),
        	      search.createColumn({name: "billcountry", label: "Billing Country"}),
        	      search.createColumn({name: "billstate", label: "Billing State/Province"}),
        	      search.createColumn({name: "billzip", label: "Billing Zip"})
        	   ]
        	});
		
      	var results = invoiceSearchObj.run();
    	var resultsSet = results.getRange({start: 0, end: 1000});
    	
        var shipAddressee = resultsSet[0].getValue('billaddressee');
        var shipAddr1 = resultsSet[0].getValue('billaddress1');
        var shipAddr2 = resultsSet[0].getValue('billaddress2');
        var city = resultsSet[0].getValue('billcity');
        var state = resultsSet[0].getValue('billstate');
        var zip = resultsSet[0].getValue('billzip');
        var country = resultsSet[0].getValue('billcountry');
        amzUrl += tranId + '&ShippingSpeedCategory=Standard&DisplayableOrderId=' + po + '&DisplayableOrderDateTime=' + date + 'T00%3A00%3A00Z&DisplayableOrderComment=ARES Tools&NotificationEmailList.member.1=ares%40arestool.com&DestinationAddress.Name=' + shipAddressee + '&DestinationAddress.Line1=' + shipAddr1;
        if(shipAddr2 != '' && shipAddr2 != null)
        	{
        	amzUrl += '&DestinationAddress.Line2=' + shipAddr2;
        	}
        amzUrl += '&DestinationAddress.City=' + city + ' &DestinationAddress.StateOrProvinceCode=' + state + '&DestinationAddress.PostalCode=' + zip + '&DestinationAddress.CountryCode=' + country;
        
		var lines = recTrans.getLineCount({
			sublistId: 'item'
		});

		var itmArr = [];
		var qtyArr = [];
		var valArr = [];
		for(var i = 0; i < lines; i++)
			{
			var item = recTrans.getSublistValue({
				sublistId: 'item',
				fieldId: 'item',
				line: i
			});
			
			var itemType = search.lookupFields({
				type: 'item',
				id: item,
				columns: ['type', 'vendorname']
			});
			
			var type = itemType.type[0].value;
              	log.error({
				title : 'Item Text',
				details : itemType.vendorname
			});
			if(type == 'InvtPart')
			{
			itmArr.push(itemType.vendorname);		
			var qty = recTrans.getSublistValue({
				sublistId: 'item',
				fieldId: 'quantity',
				line: i
			});	
			qtyArr.push(qty);
			
			var value = recTrans.getSublistValue({
				sublistId: 'item',
				fieldId: 'amount',
				line: i
			});
			valArr.push(value);	
					
			}
			
			}
			
		for(var a = 0; a < itmArr.length; a++)
			{
			  amzUrl += '&Items.member.' + Number(a+1) + '.PerUnitDeclaredValue.Value=' + valArr[a];
			}
			
		for(var z = 0; z < itmArr.length; z++)
			{
			  amzUrl += '&Items.member.' + Number(z+1) + '.PerUnitDeclaredValue.CurrencyCode=USD';
			}

		for(var t = 0; t < itmArr.length; t++)
		{
		  amzUrl += '&Items.member.' + Number(t+1) + '.Quantity=' + qtyArr[t];
		}

		for(var w = 0; w < itmArr.length; w++)
		{
		  amzUrl += '&Items.member.' + Number(w+1) + '.SellerFulfillmentOrderItemId=' + recId + '-' + w;
		}

		for(var b = 0; b < itmArr.length; b++)
		{
		  amzUrl += '&Items.member.' + Number(b+1) + '.SellerSKU=' + itmArr[b];
		}
        
		var sigArr = amzUrl.split('&');
		sigArr.sort();
		var sigUrlBody = '';
		for(var t = 0; t < sigArr.length; t++)
		{
		if(sigArr[t] != '' && sigArr[t] != null)
		if(t != 0)
		{sigUrlBody += '&' + sigArr[t];}
		else
		{sigUrlBody += sigArr[t];}
		}
			sigUrlBody = sigUrlBody.replace(/ /g,"%20");
    	record.submitFields({
        	type: 'invoice',
        	id: recId,
        	values: {
        		custbody_amz_fulfillment_url : sigUrlBody  
        	}
        });
      } catch (e) {
			log.error({
				title : 'Invoice After Submit',
				details : e.message
			});
		}
      
    }
        

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    };
    
});
