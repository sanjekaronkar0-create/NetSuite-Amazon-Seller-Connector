/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       21 May 2020     Steve
 *
 */

/**
 * @param {String} type Context Types: scheduled, ondemand, userinterface, aborted, skipped
 * @returns {Void}
 */
function scheduled(type) {
var context = nlapiGetContext();
var location = context.getSetting('SCRIPT', 'custscript_amz_adj_location');
var adjAccount = context.getSetting('SCRIPT', 'custscript_amz_adj_acct');

var results = nlapiSearchRecord("customrecord_amazon_inventory_adj",null,
		[
		     ["custrecord_amz_ia_transaction","anyof","@NONE@"], 
   "AND", 
   ["internalidnumber","greaterthanorequalto","47436"]
		], 
		[
		   new nlobjSearchColumn("custrecord_amz_ia_report_id"), 
		   new nlobjSearchColumn("custrecord_amz_ia_date"), 
		   new nlobjSearchColumn("custrecord_amz_ia_sku"), 
		   new nlobjSearchColumn("custrecord_amz_ia_quantity"), 
		   new nlobjSearchColumn("custrecord_amz_ia_transaction"), 
		   new nlobjSearchColumn("custrecord_amz_ia_reason_code"),
		   new nlobjSearchColumn("custrecord_amz_ia_error")
		]
		);

for (var x in results)
	{
	try{
	if(context.getRemainingUsage() < 200)
		{
		nlapiScheduleScript('customscript_nes_ares_sch_amz_inv_adj');
		return;
		}
	
	var id = results[x].getId();
	var report = results[x].getValue("custrecord_amz_ia_report_id");
	
	var iaId = lookupIa(report);
	
	if(iaId == null)
		{
		var iaRec = nlapiCreateRecord('inventoryadjustment');
		iaRec.setFieldValue('custbody_amz_settlement_id', report);
		iaRec.setFieldValue('account', adjAccount);
		iaRec.setFieldValue('memo', 'AMZ Inventory ADJ - ' + report);
		iaRec.setFieldValue('adjlocation', location);
		
		var date = results[x].getValue('custrecord_amz_ia_date');
		var dateArr = date.split('T');
		date = dateArr[0];
		date = date.substring(5, 7) + '/' + date.substring(8, 10) + '/' + date.substring(0, 4);
		iaRec.setFieldValue('trandate', date);
		
		}
	else
		{
		var iaRec = nlapiLoadRecord('inventoryadjustment', iaId);
		}
	
	var item = lookupItem(results[x].getValue('custrecord_amz_ia_sku'));
	if(item == null)
		{
		nlapiSubmitField('customrecord_amazon_inventory_adj', id, 'custrecord_amz_ia_error', 'No SKU found');
		continue;
		}
	
	var price = nlapiLookupField('item', item, 'averagecost');
	var qty = results[x].getValue('custrecord_amz_ia_quantity');
	var dispCode = results[x].getValue('custrecord_amz_ia_reason_code');
	
	 iaRec.selectNewLineItem('inventory');
	 iaRec.setCurrentLineItemValue('inventory', 'item', item);
	 iaRec.setCurrentLineItemValue('inventory', 'adjustqtyby', qty);
	 iaRec.setCurrentLineItemValue('inventory', 'unitcost', price);
	 iaRec.setCurrentLineItemValue('inventory', 'location', location);
	 iaRec.setCurrentLineItemText('inventory', 'custcol_amz_disposition_code', dispCode);
	 iaRec.commitLineItem('inventory');
	 
	 iaId = nlapiSubmitRecord(iaRec);
	
	 nlapiSubmitField('customrecord_amazon_inventory_adj', id, 'custrecord_amz_ia_error', '');
	 nlapiSubmitField('customrecord_amazon_inventory_adj', id, 'custrecord_amz_ia_transaction', iaId);
	 
	} catch(e) {nlapiSubmitField('customrecord_amazon_inventory_adj', id, 'custrecord_amz_ia_error', e.message);}
	}
}


function lookupIa(report) {
	var results = nlapiSearchRecord('inventoryadjustment', null, new nlobjSearchFilter('custbody_amz_settlement_id', null, 'is', report));
	
	if(results){return results[0].getId();}
	
	return null;
}


function lookupItem(item) 
{
 nlapiLogExecution('DEBUG', 'Looking Up Item', item);
 var result = nlapiSearchRecord("item",null,
		 [
		   ["itemid","is",item]
		], 
		[
		   new nlobjSearchColumn("internalid").setSort(false), 
		   new nlobjSearchColumn("itemid")
		]
		);
 
 if(!result){return null;}
 
 return result[0].getId();
}