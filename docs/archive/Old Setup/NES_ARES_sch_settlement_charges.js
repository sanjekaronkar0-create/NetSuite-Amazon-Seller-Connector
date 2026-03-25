/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       16 Apr 2020     Steve
 *
 */

/**
 * @param {String} type Context Types: scheduled, ondemand, userinterface, aborted, skipped
 * @returns {Void}
 */
function scheduled(type) {

var context = nlapiGetContext();
var debitAcct = '649';
var results = nlapiSearchRecord("customrecord_amazon_settlement_summary",null,
		[
		   ["formulanumeric: CASE WHEN {custrecord_amz_settle_summary_exp_total} = {custrecord_amz_settle_summary_total} THEN '1' ELSE '0' END","equalto","1"], 
		   "AND", 
		   ["custrecord_amz_settle_summary_no_je","is","F"], 
		   "AND", 
		   ["custrecord_amz_settle_summary_je","anyof","@NONE@"], 
		   "AND", 
		   ["custrecord_amz_settle_summary_tot_charge","notequalto","0.00"]
		],
		[
		   new nlobjSearchColumn("scriptid").setSort(false), 
		   new nlobjSearchColumn("custrecord_amz_settlle_summary_id"), 
		   new nlobjSearchColumn("custrecord_amz_settle_summary_tot_pays"), 
		   new nlobjSearchColumn("custrecord_amz_settle_summary_refunds"), 
		   new nlobjSearchColumn("custrecord_amz_settle_summary_tot_charge"), 
		   new nlobjSearchColumn("custrecord_amz_settle_summary_total"), 
		   new nlobjSearchColumn("custrecord_amz_settle_summary_start"), 
		   new nlobjSearchColumn("custrecord_amz_settle_summary_end"), 
		   new nlobjSearchColumn("custrecord_amz_settle_summary_deposit"), 
		   new nlobjSearchColumn("custrecord_amz_settle_summary_currency")
		]
		);

for (var x in results)
	{
   try{
     var jeArr = [];
	var id = results[x].getId();
	var settleId = results[x].getValue('custrecord_amz_settlle_summary_id');
	var currency = results[x].getValue('custrecord_amz_settle_summary_currency');
	if(currency == 'USD')
		{currency = '1';}
	if(currency == 'CAD')
		{currency = '3';}
	if(currency == 'MXN')
		{currency = '5';}
	
	var chargeResults = nlapiSearchRecord("customrecord_amazon_settlement",null,
			[
			   ["custrecord_amazon_settlement_summary","anyof", id], 
			   "AND", 
			   [[["custrecord_settlement_tran_type","isnot","Order"],"AND",["custrecord_settlement_tran_type","isnot","Refund"]],"OR",["custrecord_amazon_settlement_marketplace","is","Non-Amazon"]], 
			   "AND", 
			   ["custrecord_settlement_amt_desc","isnotempty",""],
      			   "AND", 
			   ["custrecord_settlement_amount","notequalto","0.00"]
			], 
			[
			   new nlobjSearchColumn("custrecord_amazon_settlement_marketplace",null,"GROUP"), 
			   new nlobjSearchColumn("custrecord_settlement_amt_desc",null,"GROUP"), 
			   new nlobjSearchColumn("formulatext",null,"GROUP").setFormula("TO_CHAR({custrecord_settlement_post_date_convert}, 'MONTH, YYYY')"), 
			   new nlobjSearchColumn("custrecord_settlement_post_date_convert",null,"MAX").setSort(false), 
			   new nlobjSearchColumn("custrecord_settlement_amount",null,"SUM"), 
			   new nlobjSearchColumn("custrecord_settlement_amount_type",null,"GROUP")
			]
			);
	

var jeRec = nlapiCreateRecord('journalentry');
jeRec.setFieldValue('currency', currency);
jeRec.setFieldValue('memo', 'Other Charges for Settlement : ' + settleId);
jeRec.setFieldValue('custbody_amz_settlement_id', settleId);


var total = 0;
var mth = '';
var prvMth = '';
for(var y = 0; y < chargeResults.length; y++)
	{
	var columns = chargeResults[y].getAllColumns();
    var amt = chargeResults[y].getValue(columns[4]);
	if(amt == 0){continue;}
	var market = chargeResults[y].getValue(columns[0]);
	var desc = chargeResults[y].getValue(columns[1]);
    nlapiLogExecution('DEBUG', 'Desc', desc);
	mth = chargeResults[y].getValue(columns[2]);
	if(y == 0)
		{jeRec.setFieldValue('trandate', chargeResults[y].getValue(columns[3]));}
	if(mth != prvMth && y !=0)
		{
		jeRec.selectNewLineItem('line');
		jeRec.setCurrentLineItemValue('line', 'account', debitAcct);
	    jeRec.setCurrentLineItemValue('line', 'debit', total);
		jeRec.setCurrentLineItemValue('line', 'memo', 'Cash - ' + settleId);
		jeRec.commitLineItem('line');
		
		var jeId = nlapiSubmitRecord(jeRec);
		jeArr.push(jeId);
		
		total = 0;
		var jeRec = nlapiCreateRecord('journalentry');
		jeRec.setFieldValue('currency', currency);
		jeRec.setFieldValue('memo', 'Other Charges for Settlement : ' + settleId);
		jeRec.setFieldValue('custbody_amz_settlement_id', settleId);
		jeRec.setFieldValue('trandate', chargeResults[y].getValue(columns[3]));
		}
	
	prvMth = mth;
	var amt = chargeResults[y].getValue(columns[4]);

	var amtType = chargeResults[y].getValue(columns[5]);
	if(amtType == 'Cost of Advertising' || amtType == 'CouponRedemptionFee')
	{
	desc = amtType;
	}
	
	if(amt == 0)
		{continue;}
	
	total = Number(total) + Number(amt);
	total = total.toFixed(2);
	
	if(market == 'Non-Amazon'){desc = 'AMAZON FBA FEES (WEBSITE)';}
    nlapiLogExecution('DEBUG', 'Desc', desc);
	var acct = lookupAcct(desc, currency);
    nlapiLogExecution('DEBUG', 'Acct', acct);
	jeRec.selectNewLineItem('line');
	jeRec.setCurrentLineItemValue('line', 'account', acct);
    jeRec.setCurrentLineItemValue('line', 'credit', amt);
	jeRec.setCurrentLineItemValue('line', 'memo', desc + '- ' + settleId);
	jeRec.commitLineItem('line');
	}

jeRec.selectNewLineItem('line');
jeRec.setCurrentLineItemValue('line', 'account', debitAcct);
jeRec.setCurrentLineItemValue('line', 'debit', total);
jeRec.setCurrentLineItemValue('line', 'memo', 'Cash - ' + settleId);
jeRec.commitLineItem('line');

var jeId = nlapiSubmitRecord(jeRec);
jeArr.push(jeId);
nlapiSubmitField('customrecord_amazon_settlement_summary', id, 'custrecord_amz_settle_summary_je', jeArr);
    } catch(e) {nlapiLogExecution('ERROR', 'Catch', e.message);}
	}

}


function lookupAcct(item, currency) {
	var results = nlapiSearchRecord("customrecord_amazon_other_charge",null,
[
   ["name","is", item], 
   "AND", 
   [["custrecord_amz_other_charge_currency","anyof", currency],"OR",["custrecord_amz_other_charge_currency","anyof","@NONE@"]]
], 
			[
			   new nlobjSearchColumn("custrecord_amz_other_charge_acct")
			]
			);

	if(results){return results[0].getValue("custrecord_amz_other_charge_acct");}
	else
		{nlapiLogExecution('DEBUG', 'No Acct Found', item);
          if(currency == '1'){return '230';}
          if(currency == '3'){return '580';}
          if(currency == '5'){return '581';}
          
          return null;}
	}