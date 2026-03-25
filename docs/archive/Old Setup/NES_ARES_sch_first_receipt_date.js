/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       14 Jan 2020     Steve
 *
 */

/**
 * @param {String} type Context Types: scheduled, ondemand, userinterface, aborted, skipped
 * @returns {Void}
 */
function scheduled(type) {
  var context = nlapiGetContext();
  var loc = context.getSetting('SCRIPT', 'custscript_rcpt_location');
  var itmField = context.getSetting('SCRIPT', 'custscript_first_receipt_field');
  var itemFieldFitler = 'item.' + itmField;
	var results = nlapiSearchRecord("itemreceipt",null,
[
   ["type","anyof","ItemRcpt"], 
   "AND", 
   ["mainline","is","F"], 
      "AND", 
      ["location","anyof", loc], 
      "AND", 
      [[itemFieldFitler,"isempty",""],"OR",["datecreated","within","yesterday"]]
], 
[
   new nlobjSearchColumn("item",null,"GROUP"), 
   new nlobjSearchColumn("trandate",null,"MAX"), 
   new nlobjSearchColumn("trandate",null,"MIN"), 
   new nlobjSearchColumn("type","item","MAX")
]
			);

	for(var x in results){
		var item = results[x].getValue("item",null,"GROUP");
		var lastDate = results[x].getValue("trandate",null,"MAX");
        var firstDate = results[x].getValue("trandate",null,"MIN");
	    var type = results[x].getValue("type","item","MAX");
	    if(type.indexOf('Non') != '-1'){var itemType = 'noninventoryitem';}
	    else
	    {var itemType = 'inventoryitem';}
	    var itemFirstDate = nlapiLookupField('item', item, itmField);
	    if(itemFirstDate == '' || itemFirstDate == null)
		{nlapiSubmitField(itemType, item, itmField, firstDate);}
		
	   nlapiSubmitField(itemType, item, 'custitem_last_receipt_date', lastDate);
	}
  
var soResults = nlapiSearchRecord("salesorder",null,
[
   ["type","anyof","SalesOrd"], 
   "AND", 
   ["mainline","is","T"], 
   "AND", 
   ["custbody_total_mcf_fees","equalto","0"], 
   "AND", 
   ["memomain","isnot","VOID"]
], 
[
   new nlobjSearchColumn("internalid"), 

]
);
  
  for(var y in soResults)
    {
      try{
      var rec = nlapiLoadRecord('salesorder', soResults[y].getId());
      nlapiSubmitRecord(rec);
      } catch(e){nlapiLogExecution('ERROR', 'Catch', e.message);}
    }
}
