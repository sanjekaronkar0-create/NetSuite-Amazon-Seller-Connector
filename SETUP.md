# NetSuite Amazon Seller Connector - Setup & Usage Guide

A production-grade integration between Amazon Seller Central (SP-API) and NetSuite ERP. Automates bi-directional synchronization of orders, inventory, settlements, returns, pricing, and catalog data.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Amazon SP-API Setup](#amazon-sp-api-setup)
3. [NetSuite Account Setup](#netsuite-account-setup)
4. [Deploying the Connector](#deploying-the-connector)
5. [Configuring the Connector](#configuring-the-connector)
6. [Sync Operations](#sync-operations)
7. [Architecture Overview](#architecture-overview)
8. [Custom Records Reference](#custom-records-reference)
9. [Error Handling & Retry](#error-handling--retry)
10. [Monitoring & Logging](#monitoring--logging)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Amazon Requirements

- An active **Amazon Seller Central** account
- **Amazon SP-API** developer registration approved
- SP-API application registered in Amazon Developer Console
- **LWA (Login with Amazon)** credentials:
  - Client ID
  - Client Secret
  - Refresh Token

### NetSuite Requirements

- NetSuite account with **SuiteCloud** enabled
- The following NetSuite features must be active:
  - Server-Side Scripting (`SERVERSIDESCRIPTING`)
  - Custom Records (`CUSTOMRECORDS`)
  - Advanced Printing (`ADVANCEDPRINTING`)
  - Create SuiteBundles (`CREATESUITEBUNDLES`)
- Optional features (enable if applicable):
  - Subsidiaries (`SUBSIDIARIES`)
  - Multi-Currency (`MULTICURRENCY`)
  - Multi-Location Inventory (`MULTILOCINVT`)

### Tools

- **SuiteCloud CLI** (`@oracle/suitecloud-cli`) or **SuiteCloud IDE** (Eclipse/WebStorm plugin)
- Node.js (for SuiteCloud CLI)

---

## Amazon SP-API Setup

### 1. Register as a Developer

1. Go to [Amazon Seller Central](https://sellercentral.amazon.com/) > **Apps & Services** > **Develop Apps**
2. Register your developer profile
3. Wait for approval

### 2. Create an SP-API Application

1. In Seller Central, go to **Apps & Services** > **Develop Apps** > **Add new app client**
2. Select the API type: **SP API**
3. Choose the IAM ARN for your application
4. Select the required API sections:
   - Orders API
   - Feeds API
   - Reports API
5. Submit for approval

### 3. Obtain LWA Credentials

After your app is approved:

1. Go to your app's **LWA Credentials** section
2. Note down the **Client ID** and **Client Secret**
3. Generate a **Refresh Token** by authorizing your app:
   - Use the self-authorization flow in Seller Central
   - Or use the OAuth authorization URL workflow

> **Important:** Store these credentials securely. You will enter them in NetSuite during configuration.

### Supported Marketplaces

| Region | Marketplace | Marketplace ID | Endpoint |
|--------|------------|----------------|----------|
| **North America** | US | ATVPDKIKX0DER | sellingpartnerapi-na.amazon.com |
| | Canada | A2EUQ1WTGCTBG2 | sellingpartnerapi-na.amazon.com |
| | Mexico | A1AM78C64UM0Y8 | sellingpartnerapi-na.amazon.com |
| | Brazil | A2Q3Y263D00KWC | sellingpartnerapi-na.amazon.com |
| **Europe** | UK | A1F83G8C2ARO7P | sellingpartnerapi-eu.amazon.com |
| | Germany | A1PA6795UKMFR9 | sellingpartnerapi-eu.amazon.com |
| | France | A13V1IB3VIYZZH | sellingpartnerapi-eu.amazon.com |
| | Italy | APJ6JRA9NG5V4 | sellingpartnerapi-eu.amazon.com |
| | Spain | A1RKKUPIHCS9HS | sellingpartnerapi-eu.amazon.com |
| **Far East** | Japan | A1VC38T7YXB528 | sellingpartnerapi-fe.amazon.com |
| | Australia | A39IBJ37TRP1C6 | sellingpartnerapi-fe.amazon.com |
| | India | A21TJRUUN4KGV | sellingpartnerapi-fe.amazon.com |
| | Singapore | A19VAU5U5O7RUS | sellingpartnerapi-fe.amazon.com |

---

## NetSuite Account Setup

### 1. Enable Required Features

Navigate to **Setup** > **Company** > **Enable Features**:

- Under **SuiteCloud**: Enable Server SuiteScript, Client SuiteScript, Custom Records
- Under **Transactions**: Enable Advanced Printing
- Under **Company** (if applicable): Enable Subsidiaries, Multi-Currency, Multi-Location Inventory

### 2. Create Required NetSuite Records

Before deploying, ensure these exist in your account:

#### Customer Records

Create a **generic customer** record for Amazon orders (e.g., "Amazon Marketplace Customer"). This customer will be the default buyer on imported sales orders. If using FBA, create a separate customer for FBA orders.

#### Items

Set up NetSuite items for Amazon-specific charges:

| Purpose | Example Item Name | Item Type |
|---------|------------------|-----------|
| Shipping charges | Amazon Shipping Charge | Other Charge Item |
| Discounts | Amazon Promotion Discount | Discount Item |
| Tax | Amazon Tax | Tax Item |

#### Financial Accounts

Create or identify accounts for settlement reconciliation:

| Purpose | Account Type |
|---------|-------------|
| Settlement Bank Account | Bank |
| Selling Fee Expense | Expense |
| FBA Fee Expense | Expense |
| Refund Account | Expense / Other Current Liability |
| Promotional Rebate | Expense |

---

## Deploying the Connector

### Option A: SuiteCloud CLI (Recommended)

1. **Install the SuiteCloud CLI:**

   ```bash
   npm install -g @oracle/suitecloud-cli
   ```

2. **Set up authentication:**

   ```bash
   suitecloud account:setup
   ```

   Follow the prompts to connect to your NetSuite account using token-based authentication.

3. **Validate the project:**

   ```bash
   suitecloud project:validate
   ```

4. **Deploy to NetSuite:**

   ```bash
   suitecloud project:deploy
   ```

   This will upload all scripts, custom records, and deployment configurations to your NetSuite account.

### Option B: SuiteCloud IDE (Eclipse/WebStorm)

1. Import the project into your IDE
2. Connect to your NetSuite account
3. Right-click the project > **Deploy to Account**

### Option C: Manual File Upload

1. Navigate to **Customization** > **Scripting** > **Scripts** > **File Cabinet**
2. Create a folder: `SuiteScripts/AmazonConnector/`
3. Upload all files from `src/FileCabinet/SuiteScripts/AmazonConnector/` preserving the directory structure
4. Manually create custom records via **Customization** > **Lists, Records, & Fields** > **Record Types** using the XML definitions in `src/Objects/`

### What Gets Deployed

| Component | Count | Description |
|-----------|-------|-------------|
| Custom Records | 7 | Configuration, Order Map, Item Map, Settlement, Return Map, Error Queue, Integration Log |
| Custom Lists | Several | Enumerations for statuses and types |
| Scheduled Scripts | 7 | Order, Inventory, Settlement, Return, Pricing, Catalog sync + Error Retry |
| Map/Reduce Scripts | 4 | Order Import, Inventory Export, Settlement Processing, Return Processing |
| Suitelet | 1 | Configuration dashboard |
| RESTlet | 1 | Webhook receiver |
| User Event Script | 1 | Item fulfillment handler |
| Client Script | 1 | Config UI helpers |

---

## Configuring the Connector

### 1. Open the Configuration Dashboard

After deployment, navigate to the Suitelet:

- Go to **Customization** > **Scripting** > **Scripts**
- Find `Amazon Connector - Config Dashboard` (script ID: `customscript_amz_sl_config`)
- Click the **deployment link** to open the dashboard

### 2. Create a Marketplace Configuration

Create a new **Amazon Connector Configuration** record:

1. Go to **Lists** > **Custom** > **Amazon Connector Config** > **New**
2. Fill in the required fields:

#### Amazon Credentials

| Field | Value |
|-------|-------|
| **Marketplace** | Select your marketplace (e.g., US) |
| **Seller ID** | Your Amazon Merchant/Seller ID |
| **Client ID** | SP-API LWA Client ID |
| **Client Secret** | SP-API LWA Client Secret |
| **Refresh Token** | SP-API LWA Refresh Token |
| **Endpoint** | SP-API endpoint URL (e.g., `https://sellingpartnerapi-na.amazon.com`) |
| **Marketplace ID** | Marketplace code (e.g., `ATVPDKIKX0DER` for US) |

#### NetSuite Mapping

| Field | Value |
|-------|-------|
| **Subsidiary** | Your NetSuite subsidiary |
| **Location** | Default warehouse for MFN orders |
| **Customer** | Default Amazon customer record |
| **Payment Method** | Payment method for cash sales |
| **Order Type** | Sales Order or Cash Sale |

#### Sync Toggles

Enable the sync operations you need:

- **Order Sync Enabled** - Import Amazon orders into NetSuite
- **Inventory Sync Enabled** - Push NetSuite inventory to Amazon
- **Fulfillment Sync Enabled** - Send fulfillment data to Amazon
- **Settlement Sync Enabled** - Process settlement reports
- **Returns Sync Enabled** - Process Amazon returns
- **Pricing Sync Enabled** - Push NetSuite prices to Amazon
- **Catalog Sync Enabled** - Sync product catalog data

#### Financial Accounts

Map your NetSuite accounts for settlement processing:

| Field | Purpose |
|-------|---------|
| Settlement Bank Account | Where Amazon deposits land |
| Selling Fee Expense Account | Amazon selling/referral fees |
| FBA Fee Expense Account | FBA fulfillment fees |
| Refund Account | Refund expenses |
| Promotional Rebate Account | Promotional costs |

#### Special Items

| Field | Purpose |
|-------|---------|
| Shipping Charge Item | Used for shipping line items on orders |
| Discount Item | Used for promotional discounts on orders |
| Tax Item | Used for tax lines |
| Tax Code | Default tax code |

#### FBA Settings (Optional)

If you sell via FBA:

| Field | Value |
|-------|-------|
| Import FBA Orders | Check to import FBA orders |
| FBA Warehouse Location | Separate location for FBA inventory |
| FBA Customer | Separate customer for FBA orders |

### 3. Set Up Item Mappings

Create **Amazon Item Mapping** records to link Amazon SKUs to NetSuite items:

1. Go to **Lists** > **Custom** > **Amazon Item Map** > **New**
2. Fill in:

| Field | Value |
|-------|-------|
| ASIN | Amazon Standard Identification Number |
| Seller SKU | Your Amazon seller SKU |
| NetSuite Item | Link to the NS inventory item |
| Inventory Sync | Check to enable inventory push for this item |
| Price Sync | Check to enable price push for this item |
| Configuration | Link to the marketplace config |

> **Note:** If no item mapping exists, the connector will attempt to resolve items by matching the Amazon SKU against NetSuite item Name, UPC, or External ID.

---

## Sync Operations

### Automatic (Scheduled)

Configure scheduled deployments for each sync type:

1. Go to **Customization** > **Scripting** > **Script Deployments**
2. Find the deployment for each sync script
3. Set the **Schedule**:
   - **Order Sync**: Recommended every 15-30 minutes
   - **Inventory Sync**: Recommended every 1-4 hours
   - **Settlement Sync**: Recommended daily
   - **Return Sync**: Recommended every 1-4 hours
   - **Pricing Sync**: Recommended daily or as needed
   - **Error Retry**: Recommended every 30-60 minutes

### Manual Trigger

From the **Configuration Dashboard** Suitelet:

1. Open the dashboard
2. Go to the **Sync Controls** tab
3. Click the button for the sync you want to trigger:
   - Trigger Order Sync
   - Trigger Inventory Sync
   - Trigger Settlement Sync
   - Trigger Return Sync
   - Trigger Pricing Sync
   - Trigger Catalog Sync
   - Trigger Error Retry

### Webhook (Real-Time)

The RESTlet webhook can receive Amazon notifications:

- **Endpoint**: Your NetSuite RESTlet URL for `customscript_amz_rl_webhook`
- **Supported Events**:
  - `ORDER_STATUS_CHANGE` - Real-time order status updates
  - `RETURN_CREATED` - Immediate return processing
  - `TRIGGER_SYNC` - Remote sync trigger

---

## Architecture Overview

### Data Flow

```
Amazon Seller Central                    NetSuite ERP
========================                 =======================

Orders ─────────────────────────────────> Sales Orders / Cash Sales
                                          (via Order Sync)

Returns ────────────────────────────────> RMAs / Credit Memos
                                          (via Return Sync)

Settlement Reports ─────────────────────> Deposits / Journal Entries
                                          (via Settlement Sync)

                   <───────────────────── Inventory Levels
                   (via Inventory Sync)

                   <───────────────────── Pricing
                   (via Pricing Sync)

                   <───────────────────── Catalog Data
                   (via Catalog Sync)

                   <───────────────────── Fulfillment / Tracking
                   (via Fulfillment Sync)
```

### Script Types

| Type | Purpose | Example |
|------|---------|---------|
| **Scheduled Scripts** | Polling-based sync triggers | `ss_order_sync.js` |
| **Map/Reduce Scripts** | High-volume bulk processing | `mr_order_import.js` |
| **Suitelet** | Admin dashboard UI | `sl_config.js` |
| **RESTlet** | Webhook / API endpoint | `rl_webhook.js` |
| **User Event** | Record-triggered actions | `ue_item_fulfillment.js` |
| **Client Script** | Browser-side UI logic | `cs_config.js` |

### Project Structure

```
src/
├── FileCabinet/SuiteScripts/AmazonConnector/
│   ├── lib/                    # Core libraries
│   │   ├── amazonAuth.js       # OAuth token management
│   │   ├── amazonClient.js     # SP-API HTTP client
│   │   ├── configHelper.js     # Configuration loader
│   │   ├── constants.js        # IDs, enums, endpoints
│   │   ├── errorQueue.js       # Retry queue management
│   │   └── logger.js           # Logging service
│   ├── services/               # Business logic
│   │   ├── orderService.js     # Order import
│   │   ├── inventoryService.js # Inventory export
│   │   ├── pricingService.js   # Pricing export
│   │   ├── returnService.js    # Return processing
│   │   ├── settlementService.js# Settlement processing
│   │   ├── financialService.js # Deposits & journals
│   │   ├── fulfillmentService.js # Shipping/ASN
│   │   └── catalogService.js   # Catalog sync
│   ├── scheduled/              # Scheduled sync scripts
│   ├── mapreduce/              # Bulk processing scripts
│   ├── suitelet/               # Dashboard UI
│   ├── restlet/                # Webhook endpoint
│   ├── userevent/              # Record event handlers
│   └── client/                 # Client-side scripts
├── Objects/                    # Custom record XML definitions
├── manifest.xml                # NetSuite project manifest
└── deploy.xml                  # Deployment configuration
```

---

## Custom Records Reference

| Record | Script ID | Purpose |
|--------|-----------|---------|
| **Connector Config** | `customrecord_amz_connector_config` | Marketplace credentials, sync settings, account mappings |
| **Order Map** | `customrecord_amz_order_map` | Amazon order <-> NetSuite transaction cross-reference |
| **Item Map** | `customrecord_amz_item_map` | Amazon SKU/ASIN <-> NetSuite item mapping |
| **Settlement** | `customrecord_amz_settlement` | Settlement report data and financial breakdown |
| **Return Map** | `customrecord_amz_return_map` | Amazon return <-> NetSuite RMA/credit memo mapping |
| **Error Queue** | `customrecord_amz_error_queue` | Failed operations queued for automatic retry |
| **Integration Log** | `customrecord_amz_integration_log` | Audit trail of all sync operations |

---

## Error Handling & Retry

The connector includes an automatic retry system with exponential backoff:

1. When any sync operation fails, it is added to the **Error Queue**
2. The `ss_error_retry.js` scheduled script processes pending retries
3. Retry timing uses exponential backoff: `delay = 30min x 2^(retryCount)`
   - 1st retry: 30 minutes
   - 2nd retry: 60 minutes
   - 3rd retry: 120 minutes
4. After reaching the maximum retry count (default: 3), the item is marked as **Failed**
5. Failed items can be manually retried from the dashboard

### Retryable Operation Types

- `ORDER_CREATE` - Sales order creation
- `FULFILLMENT_SEND` - Fulfillment feed to Amazon
- `INVENTORY_FEED` - Inventory update feed
- `RETURN_PROCESS` - Return/RMA processing
- `SETTLEMENT_PROCESS` - Settlement reconciliation
- `CREDIT_MEMO_CREATE` - Credit memo creation
- `DEPOSIT_CREATE` - Deposit creation
- `PRICING_UPDATE` - Pricing feed

---

## Monitoring & Logging

### Integration Logs

All sync operations create **Integration Log** records viewable at:
- **Lists** > **Custom** > **Amazon Integration Log**

Log types: Order Sync, Inventory Sync, Fulfillment, Settlement, Return, API Call, Pricing, Catalog, Error Retry, Financial Recon

Log statuses: Success, Error, Warning, In Progress

### Dashboard

The Suitelet dashboard provides:

- **Marketplace Configurations** tab: View all configs with sync status
- **Recent Integration Logs** tab: Last 50 operations with details
- **Order Statistics** tab: Summary metrics
- **Sync Controls** tab: Manual trigger buttons

### SuiteScript Logs

Standard SuiteScript execution logs are available at:
- **Customization** > **Scripting** > **Script Execution Logs**

---

## Troubleshooting

### Authentication Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| 403 from Amazon API | Expired or invalid refresh token | Regenerate the refresh token in Seller Central and update the config |
| Token request fails | Wrong Client ID/Secret | Verify LWA credentials in the config record |
| Repeated 403 errors | App authorization revoked | Re-authorize your SP-API app in Seller Central |

### Order Sync Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Orders not importing | Order sync not enabled | Check the "Order Sync Enabled" toggle in config |
| Duplicate orders | Mapping record check failed | Verify `customrecord_amz_order_map` records |
| Missing line items | SKU not mapped | Create an item mapping record or ensure the item Name/UPC/External ID matches the Amazon SKU |
| "Cannot find item" | No matching NS item | Create the item in NetSuite and add an item mapping |

### Inventory Sync Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Inventory not updating | Feed submission failed | Check integration logs for Amazon feed errors |
| Wrong quantities | Wrong location configured | Verify the Location field in the config |
| Items skipped | Inventory Sync not checked | Enable "Inventory Sync" on the item mapping record |

### Settlement Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| No settlements imported | Reports not yet available | Amazon settlement reports have a delay; wait and retry |
| Financial mismatch | Account mapping wrong | Verify financial account fields in the config |
| Deposits not created | Auto-Create Deposits unchecked | Enable in config or create manually |

### General

| Symptom | Cause | Fix |
|---------|-------|-----|
| Script governance errors | Too many records processed | Reduce batch sizes or add more scheduled deployments |
| "UNEXPECTED_ERROR" | NetSuite internal error | Check SuiteScript execution logs for details |
| Sync not running | Deployment inactive/unscheduled | Verify script deployment status and schedule |

### Getting Help

1. Check the **Integration Logs** for detailed error messages
2. Review **SuiteScript Execution Logs** for script-level errors
3. Check the **Error Queue** for failed operations and retry status
4. Use the dashboard **Sync Controls** to manually trigger a sync for testing
