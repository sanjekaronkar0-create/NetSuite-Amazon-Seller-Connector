/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Financial reconciliation service.
 *              Creates Deposits, Journal Entries, and Credit Memos for Amazon settlements and returns.
 */
define([
    'N/record',
    'N/search',
    'N/log',
    '../lib/constants',
    '../lib/logger',
    '../lib/configHelper'
], function (record, search, log, constants, logger, configHelper) {

    const STL = constants.CUSTOM_RECORDS.SETTLEMENT;

    /**
     * Creates a NetSuite Invoice from Amazon settlement data.
     * Adds fee lines directly on the invoice using Other Charge for Sale items
     * mapped via column-item mappings (like old NES_ARES_sch_amazon_invoices.js updateInvoices).
     * @param {Object} config - Connector config with account mappings
     * @param {Object} settlement - Settlement record data
     * @param {Object} summary - Financial summary
     * @param {Object} [columnAmounts] - Per-column amounts from settlement parsing
     * @param {Object} [columnItemMap] - Map of lowercase column name to NetSuite item ID
     * @returns {number} Invoice record ID
     */
    function createInvoice(config, settlement, summary, columnAmounts, columnItemMap) {
        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'financialService.createInvoice: Starting invoice creation for settlement ' + settlement.reportId +
            '. Customer: ' + (config.customer || 'NOT SET') +
            ', subsidiary: ' + (config.subsidiary || 'NOT SET') +
            ', invoiceForm: ' + (config.invoiceForm || 'default') +
            ', columnAmounts: ' + (columnAmounts ? Object.keys(columnAmounts).length + ' entries' : 'NONE') +
            ', columnItemMap: ' + (columnItemMap ? Object.keys(columnItemMap).length + ' mappings' : 'NONE'));

        const inv = record.create({
            type: record.Type.INVOICE,
            isDynamic: true
        });

        // Set header fields
        if (config.customer) {
            inv.setValue({ fieldId: 'entity', value: config.customer });
        } else {
            logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                'financialService.createInvoice: No customer configured. Invoice for settlement ' + settlement.reportId +
                ' will not have an entity set, which may cause save failure.');
        }
        if (config.subsidiary) {
            inv.setValue({ fieldId: 'subsidiary', value: config.subsidiary });
        }
        if (config.invoiceForm) {
            inv.setValue({ fieldId: 'customform', value: config.invoiceForm });
        }
        if (config.location) {
            inv.setValue({ fieldId: 'location', value: config.location });
        }

        inv.setValue({
            fieldId: 'trandate',
            value: settlement.endDate ? new Date(settlement.endDate) : new Date()
        });
        inv.setValue({
            fieldId: 'memo',
            value: 'Amazon Settlement: ' + (settlement.reportId || 'Unknown')
        });
        inv.setValue({
            fieldId: 'otherrefnum',
            value: settlement.reportId || ''
        });

        var invoiceLineCount = 0;
        var unmappedFees = {};

        // Add fee lines using column-item mappings (Other Charge for Sale items)
        // This matches the old process: each settlement fee description → mapped item → invoice line
        if (columnAmounts && columnItemMap) {
            for (var colName in columnAmounts) {
                if (!columnAmounts.hasOwnProperty(colName)) continue;
                var amount = columnAmounts[colName];
                if (amount === 0) continue;

                var itemId = columnItemMap[colName];
                if (itemId) {
                    inv.selectNewLine({ sublistId: 'item' });
                    inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemId });
                    inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 1 });
                    inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: amount });
                    inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: colName });
                    inv.commitLine({ sublistId: 'item' });
                    invoiceLineCount++;
                } else {
                    // Track unmapped fees for logging
                    unmappedFees[colName] = amount;
                }
            }

            if (Object.keys(unmappedFees).length > 0) {
                logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                    'financialService.createInvoice: ' + Object.keys(unmappedFees).length +
                    ' fee description(s) have no column-item mapping for settlement ' + settlement.reportId +
                    '. Unmapped: ' + Object.keys(unmappedFees).join(', ') +
                    '. Create mappings in Column-Item Map (customrecord_amz_column_item_map) to include these on the invoice.');
            }
        } else {
            // Fallback: add summary-level lines using shippingItem as generic item
            if (summary.productCharges) {
                addInvoiceLine(inv, config, 'Product Charges', Math.abs(summary.productCharges));
                invoiceLineCount++;
            }
            if (summary.shippingCredits) {
                addInvoiceLine(inv, config, 'Shipping Credits', Math.abs(summary.shippingCredits));
                invoiceLineCount++;
            }
        }

        if (invoiceLineCount === 0) {
            logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                'financialService.createInvoice: Invoice for settlement ' + settlement.reportId +
                ' has NO line items. Ensure column-item mappings exist for settlement fee descriptions.');
        }

        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'financialService.createInvoice: Saving invoice with ' + invoiceLineCount + ' line(s) for settlement ' + settlement.reportId);

        const invId = inv.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
            'Invoice created for settlement ' + settlement.reportId, {
            configId: config.configId,
            recordType: 'invoice',
            recordId: invId,
            amazonRef: settlement.reportId
        });

        return { invoiceId: invId, unmappedFees: unmappedFees };
    }

    /**
     * Adds a summary-level line item to a settlement invoice (fallback when no column-item map).
     */
    function addInvoiceLine(inv, config, description, amount) {
        inv.selectNewLine({ sublistId: 'item' });
        var itemId = config.shippingItem;
        if (itemId) {
            inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemId });
        }
        inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 1 });
        inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: amount });
        inv.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: description });
        inv.commitLine({ sublistId: 'item' });
    }

    /**
     * Creates a Customer Payment against a settlement invoice.
     * Matches old process: transform invoice to payment, set undepfunds = T.
     * @param {Object} config - Connector config
     * @param {number} invoiceId - NetSuite Invoice internal ID
     * @param {Object} settlement - Settlement data with reportId, totalAmount
     * @param {string} [payDate] - Payment date (defaults to settlement end date)
     * @returns {number} Customer Payment record ID
     */
    function createSettlementPayment(config, invoiceId, settlement, payDate) {
        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'financialService.createSettlementPayment: Creating customer payment for invoice ' + invoiceId +
            ', settlement ' + settlement.reportId + ', totalAmount: ' + (settlement.totalAmount || 0));

        var payRec = record.transform({
            fromType: record.Type.INVOICE,
            fromId: invoiceId,
            toType: record.Type.CUSTOMER_PAYMENT,
            isDynamic: true
        });

        payRec.setValue({
            fieldId: 'payment',
            value: Math.abs(settlement.totalAmount || 0)
        });
        payRec.setValue({
            fieldId: 'trandate',
            value: payDate ? new Date(payDate) : (settlement.endDate ? new Date(settlement.endDate) : new Date())
        });
        payRec.setValue({ fieldId: 'undepfunds', value: 'T' });
        payRec.setValue({
            fieldId: 'memo',
            value: 'Amazon Settlement Payment: ' + (settlement.reportId || 'Unknown')
        });

        if (config.paymentMethod) {
            payRec.setValue({ fieldId: 'paymentmethod', value: config.paymentMethod });
        }

        // Apply to the specific invoice
        var lineCount = payRec.getLineCount({ sublistId: 'apply' });
        for (var i = 0; i < lineCount; i++) {
            var applyId = payRec.getSublistValue({ sublistId: 'apply', fieldId: 'internalid', line: i });
            if (String(applyId) === String(invoiceId)) {
                payRec.selectLine({ sublistId: 'apply', line: i });
                payRec.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
                payRec.commitLine({ sublistId: 'apply' });
                break;
            }
        }

        var paymentId = payRec.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
            'Customer Payment created for settlement ' + settlement.reportId, {
            configId: config.configId,
            recordType: 'customerpayment',
            recordId: paymentId,
            amazonRef: settlement.reportId
        });

        return paymentId;
    }

    /**
     * Creates a NetSuite Deposit from Amazon settlement data.
     * @param {Object} config - Connector config with account mappings
     * @param {Object} settlement - Settlement record data
     * @param {Object} summary - Financial summary (productCharges, fees, etc.)
     * @returns {number} Deposit record ID
     */
    function createDeposit(config, settlement, summary) {
        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'financialService.createDeposit: Starting deposit creation for settlement ' + settlement.reportId +
            '. settleAccount: ' + (config.settleAccount || 'NOT SET') +
            ', subsidiary: ' + (config.subsidiary || 'NOT SET') +
            ', totalAmount: ' + (summary.totalAmount || 0));

        const deposit = record.create({
            type: record.Type.DEPOSIT,
            isDynamic: true
        });

        if (config.subsidiary) {
            deposit.setValue({ fieldId: 'subsidiary', value: config.subsidiary });
        }
        if (config.settleAccount) {
            deposit.setValue({ fieldId: 'account', value: config.settleAccount });
        }

        deposit.setValue({
            fieldId: 'trandate',
            value: settlement.endDate ? new Date(settlement.endDate) : new Date()
        });
        deposit.setValue({
            fieldId: 'memo',
            value: 'Amazon Settlement: ' + (settlement.reportId || 'Unknown')
        });

        // Add deposit line for net settlement amount
        deposit.selectNewLine({ sublistId: 'other' });
        deposit.setCurrentSublistValue({
            sublistId: 'other',
            fieldId: 'account',
            value: config.settleAccount
        });
        deposit.setCurrentSublistValue({
            sublistId: 'other',
            fieldId: 'amount',
            value: Math.abs(summary.totalAmount || 0)
        });
        deposit.setCurrentSublistValue({
            sublistId: 'other',
            fieldId: 'memo',
            value: 'Amazon Settlement Deposit'
        });
        deposit.commitLine({ sublistId: 'other' });

        const depositId = deposit.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
            'Deposit created for settlement ' + settlement.reportId, {
            configId: config.configId,
            recordType: 'deposit',
            recordId: depositId,
            amazonRef: settlement.reportId
        });

        return depositId;
    }

    /**
     * Creates a Journal Entry to record Amazon fees from a settlement.
     * When column-item mappings are enabled, creates granular lines per column name
     * using the configured items. Otherwise falls back to account-based fee lines.
     * @param {Object} config
     * @param {Object} settlement
     * @param {Object} summary
     * @param {Object} [columnAmounts] - Per-column amounts from settlement parsing
     * @param {Object} [chargeAccountMap] - { map: {chargeName: accountId}, defaultAccount: accountId }
     * @returns {number} Journal Entry ID
     */
    function createFeeJournalEntry(config, settlement, summary, columnAmounts, chargeAccountMap) {
        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'financialService.createFeeJournalEntry: Starting JE creation for settlement ' + settlement.reportId +
            '. feeAccount: ' + (config.feeAccount || 'NOT SET') +
            ', fbaFeeAccount: ' + (config.fbaFeeAccount || 'NOT SET') +
            ', promoAccount: ' + (config.promoAccount || 'NOT SET') +
            ', colMapSettle: ' + (config.colMapSettle || false) +
            ', columnAmounts available: ' + (columnAmounts ? Object.keys(columnAmounts).length + ' column(s)' : 'NO'));

        const je = record.create({
            type: record.Type.JOURNAL_ENTRY,
            isDynamic: true
        });

        if (config.subsidiary) {
            je.setValue({ fieldId: 'subsidiary', value: config.subsidiary });
        }
        je.setValue({
            fieldId: 'trandate',
            value: settlement.endDate ? new Date(settlement.endDate) : new Date()
        });
        je.setValue({
            fieldId: 'memo',
            value: 'Amazon Fees - Settlement: ' + (settlement.reportId || 'Unknown')
        });

        let lineIdx = 0;
        let totalDebits = 0;

        // Check if column-item mapping is enabled for settlements
        var useColumnMapping = config.colMapSettle === true || config.colMapSettle === 'T';
        var columnItemMap = null;

        if (useColumnMapping && columnAmounts) {
            columnItemMap = configHelper.getColumnItemMap(config.configId, { useInSettle: true });
            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'financialService.createFeeJournalEntry: Column-item mapping enabled. Loaded ' +
                (columnItemMap ? Object.keys(columnItemMap).length : 0) + ' mapping(s)');
        }

        // Charge Account Map lookup (from customrecord_amz_charge_map, like old customrecord_amazon_other_charge)
        var chargeMap = (chargeAccountMap && chargeAccountMap.map) ? chargeAccountMap.map : null;
        var chargeDefaultAcct = (chargeAccountMap && chargeAccountMap.defaultAccount) ? chargeAccountMap.defaultAccount : null;

        // Log which JE line strategy will be used
        if (chargeMap && Object.keys(chargeMap).length > 0 && columnAmounts) {
            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'financialService.createFeeJournalEntry: Using CHARGE ACCOUNT MAP strategy for JE lines (settlement ' + settlement.reportId + ')');
        } else if (columnItemMap && Object.keys(columnItemMap).length > 0 && columnAmounts) {
            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'financialService.createFeeJournalEntry: Using COLUMN-ITEM MAP strategy for JE lines (settlement ' + settlement.reportId + ')');
        } else {
            logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
                'financialService.createFeeJournalEntry: Using SUMMARY-BASED (fallback) strategy for JE lines (settlement ' + settlement.reportId +
                '). Fees - selling: ' + (summary.sellingFees || 0) + ', fba: ' + (summary.fbaFees || 0) +
                ', promo: ' + (summary.promoRebates || 0) + ', other: ' + (summary.otherFees || 0));
        }

        if (chargeMap && Object.keys(chargeMap).length > 0 && columnAmounts) {
            // Use charge account map for granular JE lines (ported from old NES_ARES_sch_settlement_charges.js lookupAcct logic)
            for (var colName in columnAmounts) {
                if (!columnAmounts.hasOwnProperty(colName)) continue;
                var amount = columnAmounts[colName];
                if (amount === 0) continue;

                // Look up account from charge map, fallback to default, then to config fee account
                var resolvedAccount = chargeMap[colName] || chargeDefaultAcct || config.feeAccount;
                if (!resolvedAccount) continue;

                var absAmount = Math.abs(amount);
                je.selectNewLine({ sublistId: 'line' });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: resolvedAccount });
                if (amount < 0) {
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: absAmount });
                } else {
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: absAmount });
                }
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: colName + ' - ' + (settlement.reportId || '') });
                je.commitLine({ sublistId: 'line' });
                lineIdx++;
                totalDebits += amount < 0 ? absAmount : -absAmount;
            }
        } else if (columnItemMap && Object.keys(columnItemMap).length > 0 && columnAmounts) {
            // Use column-item mappings for granular JE lines
            for (var colName2 in columnAmounts) {
                if (!columnAmounts.hasOwnProperty(colName2)) continue;
                var amount2 = columnAmounts[colName2];
                if (amount2 === 0) continue;

                var itemId = columnItemMap[colName2];
                if (!itemId) continue;

                // Look up the item's expense/income account for the JE line
                var itemAccount = getItemAccount(itemId);
                if (!itemAccount && config.feeAccount) {
                    itemAccount = config.feeAccount;
                }
                if (!itemAccount) continue;

                var absAmount2 = Math.abs(amount2);
                je.selectNewLine({ sublistId: 'line' });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: itemAccount });
                if (amount2 < 0) {
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: absAmount2 });
                } else {
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: absAmount2 });
                }
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Amazon: ' + colName2 });
                je.commitLine({ sublistId: 'line' });
                lineIdx++;
                totalDebits += amount2 < 0 ? absAmount2 : -absAmount2;
            }
        } else {
            // Fallback: account-based fee lines (original behavior)

            // Selling Fees (debit expense account)
            if (summary.sellingFees && !config.feeAccount) {
                logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                    'financialService.createFeeJournalEntry: Selling fees of ' + summary.sellingFees +
                    ' exist but feeAccount is not configured - skipping selling fees line (settlement ' + settlement.reportId + ')');
            }
            if (summary.fbaFees && !config.fbaFeeAccount) {
                logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                    'financialService.createFeeJournalEntry: FBA fees of ' + summary.fbaFees +
                    ' exist but fbaFeeAccount is not configured - skipping FBA fees line (settlement ' + settlement.reportId + ')');
            }
            if (summary.promoRebates && !config.promoAccount) {
                logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                    'financialService.createFeeJournalEntry: Promo rebates of ' + summary.promoRebates +
                    ' exist but promoAccount is not configured - skipping promo rebates line (settlement ' + settlement.reportId + ')');
            }

            if (summary.sellingFees && config.feeAccount) {
                je.selectNewLine({ sublistId: 'line' });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: config.feeAccount });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.abs(summary.sellingFees) });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Amazon Selling Fees' });
                je.commitLine({ sublistId: 'line' });
                lineIdx++;
            }

            // FBA Fees (debit FBA expense account)
            if (summary.fbaFees && config.fbaFeeAccount) {
                je.selectNewLine({ sublistId: 'line' });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: config.fbaFeeAccount });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.abs(summary.fbaFees) });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Amazon FBA Fees' });
                je.commitLine({ sublistId: 'line' });
                lineIdx++;
            }

            // Promo Rebates (debit promo expense account)
            if (summary.promoRebates && config.promoAccount) {
                je.selectNewLine({ sublistId: 'line' });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: config.promoAccount });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.abs(summary.promoRebates) });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Amazon Promotional Rebates' });
                je.commitLine({ sublistId: 'line' });
                lineIdx++;
            }

            // Other Fees
            if (summary.otherFees && config.feeAccount) {
                je.selectNewLine({ sublistId: 'line' });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: config.feeAccount });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.abs(summary.otherFees) });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Amazon Other Fees' });
                je.commitLine({ sublistId: 'line' });
                lineIdx++;
            }

            totalDebits = Math.abs(summary.sellingFees || 0) + Math.abs(summary.fbaFees || 0) +
                Math.abs(summary.promoRebates || 0) + Math.abs(summary.otherFees || 0);
        }

        // If no fee lines, skip JE creation
        if (lineIdx === 0) {
            logger.warn(constants.LOG_TYPE.FINANCIAL_RECON,
                'financialService.createFeeJournalEntry: No fee lines created for settlement ' + settlement.reportId +
                '. JE will NOT be saved. Possible reasons: all fee amounts are 0, no matching accounts/items in mappings, ' +
                'or fee accounts (feeAccount, fbaFeeAccount, promoAccount) are not configured.', {
                configId: config.configId,
                amazonRef: settlement.reportId
            });
            return null;
        }

        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'financialService.createFeeJournalEntry: Created ' + lineIdx + ' fee line(s) for settlement ' + settlement.reportId +
            '. Total debits: ' + Math.abs(totalDebits) + '. Adding balancing credit line.');

        // Credit line: settlement/clearing account (balancing entry)
        var balancingAccount = config.settleAccount || config.feeAccount;
        if (!balancingAccount) {
            throw new Error('No settlement or fee account configured for balancing JE line');
        }
        var balancingAmount = Math.abs(totalDebits);
        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: balancingAccount });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: balancingAmount });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Amazon Settlement Clearing' });
        je.commitLine({ sublistId: 'line' });

        const jeId = je.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
            'Fee Journal Entry created for settlement ' + settlement.reportId, {
            configId: config.configId,
            recordType: 'journalentry',
            recordId: jeId,
            amazonRef: settlement.reportId
        });

        return jeId;
    }

    /**
     * Looks up the expense or income account for a NetSuite item.
     * @param {string|number} itemId
     * @returns {string|null} Account internal ID
     */
    function getItemAccount(itemId) {
        if (!itemId) return null;
        try {
            var looked = search.lookupFields({
                type: 'item',
                id: itemId,
                columns: ['expenseaccount', 'incomeaccount']
            });
            var expAcct = looked.expenseaccount;
            if (Array.isArray(expAcct) && expAcct.length > 0) return expAcct[0].value;
            var incAcct = looked.incomeaccount;
            if (Array.isArray(incAcct) && incAcct.length > 0) return incAcct[0].value;
        } catch (e) {
            log.debug({ title: 'getItemAccount', details: 'Could not look up account for item ' + itemId + ': ' + e.message });
        }
        return null;
    }

    /**
     * Creates a Credit Memo from a Return Authorization.
     * @param {Object} config
     * @param {number} rmaId - NetSuite Return Authorization ID
     * @param {Object} returnData - Amazon return info
     * @returns {number} Credit Memo ID
     */
    function createCreditMemo(config, rmaId, returnData) {
        const cm = record.transform({
            fromType: record.Type.RETURN_AUTHORIZATION,
            fromId: rmaId,
            toType: record.Type.CREDIT_MEMO,
            isDynamic: true
        });

        cm.setValue({
            fieldId: 'memo',
            value: 'Amazon Refund: ' + (returnData.returnId || returnData.amazonOrderId)
        });

        // Override refund amount if provided by Amazon
        if (returnData.refundAmount) {
            const lineCount = cm.getLineCount({ sublistId: 'item' });
            if (lineCount > 0) {
                cm.selectLine({ sublistId: 'item', line: 0 });
                const qty = cm.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' }) || 1;
                cm.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    value: parseFloat(returnData.refundAmount) / qty
                });
                cm.commitLine({ sublistId: 'item' });
            }
        }

        const cmId = cm.save({ ignoreMandatoryFields: true });

        logger.success(constants.LOG_TYPE.RETURN_SYNC,
            'Credit Memo created for return ' + (returnData.returnId || returnData.amazonOrderId), {
            configId: config.configId,
            recordType: 'creditmemo',
            recordId: cmId,
            amazonRef: returnData.amazonOrderId
        });

        return cmId;
    }

    /**
     * Creates a Customer Refund from a Credit Memo.
     * @param {Object} config
     * @param {number} creditMemoId
     * @returns {number} Customer Refund ID
     */
    function createCustomerRefund(config, creditMemoId) {
        const refund = record.transform({
            fromType: record.Type.CREDIT_MEMO,
            fromId: creditMemoId,
            toType: record.Type.CUSTOMER_REFUND,
            isDynamic: true
        });

        if (config.paymentMethod) {
            refund.setValue({ fieldId: 'paymentmethod', value: config.paymentMethod });
        }

        refund.setValue({
            fieldId: 'memo',
            value: 'Amazon Refund Processing'
        });

        return refund.save({ ignoreMandatoryFields: true });
    }

    /**
     * Creates multiple Journal Entries split by month within a settlement period.
     * Ported from old NES_ARES_sch_settlement_charges.js logic where charges spanning
     * multiple months get separate JEs per month.
     * @param {Object} config
     * @param {Object} settlement
     * @param {Object} rowsByMonth - Map of YYYY-MM to { rows, date, columnAmounts }
     * @param {Object} [chargeAccountMap] - { map: {chargeName: accountId}, defaultAccount: accountId }
     * @returns {Array<number>} Array of Journal Entry IDs
     */
    function createFeeJournalEntriesByMonth(config, settlement, rowsByMonth, chargeAccountMap) {
        var jeIds = [];
        var sortedMonths = Object.keys(rowsByMonth).sort();

        for (var i = 0; i < sortedMonths.length; i++) {
            var monthKey = sortedMonths[i];
            var monthData = rowsByMonth[monthKey];

            if (!monthData.columnAmounts || Object.keys(monthData.columnAmounts).length === 0) continue;

            // Build a month-specific summary from the column amounts
            var monthSummary = { sellingFees: 0, fbaFees: 0, promoRebates: 0, otherFees: 0 };
            for (var col in monthData.columnAmounts) {
                if (!monthData.columnAmounts.hasOwnProperty(col)) continue;
                monthSummary.otherFees += monthData.columnAmounts[col];
            }

            // Determine transaction date - use the month's latest posting date
            var monthSettlement = {
                reportId: settlement.reportId,
                endDate: monthData.date ? monthData.date.toISOString() : settlement.endDate
            };

            var jeId = createFeeJournalEntry(
                config, monthSettlement, monthSummary, monthData.columnAmounts, chargeAccountMap
            );

            if (jeId) {
                jeIds.push(jeId);
                logger.success(constants.LOG_TYPE.FINANCIAL_RECON,
                    'Monthly JE created for ' + monthKey + ' - settlement ' + settlement.reportId, {
                    configId: config.configId,
                    recordType: 'journalentry',
                    recordId: jeId,
                    amazonRef: settlement.reportId
                });
            }
        }

        return jeIds;
    }

    /**
     * Updates a settlement record with financial reconciliation references.
     * Supports the new NS_INVOICE and NS_JOURNALS fields for configurable settlement processing.
     */
    function updateSettlementFinancials(settlementId, options) {
        options = options || {};
        logger.progress(constants.LOG_TYPE.FINANCIAL_RECON,
            'financialService.updateSettlementFinancials: Marking settlement ' + settlementId + ' as RECONCILED. ' +
            'depositId: ' + (options.depositId || 'none') +
            ', invoiceId: ' + (options.invoiceId || 'none') +
            ', journalId: ' + (options.journalId || 'none') +
            ', journalIds: ' + (options.journalIds && options.journalIds.length ? options.journalIds.join(',') : 'none'));

        const values = { [STL.FIELDS.STATUS]: constants.SETTLEMENT_STATUS.RECONCILED };

        if (options.depositId) values[STL.FIELDS.NS_DEPOSIT] = options.depositId;
        if (options.invoiceId) values[STL.FIELDS.NS_INVOICE] = options.invoiceId;
        if (options.journalId) values[STL.FIELDS.NS_JOURNAL] = options.journalId;
        if (options.journalIds && options.journalIds.length > 0) {
            values[STL.FIELDS.NS_JOURNALS] = options.journalIds.join(',');
            // Also set the first JE as the primary reference
            if (!options.journalId) {
                values[STL.FIELDS.NS_JOURNAL] = options.journalIds[0];
            }
        }

        record.submitFields({
            type: STL.ID,
            id: settlementId,
            values: values
        });
    }

    return {
        createInvoice,
        createSettlementPayment,
        createDeposit,
        createFeeJournalEntry,
        createFeeJournalEntriesByMonth,
        createCreditMemo,
        createCustomerRefund,
        updateSettlementFinancials
    };
});
