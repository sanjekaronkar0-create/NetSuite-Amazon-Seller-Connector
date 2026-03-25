/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       01 Apr 2020     Steve
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
function scheduled(type){
  var context = nlapiGetContext();
	var settlementSearch = nlapiSearchRecord("customrecord_amazon_settlement",null,
			[
			   ["custrecord_amazon_settlement_summary","anyof","@NONE@"]
			], 
			[
			   new nlobjSearchColumn("internalid"), 
			   new nlobjSearchColumn("custrecord_amazon_settlement_id"), 
			   new nlobjSearchColumn("custrecord_settlement_order_id"), 
			   new nlobjSearchColumn("custrecord_settlement_start"), 
			   new nlobjSearchColumn("custrecord_settlement_post_date"),
			   new nlobjSearchColumn("custrecord_settlement_end_date"), 
			   new nlobjSearchColumn("custrecord_settlement_deposit_date"), 
			   new nlobjSearchColumn("custrecord_settlement_total"),
			   new nlobjSearchColumn("custrecord_settlement_currency")
			]
			);
	
	for(var y in settlementSearch)
	{
	try{
    if(context.getRemainingUsage() < 200 || y == 999)
      {
        nlapiScheduleScript('customscript_nes_ares_sch_amz_settle_sum');
        return;
      }
    var id = settlementSearch[y].getId();
	var settleId = settlementSearch[y].getValue('custrecord_amazon_settlement_id');
	var sumResults = nlapiSearchRecord('customrecord_amazon_settlement_summary', null, new nlobjSearchFilter('custrecord_amz_settlle_summary_id', null, 'is', settleId));
	
	if(sumResults)
	{
	var sumRecId = sumResults[0].getId();
	nlapiSubmitField('customrecord_amazon_settlement', id, 'custrecord_amazon_settlement_summary', sumRecId);
	nlapiSubmitField('customrecord_amazon_settlement_summary', sumRecId, 'custrecord_amz_settle_summary_recalc', 'T');
	}
     else
	{
	var sumRec = nlapiCreateRecord('customrecord_amazon_settlement_summary');
	sumRec.setFieldValue('name', settleId);
	sumRec.setFieldValue('custrecord_amz_settlle_summary_id', settleId);
	sumRec.setFieldValue('custrecord_amz_settle_summary_recalc', 'T');
	var sumRecId = nlapiSubmitRecord(sumRec);
	nlapiSubmitField('customrecord_amazon_settlement', id, 'custrecord_amazon_settlement_summary', sumRecId);
	}

	if(settlementSearch[y].getValue('custrecord_settlement_start') != '' && settlementSearch[y].getValue('custrecord_settlement_start') != null)
	{
	nlapiSubmitField('customrecord_amazon_settlement_summary', sumRecId, 'custrecord_amz_settle_summary_start', settlementSearch[y].getValue('custrecord_settlement_start'));
	nlapiSubmitField('customrecord_amazon_settlement_summary', sumRecId, 'custrecord_amz_settle_summary_end', settlementSearch[y].getValue('custrecord_settlement_end_date'));
	nlapiSubmitField('customrecord_amazon_settlement_summary', sumRecId, 'custrecord_amz_settle_summary_deposit', settlementSearch[y].getValue('custrecord_settlement_deposit_date'));
	nlapiSubmitField('customrecord_amazon_settlement_summary', sumRecId, 'custrecord_amz_settle_summary_exp_total', settlementSearch[y].getValue('custrecord_settlement_total'));
	nlapiSubmitField('customrecord_amazon_settlement_summary', sumRecId, 'custrecord_amz_settle_summary_currency', settlementSearch[y].getValue('custrecord_settlement_currency'));
	}
	
	var payDate = settlementSearch[y].getValue("custrecord_settlement_post_date");
	if(payDate != '' && payDate != null)
	{
	if(payDate.indexOf('.') == '-1')
	{payDate = payDate.substring(5, 7) + '/' + payDate.substring(8, 10) + '/' + payDate.substring(0, 4);}
	else
	{payDate = payDate.substring(3, 5) + '/' + payDate.substring(0, 2) + '/' + payDate.substring(6, 10);}
	
	nlapiSubmitField('customrecord_amazon_settlement', id, 'custrecord_settlement_post_date_convert', payDate);
	}
	
	var periodSearch = nlapiSearchRecord("accountingperiod",null,
			[
			   ["isquarter","is","F"], 
			   "AND", 
			   ["isyear","is","F"], 
			   "AND", 
			   ["startdate","onorbefore",payDate], 
			   "AND", 
			   ["enddate","onorafter",payDate]
			], 
			[
			   new nlobjSearchColumn("periodname").setSort(false)
			]
			);
	if(periodSearch)
	{nlapiSubmitField('customrecord_amazon_settlement', id, 'custrecord_settlement_post_period', periodSearch[0].getId());}
	} catch(e){nlapiLogExecution('DEBUG', 'Catch', e);}
	}

//Now do re-calc
var results = nlapiSearchRecord("customrecord_amazon_settlement_summary",null,
		[
		   ["custrecord_amz_settle_summary_recalc","is","T"]
		], 
		[
		   new nlobjSearchColumn("internalid").setSort(false), 
		]
		);

for(var x in results)
{
var ordTotal = 0;
var refTotal = 0;
var othTotal = 0;
var total = 0;

var id = results[x].getId();
  
var lineResults = nlapiSearchRecord("customrecord_amazon_settlement",null,
  	    [
		   ["custrecord_amazon_settlement_summary","anyof",id]
		], 
		[
		   new nlobjSearchColumn("custrecord_amazon_settlement_summary",null,"GROUP"), 
		   new nlobjSearchColumn("formulanumeric", null,"SUM").setFormula("CASE WHEN ({custrecord_settlement_tran_type} = 'Order' AND {custrecord_amazon_settlement_marketplace} != 'Non-Amazon') THEN {custrecord_settlement_amount} ELSE 0 END"), 
		   new nlobjSearchColumn("formulanumeric", null,"SUM").setFormula("CASE WHEN {custrecord_settlement_tran_type} = 'Refund' THEN {custrecord_settlement_amount} ELSE 0 END"), 
		   new nlobjSearchColumn("formulanumeric", null,"SUM").setFormula("CASE WHEN (({custrecord_settlement_tran_type} = 'Refund'  OR {custrecord_settlement_tran_type} = 'Order' OR {custrecord_settlement_amt_desc} = 'Previous Reserve Amount Balance') AND {custrecord_amazon_settlement_marketplace} != 'Non-Amazon') THEN 0 ELSE {custrecord_settlement_amount} END"), 
		   new nlobjSearchColumn("custrecord_settlement_amount",null,"SUM")
		]
		);
  
columns = lineResults[0].getAllColumns();
ordTotal = lineResults[0].getValue(columns[1]);
refTotal = lineResults[0].getValue(columns[2]);
othTotal = lineResults[0].getValue(columns[3]);
total = lineResults[0].getValue(columns[4]);

nlapiSubmitField('customrecord_amazon_settlement_summary', id, 'custrecord_amz_settle_summary_tot_pays', ordTotal);
nlapiSubmitField('customrecord_amazon_settlement_summary', id, 'custrecord_amz_settle_summary_refunds', refTotal);
nlapiSubmitField('customrecord_amazon_settlement_summary', id, 'custrecord_amz_settle_summary_tot_charge', othTotal);
nlapiSubmitField('customrecord_amazon_settlement_summary', id, 'custrecord_amz_settle_summary_total', total);
nlapiSubmitField('customrecord_amazon_settlement_summary', id, 'custrecord_amz_settle_summary_recalc', 'F');
}
}