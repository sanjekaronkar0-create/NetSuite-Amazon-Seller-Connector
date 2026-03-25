/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       18 May 2020     Steve
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

function userEventBeforeSubmit(type) {
	var recType = nlapiGetRecordType();
	var createFrom = nlapiGetFieldText('createdfrom');
	if (recType == 'itemreceipt') {
		var totCbm = 0;
		var lines = nlapiGetLineItemCount('item');
		for (var y = 1; y <= lines; y++) {
			var item = nlapiGetLineItemValue('item', 'item', y);

			if (createFrom.indexOf('Transfer') != '-1') {
				var qty = nlapiGetLineItemValue('item', 'quantity', y);
				var h = ifNull(nlapiLookupField('item', item, 'custitem_master_height_2'));
				var w = ifNull(nlapiLookupField('item', item, 'custitem_master_width_2'));
				var l = ifNull(nlapiLookupField('item', item, 'custitem_master_length_2'));
				var master = ifNull(nlapiLookupField('item', item, 'custitem_master_quantity_2'));
				if (master == '') { master = 1; }
				var masterQty = qty / master;

				var cbm = h * l * w * 0.000016387064;

				var totLineCbm = cbm * masterQty;
				nlapiSelectLineItem('item', y);
				nlapiSetCurrentLineItemValue('item', 'custcol_line_cbm', totLineCbm);
				nlapiCommitLineItem('item', y);
				totCbm = Number(totCbm) + Number(totLineCbm);
			}
		}
		nlapiSetFieldValue('custbody_total_receipt_cbm', totCbm);
	}
}

function userEventAfterSubmit(type) {
	var context = nlapiGetContext();
	var mpfCap = context.getSetting('SCRIPT', 'custscript_mpf_cap');
	var totMpfDuty = 0;
	var mpfDuty = 0;
	try {
		if (type != 'delete') {
			var id = nlapiGetRecordId();
			var recType = nlapiGetRecordType();
			nlapiLogExecution('DEBUG', 'Type', recType);
			var rec = nlapiLoadRecord(recType, id);
			var totCbm = 0;
			if (recType == 'inboundshipment' && context.getExecutionContext() != 'scheduled') {
				var domestic = rec.getFieldValue('custrecord_domestic_shipment');

				var lines = rec.getLineItemCount('items');
				if (lines > 30) {
					var params = [];
					params['custscript_ship_id'] = id;
					nlapiScheduleScript('customscript_nes_ares_sch_landcost', null, params);
					return;
				}

				var totCustom = 0;
				var totGst = 0;
				for (var x = 1; x <= lines; x++) {
					var item = rec.getLineItemValue('items', 'itemid', x);
					nlapiLogExecution('DEBUG', 'Item', item);
					var qty = rec.getLineItemValue('items', 'quantityexpected', x);
					var amt = rec.getLineItemValue('items', 'porate', x);
					var lineAmt = rec.getLineItemValue('items', 'shipmentitemamount', x);
					var h = ifNull(nlapiLookupField('item', item, 'custitem_master_height_2'));
					var w = ifNull(nlapiLookupField('item', item, 'custitem_master_width_2'));
					var l = ifNull(nlapiLookupField('item', item, 'custitem_master_length_2'));
					var loc = rec.getLineItemValue('items', 'receivinglocation', x);
					if (loc == '10') { var duty = ifNull(nlapiLookupField('item', item, 'custitem_duty_ca')); }
					else { var duty = ifNull(nlapiLookupField('item', item, 'custitem_dutypct')); }
					var tarriff = ifNull(nlapiLookupField('item', item, 'custitem_tarriff'));
					if (tarriff == '') { tarriff = 0; }
					rec.setLineItemValue('items', 'custrecord_total_duty_percent', x, duty);
					if (duty == '') { duty = .001250; }
					else { duty = (parseFloat(duty) + Number(.1250) + parseFloat(tarriff)) * .01; }
					if (loc != '10') {
						mpfDuty = .003464 * qty * amt;
						if (totMpfDuty > mpfCap) {
							mpfDuty = 0;
						}
						else {
							totMpfDuty = Number(totMpfDuty) + Number(mpfDuty);
							if (totMpfDuty > mpfCap) {
								mpfDuty = Number(mpfDuty) - Number(Number(totMpfDuty) - Number(mpfCap));

							}
						}
					}
					var lineCustom = Number(qty * duty * amt) + Number(mpfDuty);
					totCustom = Number(totCustom) + Number(lineCustom);
					if (loc == '10') {
						var lineGst = (Number(lineCustom) + Number(lineAmt)) * .05;
						rec.setLineItemValue('items', 'custrecord_ibs_line_gst', x, lineGst.toFixed(2));
						totGst = Number(totGst) + Number(lineGst);
					}
					var master = ifNull(nlapiLookupField('item', item, 'custitem_master_quantity_2'));
					if (master == '') { master = 1; }
					var masterQty = qty / master;

					var cbm = h * l * w * 0.000016387064;

					var totLineCbm = cbm * masterQty;
					rec.setLineItemValue('items', 'custrecord_master_cart_cbm', x, cbm.toFixed(4));
					rec.setLineItemValue('items', 'custrecord_total_line_cbm', x, totLineCbm.toFixed(4));
					rec.setLineItemValue('items', 'custrecord_estimated_customs', x, lineCustom.toFixed(4));
					totCbm = Number(totCbm) + Number(totLineCbm);
				}
				rec.setFieldValue('custrecord_total_cbm', totCbm.toFixed(4));
				rec.setFieldValue('custrecord_total_customs', totCustom.toFixed(4));
				rec.setFieldValue('custrecord_total_gst', totGst.toFixed(2));
			}//end if shipment

			if (recType == 'itemreceipt' && type != 'delete') {
				var recLocation = rec.getFieldValue('location');
				var lines = rec.getLineItemCount('item');
				for (var y = 1; y <= lines; y++) {
					var item = rec.getLineItemValue('item', 'item', y);
					var costResults = nlapiSearchRecord("inboundshipment", null,
						[
							["itemreceipt.internalidnumber", "equalto", id],
							"AND",
							["item", "anyof", item]
						],
						[
							new nlobjSearchColumn("formulacurrency").setFormula("{custrecord_actual_freight_charges}+{custrecord_actual_destination_charges}+{custrecord_origin_costs_actual}+{custrecord_customs_cost_actual}"),
							new nlobjSearchColumn("formulacurrency").setFormula("(NVL({custrecord_quoted_freight_charges}, '0') + NVL({custrecord_quoted_destination_charges}, '0') +NVL({custrecord_origin_cost_quote}, '0') + NVL({custrecord_customs_cost_quote}, '0'))*({inboundshipmentitem.custrecord_total_line_cbm}/{custrecord_total_cbm})"),
							new nlobjSearchColumn("formulacurrency").setFormula("{porate}*({item.custitem_dutypct} + .001250)*{itemreceipt.quantity}"),
							new nlobjSearchColumn("formulacurrency").setFormula("{porate}*.003464*{itemreceipt.quantity}"),
							new nlobjSearchColumn("formulacurrency").setFormula("{porate}*.035*{itemreceipt.quantity}"),
							new nlobjSearchColumn("custrecord_flexport_link"),
							new nlobjSearchColumn("externaldocumentnumber"),
							new nlobjSearchColumn("custrecord_estimated_customs", "inboundShipmentItem", null),
							new nlobjSearchColumn("custrecord_domestic_shipment"),
							new nlobjSearchColumn("custrecord_ibs_line_gst", "inboundShipmentItem", null),
							new nlobjSearchColumn("receivinglocation")

						]
					);

					if (costResults) {
						nlapiLogExecution('DEBUG', 'Cost Results');
						var columns = costResults[0].getAllColumns();
						var lineCost = costResults[0].getValue(columns[1]);
						var domestic = costResults[0].getValue('custrecord_domestic_shipment');
						var duty = costResults[0].getValue("custrecord_estimated_customs", "inboundShipmentItem");
						var link = costResults[0].getValue('custrecord_flexport_link');
						var docNum = costResults[0].getValue('externaldocumentnumber');
						var whCost = costResults[0].getValue(columns[4]);
						var gst = costResults[0].getValue("custrecord_ibs_line_gst", "inboundShipmentItem");
						var location = costResults[0].getValue('receivinglocation');
						rec.setFieldValue('memo', docNum);
						rec.setFieldValue('custbody_flexport', link);
						rec.selectLineItem('item', y);
						var lc = rec.editCurrentLineItemSubrecord('item', 'landedcost');
						if (lc == '' || lc == null) {
							var lc = rec.createCurrentLineItemSubrecord('item', 'landedcost');
							lc.selectNewLineItem('landedcostdata');
							lc.setCurrentLineItemValue('landedcostdata', 'costcategory', '2');
							lc.setCurrentLineItemValue('landedcostdata', 'amount', lineCost);
							lc.commitLineItem('landedcostdata');

							if (domestic == 'F') {
								lc.selectNewLineItem('landedcostdata');
								lc.setCurrentLineItemValue('landedcostdata', 'costcategory', '1');
								lc.setCurrentLineItemValue('landedcostdata', 'amount', duty);
								lc.commitLineItem('landedcostdata');
							}

							lc.selectNewLineItem('landedcostdata');
							lc.setCurrentLineItemValue('landedcostdata', 'costcategory', '4');
							lc.setCurrentLineItemValue('landedcostdata', 'amount', whCost);
							lc.commitLineItem('landedcostdata');

							if (location == '10') {
								lc.selectNewLineItem('landedcostdata');
								lc.setCurrentLineItemValue('landedcostdata', 'costcategory', '5');
								lc.setCurrentLineItemValue('landedcostdata', 'amount', gst);
								lc.commitLineItem('landedcostdata');
							}
							lc.commit();
						}
						else {
							var tranLine = lc.findLineItemValue('landedcostdata', 'costcategory', '2');
							if (tranLine == '-1') {
								lc.selectNewLineItem('landedcostdata');
								lc.setCurrentLineItemValue('landedcostdata', 'costcategory', '2');
								lc.setCurrentLineItemValue('landedcostdata', 'amount', lineCost);
								lc.commitLineItem('landedcostdata');
							}
							else {
								lc.selectLineItem('landedcostdata', tranLine);
								lc.setCurrentLineItemValue('landedcostdata', 'amount', lineCost);
								lc.commitLineItem('landedcostdata');
							}

							if (domestic == 'F') {
								var dutyLine = lc.findLineItemValue('landedcostdata', 'costcategory', '1');
								if (dutyLine == '-1') {
									lc.selectNewLineItem('landedcostdata');
									lc.setCurrentLineItemValue('landedcostdata', 'costcategory', '1');
									lc.setCurrentLineItemValue('landedcostdata', 'amount', duty);
									lc.commitLineItem('landedcostdata');
								}
								else {
									lc.selectLineItem('landedcostdata', dutyLine);
									lc.setCurrentLineItemValue('landedcostdata', 'amount', duty);
									lc.commitLineItem('landedcostdata');
								}
							}

							var whLine = lc.findLineItemValue('landedcostdata', 'costcategory', '4');
							if (whLine == '-1') {
								lc.selectNewLineItem('landedcostdata');
								lc.setCurrentLineItemValue('landedcostdata', 'costcategory', '4');
								lc.setCurrentLineItemValue('landedcostdata', 'amount', whCost);
								lc.commitLineItem('landedcostdata');
							}
							else if (whLine != '-1') {
								lc.selectLineItem('landedcostdata', whLine);
								lc.setCurrentLineItemValue('landedcostdata', 'amount', whCost);
								lc.commitLineItem('landedcostdata');
							}
							if (location == '10') {
								var gstLine = lc.findLineItemValue('landedcostdata', 'costcategory', '5');
								if (gstLine == '-1') {
									lc.selectNewLineItem('landedcostdata');
									lc.setCurrentLineItemValue('landedcostdata', 'costcategory', '5');
									lc.setCurrentLineItemValue('landedcostdata', 'amount', gst);
									lc.commitLineItem('landedcostdata');
								}
								else if (gstLine != '-1') {
									lc.selectLineItem('landedcostdata', gstLine);
									lc.setCurrentLineItemValue('landedcostdata', 'amount', gst);
									lc.commitLineItem('landedcostdata');
								}
							}
							lc.commit();

						}
						rec.commitLineItem('item');
					}
				}


			}

			nlapiSubmitRecord(rec);
		}
	} catch (e) { nlapiLogExecution('ERROR', 'catch', e.message); }
}



function scheduled() {

	var context = nlapiGetContext();
	var mpfCap = context.getSetting('SCRIPT', 'custscript_mpf_cap');
	var id = context.getSetting('SCRIPT', 'custscript_ship_id');
	var totMpfDuty = 0;
	var mpfDuty = 0;
	var recType = 'inboundshipment';
	var rec = nlapiLoadRecord(recType, id);
	var domestic = rec.getFieldValue('custrecord_domestic_shipment');
	if (domestic == 'T') { return; }
	var totCbm = 0;
	var lines = rec.getLineItemCount('items');

	var totCustom = 0;
	var totGst = 0;
	for (var x = 1; x <= lines; x++) {
		var item = rec.getLineItemValue('items', 'itemid', x);
		var qty = rec.getLineItemValue('items', 'quantityexpected', x);
		var amt = rec.getLineItemValue('items', 'porate', x);
		var lineAmt = rec.getLineItemValue('items', 'shipmentitemamount', x);
		var h = ifNull(nlapiLookupField('item', item, 'custitem_master_height_2'));
		var w = ifNull(nlapiLookupField('item', item, 'custitem_master_width_2'));
		var l = ifNull(nlapiLookupField('item', item, 'custitem_master_length_2'));
		var loc = rec.getLineItemValue('items', 'receivinglocation', x);
		if (loc == '10') { var duty = ifNull(nlapiLookupField('item', item, 'custitem_duty_ca')); }
		var duty = ifNull(nlapiLookupField('item', item, 'custitem_dutypct'));
		var tarriff = ifNull(nlapiLookupField('item', item, 'custitem_tarriff'));
		if (tarriff == '') { tarriff = 0; }
		rec.setLineItemValue('items', 'custrecord_total_duty_percent', x, duty);
		if (duty == '') { duty = .001250; }
		else { duty = (parseFloat(duty) + Number(.1250) + parseFloat(tarriff)) * .01; }
		if (loc != '10') {
			mpfDuty = .003464 * qty * amt;
			if (totMpfDuty > mpfCap) {
				mpfDuty = 0;
			}
			else {
				totMpfDuty = Number(totMpfDuty) + Number(mpfDuty);
				if (totMpfDuty > mpfCap) {
					mpfDuty = Number(mpfDuty) - Number(Number(totMpfDuty) - Number(mpfCap));

				}
			}
		}
		var lineCustom = Number(qty * duty * amt) + Number(mpfDuty);
		nlapiLogExecution('DEBUG', 'Line Custom', lineCustom);
		totCustom = Number(totCustom) + Number(lineCustom);
		if (loc == '10') {
			var lineGst = (Number(lineCustom) + Number(lineAmt)) * .05;
			rec.setLineItemValue('items', 'custrecord_ibs_line_gst', x, lineGst.toFixed(2));
			totGst = Number(totGst) + Number(lineGst);
		}
		var master = ifNull(nlapiLookupField('item', item, 'custitem_master_quantity_2'));
		var masterQty = qty / master;


		var cbm = h * l * w * 0.000016387064;

		var totLineCbm = cbm * masterQty;
		rec.setLineItemValue('items', 'custrecord_master_cart_cbm', x, cbm.toFixed(4));
		rec.setLineItemValue('items', 'custrecord_total_line_cbm', x, totLineCbm.toFixed(4));
		rec.setLineItemValue('items', 'custrecord_estimated_customs', x, lineCustom.toFixed(4));
		totCbm = Number(totCbm) + Number(totLineCbm);
	}

	nlapiLogExecution('DEBUG', 'Total CBM', totCbm);
	rec.setFieldValue('custrecord_total_cbm', totCbm.toFixed(4));
	rec.setFieldValue('custrecord_total_customs', totCustom.toFixed(4));
	rec.setFieldValue('custrecord_total_gst', totGst.toFixed(2));

	nlapiSubmitRecord(rec);
}


function ifNull(value) {
	if (value == null) {
		return '';
	}
	else
		return value;
}