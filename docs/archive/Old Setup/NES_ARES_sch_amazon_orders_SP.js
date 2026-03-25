/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 */
define(['N/email', 'N/error', 'N/format', 'N/https', 'N/log', 'N/record', 'N/search', 'N/transaction', 'N/url', 'N/crypto', 'N/encode', 'N/runtime'],
    /**
     * @param {email} email
     * @param {error} error
     * @param {format} format
     * @param {https} https
     * @param {log} log
     * @param {record} record
     * @param {search} search
     * @param {transaction} transaction
     * @param {url} url
     */
    function (email, error, format, https, log, record, search, transaction, url, crypto, encode, runtime) {

        /**
         * Definition of the Scheduled script trigger point.
         *
         * @param {Object} scriptContext
         * @param {string} scriptContext.type - The context in which the script is executed. It is one of the values from the scriptContext.InvocationType enum.
         * @Since 2015.2
         */
        function execute(scriptContext) {
            var me = runtime.getCurrentScript();
            var tokenUrl = 'https://api.amazon.com/auth/o2/token';
            var fulfillUrl = 'https://sellingpartnerapi-na.amazon.com/fba/outbound/2020-07-01/fulfillmentOrders';
            var client_id = me.getParameter({ name: 'custscript_amz_client_id' });
            var client_secret = me.getParameter({ name: 'custscript_amz_client_secret' });
            var refreshToken = me.getParameter({ name: 'custscript_amz_refresh' });
            var grantType = 'refresh_token';
            var details = {
                'client_id': client_id,
                'client_secret': client_secret,
                'refresh_token': refreshToken,
                'grant_type': grantType
            }
            var formBody = [];
            for (var property in details) {
                var encodedKey = encodeURIComponent(property);
                var encodedValue = encodeURIComponent(details[property]);
                formBody.push(encodedKey + "=" + encodedValue);
            }
            formBody = formBody.join("&");

            var tokenResp = https.request({
                method: https.Method.POST,
                url: tokenUrl,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', },
                body: formBody
            });

            var code = tokenResp.code;
            log.debug({
                title: 'Code',
                details: code
            });

            if (code == '200' || code == '201') {
                var body = tokenResp.body;
                var product = JSON.parse(body);
                var accessToken = product['access_token'];
            }
            else { return; }

            var invoiceSearchObj = search.create({
                type: "invoice",
                filters:
                    [
                        ["mainline", "is", "T"],
                        "AND",
                        ["type", "anyof", "CustInvc"],
                        "AND",
                        ["poastext", "contains", "Shopify Order #"],
                        "AND",
                        ["custbody_do_not_send_amz", "is", "F"],
                        "AND",
                        ["custbody_amazon_order_result", "doesnotcontain", "SUCCESS"],
                        "AND",
                        ["custbody_order_source", "is", "Shopify"]
                    ],
                columns:
                    [
                        search.createColumn({ name: "internalid", label: "Internal Id" }),
                        search.createColumn({ name: "otherrefnum", label: "PO/Check Number" }),
                        search.createColumn({ name: "tranid", label: "Document Number" }),
                        search.createColumn({ name: "trandate", label: "Document Number" }),
                        search.createColumn({ name: "shipaddressee", label: "Shipping Addressee" }),
                        search.createColumn({ name: "shipaddress1", label: "Shipping Address 1" }),
                        search.createColumn({ name: "shipaddress2", label: "Shipping Address 2" }),
                        search.createColumn({ name: "shipcity", label: "Shipping City" }),
                        search.createColumn({ name: "shipstate", label: "Shipping State/Province" }),
                        search.createColumn({ name: "shipzip", label: "Shipping Zip" }),
                        search.createColumn({ name: "shipcountrycode", label: "Shipping Country Code" })
                    ]
            });

            var results = invoiceSearchObj.run();
            var resultsSet = results.getRange({ start: 0, end: 1000 });

            for (var x = 0; x < resultsSet.length; x++) {
                try {

                    var recId = resultsSet[x].getValue({ name: "internalid" });
                    var orderNum = resultsSet[x].getValue({ name: "otherrefnum" });
                    var shipName = resultsSet[x].getValue({ name: "shipaddressee" });
                    var shipAddr1 = resultsSet[x].getValue({ name: "shipaddress1" });
                    var shipAddr2 = resultsSet[x].getValue({ name: "shipaddress2" });
                    var shipCity = resultsSet[x].getValue({ name: "shipcity" });
                    var shipState = resultsSet[x].getValue({ name: "shipstate" });
                    var shipCountry = resultsSet[x].getValue({ name: "shipcountrycode" });
                    var shipZip = resultsSet[x].getValue({ name: "shipzip" });
                    var ordDate = convertDate(new Date(resultsSet[x].getValue({ name: "trandate" })));
                    var invRec = record.load({ type: 'invoice', id: recId });
                    var line = invRec.getLineCount({
                        sublistId: 'item'
                    });
                    var lineObj = [];
                    for (var w = 0; w < line; w++) {
                        var sku = invRec.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'item',
                            line: w
                        });
                        if (sku == '340') { continue; }
                        var itemLookup = search.lookupFields({
                            type: 'item',
                            id: sku,
                            columns: ['vendorname']
                        });
                        var skuName = itemLookup.vendorname;

                        var amt = invRec.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'amount',
                            line: w
                        });
                        var qty = invRec.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'quantity',
                            line: w
                        });
                        var lineItemObj = {
                            sellerSku: skuName,
                            sellerFulfillmentOrderItemId: recId + '-' + w,
                            quantity: qty,
                            perUnitDeclaredValue: {
                                "currencyCode": "USD",
                                "value": amt
                            }
                        };

                        lineObj.push(lineItemObj);
                    }
                    var shipAddrObj = {
                        name: shipName,
                        addressLine1: shipAddr1,
                        addressLine2: shipAddr2,
                        city: shipCity,
                        stateOrRegion: shipState,
                        countryCode: shipCountry,
                        postalCode: shipZip
                    }
                    var itemData = lineObj;
                    var amzObj = {
                        sellerFulfillmentOrderId: recId,
                        displayableOrderId: orderNum,
                        displayableOrderDate: ordDate,
                        displayableOrderComment: orderNum,
                        shippingSpeedCategory: "Standard",
                        fulfillmentAction: "Ship",
                        destinationAddress: shipAddrObj,
                        notificationEmails: ["ares@arestool.com"],
                        items: itemData
                    };
                    var ffObjString = JSON.stringify(amzObj);
                    var ffResp = https.request({
                        method: https.Method.POST,
                        url: fulfillUrl,
                        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'x-amz-access-token': accessToken },
                        body: ffObjString
                    });
                    log.debug({
                        title: 'JSON',
                        details: ffObjString
                    });
                    var rcode = ffResp.code;
                    var rbody = ffResp.body;
                    log.debug({
                        title: 'FF Code',
                        details: rcode
                    });
                    if (rcode != '200') {
                        var errors = JSON.parse(rbody);
                        var e = errors['errors'];
                        var details = e[0].message;
                        record.submitFields({
                            type: 'invoice',
                            id: recId,
                            values: {
                                custbody_amazon_order_result: details
                            }
                        });
                    }
                    else {
                        record.submitFields({
                            type: 'invoice',
                            id: recId,
                            values: {
                                custbody_amazon_order_result: "SUCCESS"
                            }
                        });
                    }

                } catch (e) {
                    log.error({
                        title: 'Get Orders',
                        details: e.message
                    });
                }
            }

        }

        function convertDate(date) {
            var m = Number(date.getMonth()) + Number(1);
            var d = date.getDate();
            var y = date.getFullYear();
            if (m < 10) { m = '0' + m; }
            if (d < 10) { d = '0' + d; }
            var newDate = y + "-" + m + "-" + d;
            return newDate;
        }
        return {
            execute: execute
        };

    });