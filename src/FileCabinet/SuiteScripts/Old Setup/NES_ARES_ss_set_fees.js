/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       29 Sep 2020     Steve
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


function userEventAfterSubmit(type){
    var context = nlapiGetContext();
    var ffItem = context.getSetting('SCRIPT', 'custscript_fee_sku');
    var column ='custrecord_mc_standard_ship';
    var id = nlapiGetRecordId();
  var recType = nlapiGetRecordType();
	var source = nlapiGetFieldValue('custbody_order_source');
    var po = nlapiGetFieldValue('otherrefnum');
    var poIndex = '-1';
    if(po != null && po != '')
    {poIndex = po.indexOf('S01');}
	if(source == 'Shopify' || poIndex != '-1')
	{
	var totFee = 0;
    var rec = nlapiLoadRecord(recType, id);
    var shipMeth = rec.getFieldText('shipmethod');
	if(shipMeth.indexOf('Expediated') != '-1')
	{column ='custrecord_mc_exp_shipping';}
	
    var totQty = rec.getFieldValue('custbody_total_units');
    if(totQty > 4){totQty = 4;}
    var lines = rec.getLineItemCount('item');
    
	for(var x = 1; x <= lines; x++)
	{
	var item = rec.getLineItemValue('item', 'item', x);
	if(item != ffItem)
	{
		var qty = rec.getLineItemValue('item', 'quantity', x);
		var fee = getItemFee(item, totQty, column);
		var lineTot = fee*qty;
		nlapiLogExecution('DEBUG', 'Line Fee', lineTot);
		rec.setLineItemValue('item', 'custcol_mc_fee', x, lineTot);
		totFee = Number(totFee) + Number(lineTot);	
	}
	}
    nlapiLogExecution('DEBUG', 'Tot Fee', totFee);
    rec.setFieldValue('custbody_total_mcf_fees', totFee);
	
	nlapiSubmitRecord(rec);
	}
}

function getItemFee(item, qty, column)
{
	var results = nlapiSearchRecord("customrecord_mc_ship_expense",null,
			[
				   ["custrecord_mc_item","anyof",item], 
				   "AND", 
				   ["custrecord_mc_ship_units","anyof", qty]
				], 
				[
				   new nlobjSearchColumn(column)
				]
				);	
	
	if(results){return results[0].getValue(column);}
	else
		{return 0;}

}