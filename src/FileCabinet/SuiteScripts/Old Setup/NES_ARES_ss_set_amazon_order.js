/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       20 Feb 2020     Steve
 *
 */

/**
 * The recordType (internal id) corresponds to the "Applied To" record in your script deployment. 
 * @appliedtorecord recordType
 * 
 * @param {String} type Operation types: create, edit, delete, xedit,
 *                      approve, cancel, reject (SO, ER, Time Bill, PO & RMA only)
 *                      pack, ship (IF only)
 *                      dropship, specialorder, orderitems (PO only) 
 *                      paybills (vendor payments)
 * @returns {Void}
 */
function userEventAfterSubmit(type){
if(type != 'delete')
{
var id = nlapiGetRecordId();
var recType = nlapiGetRecordType();
  nlapiLogExecution('DEBUG', 'REc Type', recType);
  nlapiLogExecution('DEBUG', 'Id', id);
var ordRecField = 'custrecord_amazon_item_order_id';
var mktPlaceField = 'custrecord_amazon_item_marketplace';
var headField = 'custrecord_amazon_item_header';
var merchId = '1';
if(recType == 'customrecord_amazon_settlement') 
{
	ordRecField = 'custrecord_settlement_order_id';
	headField = 'custrecord_amazon_settlement_record';
	mktPlaceField = 'custrecord_amazon_settlement_marketplace';
	merchId = nlapiGetFieldValue('custrecord_amazon_settlement_merch_id');
}

var orderId = nlapiGetFieldValue(ordRecField);
var mktPlace = nlapiGetFieldValue(mktPlaceField);

if(orderId != null && orderId != '')
{
var results = nlapiSearchRecord('customrecord_amazon_settlement_header', null, new nlobjSearchFilter('custrecord_amazon_order_id', null, 'is', orderId));

if(results)
	{
	nlapiSubmitField(recType, id, headField, results[0].getId());
	if(recType == 'customrecord_amazon_settlement' && type == 'create')
		{

		if(nlapiGetFieldValue('custrecord_settlement_tran_type') == 'Order')
		{nlapiSubmitField('customrecord_amazon_settlement_header', results[0].getId(), 'custrecord_settlement_data_loaded', 'T');}
				
		if(nlapiGetFieldValue('custrecord_settlement_tran_type') == 'Refund')
		{nlapiSubmitField('customrecord_amazon_settlement_header', results[0].getId(), 'custrecord_amazon_refund_required', 'T');}
		

		}
	else
		{
        var existingInv = lookupInvoice(orderId, merchId);
          nlapiLogExecution('DEBUG', 'Invoice', results[0].getId());
	if(existingInv != null && existingInv != '')
	{
      nlapiSubmitField('customrecord_amazon_settlement_header', results[0].getId(), 'custrecord_settlement_invoice_rec', existingInv);
	}
		if(type == 'create')
		{nlapiSubmitField('customrecord_amazon_settlement_header', results[0].getId(), 'custrecord_amazon_update_inv', 'T');}
		}
	}
else
	{
	var newRec = nlapiCreateRecord('customrecord_amazon_settlement_header');
	var existingInv = lookupInvoice(orderId, merchId);
	if(existingInv != null && existingInv != '')
	{
		newRec.setFieldValue('custrecord_settlement_invoice_rec', existingInv);
	}
	newRec.setFieldValue('custrecord_amazon_order_id', orderId);
	newRec.setFieldValue('custrecord_amazon_order_marketplace', mktPlace);
	
	if(recType == 'customrecord_amazon_settlement')
	{
		newRec.setFieldValue('custrecord_settlement_data_loaded', 'T');
	}
	else
		{
		newRec.setFieldValue('custrecord_amazon_update_inv', 'T');
		}
	
	var recId = nlapiSubmitRecord(newRec);
	nlapiSubmitField(recType, id, headField, recId);
	}
}
}
}

function lookupInvoice(orderId, merchId) {
	var results = nlapiSearchRecord("transaction",null,
			[
				   ["type","anyof","SalesOrd","CustInvc"], 
				   "AND", 
				   ["mainline","is","T"], 
				   "AND", 
				   [["otherrefnum","equalto",orderId],"OR",["memo","is", orderId]]
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