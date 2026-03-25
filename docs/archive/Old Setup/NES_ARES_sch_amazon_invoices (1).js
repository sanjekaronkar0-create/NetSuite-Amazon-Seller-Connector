/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       24 Feb 2020     Steve
 *
 */

/**
 * @param {String} type Context Types: scheduled, ondemand, userinterface, aborted, skipped
 * @returns {Void}
 */
function createInvoices(type) {
var context = nlapiGetContext();

var results = nlapiSearchRecord("customrecord_amazon_settlement_header",null,
		[
		   ["custrecord_amazon_update_inv","is","T"], 
		   "AND", 
		   ["custrecord_amazon_order_marketplace","isnot","Non-Amazon"],
     	   "AND", 
   		   ["isinactive","is","F"]
		], 
		[
  		   new nlobjSearchColumn("internalid"),
		   new nlobjSearchColumn("custrecord_amazon_order_id"), 
		   new nlobjSearchColumn("custrecord_amazon_order_marketplace"),
		   new nlobjSearchColumn("custrecord_settlement_invoice_rec")		   
		]
		);

for(var x in results)
	{
	try{
		if(context.getRemainingUsage() < 200 || x == 999)
			{
			nlapiScheduleScript('customscript_nes_ares_sch_amz_create_inv');
			return;
			}
		var submitInv = false;
		var id = results[x].getId();
		var orderId = results[x].getValue('custrecord_amazon_order_id');
		var invId = nlapiLookupField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_invoice_rec');
		if(invId == '' || invId == null)
		{
		var existingInv = lookupInvoice(orderId);
		if(existingInv != null && existingInv != '')
			{
			nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_invoice_rec', existingInv);
			continue;
			}
		}
		
		var mp = results[x].getValue('custrecord_amazon_order_marketplace');
		var currency = '1';
		var customer = '105';
        var location = '1';
		if(mp == 'Amazon.ca')
			{
			currency = '3';
			customer = '6533613';
			}
		if(mp == 'Amazon.com.mx')
		{
		currency = '5';
		customer = '6550019';
		}
		
		
		var lineResults = nlapiSearchRecord("customrecord_amazon_order_items",null,
				[
				   ["custrecord_amazon_item_header","anyof", id]
				], 
				[
				   new nlobjSearchColumn("id").setSort(false), 
				   new nlobjSearchColumn("externalid"),
				   new nlobjSearchColumn("custrecord_amazon_item_header"), 
				   new nlobjSearchColumn("custrecord_amazon_item_order_id"), 
				   new nlobjSearchColumn("custrecord_amazon_item_ship_date"),
				   new nlobjSearchColumn("custrecord_amazon_purchase_date"),
				   new nlobjSearchColumn("custrecord_amazon_item_sku"), 
				   new nlobjSearchColumn("custrecord_amazon_item_qty"), 
				   new nlobjSearchColumn("custrecord_amazon_item_currency"), 
				   new nlobjSearchColumn("custrecord_amazon_item_total"), 
				   new nlobjSearchColumn("custrecord_amazon_item_name"), 
				   new nlobjSearchColumn("custrecord_amazon_item_addr1"), 
				   new nlobjSearchColumn("custrecord_amazon_item_addr2"), 
				   new nlobjSearchColumn("custrecord_amazon_items_city"), 
				   new nlobjSearchColumn("custrecord_amazon_item_state"), 
				   new nlobjSearchColumn("custrecord_amazon_item_zip"),
				   new nlobjSearchColumn("custrecord_amazon_item_country"),
				   new nlobjSearchColumn("custrecord_amazon_item_ship_date")
				]
				);
		
		if(lineResults)
		{
		if(invId == '' || invId == null)
		{
		var name = lineResults[0].getValue("custrecord_amazon_item_nam");
		var addr1 = lineResults[0].getValue("custrecord_amazon_item_addr1");
		var addr2 = lineResults[0].getValue("custrecord_amazon_item_addr2");
		var city = lineResults[0].getValue("custrecord_amazon_item_city");
		var state = lineResults[0].getValue("custrecord_amazon_item_state");
		var zip = lineResults[0].getValue("custrecord_amazon_item_zip");
		var country = lineResults[0].getValue("custrecord_amazon_item_country");
        if(country == '--'){country = 'US';}
    //    if(country == 'CA' && mp == 'Amazon.ca'){location = '10';}
		var shipDate = lineResults[0].getValue("custrecord_amazon_purchase_date");
		var shipArr = shipDate.split('T');
		shipDate = shipArr[0];
		shipDate = shipDate.substring(5, 7) + '/' + shipDate.substring(8, 10) + '/' + shipDate.substring(0, 4);
		
		var custRec = nlapiCreateRecord('customer');
		custRec.setFieldValue('isperson', 'F');
		custRec.setFieldValue('companyname', 'AMZ-' + id);
		custRec.setFieldValue('currency', currency);
		custRec.selectNewLineItem('addressbook');
		custRec.setCurrentLineItemValue('addressbook', 'addr1', addr1);
		custRec.setCurrentLineItemValue('addressbook', 'city', city);
		custRec.setCurrentLineItemValue('addressbook', 'state', state);
		custRec.setCurrentLineItemValue('addressbook', 'zip', zip);
		custRec.setCurrentLineItemValue('addressbook', 'country', country);
		custRec.setCurrentLineItemValue('addressbook', 'defaultshipping', 'T');
		custRec.setCurrentLineItemValue('addressbook', 'defaultbilling', 'T');
		custRec.commitLineItem('addressbook');
		
		customer = nlapiSubmitRecord(custRec);
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_amazon_customer', customer);
		if(lineResults[0].getValue("custrecord_amazon_item_sku").indexOf('-CA') != '-1'){location = '10';}
		var invRec = nlapiCreateRecord('invoice');
		invRec.setFieldValue('entity', customer);
		invRec.setFieldValue('trandate', shipDate);
		invRec.setFieldValue('otherrefnum', orderId);
		invRec.setFieldValue('location', location);
		invRec.setFieldValue('currency', currency);
        invRec.setFieldValue('shippingcost', 0);
		}
		else
			{
			var invRec = nlapiLoadRecord('invoice', invId);
			invRec.setFieldValue('shippingcost', 0);
			}
		
		for(var y in lineResults)
			{
			var lineId = lineResults[y].getValue("externalid");
			var item = lineResults[y].getValue("custrecord_amazon_item_sku");
			item = lookupItem(item);
			if(item == null || item == ''){
				nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_invoice_error', 'No Sku found for ' + lineResults[y].getValue("custrecord_amazon_item_sku"));
			continue;
			}
			var qty = lineResults[y].getValue("custrecord_amazon_item_qty");
			var amount = lineResults[y].getValue("custrecord_amazon_item_total");
		    if(amount == null || amount == ''){amount = 0;}
			var line = invRec.findLineItemValue('item', 'custcol_celigo_etail_order_line_id', lineId);
			if(line == '-1')
			{
			invRec.selectNewLineItem('item');
			invRec.setCurrentLineItemValue('item', 'item', item);
			invRec.setCurrentLineItemValue('item', 'quantity', qty);
			invRec.setCurrentLineItemValue('item', 'amount', amount);
			invRec.setCurrentLineItemValue('item', 'custcol_celigo_etail_order_line_id', lineId);
			invRec.commitLineItem('item');
			}
			else
				{
				invRec.setLineItemValue('item', 'quantity', line, qty);
				invRec.setLineItemValue('item', 'amount', line, amount);
				}
			}

		var invId = nlapiSubmitRecord(invRec);
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_invoice_rec', invId);
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_amazon_update_inv', 'F');
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_invoice_error', '');
		}
		else
			{nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_amazon_update_inv', 'F');}
		
	} catch(e) {nlapiLogExecution('ERROR', 'Catch', e.message);
	nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_invoice_error', e.message);
	}
	}
}


function updateInvoices(type) {
var context = nlapiGetContext();
var results;
var lastId;
var filters;
var reRun;
var results = nlapiSearchRecord("customrecord_amazon_settlement_header",'customsearch_amz_settlement_process');

//if (partialresults) {
//	results = partialresults;
//	while (partialresults.length == 1000) {
//		lastId = partialresults[999].getId();
//		partialresults = nlapiSearchRecord("customrecord_amazon_settlement_header", 'customsearch_amz_settlement_process', new nlobjSearchFilter('internalidnumber', null, 'greaterthan', lastId));
//		results = results.concat(partialresults);
//	}
//}


for (var x in results)
	{
	try{
		if(context.getRemainingUsage() < 200 || x == 999)
		{
			nlapiScheduleScript('customscript_nes_ares_sch_amz_settlement');
			return;
		}
	
	var breakLoop = false;
	var id = results[x].getId();
	var invRecId = nlapiLookupField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_invoice_rec');
	if(invRecId == '' || invRecId == null)
		{
		invRecId = lookupInvoice(results[x].getValue("custrecord_amazon_order_id"));
		if(invRecId == '' || invRecId == null)
		{
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', 'There is no invoice created for this order yet. Settlement can not be updated.');
		continue;
		}
		else{nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_invoice_rec', invRecId);}
		}
	
	var lineResults = nlapiSearchRecord("customrecord_amazon_settlement",null,
			[
			   ["custrecord_amazon_settlement_record","anyof",id], 
			   "AND", 
			   ["custrecord_settlement_tran_type","is","Order"],
			   "AND", 
			   ["custrecord_settlement_processed","is","F"]
			], 
			[
               new nlobjSearchColumn("internalid").setSort(true),
			   new nlobjSearchColumn("custrecord_settlement_tran_type"), 
			   new nlobjSearchColumn("custrecord_settlement_amount_type"), 
			   new nlobjSearchColumn("custrecord_settlement_amt_desc"), 
			   new nlobjSearchColumn("custrecord_settlement_amount"), 
			   new nlobjSearchColumn("custrecord_settlement_currency"), 
			   new nlobjSearchColumn("custrecord_settlement_sku"), 
			   new nlobjSearchColumn("custrecord_settlement_quantity"),
			   new nlobjSearchColumn("custrecord_settlement_post_date"),
			   new nlobjSearchColumn("externalid"),
			   new nlobjSearchColumn("custrecord_amazon_settlement_id"),
			   new nlobjSearchColumn("custrecord_amazon_settlement_marketplace"),
			   new nlobjSearchColumn("custrecord_settlement_post_date_convert"),
			   new nlobjSearchColumn("custrecord__settlement_promo")
			]
			);
	
	if(!lineResults)
		{
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_data_loaded', 'F');
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', '');
		continue;}
	
	var invRec = nlapiLoadRecord('invoice', invRecId);
	var total = 0;
	invRec.setFieldValue('shippingcost', 0);
	for(var y in lineResults)
		{
		var sku = '';
		var extId = lineResults[y].getValue("externalid");
		var settleId = lineResults[0].getValue("custrecord_amazon_settlement_id");
		var item = lineResults[y].getValue("custrecord_settlement_sku");
		var qty = lineResults[y].getValue("custrecord_settlement_quantity");
		var amount = lineResults[y].getValue("custrecord_settlement_amount");
		
		var itemDesc = lineResults[y].getValue("custrecord_settlement_amt_desc");
		var itemType = lineResults[y].getValue("custrecord_settlement_amount_type");
		if(itemType == 'Promotion')
			{
			if(itemDesc == 'Shipping')
			{itemDesc = 'Promotion - Shipping';}
			if(itemDesc == 'Principal')
			{itemDesc = 'Promotion - Principal';}
			}
		var promo = lineResults[y].getValue("custrecord__settlement_promo");
		if(promo != '' && promo != null)
			{
			invRec.setFieldValue('custbody_promotion_id', promo);
			}
		if(amount == 0 || itemDesc == 'Principal')
		{
			total = Number(total) + Number(amount);
			continue;
		}
		
		sku = lookupSettlementItem(itemDesc, lineResults[y].getValue('custrecord_amazon_settlement_marketplace'));
		
		if(sku == null)
			{
			nlapiLogExecution('ERROR', 'No Settlement Item found for: ', itemDesc);
			nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', 'No Settlement Item found for: ' + itemDesc);
			breakLoop = true;
			break;
			}
		
		var line = invRec.findLineItemValue('item', 'custcol_celigo_etail_order_line_id', extId);
		if(line == '-1')
		{
		total = Number(total) + Number(amount);
		invRec.selectNewLineItem('item');
		invRec.setCurrentLineItemValue('item', 'item', sku);
		invRec.setCurrentLineItemValue('item', 'description', itemDesc);
		invRec.setCurrentLineItemValue('item', 'quantity', qty);
		invRec.setCurrentLineItemValue('item', 'amount', amount);
		invRec.setCurrentLineItemValue('item', 'custcol_celigo_etail_order_line_id', extId);
		invRec.commitLineItem('item');
		}
		}
	
	if(breakLoop == true)
		{continue;}
	
	nlapiSubmitRecord(invRec);
	
	for(var n in lineResults)
	{
	nlapiSubmitField('customrecord_amazon_settlement', lineResults[n].getId(), 'custrecord_settlement_processed', 'T');
	}
	
	var payDate = lineResults[0].getValue("custrecord_settlement_post_date_convert");

	var payRec = nlapiTransformRecord('invoice', invRecId, 'customerpayment');
	payRec.setFieldValue('payment', total);
	payRec.setFieldValue('trandate', payDate);
	payRec.setFieldValue('undepfunds', 'T');
	payRec.setFieldValue('custbody_amz_settlement_id', settleId);
	
	var invLine = payRec.findLineItemValue('apply', 'internalid', invRecId);
	if(invLine != '-1')
		{
		payRec.setLineItemValue('apply', 'apply', invLine, 'T');
		}
	else
		{
		reRun = true;
		continue;
		}
	var paymentId = nlapiSubmitRecord(payRec);
	nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_data_loaded', 'F');
	nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', '');
	
	var payRecArr = nlapiLookupField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_payment_rec');
	if(payRecArr == null || payRecArr == '') {nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_payment_rec', paymentId);}
	else
	{
	payRecArr = payRecArr.split(',');
	payRecArr.push(paymentId);
	nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_payment_rec', payRecArr);
	}

	} catch(e) {
	nlapiLogExecution('ERROR', 'Error on ID = ' + id, e.message);
	nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', e.message);
	}
	} 
//end of updating invoices and payments
//Now create refunds

var refundResults = nlapiSearchRecord("customrecord_amazon_settlement_header",null,
		[
		   ["custrecord_amazon_refund_required","is","T"], 
		], 
		[
		   new nlobjSearchColumn("custrecord_amazon_order_id"), 
		   new nlobjSearchColumn("custrecord_settlement_invoice_rec"), 
		   new nlobjSearchColumn("custrecord_settlement_payment_rec"), 
		   new nlobjSearchColumn("custrecord_amazon_order_marketplace"), 
		   new nlobjSearchColumn("custrecord_settlement_data_loaded"), 
		   new nlobjSearchColumn("custrecord_amazon_settlement_update"), 
		   new nlobjSearchColumn("custrecord_settlement_error"), 
		   new nlobjSearchColumn("custrecord_invoice_error"), 
		   new nlobjSearchColumn("custrecord_amazon_refund_required"),
		   new nlobjSearchColumn("custrecord_amazon_customer")
		]
		);

for(var i in refundResults)
	{
	try{
      	if(context.getRemainingUsage() < 200 )
		{
			nlapiYieldScript();
		}
		var id = refundResults[i].getId();
		var breakLoop = false;
		var refLines = nlapiSearchRecord("customrecord_amazon_settlement",null,
				[
				   ["custrecord_amazon_settlement_record","anyof",id], 
				   "AND", 
				   ["custrecord_settlement_tran_type","is","Refund"],
				   "AND", 
				   ["custrecord_settlement_processed","is","F"]
				], 
				[
	               new nlobjSearchColumn("internalid").setSort(),
				   new nlobjSearchColumn("custrecord_settlement_tran_type"), 
				   new nlobjSearchColumn("custrecord_settlement_amount_type"), 
				   new nlobjSearchColumn("custrecord_settlement_amt_desc"), 
				   new nlobjSearchColumn("custrecord_settlement_amount"), 
				   new nlobjSearchColumn("custrecord_settlement_currency"), 
				   new nlobjSearchColumn("custrecord_settlement_sku"), 
				   new nlobjSearchColumn("custrecord_settlement_quantity"),
				   new nlobjSearchColumn("custrecord_settlement_post_date"),
				   new nlobjSearchColumn("externalid"),
				   new nlobjSearchColumn("custrecord_amazon_settlement_marketplace"),
				   new nlobjSearchColumn("custrecord_amazon_settlement_id")
				]
				);
		
		if(!refLines)
			{
			nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_amazon_refund_required', 'F');
			nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', '');
			continue;
			}

		var mp = refLines[0].getValue('custrecord_amazon_settlement_marketplace');
		var currency = '1';
		if(mp == 'Amazon.ca')
			{
			currency = '3';
			}
		if(mp == 'Amazon.com.mx')
		{
		currency = '5';
		}
		
		var cmRec = nlapiCreateRecord('creditmemo');
		cmRec.setFieldValue('entity', refundResults[i].getValue('custrecord_amazon_customer'));
		cmRec.setFieldValue('otherrefnum', refundResults[i].getValue("custrecord_amazon_order_id"));
		cmRec.setFieldValue('location', '1');
		cmRec.setFieldValue('currency', currency);
		cmRec.setFieldValue('shippingcost', 0);
		var refTotal = 0;
		for(var t in refLines)
			{
			var sku = '';
			var extId = refLines[t].getValue("externalid");
			var settleId = refLines[0].getValue("custrecord_amazon_settlement_id");
			var item = refLines[t].getValue("custrecord_settlement_sku");
			var qty = refLines[t].getValue("custrecord_settlement_quantity");
            if(qty == '' || qty == null){qty = 1;}
			var amount = refLines[t].getValue("custrecord_settlement_amount");
            nlapiLogExecution('DEBUG', 'qty', qty);
			amount = -amount;
			refTotal = Number(refTotal) + Number(amount);
			var itemDesc = refLines[t].getValue("custrecord_settlement_amt_desc");
			var itemType = refLines[t].getValue("custrecord_settlement_amount_type");
			if((itemDesc == 'Tax' || itemType == 'ItemWithheldTax') && amount == 0)
				{continue;}
			if(itemType == 'Promotion' && itemDesc == 'Principal')
				{itemDesc = 'Promotion - Principal';}
			if(itemDesc == 'Principal' && itemType != 'Promotion')
			{
			sku = lookupItem(refLines[t].getValue("custrecord_settlement_sku"));
			}
			else
				{
				sku = lookupSettlementItem(itemDesc, refLines[t].getValue("custrecord_amazon_settlement_marketplace"));
				
				if(sku == null)
					{
					nlapiLogExecution('ERROR', 'No Settlement Item found for: ', itemDesc);
					nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', 'No Settlement Item found for: ' + itemDesc);
					breakLoop = true;
					break;
					}
				}
			
			var line = cmRec.findLineItemValue('item', 'custcol_celigo_etail_order_line_id', extId);
			if(line == '-1')
			{
				cmRec.selectNewLineItem('item');
				cmRec.setCurrentLineItemValue('item', 'item', sku);
				cmRec.setCurrentLineItemValue('item', 'description', itemDesc);
				cmRec.setCurrentLineItemValue('item', 'quantity', qty);
				cmRec.setCurrentLineItemValue('item', 'amount', amount);
				cmRec.setCurrentLineItemValue('item', 'custcol_celigo_etail_order_line_id', extId);
				cmRec.commitLineItem('item');
			}
			else
				{
				cmRec.setLineItemValue('item', 'quantity', line, qty);
				cmRec.setLineItemValue('item', 'amount', line, amount);
				}
			}
		
		if(breakLoop == true)
		{continue;}
		
		var cmRecId = nlapiSubmitRecord(cmRec);
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_amazon_credit_memo', cmRecId);
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', '');
		
		for(var w in refLines)
			{
			nlapiSubmitField('customrecord_amazon_settlement', refLines[w].getId(), 'custrecord_settlement_processed', 'T');
			}
			
		var refRec = nlapiCreateRecord('customerrefund', {recordmode:'dynamic'} );
		refRec.setFieldValue('customer', nlapiLookupField('creditmemo', cmRecId, 'entity'));
		refRec.setFieldText('paymentmethod', 'Amazon');
		refRec.setFieldValue('custbody_amz_settlement_id', settleId);
		refRec.setFieldValue('account', '115');
		var cmLine = refRec.findLineItemValue('apply', 'internalid', cmRecId);
		if(cmLine != '-1')
			{
			refRec.selectLineItem('apply', cmLine);
			refRec.setCurrentLineItemValue('apply', 'apply', 'T');
			refRec.commitLineItem('apply');
			}
		else
			{
			reRun = true;
			continue;
			}
		
		var refundId = nlapiSubmitRecord(refRec);
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_amazon_refund', refundId);
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_amazon_refund_required', 'F');
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', '');
		
		
	} catch(e) {
		nlapiLogExecution('ERROR', 'Error on ID = ' + id, e.message);
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', e.message);
	}
	
	} // End i

}

function lookupInvoice(orderId) {
var results = nlapiSearchRecord("invoice",null,
		[
		   ["otherrefnum","equalto",orderId], 
		   "AND", 
		   ["type","anyof","CustInvc"],
		   "AND",
		   ["mainline", "is", 'T']
		], 
		[

		]
		);

if(results)
	{
	return results[0].getId();
	}
else
	{return null;}
}

function lookupItem(item) 
{
 nlapiLogExecution('DEBUG', 'Looking Up Item', item);
 var result = nlapiSearchRecord("item",null,
		 [
		      ["name","haskeywords", item], 
   "AND", 
   ["name","is", item], 
		   "AND", 
		   ["custitem_status","anyof","5", "4", "10", "6", "11", "9"]
		], 
		[
		   new nlobjSearchColumn("internalid").setSort(false), 
		   new nlobjSearchColumn("itemid")
		]
		);
 
 if(!result){return null;}
 
 return result[0].getId();
}

function lookupSettlementItem(item, mp) {
var results = nlapiSearchRecord("customrecord_amazon_sku_table",null,
		[
		   ["name","is", item]
		   
		], 
		[
		   new nlobjSearchColumn("custrecord_amazon_sku_item"),
		   new nlobjSearchColumn("custrecord_amazon_sku_item_ca"),
		   new nlobjSearchColumn("custrecord_amazon_sku_item_mx")
		]
		);

if(results){
if(mp == 'Amazon.ca')
{
	return results[0].getValue("custrecord_amazon_sku_item_ca");
}
if(mp == 'Amazon.com.mx')
{
	return results[0].getValue("custrecord_amazon_sku_item_mx");
}

return results[0].getValue("custrecord_amazon_sku_item");
}
else
	{return null;}
}

function deleteRec(type)
{
var x = nlapiSearchRecord('customerpayment', '2142');
for(var y in x)
{
try{
nlapiDeleteRecord('customerpayment', x[y].getId());
} catch(e){nlapiLogExecution('DEBUG', e.message);}
}



}


function tempInvoices(type) {
	var context = nlapiGetContext();

	var results = nlapiSearchRecord("invoice", '2302'); 

	for(var x in results)
		{
		try{
			if(context.getRemainingUsage() < 200 || x == 999)
				{
				nlapiScheduleScript('customscript_nes_ares_sch_amz_settlement');
				return;
				}
          var id = results[x].getId();
         var rec = nlapiLoadRecord('invoice', id);
          rec.setFieldValue('custbody_basket', 'T');
          nlapiSubmitRecord(rec);
			
		} catch(e) {nlapiLogExecution('ERROR', 'Catch', e.message);
		}
		}
	}


function fix() {
	
	var context = nlapiGetContext();
	var arr = [
		];


	for(var x = 0; x< arr.length; x++)
		{
		if(context.getRemainingUsage() < 200)
			{
nlapiYieldScript();
		}
		try{
		var results = nlapiSearchRecord("invoice",null,
					[
						   ["otherrefnum","equalto", arr[x]], 
						   "AND", 
						   ["mainline","is","T"], 
						   "AND", 
						   ["type","anyof","CustInvc"]
						], 
						[
						   new nlobjSearchColumn("internalid").setSort(false), 
						   new nlobjSearchColumn("otherrefnum"), 
						   new nlobjSearchColumn("tranid"), 
						   new nlobjSearchColumn("entity"), 
						   new nlobjSearchColumn("memo"), 
						   new nlobjSearchColumn("amount")
						]
						);
		var id = results[1].getId();
		nlapiDeleteRecord('invoice', id);

		} catch(e) {nlapiLogExecution('ERROR', 'Catch on ID ' + id, e.message);}
		
		}
}


function fixCredit() {
	
	var context = nlapiGetContext();
	var results = nlapiSearchRecord("customrecord_amazon_settlement_header", '2165');
	
	for(var x in results)
		{
		if(context.getRemainingUsage() < 200 || x == 999)
		{
		nlapiScheduleScript('customscript_nes_ares_sch_amz_create_inv');
		return;
		}
		var id = results[x].getId();
		var invRec = nlapiLoadRecord('creditmemo', results[x].getValue('custrecord_amazon_credit_memo'));
		
		var lineResults = nlapiSearchRecord("customrecord_amazon_settlement",null,
				[
				   ["custrecord_amazon_settlement_record","anyof",id], 
				   "AND", 
				   ["custrecord_settlement_tran_type","is","Refund"], 
				   "AND", 
				   ["custrecord_settlement_amt_desc","is","Principal"]
				], 
				[
	               new nlobjSearchColumn("internalid").setSort(),
				   new nlobjSearchColumn("custrecord_settlement_tran_type"), 
				   new nlobjSearchColumn("custrecord_settlement_amount_type"), 
				   new nlobjSearchColumn("custrecord_settlement_amt_desc"), 
				   new nlobjSearchColumn("custrecord_settlement_amount"), 
				   new nlobjSearchColumn("custrecord_settlement_currency"), 
				   new nlobjSearchColumn("custrecord_settlement_sku"), 
				   new nlobjSearchColumn("custrecord_settlement_quantity"),
				   new nlobjSearchColumn("custrecord_settlement_post_date"),
				   new nlobjSearchColumn("externalid"),
				   new nlobjSearchColumn("custrecord_amazon_settlement_id")
				]
				);
		
		for(var y in lineResults)
			{
			var lineId = lineResults[y].getValue('externalid');
			var item = lineResults[y].getValue("custrecord_settlement_sku");
			item = lookupItem(item);
			if(item == null){
				nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_invoice_error', 'No Sku found for ' + lineResults[y].getValue("custrecord_amazon_item_sku"));
			continue;
			}
			var qty = lineResults[y].getValue("custrecord_settlement_quantity");
			var amount = lineResults[y].getValue("custrecord_settlement_amount");
			amount = -amount;
			var line = invRec.findLineItemValue('item', 'custcol_celigo_etail_order_line_id', lineId);
			if(line != '-1')
				{
				var lineItem = invRec.getLineItemValue('item', 'item', line);
				if(lineItem != item)
					{
					invRec.setLineItemValue('item', 'item', line, item);
					invRec.setLineItemValue('item', 'quantity', line, qty);
					invRec.setLineItemValue('item', 'amount', line, amount);
					}
				}
			}
		nlapiSubmitRecord(invRec);
		nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_credit_fix', 'T');
		}
}


function fixPay() 
	{
		var context = nlapiGetContext();
		var results;
		var lastId;
		var filters;
		var reRun;
		var partialresults = nlapiSearchRecord("customrecord_amazon_settlement_header",'2149');

		if (partialresults) {
			results = partialresults;
			while (partialresults.length == 1000) {
				lastId = partialresults[999].getId();
				partialresults = nlapiSearchRecord("customrecord_amazon_settlement_header", 'customsearch_amz_settlement_process', new nlobjSearchFilter('internalidnumber', null, 'greaterthan', lastId));
				results = results.concat(partialresults);
			}
		}

		nlapiLogExecution('DEBUG', 'Results Length', results.length);
		for (var x in results)
			{
			try{
				if(context.getRemainingUsage() < 200 || x == 999)
				{
				nlapiScheduleScript('customscript_nes_ares_sch_amz_create_inv');
				return;
				}
			
			var breakLoop = false;
			var id = results[x].getId();
			var invRecId = nlapiLookupField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_invoice_rec');
			if(invRecId == '' || invRecId == null)
				{
				invRecId = lookupInvoice(results[x].getValue("custrecord_amazon_order_id"));
				if(invRecId == '' || invRecId == null)
				{
				nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', 'There is no invoice created for this order yet. Settlement can not be updated.');
				continue;
				}
				else{nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_invoice_rec', invRecId);}
				}
			
			var lineResults = nlapiSearchRecord("customrecord_amazon_settlement",null,
					[
					   ["custrecord_amazon_settlement_record","anyof",id], 
					   "AND", 
					   ["custrecord_settlement_tran_type","is","Order"],
					   "AND", 
					   ["custrecord_settlement_processed","is","F"]
					], 
					[
		               new nlobjSearchColumn("internalid").setSort(true),
					   new nlobjSearchColumn("custrecord_settlement_tran_type"), 
					   new nlobjSearchColumn("custrecord_settlement_amount_type"), 
					   new nlobjSearchColumn("custrecord_settlement_amt_desc"), 
					   new nlobjSearchColumn("custrecord_settlement_amount"), 
					   new nlobjSearchColumn("custrecord_settlement_currency"), 
					   new nlobjSearchColumn("custrecord_settlement_sku"), 
					   new nlobjSearchColumn("custrecord_settlement_quantity"),
					   new nlobjSearchColumn("custrecord_settlement_post_date"),
					   new nlobjSearchColumn("externalid"),
					   new nlobjSearchColumn("custrecord_amazon_settlement_id"),
		new nlobjSearchColumn("custrecord_settlement_post_date_convert")
					]
					);
			
			if(!lineResults)
				{
				nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_data_loaded', 'F');
				nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', '');
				continue;}
		var total = 0;
			for(var y in lineResults)
				{
				var sku = '';
				var settleId = lineResults[0].getValue("custrecord_amazon_settlement_id");

				var amount = lineResults[y].getValue("custrecord_settlement_amount");
				total = Number(total) + Number(amount);


		                }
			
			var payDate = lineResults[0].getValue("custrecord_settlement_post_date_convert");
			
			var payRec = nlapiTransformRecord('invoice', invRecId, 'customerpayment');
			payRec.setFieldValue('payment', total);
			payRec.setFieldValue('trandate', payDate);
			payRec.setFieldValue('undepfunds', 'T');
			payRec.setFieldValue('custbody_amz_settlement_id', settleId);
			
			var invLine = payRec.findLineItemValue('apply', 'internalid', invRecId);
			if(invLine != '-1')
				{
				payRec.setLineItemValue('apply', 'apply', invLine, 'T');
				}
			else
				{
				reRun = true;
				continue;
				}
			var paymentId = nlapiSubmitRecord(payRec);
			nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_data_loaded', 'F');
			nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', '');
			
		for(var n in lineResults)
			{
			nlapiSubmitField('customrecord_amazon_settlement', lineResults[n].getId(), 'custrecord_settlement_processed', 'T');
			}

			var payRecArr = nlapiLookupField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_payment_rec');
			if(payRecArr == null || payRecArr == '') {nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_payment_rec', paymentId);}
			else
			{
			payRecArr = payRecArr.split(',');
			payRecArr.push(paymentId);
			nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_payment_rec', payRecArr);
			}

			} catch(e) {
			nlapiLogExecution('ERROR', 'Error on ID = ' + id, e.message);
			nlapiSubmitField('customrecord_amazon_settlement_header', id, 'custrecord_settlement_error', e.message);
			}
			} 

		}
