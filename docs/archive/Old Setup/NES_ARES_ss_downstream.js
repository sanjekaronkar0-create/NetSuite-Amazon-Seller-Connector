/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       16 Feb 2021     Steve
 *
 */

/**
 * The recordType (internal id) corresponds to the "Applied To" record in your script deployment. 
 * @appliedtorecord recordType
 * 
 * @param {String} type Operation types: create, edit, delete, xedit
 *                      approve, reject, cancel (SO, ER, Time Bill, PO & RMA only)
 *                      pack, ship (IF)
 *                      markcomplete (Call, Task)
 *                      reassign (Case)
 *                      editforecast (Opp, Estimate)
 * @returns {Void}
 */
function userEventBeforeSubmit(type){
try{

 var recType = nlapiGetRecordType();
 if(recType == 'customrecord_downstream_ams')
 {
 var sku = nlapiGetFieldValue('custrecord_ds_sku');
 var itemRec = nlapiGetFieldValue('custrecord_ds_item_record');
 if(itemRec != '' && itemRec != null){return;}
 
 itemRec = lookupItem(sku, "itemid");
 nlapiSetFieldValue('custrecord_ds_item_record', itemRec);
 }
 else
	 {
	 var asin = nlapiGetFieldValue('custrecord_sc_asin');
	 var itemRec = nlapiGetFieldValue('custrecord_ds_item_record');
	 if(itemRec != '' && itemRec != null){return;}
	 
	 itemRec = lookupItem(asin, 'custitem_asin');
	 if(itemRec == '' || itemRec == null)
		 {
		 var eccomResults = nlapiSearchRecord("customrecord_amazon_details",null,
				 [
					   ["custrecord_ecomm_asin","is", asin]
					], 
					[
					   new nlobjSearchColumn("custrecord_ecomm_item")
					]
					);
		 
		 if(eccomResults)
			 {
			 itemRec = eccomResults[0].getValue('custrecord_ecomm_item');
			 } 
		 }
	 nlapiSetFieldValue('custrecord_sc_item_record', itemRec);
	 }
 
} catch(e){nlapiLogExecution('ERROR', 'Catch', e.message);}
}


function lookupItem(item, keyFld) 
{
 nlapiLogExecution('DEBUG', 'Looking Up Item', item);
 var result = nlapiSearchRecord("item",null,
		 [
		   [keyFld,"is",item]
		], 
		[
		   new nlobjSearchColumn("internalid").setSort(false), 
		   new nlobjSearchColumn("itemid")
		]
		);
 
 if(!result){return null;}
 
 return result[0].getId();
}