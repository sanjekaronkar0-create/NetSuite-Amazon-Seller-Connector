/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       16 Dec 2019     Steve
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
 var price = 0;
 var price_sublist = 'price3';
 if(type == 'create' || type == 'edit')
	 {
	 price = nlapiGetFieldValue('custrecord_ecomm_sales_price');
	 var item = nlapiGetFieldValue('custrecord_ecomm_item');
	 var itemId = nlapiLookupField('item', item, 'vendorname');
	 var mp = nlapiGetFieldValue('custrecord_ecomm_marketplace');
	 if(mp == '1'){mp = 'US';}
	 if(mp == '2'){mp = 'CA';}
	 if(mp == '3'){mp = 'MX'; price_sublist = 'price5';}
	 
	 nlapiSetFieldValue('name', itemId + '_' + mp);
	 }
 
 if(mp != 'US' && price != 0)
	 {
	 var itemRec = nlapiLoadRecord('inventoryitem', item);
	 var line = itemRec.findLineItemValue(price_sublist, 'pricelevel', '6');
	 if(line != '-1')
		 {
		 itemRec.selectLineItem(price_sublist, line);
		 itemRec.setCurrentLineItemMatrixValue(price_sublist, 'price', 1, price);
		 itemRec.commitLineItem(price_sublist);

		 }
	 nlapiSubmitRecord(itemRec);
	 
	 }
}
