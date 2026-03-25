/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 */
define(['N/error', 'N/https', 'N/log', 'N/record', 'N/search', 'N/transaction', 'N/url', 'N/file', 'N/encode', 'N/task', 'N/runtime', 'N/format', 'N/email'],
    /**
     * @param {error} error
     * @param {https} https
     * @param {log} log
     * @param {record} record
     * @param {search} search
     * @param {transaction} transaction
     * @param {url} url
     */
    function (error, https, log, record, search, transaction, url, file, encode, task, runtime, format, email) {

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
            var invUrl = 'https://sellingpartnerapi-na.amazon.com/fba/inventory/v1/summaries/?details=true&granularityType=Marketplace&granularityId=ATVPDKIKX0DER&marketplaceIds=ATVPDKIKX0DER';
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
            else {            log.debug({
                title: 'Body',
                details: tokenResp.body
            }); return;}
            var itemSearchObj = search.create({
                type: "item",
                filters:
                    [
                        ["custitem_status", "anyof", "5", "12", "4", "11"]
                    ],
                columns:
                    [
                        search.createColumn({ name: "internalid", label: "Internal ID" }),
                        search.createColumn({ name: "itemid", label: "Name" }),
                        search.createColumn({ name: "vendorname", label: "Vendor Name" }),
                        search.createColumn({
                            name: "internalid",
                            join: "CUSTRECORD_INVENTORY_ITEM_RECORD",
                            label: "Internal ID"
                        })
                    ]
            });

            itemSearchObj.run().each(function (result) {
                try {
                    var recId = result.getValue({ name: "internalid" });
                    var skuName = result.getValue({ name: "vendorname" });
                    var amzRecid = result.getValue({ name: "internalid", join: "CUSTRECORD_INVENTORY_ITEM_RECORD" });

                    var invResp = https.request({
                        method: https.Method.GET,
                        url: invUrl + '&sellerSkus=' + skuName,
                        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'x-amz-access-token': accessToken }
                    });

                    var icode = invResp.code;
                    var ibody = invResp.body;
                    if (icode == '200') {
                        var respObj = JSON.parse(ibody);
                        var payload = respObj['payload'];
                        var summary = payload.inventorySummaries;
                        var totQty = summary[0].totalQuantity;
                        var asin = summary[0].asin;
                        var invDetails = summary[0].inventoryDetails;
                        var avlQty = invDetails.fulfillableQuantity;

                        if (amzRecid != '' && amzRecid != null) {
                            record.submitFields({
                                type: 'customrecord_amazon_inventory_on_hand',
                                id: amzRecid,
                                values: {
                                    custrecord_inventory_on_hand_total: totQty,
                                    custrecord_quantity_available: avlQty
                                }
                            });
                        }
                        else {
                            var invRec = record.create({
                                type: 'customrecord_amazon_inventory_on_hand'
                            });
                            invRec.setValue({
                                fieldId: 'name',
                                value: skuName
                            });
                            invRec.setValue({
                                fieldId: 'custrecord_inventory_on_hand_total',
                                value: totQty
                            });
                            invRec.setValue({
                                fieldId: 'custrecord_quantity_available',
                                value: avlQty
                            });
                            invRec.setValue({
                                fieldId: 'custrecord_inventory_item_record',
                                value: recId
                            });
                            invRec.setValue({
                                fieldId: 'custrecord_inventory_on_hand_asin',
                                value: asin
                            });
                            invRec.save();
                        }
                    }

                } catch (e) {
                    log.debug({
                        title: 'R2 Error',
                        details: e
                    });
                }
                return true;
            });



        }




        return {
            execute: execute
        };

    });