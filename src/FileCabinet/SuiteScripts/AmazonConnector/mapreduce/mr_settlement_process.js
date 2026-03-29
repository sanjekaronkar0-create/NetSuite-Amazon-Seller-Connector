/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @description Map/Reduce script for processing Amazon settlements following the old process flow:
 *              Phase A: Create/link order headers per unique order_id
 *              Phase B: Create invoices + customer payments per order
 *              Phase C: Create credit memos + customer refunds for refund lines
 *              Phase D: Create JEs for other charges grouped by month
 */
define([
    'N/runtime',
    'N/record',
    'N/search',
    'N/format',
    'N/log',
    '../lib/constants',
    '../lib/configHelper',
    '../lib/errorQueue',
    '../lib/logger',
    '../services/financialService'
], function (runtime, record, search, format, log, constants, configHelper, errorQueue, logger,
    financialService) {

    const STL = constants.CUSTOM_RECORDS.SETTLEMENT;
    const SL = constants.CUSTOM_RECORDS.SETTLEMENT_LINE;
    const SH = constants.CUSTOM_RECORDS.SETTLE_HEADER;

    /**
     * Input stage: finds settlements with status = PENDING.
     */
    function getInputData() {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement Process MR getInputData: Searching for PENDING settlements');

        return {
            type: STL.ID,
            filters: [[STL.FIELDS.STATUS, 'anyof', constants.SETTLEMENT_STATUS.PENDING]],
            columns: [
                STL.FIELDS.REPORT_ID,
                STL.FIELDS.CONFIG,
                STL.FIELDS.CURRENCY,
                STL.FIELDS.EXPECTED_TOTAL,
                STL.FIELDS.TOTAL_PAYMENTS,
                STL.FIELDS.TOTAL_REFUNDS,
                STL.FIELDS.TOTAL_OTHER,
                STL.FIELDS.TOTAL_AMOUNT,
                STL.FIELDS.NO_JE,
                STL.FIELDS.DEPOSIT_DATE
            ]
        };
    }

    /**
     * Map stage: emit each settlement keyed by its internal ID.
     */
    function map(context) {
        try {
            var result = JSON.parse(context.value);
            var settlementId = result.id;
            var configId = result.values ? result.values[STL.FIELDS.CONFIG] : null;
            if (configId && typeof configId === 'object') configId = configId.value || configId;

            logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Process MR map: Processing settlement ' + settlementId);

            // Mark as PROCESSING
            record.submitFields({
                type: STL.ID,
                id: settlementId,
                values: { [STL.FIELDS.STATUS]: constants.SETTLEMENT_STATUS.PROCESSING }
            });

            context.write({
                key: settlementId,
                value: JSON.stringify({
                    settlementId: settlementId,
                    configId: configId,
                    reportId: result.values ? result.values[STL.FIELDS.REPORT_ID] : '',
                    currency: result.values ? result.values[STL.FIELDS.CURRENCY] : '',
                    expectedTotal: result.values ? parseFloat(result.values[STL.FIELDS.EXPECTED_TOTAL]) || 0 : 0,
                    totalPayments: result.values ? parseFloat(result.values[STL.FIELDS.TOTAL_PAYMENTS]) || 0 : 0,
                    totalRefunds: result.values ? parseFloat(result.values[STL.FIELDS.TOTAL_REFUNDS]) || 0 : 0,
                    totalOther: result.values ? parseFloat(result.values[STL.FIELDS.TOTAL_OTHER]) || 0 : 0,
                    totalAmount: result.values ? parseFloat(result.values[STL.FIELDS.TOTAL_AMOUNT]) || 0 : 0,
                    noJe: result.values ? result.values[STL.FIELDS.NO_JE] : false,
                    depositDate: result.values ? result.values[STL.FIELDS.DEPOSIT_DATE] : ''
                })
            });
        } catch (e) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Process MR map error: ' + e.message, { details: e.stack });
        }
    }

    /**
     * Reduce stage: orchestrates the old settlement processing flow for each settlement.
     */
    function reduce(context) {
        var settlementId = context.key;
        var data = JSON.parse(context.values[0]);
        var configId = data.configId;
        var reportId = data.reportId;

        try {
            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement Process MR reduce: Starting for settlement ' + settlementId +
                ', report ' + reportId + ', config ' + configId);

            var config = configHelper.getConfig(configId);
            var chargeMap = configHelper.getChargeAccountMap(configId, resolveCurrencyId(data.currency));

            // ================================================================
            // Phase A: Create/Link Order Headers
            // ================================================================
            var headers = phaseA_createOrderHeaders(config, settlementId);

            // ================================================================
            // Phase B: Create Invoices + Payments
            // ================================================================
            phaseB_createInvoicesAndPayments(config, settlementId, reportId, headers, chargeMap);

            // ================================================================
            // Phase C: Create Credit Memos + Refunds
            // ================================================================
            phaseC_createCreditMemosAndRefunds(config, settlementId, reportId, headers, chargeMap);

            // ================================================================
            // Phase D: Create JEs for Other Charges
            // ================================================================
            var journalIds = [];
            var noJe = data.noJe === true || data.noJe === 'T';
            if (!noJe && data.totalOther !== 0) {
                journalIds = phaseD_createChargeJournalEntries(
                    config, settlementId, reportId, data.currency, data.expectedTotal, data.totalAmount, chargeMap
                );
            }

            // ================================================================
            // Mark RECONCILED
            // ================================================================
            financialService.updateSettlementFinancials(settlementId, {
                journalIds: journalIds
            });

            logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement ' + reportId + ' reconciled. ' +
                'Headers: ' + Object.keys(headers).length +
                (journalIds.length ? ', JEs: ' + journalIds.join(',') : ''), {
                configId: configId,
                amazonRef: reportId
            });

        } catch (e) {
            logger.error(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement Process MR reduce error for ' + settlementId + ': ' + e.message, {
                details: e.stack
            });

            try {
                record.submitFields({
                    type: STL.ID,
                    id: settlementId,
                    values: { [STL.FIELDS.STATUS]: constants.SETTLEMENT_STATUS.ERROR }
                });
            } catch (ignore) { /* best effort */ }

            errorQueue.enqueue({
                type: constants.ERROR_QUEUE_TYPE.SETTLEMENT_PROCESS,
                amazonRef: reportId,
                errorMsg: e.message,
                configId: configId,
                payload: JSON.stringify({ settlementId: settlementId })
            });
        }
    }

    // ========================================================================
    // Phase A: Create/Link Order Headers
    // ========================================================================

    /**
     * Groups settlement lines by order_id, creates/finds a settle_header per order.
     * @returns {Object} Map of orderId → { headerId, marketplace, hasOrders, hasRefunds }
     */
    function phaseA_createOrderHeaders(config, settlementId) {
        var headers = {};

        // Search all unprocessed lines for this settlement
        var lineSearch = search.create({
            type: SL.ID,
            filters: [
                [SL.FIELDS.SUMMARY, 'anyof', settlementId],
                'AND',
                [SL.FIELDS.PROCESSED, 'is', 'F']
            ],
            columns: [
                SL.FIELDS.ORDER_ID,
                SL.FIELDS.MARKETPLACE,
                SL.FIELDS.TRAN_TYPE
            ]
        });

        lineSearch.run().each(function (result) {
            var orderId = result.getValue(SL.FIELDS.ORDER_ID) || '';
            if (!orderId) return true;

            var marketplace = result.getValue(SL.FIELDS.MARKETPLACE) || '';
            var tranType = result.getValue(SL.FIELDS.TRAN_TYPE) || '';

            if (!headers[orderId]) {
                headers[orderId] = {
                    headerId: null,
                    marketplace: marketplace,
                    hasOrders: false,
                    hasRefunds: false
                };
            }
            if (tranType === 'Order') headers[orderId].hasOrders = true;
            if (tranType === 'Refund') headers[orderId].hasRefunds = true;

            return true;
        });

        // Create or find header record for each order
        for (var orderId in headers) {
            if (!headers.hasOwnProperty(orderId)) continue;
            var info = headers[orderId];

            try {
                // Search for existing header
                var existing = search.create({
                    type: SH.ID,
                    filters: [
                        [SH.FIELDS.ORDER_ID, 'is', orderId],
                        'AND',
                        [SH.FIELDS.SUMMARY, 'anyof', settlementId]
                    ],
                    columns: ['internalid']
                }).run().getRange({ start: 0, end: 1 });

                if (existing && existing.length > 0) {
                    info.headerId = existing[0].id;
                } else {
                    var rec = record.create({ type: SH.ID });
                    rec.setValue({ fieldId: SH.FIELDS.ORDER_ID, value: orderId });
                    rec.setValue({ fieldId: SH.FIELDS.MARKETPLACE, value: info.marketplace });
                    rec.setValue({ fieldId: SH.FIELDS.CONFIG, value: config.configId });
                    rec.setValue({ fieldId: SH.FIELDS.SUMMARY, value: settlementId });
                    info.headerId = rec.save({ ignoreMandatoryFields: true });
                }

                // Set flags
                var flagUpdates = {};
                if (info.hasOrders) flagUpdates[SH.FIELDS.UPDATE_INV] = true;
                if (info.hasRefunds) flagUpdates[SH.FIELDS.REFUND_REQUIRED] = true;
                if (Object.keys(flagUpdates).length > 0) {
                    record.submitFields({ type: SH.ID, id: info.headerId, values: flagUpdates });
                }
            } catch (e) {
                logger.error(constants.LOG_TYPE.FINANCIAL_RECON,
                    'Phase A: Error creating header for order ' + orderId + ': ' + e.message);
            }
        }

        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'Phase A complete: Created/linked ' + Object.keys(headers).length + ' order headers');

        return headers;
    }

    // ========================================================================
    // Phase B: Create Invoices + Payments
    // ========================================================================

    function phaseB_createInvoicesAndPayments(config, settlementId, reportId, headers, chargeMap) {
        // Search headers where update_inv = T for this settlement
        var headerSearch = search.create({
            type: SH.ID,
            filters: [
                [SH.FIELDS.SUMMARY, 'anyof', settlementId],
                'AND',
                [SH.FIELDS.UPDATE_INV, 'is', 'T']
            ],
            columns: [SH.FIELDS.ORDER_ID, SH.FIELDS.MARKETPLACE, SH.FIELDS.INVOICE_REC]
        });

        headerSearch.run().each(function (result) {
            var headerId = result.id;
            var orderId = result.getValue(SH.FIELDS.ORDER_ID);
            var marketplace = result.getValue(SH.FIELDS.MARKETPLACE) || '';

            try {
                // Skip Non-Amazon marketplace
                if (marketplace === 'Non-Amazon') {
                    record.submitFields({
                        type: SH.ID, id: headerId,
                        values: { [SH.FIELDS.UPDATE_INV]: false }
                    });
                    return true;
                }

                // Get settlement lines for this order
                var orderLines = getSettlementLines(settlementId, orderId, 'Order');
                if (!orderLines || orderLines.length === 0) {
                    record.submitFields({
                        type: SH.ID, id: headerId,
                        values: { [SH.FIELDS.UPDATE_INV]: false }
                    });
                    return true;
                }

                // Check for existing invoice
                var existingInvId = null;
                try {
                    var invLookup = search.lookupFields({
                        type: SH.ID, id: headerId,
                        columns: [SH.FIELDS.INVOICE_REC]
                    });
                    var invVal = invLookup[SH.FIELDS.INVOICE_REC];
                    if (Array.isArray(invVal) && invVal.length > 0) existingInvId = invVal[0].value;
                    else if (invVal) existingInvId = invVal;
                } catch (ignore) { }

                if (!existingInvId) {
                    existingInvId = financialService.lookupInvoice(orderId);
                }

                var invoiceId, paymentTotal;
                if (existingInvId) {
                    invoiceId = existingInvId;
                    paymentTotal = 0;
                    for (var i = 0; i < orderLines.length; i++) {
                        paymentTotal += parseFloat(orderLines[i].amount) || 0;
                    }
                } else {
                    var result2 = financialService.createSettlementInvoice(
                        config, orderId, orderLines, marketplace, chargeMap
                    );
                    invoiceId = result2.invoiceId;
                    paymentTotal = result2.paymentTotal;
                }

                // Create customer payment
                var paymentId = null;
                if (invoiceId && paymentTotal) {
                    var firstLine = orderLines[0] || {};
                    var settlement = {
                        reportId: reportId,
                        totalAmount: paymentTotal,
                        endDate: firstLine.postDateNs || new Date()
                    };
                    paymentId = financialService.createSettlementPayment(
                        config, invoiceId, settlement, firstLine.postDateNs
                    );
                }

                // Mark order lines as processed
                markLinesProcessed(orderLines);

                // Update header
                var headerUpdates = {
                    [SH.FIELDS.UPDATE_INV]: false,
                    [SH.FIELDS.DATA_LOADED]: false,
                    [SH.FIELDS.ERROR]: ''
                };
                if (invoiceId) headerUpdates[SH.FIELDS.INVOICE_REC] = invoiceId;
                if (paymentId) headerUpdates[SH.FIELDS.PAYMENT_REC] = String(paymentId);
                if (config.customer) headerUpdates[SH.FIELDS.CUSTOMER] = config.customer;
                record.submitFields({ type: SH.ID, id: headerId, values: headerUpdates });

                logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                    'Phase B: Invoice ' + invoiceId + ', Payment ' + (paymentId || 'none') +
                    ' for order ' + orderId);

            } catch (e) {
                logger.error(constants.LOG_TYPE.FINANCIAL_RECON,
                    'Phase B: Error for order ' + orderId + ': ' + e.message);
                try {
                    record.submitFields({
                        type: SH.ID, id: headerId,
                        values: { [SH.FIELDS.ERROR]: e.message }
                    });
                } catch (ignore) { }
            }

            return true;
        });
    }

    // ========================================================================
    // Phase C: Create Credit Memos + Refunds
    // ========================================================================

    function phaseC_createCreditMemosAndRefunds(config, settlementId, reportId, headers, chargeMap) {
        var headerSearch = search.create({
            type: SH.ID,
            filters: [
                [SH.FIELDS.SUMMARY, 'anyof', settlementId],
                'AND',
                [SH.FIELDS.REFUND_REQUIRED, 'is', 'T']
            ],
            columns: [SH.FIELDS.ORDER_ID, SH.FIELDS.MARKETPLACE]
        });

        headerSearch.run().each(function (result) {
            var headerId = result.id;
            var orderId = result.getValue(SH.FIELDS.ORDER_ID);
            var marketplace = result.getValue(SH.FIELDS.MARKETPLACE) || '';

            try {
                var refundLines = getSettlementLines(settlementId, orderId, 'Refund');
                if (!refundLines || refundLines.length === 0) {
                    record.submitFields({
                        type: SH.ID, id: headerId,
                        values: { [SH.FIELDS.REFUND_REQUIRED]: false, [SH.FIELDS.ERROR]: '' }
                    });
                    return true;
                }

                // Create credit memo
                var creditMemoId = financialService.createSettlementCreditMemo(
                    config, orderId, refundLines, marketplace, chargeMap
                );

                // Create customer refund
                var refundId = null;
                if (creditMemoId) {
                    var settlId = refundLines[0] ? refundLines[0].settlementId : reportId;
                    refundId = financialService.createSettlementRefund(config, creditMemoId, settlId);
                }

                // Mark refund lines as processed
                markLinesProcessed(refundLines);

                // Update header
                var headerUpdates = {
                    [SH.FIELDS.REFUND_REQUIRED]: false,
                    [SH.FIELDS.ERROR]: ''
                };
                if (creditMemoId) headerUpdates[SH.FIELDS.CREDIT_MEMO] = creditMemoId;
                if (refundId) headerUpdates[SH.FIELDS.REFUND] = refundId;
                record.submitFields({ type: SH.ID, id: headerId, values: headerUpdates });

                logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                    'Phase C: CM ' + creditMemoId + ', Refund ' + (refundId || 'none') +
                    ' for order ' + orderId);

            } catch (e) {
                logger.error(constants.LOG_TYPE.FINANCIAL_RECON,
                    'Phase C: Error for order ' + orderId + ': ' + e.message);
                try {
                    record.submitFields({
                        type: SH.ID, id: headerId,
                        values: { [SH.FIELDS.ERROR]: e.message }
                    });
                } catch (ignore) { }
            }

            return true;
        });
    }

    // ========================================================================
    // Phase D: Create JEs for Other Charges (grouped by month)
    // ========================================================================

    /**
     * Replicates NES_ARES_sch_settlement_charges.js logic:
     * Creates one JE per posting month for non-Order/Refund charges.
     */
    function phaseD_createChargeJournalEntries(config, settlementId, reportId, currency, expectedTotal, totalAmount, chargeMap) {
        var jeIds = [];

        // Check trigger conditions (like old process)
        if (expectedTotal && totalAmount && parseFloat(expectedTotal) !== parseFloat(totalAmount)) {
            logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                'Phase D: Expected total (' + expectedTotal + ') != actual total (' + totalAmount +
                ') for settlement ' + reportId + '. Skipping JE creation.');
            return jeIds;
        }

        // Check if JEs already exist
        var existingJournals = search.lookupFields({
            type: STL.ID, id: settlementId,
            columns: [STL.FIELDS.NS_JOURNALS]
        });
        var nsJournals = existingJournals[STL.FIELDS.NS_JOURNALS] || '';
        if (nsJournals && String(nsJournals).trim() !== '') {
            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'Phase D: JEs already exist for settlement ' + reportId + ': ' + nsJournals);
            return jeIds;
        }

        // Search charge lines grouped by marketplace, desc, month
        var chargeSearch = search.create({
            type: SL.ID,
            filters: [
                [SL.FIELDS.SUMMARY, 'anyof', settlementId],
                'AND',
                [
                    [[SL.FIELDS.TRAN_TYPE, 'isnot', 'Order'], 'AND', [SL.FIELDS.TRAN_TYPE, 'isnot', 'Refund']],
                    'OR',
                    [SL.FIELDS.MARKETPLACE, 'is', 'Non-Amazon']
                ],
                'AND',
                [SL.FIELDS.AMOUNT_DESC, 'isnotempty', ''],
                'AND',
                [SL.FIELDS.AMOUNT, 'notequalto', '0.00']
            ],
            columns: [
                search.createColumn({ name: SL.FIELDS.MARKETPLACE, summary: search.Summary.GROUP }),
                search.createColumn({ name: SL.FIELDS.AMOUNT_DESC, summary: search.Summary.GROUP }),
                search.createColumn({
                    name: 'formulatext',
                    summary: search.Summary.GROUP,
                    formula: "TO_CHAR({" + SL.FIELDS.POST_DATE_NS + "}, 'MONTH, YYYY')"
                }),
                search.createColumn({
                    name: SL.FIELDS.POST_DATE_NS,
                    summary: search.Summary.MAX,
                    sort: search.Sort.ASC
                }),
                search.createColumn({ name: SL.FIELDS.AMOUNT, summary: search.Summary.SUM }),
                search.createColumn({ name: SL.FIELDS.AMOUNT_TYPE, summary: search.Summary.GROUP })
            ]
        });

        var chargeResults = [];
        chargeSearch.run().each(function (r) {
            chargeResults.push(r);
            return true;
        });

        if (chargeResults.length === 0) {
            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'Phase D: No other charge lines found for settlement ' + reportId);
            return jeIds;
        }

        // Resolve currency
        var nsCurrency = resolveCurrencyId(currency);

        // Create JEs grouped by month
        var currentJe = null;
        var currentTotal = 0;
        var prevMonth = '';

        for (var y = 0; y < chargeResults.length; y++) {
            var columns = chargeResults[y].getAllColumns();
            var amt = parseFloat(chargeResults[y].getValue(columns[4])) || 0;
            if (amt === 0) continue;

            var mp = chargeResults[y].getValue(columns[0]);
            var desc = chargeResults[y].getValue(columns[1]);
            var month = chargeResults[y].getValue(columns[2]);
            var maxDate = chargeResults[y].getValue(columns[3]);
            var amtType = chargeResults[y].getValue(columns[5]);

            // Override desc for specific amount types (like old process)
            if (amtType === 'Cost of Advertising' || amtType === 'CouponRedemptionFee') {
                desc = amtType;
            }
            if (mp === 'Non-Amazon') {
                desc = 'AMAZON FBA FEES (WEBSITE)';
            }

            // When month changes, save current JE and start new one
            if (month !== prevMonth && currentJe !== null) {
                addBalancingDebitLine(currentJe, config, currentTotal, reportId);
                var savedId = currentJe.save({ ignoreMandatoryFields: true });
                jeIds.push(savedId);
                currentJe = null;
                currentTotal = 0;
            }

            // Create new JE if needed
            if (currentJe === null) {
                currentJe = record.create({
                    type: record.Type.JOURNAL_ENTRY,
                    isDynamic: true
                });
                if (nsCurrency) {
                    currentJe.setValue({ fieldId: 'currency', value: nsCurrency });
                }
                if (config.subsidiary) {
                    currentJe.setValue({ fieldId: 'subsidiary', value: config.subsidiary });
                }
                currentJe.setValue({
                    fieldId: 'memo',
                    value: 'Other Charges for Settlement: ' + reportId
                });
                try {
                    currentJe.setValue({ fieldId: 'custbody_amz_settlement_id', value: reportId });
                } catch (ignore) { }
                if (maxDate) {
                    currentJe.setValue({ fieldId: 'trandate', value: new Date(maxDate) });
                }
            }

            prevMonth = month;
            currentTotal = parseFloat((Number(currentTotal) + Number(amt)).toFixed(2));

            // Look up credit account
            var acct = lookupChargeAccount(desc, chargeMap, config, nsCurrency);

            if (acct) {
                currentJe.selectNewLine({ sublistId: 'line' });
                currentJe.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: acct });
                currentJe.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: Math.abs(amt) });
                currentJe.setCurrentSublistValue({
                    sublistId: 'line', fieldId: 'memo',
                    value: desc + ' - ' + reportId
                });
                currentJe.commitLine({ sublistId: 'line' });
            }
        }

        // Save final JE
        if (currentJe !== null) {
            addBalancingDebitLine(currentJe, config, currentTotal, reportId);
            var finalId = currentJe.save({ ignoreMandatoryFields: true });
            jeIds.push(finalId);
        }

        if (jeIds.length > 0) {
            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'Phase D: Created ' + jeIds.length + ' JE(s) for settlement ' + reportId +
                ': ' + jeIds.join(', '));
        }

        return jeIds;
    }

    // ========================================================================
    // Helper functions
    // ========================================================================

    /**
     * Searches settlement lines for a given settlement, order, and transaction type.
     * Returns array of line objects suitable for financialService functions.
     */
    function getSettlementLines(settlementId, orderId, tranType) {
        var lines = [];
        var filters = [
            [SL.FIELDS.SUMMARY, 'anyof', settlementId],
            'AND',
            [SL.FIELDS.ORDER_ID, 'is', orderId],
            'AND',
            [SL.FIELDS.TRAN_TYPE, 'is', tranType],
            'AND',
            [SL.FIELDS.PROCESSED, 'is', 'F']
        ];

        search.create({
            type: SL.ID,
            filters: filters,
            columns: [
                search.createColumn({ name: 'internalid', sort: search.Sort.ASC }),
                SL.FIELDS.SETTLEMENT_ID,
                SL.FIELDS.ORDER_ID,
                SL.FIELDS.MARKETPLACE,
                SL.FIELDS.TRAN_TYPE,
                SL.FIELDS.AMOUNT_TYPE,
                SL.FIELDS.AMOUNT_DESC,
                SL.FIELDS.AMOUNT,
                SL.FIELDS.CURRENCY,
                SL.FIELDS.SKU,
                SL.FIELDS.QUANTITY,
                SL.FIELDS.POST_DATE,
                SL.FIELDS.POST_DATE_NS,
                SL.FIELDS.PROMO_ID
            ]
        }).run().each(function (result) {
            lines.push({
                id: result.id,
                settlementId: result.getValue(SL.FIELDS.SETTLEMENT_ID),
                orderId: result.getValue(SL.FIELDS.ORDER_ID),
                marketplace: result.getValue(SL.FIELDS.MARKETPLACE),
                tranType: result.getValue(SL.FIELDS.TRAN_TYPE),
                amountType: result.getValue(SL.FIELDS.AMOUNT_TYPE),
                amountDesc: result.getValue(SL.FIELDS.AMOUNT_DESC),
                amount: result.getValue(SL.FIELDS.AMOUNT),
                currency: result.getValue(SL.FIELDS.CURRENCY),
                sku: result.getValue(SL.FIELDS.SKU),
                quantity: result.getValue(SL.FIELDS.QUANTITY),
                postDate: result.getValue(SL.FIELDS.POST_DATE),
                postDateNs: result.getValue(SL.FIELDS.POST_DATE_NS),
                promoId: result.getValue(SL.FIELDS.PROMO_ID)
            });
            return true;
        });

        return lines;
    }

    /**
     * Marks an array of settlement lines as processed.
     */
    function markLinesProcessed(lines) {
        for (var i = 0; i < lines.length; i++) {
            try {
                record.submitFields({
                    type: SL.ID,
                    id: lines[i].id,
                    values: { [SL.FIELDS.PROCESSED]: true }
                });
            } catch (e) {
                logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                    'Could not mark line ' + lines[i].id + ' as processed: ' + e.message);
            }
        }
    }

    /**
     * Adds a balancing debit line to a JE.
     */
    function addBalancingDebitLine(je, config, total, settlementId) {
        var debitAccount = config.settleAccount || config.feeAccount;
        if (!debitAccount) return;

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: debitAccount });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.abs(total) });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Cash - ' + settlementId });
        je.commitLine({ sublistId: 'line' });
    }

    /**
     * Looks up the GL account for a charge description using the charge account map.
     * Fallback chain: chargeMap.map[desc].account → chargeMap.defaultAccount →
     *   currency-specific default (config.feeAccount for USD, config.defaultFeeAcctCad for CAD,
     *   config.defaultFeeAcctMxn for MXN) → config.feeAccount
     */
    function lookupChargeAccount(description, chargeMap, config, nsCurrency) {
        var key = (description || '').toLowerCase().trim();
        if (chargeMap && chargeMap.map && chargeMap.map[key]) {
            if (chargeMap.map[key].account) return chargeMap.map[key].account;
        }
        if (chargeMap && chargeMap.defaultAccount) return chargeMap.defaultAccount;

        // Currency-specific fallback
        if (nsCurrency === '3' && config.defaultFeeAcctCad) return config.defaultFeeAcctCad;
        if (nsCurrency === '5' && config.defaultFeeAcctMxn) return config.defaultFeeAcctMxn;
        return config.feeAccount || null;
    }

    /**
     * Resolves a currency code to NS internal ID.
     */
    function resolveCurrencyId(currencyCode) {
        if (!currencyCode) return null;
        var map = { 'USD': '1', 'CAD': '3', 'MXN': '5' };
        return map[currencyCode.toUpperCase()] || null;
    }

    function summarize(summary) {
        logger.progress(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement Process MR summarize: Execution completed');

        if (summary.inputSummary.error) {
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Process MR: Input error: ' + summary.inputSummary.error);
        }

        var mapErrors = 0;
        summary.mapSummary.errors.iterator().each(function (key, error) {
            mapErrors++;
            logger.error(constants.LOG_TYPE.SETTLEMENT_SYNC,
                'Settlement Process MR: Map error [' + key + ']: ' + error);
            return true;
        });

        var reduceErrors = 0;
        summary.reduceSummary.errors.iterator().each(function (key, error) {
            reduceErrors++;
            logger.error(constants.LOG_TYPE.FINANCIAL_RECON,
                'Settlement Process MR: Reduce error [' + key + ']: ' + error);
            return true;
        });

        logger.success(constants.LOG_TYPE.SETTLEMENT_SYNC,
            'Settlement Process MR complete. Map errors: ' + mapErrors +
            ', Reduce errors: ' + reduceErrors);
    }

    return { getInputData, map, reduce, summarize };
});
