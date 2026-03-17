/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Constants and enumerations for the Amazon Seller Connector.
 *              Central reference for all custom record IDs, field IDs, enumerations,
 *              API endpoints, marketplace IDs, and script/deployment IDs.
 */
define([], function () {

    // ============================================================
    // Custom Record Definitions
    // ============================================================

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
                PRICING_ENABLED: 'custrecord_amz_cfg_pricing_enabled',
                CATALOG_ENABLED: 'custrecord_amz_cfg_catalog_enabled',
                LAST_ORDER_SYNC: 'custrecord_amz_cfg_last_order_sync',
                LAST_INV_SYNC: 'custrecord_amz_cfg_last_inv_sync',
                LAST_SETTLE_SYNC: 'custrecord_amz_cfg_last_settle_sync',
                LAST_RETURN_SYNC: 'custrecord_amz_cfg_last_return_sync',
                LAST_PRICING_SYNC: 'custrecord_amz_cfg_last_pricing_sync',
                LAST_CATALOG_SYNC: 'custrecord_amz_cfg_last_catalog_sync',
                PAYMENT_METHOD: 'custrecord_amz_cfg_payment_method',
                CUSTOMER: 'custrecord_amz_cfg_customer',
                // Order Type Configuration
                ORDER_TYPE: 'custrecord_amz_cfg_order_type',
                // Financial Reconciliation
                SETTLE_ACCOUNT: 'custrecord_amz_cfg_settle_account',
                FEE_ACCOUNT: 'custrecord_amz_cfg_fee_account',
                FBA_FEE_ACCOUNT: 'custrecord_amz_cfg_fba_fee_account',
                REFUND_ACCOUNT: 'custrecord_amz_cfg_refund_account',
                PROMO_ACCOUNT: 'custrecord_amz_cfg_promo_account',
                SHIPPING_ITEM: 'custrecord_amz_cfg_shipping_item',
                DISCOUNT_ITEM: 'custrecord_amz_cfg_discount_item',
                // FBA Settings
                FBA_ENABLED: 'custrecord_amz_cfg_fba_enabled',
                FBA_LOCATION: 'custrecord_amz_cfg_fba_location',
                FBA_CUSTOMER: 'custrecord_amz_cfg_fba_customer',
                // Multi-marketplace
                ADDITIONAL_MARKETPLACE_IDS: 'custrecord_amz_cfg_addl_mkt_ids',
                // Retry / Error Settings
                MAX_RETRIES: 'custrecord_amz_cfg_max_retries',
                RETRY_DELAY_MINS: 'custrecord_amz_cfg_retry_delay',
                // Auto Credit Memo
                AUTO_CREDIT_MEMO: 'custrecord_amz_cfg_auto_credit_memo',
                AUTO_DEPOSIT: 'custrecord_amz_cfg_auto_deposit',
                // Custom Form
                SALES_ORDER_FORM: 'custrecord_amz_cfg_so_form',
                CASH_SALE_FORM: 'custrecord_amz_cfg_cs_form',
                // Tax Handling
                TAX_ITEM: 'custrecord_amz_cfg_tax_item',
                TAX_CODE: 'custrecord_amz_cfg_tax_code',
                // Notification Settings
                NOTIFY_ON_ERROR: 'custrecord_amz_cfg_notify_error',
                NOTIFY_EMAIL: 'custrecord_amz_cfg_notify_email',
                NOTIFY_ON_SYNC: 'custrecord_amz_cfg_notify_sync',
                // Sync Interval Configuration (minutes)
                ORDER_SYNC_INTERVAL: 'custrecord_amz_cfg_order_interval',
                INV_SYNC_INTERVAL: 'custrecord_amz_cfg_inv_interval',
                SETTLE_SYNC_INTERVAL: 'custrecord_amz_cfg_settle_interval',
                RETURN_SYNC_INTERVAL: 'custrecord_amz_cfg_return_interval',
                PRICING_SYNC_INTERVAL: 'custrecord_amz_cfg_pricing_interval',
                CATALOG_SYNC_INTERVAL: 'custrecord_amz_cfg_catalog_interval',
                // Log Archival
                LOG_RETENTION_DAYS: 'custrecord_amz_cfg_log_retention',
                // FBA Inventory Sync
                FBA_INV_SYNC_ENABLED: 'custrecord_amz_cfg_fba_inv_sync',
                // Order Cancellation
                CANCEL_SYNC_ENABLED: 'custrecord_amz_cfg_cancel_enabled',
                CANCEL_ACTION: 'custrecord_amz_cfg_cancel_action'
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
                NS_INVOICE: 'custrecord_amz_om_ns_invoice',
                STATUS: 'custrecord_amz_om_status',
                PURCHASE_DATE: 'custrecord_amz_om_purchase_date',
                TOTAL: 'custrecord_amz_om_total',
                CURRENCY: 'custrecord_amz_om_currency',
                BUYER_EMAIL: 'custrecord_amz_om_buyer_email',
                BUYER_NAME: 'custrecord_amz_om_buyer_name',
                SHIP_CITY: 'custrecord_amz_om_ship_city',
                SHIP_STATE: 'custrecord_amz_om_ship_state',
                SHIP_COUNTRY: 'custrecord_amz_om_ship_country',
                FULFILLMENT_CHANNEL: 'custrecord_amz_om_fulfillment_channel',
                CONFIG: 'custrecord_amz_om_config',
                LAST_SYNCED: 'custrecord_amz_om_last_synced',
                ERROR_COUNT: 'custrecord_amz_om_error_count',
                MARKETPLACE_ID: 'custrecord_amz_om_marketplace_id'
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
                PRICE_SYNC: 'custrecord_amz_im_price_sync',
                CONFIG: 'custrecord_amz_im_config',
                LAST_INV_QTY: 'custrecord_amz_im_last_inv_qty',
                LAST_SYNCED: 'custrecord_amz_im_last_synced',
                UPC: 'custrecord_amz_im_upc',
                CONDITION: 'custrecord_amz_im_condition',
                LISTING_STATUS: 'custrecord_amz_im_listing_status',
                FULFILLMENT_CHANNEL: 'custrecord_amz_im_fulfillment_channel'
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
                NS_JOURNAL: 'custrecord_amz_stl_ns_journal',
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
        },
        ERROR_QUEUE: {
            ID: 'customrecord_amz_error_queue',
            FIELDS: {
                TYPE: 'custrecord_amz_eq_type',
                RECORD_TYPE: 'custrecord_amz_eq_record_type',
                RECORD_ID: 'custrecord_amz_eq_record_id',
                AMAZON_REF: 'custrecord_amz_eq_amazon_ref',
                ERROR_MSG: 'custrecord_amz_eq_error_msg',
                RETRY_COUNT: 'custrecord_amz_eq_retry_count',
                MAX_RETRIES: 'custrecord_amz_eq_max_retries',
                NEXT_RETRY: 'custrecord_amz_eq_next_retry',
                STATUS: 'custrecord_amz_eq_status',
                PAYLOAD: 'custrecord_amz_eq_payload',
                CONFIG: 'custrecord_amz_eq_config',
                CREATED: 'custrecord_amz_eq_created'
            }
        }
    };

    // ============================================================
    // Enumerations
    // ============================================================

    const LOG_TYPE = {
        ORDER_SYNC: '1',
        INVENTORY_SYNC: '2',
        FULFILLMENT_SYNC: '3',
        SETTLEMENT_SYNC: '4',
        RETURN_SYNC: '5',
        API_CALL: '6',
        PRICING_SYNC: '7',
        CATALOG_SYNC: '8',
        ERROR_RETRY: '9',
        FINANCIAL_RECON: '10',
        NOTIFICATION: '11',
        FBA_INVENTORY: '12',
        CANCELLATION: '13',
        DATA_ARCHIVAL: '14',
        FEED_TRACKING: '15'
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
        RETURNED: '5',
        PARTIALLY_SHIPPED: '6',
        INVOICE_UNCONFIRMED: '7',
        UNFULFILLABLE: '8'
    };

    const ORDER_TYPE = {
        SALES_ORDER: '1',
        CASH_SALE: '2'
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
        ERROR: '3',
        CREDIT_ISSUED: '4'
    };

    const ERROR_QUEUE_STATUS = {
        PENDING: '1',
        RETRYING: '2',
        RESOLVED: '3',
        FAILED: '4'
    };

    const ERROR_QUEUE_TYPE = {
        ORDER_CREATE: 'ORDER_CREATE',
        FULFILLMENT_SEND: 'FULFILLMENT_SEND',
        INVENTORY_FEED: 'INVENTORY_FEED',
        RETURN_PROCESS: 'RETURN_PROCESS',
        SETTLEMENT_PROCESS: 'SETTLEMENT_PROCESS',
        CREDIT_MEMO_CREATE: 'CREDIT_MEMO_CREATE',
        DEPOSIT_CREATE: 'DEPOSIT_CREATE',
        PRICING_UPDATE: 'PRICING_UPDATE',
        CANCEL_PROCESS: 'CANCEL_PROCESS',
        FBA_INVENTORY: 'FBA_INVENTORY',
        CATALOG_SYNC: 'CATALOG_SYNC'
    };

    // ============================================================
    // Amazon SP-API Endpoints & Configuration
    // ============================================================

    const SP_API_ENDPOINTS = {
        NORTH_AMERICA: 'https://sellingpartnerapi-na.amazon.com',
        EUROPE: 'https://sellingpartnerapi-eu.amazon.com',
        FAR_EAST: 'https://sellingpartnerapi-fe.amazon.com'
    };

    const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

    const MARKETPLACE_IDS = {
        // North America
        US: 'ATVPDKIKX0DER',
        CA: 'A2EUQ1WTGCTBG2',
        MX: 'A1AM78C64UM0Y8',
        BR: 'A2Q3Y263D00KWC',
        // Europe
        UK: 'A1F83G8C2ARO7P',
        DE: 'A1PA6795UKMFR9',
        FR: 'A13V1IB3VIYZZH',
        IT: 'APJ6JRA9NG5V4',
        ES: 'A1RKKUPIHCS9HS',
        NL: 'A1805IZSGTT6HS',
        SE: 'A2NODRKZP88ZB9',
        PL: 'A1C3SOZAPQ2R3W',
        TR: 'A33AVAJ2PDY3EV',
        AE: 'A2VIGQ35RCS4UG',
        SA: 'A17E79C6D8DWNP',
        EG: 'ARBP9OOSHTCHU',
        // Far East
        JP: 'A1VC38T7YXB528',
        AU: 'A39IBJ37TRP1C6',
        IN: 'A21TJRUUN4KGV',
        SG: 'A19VAU5U5O7RUS'
    };

    const FEED_TYPES = {
        INVENTORY: 'POST_INVENTORY_AVAILABILITY_DATA',
        FULFILLMENT: 'POST_ORDER_FULFILLMENT_DATA',
        PRICING: 'POST_PRODUCT_PRICING_DATA',
        PRODUCT: 'POST_PRODUCT_DATA',
        RELATIONSHIP: 'POST_PRODUCT_RELATIONSHIP_DATA',
        IMAGE: 'POST_PRODUCT_IMAGE_DATA',
        OVERRIDE: 'POST_PRODUCT_OVERRIDES_DATA'
    };

    const REPORT_TYPES = {
        SETTLEMENT: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2',
        FBA_RETURNS: 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA',
        FBA_INVENTORY: 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA',
        ACTIVE_LISTINGS: 'GET_MERCHANT_LISTINGS_DATA',
        ALL_LISTINGS: 'GET_MERCHANT_LISTINGS_ALL_DATA',
        CANCELED_LISTINGS: 'GET_MERCHANT_CANCELLED_LISTINGS_DATA',
        OPEN_LISTINGS: 'GET_FLAT_FILE_OPEN_LISTINGS_DATA',
        MFN_RETURNS: 'GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE',
        FBA_REIMBURSEMENTS: 'GET_FBA_REIMBURSEMENTS_DATA',
        ORDER_REPORT: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL'
    };

    // ============================================================
    // SP-API Rate Limits (requests per second)
    // ============================================================

    const RATE_LIMITS = {
        ORDERS_GET: { rate: 0.0167, burst: 20 },         // 1 req/min sustained, 20 burst
        ORDER_ITEMS_GET: { rate: 0.5, burst: 30 },
        ORDER_ADDRESS_GET: { rate: 0.5, burst: 30 },
        ORDER_BUYER_INFO_GET: { rate: 0.5, burst: 30 },
        FEEDS_POST: { rate: 2, burst: 15 },
        FEEDS_GET: { rate: 2, burst: 15 },
        REPORTS_POST: { rate: 0.0222, burst: 15 },
        REPORTS_GET: { rate: 2, burst: 15 },
        REPORTS_DOCUMENT_GET: { rate: 0.0167, burst: 15 },
        DEFAULT: { rate: 1, burst: 5 }
    };

    // ============================================================
    // Marketplace-to-Currency Mapping
    // ============================================================

    const MARKETPLACE_CURRENCY = {
        'ATVPDKIKX0DER': 'USD',    // US
        'A2EUQ1WTGCTBG2': 'CAD',   // Canada
        'A1AM78C64UM0Y8': 'MXN',   // Mexico
        'A2Q3Y263D00KWC': 'BRL',   // Brazil
        'A1F83G8C2ARO7P': 'GBP',   // UK
        'A1PA6795UKMFR9': 'EUR',   // Germany
        'A13V1IB3VIYZZH': 'EUR',   // France
        'APJ6JRA9NG5V4': 'EUR',    // Italy
        'A1RKKUPIHCS9HS': 'EUR',   // Spain
        'A1805IZSGTT6HS': 'EUR',   // Netherlands
        'A2NODRKZP88ZB9': 'SEK',   // Sweden
        'A1C3SOZAPQ2R3W': 'PLN',   // Poland
        'A33AVAJ2PDY3EV': 'TRY',   // Turkey
        'A2VIGQ35RCS4UG': 'AED',   // UAE
        'A17E79C6D8DWNP': 'SAR',   // Saudi Arabia
        'ARBP9OOSHTCHU': 'EGP',    // Egypt
        'A1VC38T7YXB528': 'JPY',   // Japan
        'A39IBJ37TRP1C6': 'AUD',   // Australia
        'A21TJRUUN4KGV': 'INR',    // India
        'A19VAU5U5O7RUS': 'SGD'    // Singapore
    };

    // ============================================================
    // Sync Interval Defaults (minutes)
    // ============================================================

    const SYNC_INTERVAL_DEFAULTS = {
        ORDER: 15,
        INVENTORY: 60,
        FULFILLMENT: 0,  // Real-time via User Event
        SETTLEMENT: 1440, // Daily
        RETURN: 240,      // 4 hours
        PRICING: 1440,    // Daily
        CATALOG: 1440,    // Daily
        ERROR_RETRY: 30
    };

    const CARRIER_MAP = {
        'ups': 'UPS',
        'fedex': 'FedEx',
        'usps': 'USPS',
        'dhl': 'DHL',
        'dhl express': 'DHL',
        'royal mail': 'Royal Mail',
        'canada post': 'Canada Post',
        'australia post': 'Australia Post',
        'deutsche post': 'Deutsche Post',
        'la poste': 'La Poste',
        'japan post': 'Japan Post',
        'yamato': 'Yamato Transport',
        'sagawa': 'Sagawa Express',
        'ontrac': 'OnTrac',
        'lasership': 'LaserShip',
        'amazon': 'Amazon',
        'amzl': 'AMZL_US'
    };

    // ============================================================
    // Script & Deployment IDs
    // ============================================================

    const SCRIPT_IDS = {
        SCHED_ORDER_SYNC: 'customscript_amz_ss_order_sync',
        SCHED_INV_SYNC: 'customscript_amz_ss_inv_sync',
        SCHED_SETTLE_SYNC: 'customscript_amz_ss_settle_sync',
        SCHED_RETURN_SYNC: 'customscript_amz_ss_return_sync',
        SCHED_PRICING_SYNC: 'customscript_amz_ss_pricing_sync',
        SCHED_CATALOG_SYNC: 'customscript_amz_ss_catalog_sync',
        SCHED_ERROR_RETRY: 'customscript_amz_ss_error_retry',
        SCHED_DATA_ARCHIVAL: 'customscript_amz_ss_data_archival',
        SCHED_FBA_INV_SYNC: 'customscript_amz_ss_fba_inv_sync',
        SCHED_CANCEL_SYNC: 'customscript_amz_ss_cancel_sync',
        MR_ORDER_IMPORT: 'customscript_amz_mr_order_import',
        MR_INV_EXPORT: 'customscript_amz_mr_inv_export',
        MR_SETTLE_PROCESS: 'customscript_amz_mr_settle_process',
        MR_RETURN_PROCESS: 'customscript_amz_mr_return_process',
        SL_CONFIG: 'customscript_amz_sl_config',
        RL_WEBHOOK: 'customscript_amz_rl_webhook',
        UE_FULFILL: 'customscript_amz_ue_fulfill',
        CS_CONFIG: 'customscript_amz_cs_config'
    };

    const DEPLOY_IDS = {
        SCHED_ORDER_SYNC: 'customdeploy_amz_ss_order_sync',
        SCHED_INV_SYNC: 'customdeploy_amz_ss_inv_sync',
        SCHED_SETTLE_SYNC: 'customdeploy_amz_ss_settle_sync',
        SCHED_RETURN_SYNC: 'customdeploy_amz_ss_return_sync',
        SCHED_PRICING_SYNC: 'customdeploy_amz_ss_pricing_sync',
        SCHED_CATALOG_SYNC: 'customdeploy_amz_ss_catalog_sync',
        SCHED_ERROR_RETRY: 'customdeploy_amz_ss_error_retry',
        SCHED_DATA_ARCHIVAL: 'customdeploy_amz_ss_data_archival',
        SCHED_FBA_INV_SYNC: 'customdeploy_amz_ss_fba_inv_sync',
        SCHED_CANCEL_SYNC: 'customdeploy_amz_ss_cancel_sync',
        MR_ORDER_IMPORT: 'customdeploy_amz_mr_order_import',
        MR_INV_EXPORT: 'customdeploy_amz_mr_inv_export',
        MR_SETTLE_PROCESS: 'customdeploy_amz_mr_settle_process',
        MR_RETURN_PROCESS: 'customdeploy_amz_mr_return_process',
        SL_CONFIG: 'customdeploy_amz_sl_config',
        RL_WEBHOOK: 'customdeploy_amz_rl_webhook',
        UE_FULFILL: 'customdeploy_amz_ue_fulfill',
        CS_CONFIG: 'customdeploy_amz_cs_config'
    };

    return {
        CUSTOM_RECORDS,
        LOG_TYPE,
        LOG_STATUS,
        ORDER_STATUS,
        ORDER_TYPE,
        FULFILLMENT_CHANNEL,
        SETTLEMENT_STATUS,
        RETURN_STATUS,
        ERROR_QUEUE_STATUS,
        ERROR_QUEUE_TYPE,
        SP_API_ENDPOINTS,
        LWA_TOKEN_URL,
        MARKETPLACE_IDS,
        MARKETPLACE_CURRENCY,
        RATE_LIMITS,
        SYNC_INTERVAL_DEFAULTS,
        FEED_TYPES,
        REPORT_TYPES,
        CARRIER_MAP,
        SCRIPT_IDS,
        DEPLOY_IDS
    };
});
