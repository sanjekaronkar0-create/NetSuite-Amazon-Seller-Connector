/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       30 Dec 2019     Steve
 *
 */

/**
 * @param {String} type Context Types: scheduled, ondemand, userinterface, aborted, skipped
 * @returns {Void}
 */
function scheduled(type) {
var context = nlapiGetContext();
var invoiceSearch = 		
[
11854703,
11854704,
11854705,
11854706,
11854707,
11854708,
11854851,
11854852,
11854853,
11854854,
11854856,
11854857,
11854858,
11854859,
11854862,
11854863,
11854864,
11854865,
11854866,
11854867,
11854868,
11854869,
11854870,
11854871,
11854874,
11854876,
11854878,
11854879,
11854881,
11854882,
11854887,
11854889,
11854953,
11854954,
11854957,
11854960,
11854966,
11854976,
11854977,
11855056,
11855058,
11855153,
11855160,
11855161,
11855164,
11854709,
11854855,
11854860,
11854861,
11854872,
11854873,
11854875,
11854877,
11854880,
11854883,
11854884,
11854885,
11854886,
11854888,
11854890,
11854959,
11854961,
11854975,
11855055,
11855057,
11855060,
11855063,
11855156,
11863569,
11879031,
11916350,
11916361,
11918023,
11940414,
11944731,
11963411,
11993019,
12011870,
12019070,
12018308,
12024826,
12027250,
12032054,
12035231,
12036053,
12037278,
12038268,
12038736,
12042160]

for(var x in invoiceSearch)
	{
	try{

		var id = invoiceSearch[x];
var invRec = nlapiLoadRecord('invoice', id);
		var amt = invRec.getFieldValue('amountremaining');
var invId = invRec.getFieldValue('id');
		var customer = nlapiLookupField('invoice', id, 'entity');
		var cmRec = nlapiCreateRecord('creditmemo');
		cmRec.setFieldValue('entity', customer);
		cmRec.setFieldValue('location', '1');
		cmRec.setFieldValue('shippingcost', '0');
        cmRec.setFieldValue('trandate', '12/31/2023');
		cmRec.selectNewLineItem('item');
		cmRec.setCurrentLineItemValue('item', 'item', '4602');
		cmRec.setCurrentLineItemValue('item', 'amount', amt);
		cmRec.commitLineItem('item');	
		var cmRecId = nlapiSubmitRecord(cmRec);
		nlapiLogExecution('DEBUG', 'InvId', invId);
		var cmRec2 = nlapiLoadRecord('creditmemo', cmRecId);
		var applyLine = cmRec2.findLineItemValue('apply', 'internalid', invId);
		cmRec2.setLineItemValue('apply', 'apply', applyLine, 'T');
		nlapiSubmitRecord(cmRec2);
		

	} catch(e) {nlapiLogExecution('ERROR', 'Catch', e.message);}
	}
}


function deleteRec(type)
{
var arr = [
16560642,
16560644,
16560646,
16560648,
16560654,
16560656,
16560658,
16560684,
16560687,
16560689,
16560692,
16560694,
16560711,
16560713,
16560737,
16560739,
16560660,
16560762,
16560764,
16560766,
16560768,
16560770,
16560772,
16560774,
16560776,
16560794,
16560796,
16560798,
16560800,
16560802,
16560804,
16560865,
16560867,
16560869,
16560873,
16560875,
16560877,
16560879,
16560881,
16560883,
16560885,
16560893,
16560895,
16560897,
16560899,
16560901,
16560903,
16560905,
16560908,
16560910,
16560912,
16560914,
16560917,
16560919,
16560925,
16560927,
16560929,
16560931,
16560933,
16560935,
16560937,
16560939,
16560942,
16560944,
16560946,
16560948,
16560956,
16560968,
16560994,
16560996,
16561072,
16561163,
16561165,
16561169,
16561171,
16561175,
16561177,
16561181]

for(var x in arr)
{
if(nlapiGetContext().getRemainingUsage() < 200)
{
nlapiYieldScript();
		}
var rec = nlapiLoadRecord('creditmemo', arr[x]);
var rfId = rec.getLineItemValue('apply', 'internalid', 1);
rec.setLineItemValue('apply', 'apply', 1, 'F');
nlapiSubmitRecord(rec);

nlapiDeleteRecord('creditmemo', arr[x]);
nlapiLogExecution('DEBUG', 'CM', arr[x]);

}



}

