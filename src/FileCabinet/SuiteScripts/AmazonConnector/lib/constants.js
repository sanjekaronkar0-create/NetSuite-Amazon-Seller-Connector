/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Constants and enumerations for the Amazon Seller Connector.
 */
define([], function () {

    const CUSTOM_RECORDS = {
        CONFIG: {
            ID: 'customrecord_amz_connector_config',
            FIELDS: {
                MARKETPLACE: 'custrecord_amz_cfg_marketplace',
                SELLER_ID: 'custrecord_amz_cfg_seller_id',
                CLIENT_ID: 'custrecord_amz_cfg_client_id',
                CLIENT_SECRET: 'custrecord_amz_cfg_client_secret',
                REFRESH_TOKEN: 'custrecord_amz_cfg_refresh_token',
                ENDPOINT: 'custrecord_amz_cfg_endpoint',
                MARKETPLACE_ID: 'custrecord_amz_cfg_marketplace_id',
                SUBSIDIARY: 'custrecord_amz_cfg_subsidiary',
                LOCATION: 'custrecord_amz_cfg_location',
                ORDER_ENABLED: 'custrecord_amz_cfg_order_enabled',
                INV_ENABLED: 'custrecord_amz_cfg_inv_enabled',
                FULFILL_ENABLED: 'custrecord_amz_cfg_fulfill_enabled',
                SETTLE_ENABLED: 'custrecord_amz_cfg_settle_enabled',
                RETURN_ENABLED: 'custrecord_amz_cfg_return_enabled',
                LAST_ORDER_SYNC: 'custrecord_amz_cfg_last_order_sync',
                LAST_INV_SYNC: 'custrecord_amz_cfg_last_inv_sync',
                LAST_SETTLE_SYNC: 'custrecord_amz_cfg_last_settle_sync',
                PAYMENT_METHOD: 'custrecord_amz_cfg_payment_method',
                CUSTOMER: 'custrecord_amz_cfg_customer'
            }
        },
        LOG: {
            ID: 'customrecord_amz_integration_log',
            FIELDS: {
                TYPE: 'custrecord_amz_log_type',
                STATUS: 'custrecord_amz_log_status',
                MESSAGE: 'custrecord_amz_log_message',
                DETAILS: 'custrecord_amz_log_details',
                RECORD_TYPE: 'custrecord_amz_log_record_type',
                RECORD_ID: 'custrecord_amz_log_record_id',
                AMAZON_REF: 'custrecord_amz_log_amazon_ref',
                CONFIG: 'custrecord_amz_log_config',
                TIMESTAMP: 'custrecord_amz_log_timestamp'
            }
        },
        ORDER_MAP: {
            ID: 'customrecord_amz_order_map',
            FIELDS: {
                ORDER_ID: 'custrecord_amz_om_order_id',
                NS_SALES_ORDER: 'custrecord_amz_om_ns_sales_order',
                NS_CASH_SALE: 'custrecord_amz_om_ns_cash_sale',
                STATUS: 'custrecord_amz_om_status',
                PURCHASE_DATE: 'custrecord_amz_om_purchase_date',
                TOTAL: 'custrecord_amz_om_total',
                CURRENCY: 'custrecord_amz_om_currency',
                BUYER_EMAIL: 'custrecord_amz_om_buyer_email',
                SHIP_CITY: 'custrecord_amz_om_ship_city',
                SHIP_STATE: 'custrecord_amz_om_ship_state',
                SHIP_COUNTRY: 'custrecord_amz_om_ship_country',
                FULFILLMENT_CHANNEL: 'custrecord_amz_om_fulfillment_channel',
                CONFIG: 'custrecord_amz_om_config',
                LAST_SYNCED: 'custrecord_amz_om_last_synced'
            }
        },
        ITEM_MAP: {
            ID: 'customrecord_amz_item_map',
            FIELDS: {
                ASIN: 'custrecord_amz_im_asin',
                SELLER_SKU: 'custrecord_amz_im_seller_sku',
                NS_ITEM: 'custrecord_amz_im_ns_item',
                TITLE: 'custrecord_amz_im_title',
                PRICE: 'custrecord_amz_im_price',
                INV_SYNC: 'custrecord_amz_im_inv_sync',
                CONFIG: 'custrecord_amz_im_config',
                LAST_INV_QTY: 'custrecord_amz_im_last_inv_qty',
                LAST_SYNCED: 'custrecord_amz_im_last_synced'
            }
        },
        SETTLEMENT: {
            ID: 'customrecord_amz_settlement',
            FIELDS: {
                REPORT_ID: 'custrecord_amz_stl_report_id',
                START_DATE: 'custrecord_amz_stl_start_date',
                END_DATE: 'custrecord_amz_stl_end_date',
                TOTAL_AMOUNT: 'custrecord_amz_stl_total_amount',
                CURRENCY: 'custrecord_amz_stl_currency',
                PRODUCT_CHARGES: 'custrecord_amz_stl_product_charges',
                SHIPPING_CREDITS: 'custrecord_amz_stl_shipping_credits',
                PROMO_REBATES: 'custrecord_amz_stl_promo_rebates',
                SELLING_FEES: 'custrecord_amz_stl_selling_fees',
                FBA_FEES: 'custrecord_amz_stl_fba_fees',
                OTHER_FEES: 'custrecord_amz_stl_other_fees',
                REFUNDS: 'custrecord_amz_stl_refunds',
                NS_DEPOSIT: 'custrecord_amz_stl_ns_deposit',
                STATUS: 'custrecord_amz_stl_status',
                CONFIG: 'custrecord_amz_stl_config'
            }
        },
        RETURN_MAP: {
            ID: 'customrecord_amz_return_map',
            FIELDS: {
                AMAZON_ORDER_ID: 'custrecord_amz_ret_amazon_order_id',
                RETURN_ID: 'custrecord_amz_ret_return_id',
                REASON: 'custrecord_amz_ret_reason',
                REFUND_AMOUNT: 'custrecord_amz_ret_refund_amount',
                NS_RMA: 'custrecord_amz_ret_ns_rma',
                NS_CREDIT_MEMO: 'custrecord_amz_ret_ns_credit_memo',
                STATUS: 'custrecord_amz_ret_status',
                ORDER_MAP: 'custrecord_amz_ret_order_map',
                CONFIG: 'custrecord_amz_ret_config',
                DATE: 'custrecord_amz_ret_date'
            }
        }
    };

    const LOG_TYPE = {
        ORDER_SYNC: '1',
        INVENTORY_SYNC: '2',
        FULFILLMENT_SYNC: '3',
        SETTLEMENT_SYNC: '4',
        RETURN_SYNC: '5',
        API_CALL: '6'
    };

    const LOG_STATUS = {
        SUCCESS: '1',
        ERROR: '2',
        WARNING: '3',
        IN_PROGRESS: '4'
    };

    const ORDER_STATUS = {
        PENDING: '1',
        UNSHIPPED: '2',
        SHIPPED: '3',
        CANCELED: '4',
        RETURNED: '5'
    };

    const FULFILLMENT_CHANNEL = {
        MFN: '1',
        AFN: '2'
    };

    const SETTLEMENT_STATUS = {
        PENDING: '1',
        PROCESSING: '2',
        RECONCILED: '3',
        ERROR: '4'
    };

    const RETURN_STATUS = {
        PENDING: '1',
        PROCESSED: '2',
        ERROR: '3'
    };

    const SP_API_ENDPOINTS = {
        NORTH_AMERICA: 'https://sellingpartnerapi-na.amazon.com',
        EUROPE: 'https://sellingpartnerapi-eu.amazon.com',
        FAR_EAST: 'https://sellingpartnerapi-fe.amazon.com'
    };

    const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

    const MARKETPLACE_IDS = {
        US: 'ATVPDKIKX0DER',
        CA: 'A2EUQ1WTGCTBG2',
        MX: 'A1AM78C64UM0Y8',
        UK: 'A1F83G8C2ARO7P',
        DE: 'A1PA6795UKMFR9',
        FR: 'A13V1IB3VIYZZH',
        IT: 'APJ6JRA9NG5V4',
        ES: 'A1RKKUPIHCS9HS',
        JP: 'A1VC38T7YXB528',
        AU: 'A39IBJ37TRP1C6',
        IN: 'A21TJRUUN4KGV'
    };

    const SCRIPT_IDS = {
        SCHED_ORDER_SYNC: 'customscript_amz_ss_order_sync',
        SCHED_INV_SYNC: 'customscript_amz_ss_inv_sync',
        SCHED_SETTLE_SYNC: 'customscript_amz_ss_settle_sync',
        SCHED_RETURN_SYNC: 'customscript_amz_ss_return_sync',
        MR_ORDER_IMPORT: 'customscript_amz_mr_order_import',
        MR_INV_EXPORT: 'customscript_amz_mr_inv_export',
        MR_SETTLE_PROCESS: 'customscript_amz_mr_settle_process',
        MR_RETURN_PROCESS: 'customscript_amz_mr_return_process',
        SL_CONFIG: 'customscript_amz_sl_config',
        SL_DASHBOARD: 'customscript_amz_sl_dashboard',
        RL_WEBHOOK: 'customscript_amz_rl_webhook',
        UE_FULFILL: 'customscript_amz_ue_fulfill',
        CS_CONFIG: 'customscript_amz_cs_config'
    };

    const DEPLOY_IDS = {
        SCHED_ORDER_SYNC: 'customdeploy_amz_ss_order_sync',
        SCHED_INV_SYNC: 'customdeploy_amz_ss_inv_sync',
        SCHED_SETTLE_SYNC: 'customdeploy_amz_ss_settle_sync',
        SCHED_RETURN_SYNC: 'customdeploy_amz_ss_return_sync',
        MR_ORDER_IMPORT: 'customdeploy_amz_mr_order_import',
        MR_INV_EXPORT: 'customdeploy_amz_mr_inv_export',
        MR_SETTLE_PROCESS: 'customdeploy_amz_mr_settle_process',
        MR_RETURN_PROCESS: 'customdeploy_amz_mr_return_process',
        SL_CONFIG: 'customdeploy_amz_sl_config',
        SL_DASHBOARD: 'customdeploy_amz_sl_dashboard',
        RL_WEBHOOK: 'customdeploy_amz_rl_webhook',
        UE_FULFILL: 'customdeploy_amz_ue_fulfill',
        CS_CONFIG: 'customdeploy_amz_cs_config'
    };

    return {
        CUSTOM_RECORDS,
        LOG_TYPE,
        LOG_STATUS,
        ORDER_STATUS,
        FULFILLMENT_CHANNEL,
        SETTLEMENT_STATUS,
        RETURN_STATUS,
        SP_API_ENDPOINTS,
        LWA_TOKEN_URL,
        MARKETPLACE_IDS,
        SCRIPT_IDS,
        DEPLOY_IDS
    };
});
