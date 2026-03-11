# Amazon Seller Central Sandbox Setup Guide

Step-by-step guide to configure an Amazon Seller Central sandbox environment for testing the NetSuite Amazon Seller Connector before going live.

---

## Table of Contents

1. [Overview](#overview)
2. [Step 1: Register as an Amazon SP-API Developer](#step-1-register-as-an-amazon-sp-api-developer)
3. [Step 2: Create an SP-API Application](#step-2-create-an-sp-api-application)
4. [Step 3: Obtain LWA Credentials](#step-3-obtain-lwa-credentials)
5. [Step 4: Understand the SP-API Sandbox](#step-4-understand-the-sp-api-sandbox)
6. [Step 5: Configure the Connector for Sandbox Testing](#step-5-configure-the-connector-for-sandbox-testing)
7. [Step 6: Test Each Integration Point](#step-6-test-each-integration-point)
8. [Step 7: Switch to Production](#step-7-switch-to-production)
9. [Credential Reference](#credential-reference)
10. [Marketplace IDs & Endpoints](#marketplace-ids--endpoints)
11. [Troubleshooting](#troubleshooting)

---

## Overview

Amazon SP-API provides a **built-in sandbox environment** that returns static, pre-defined responses for API calls. This lets you verify your integration logic without affecting real orders, inventory, or financial data.

**Key points about the SP-API Sandbox:**
- Uses the **same credentials** (Client ID, Client Secret, Refresh Token) as production
- Uses the **same endpoints** as production
- Sandbox mode is activated by calling sandbox-specific API paths (prefixed with `/sandbox/`)
- Returns static mock responses defined by Amazon
- No real orders or data are created or modified

---

## Step 1: Register as an Amazon SP-API Developer

### Where to go
Amazon Seller Central → **Apps & Services** → **Develop Apps**

### Steps

1. **Log in** to [Amazon Seller Central](https://sellercentral.amazon.com/) with your seller account
2. Navigate to the **Apps & Services** menu in the top navigation bar
3. Click **Develop Apps**
4. If you haven't registered as a developer yet, click **Register** and complete the developer profile:
   - **Organization name**: Your company name
   - **Organization address**: Your business address
   - **Data Protection Officer contact**: Required for EU marketplaces
   - **Primary contact**: Name, email, phone
5. **Submit** and wait for Amazon's approval (typically 1-3 business days)
6. You will receive an email once approved

### What you get from this step
- Developer account status: **Approved**

---

## Step 2: Create an SP-API Application

### Where to go
Seller Central → **Apps & Services** → **Develop Apps** → **Add new app client**

### Steps

1. Click **Add new app client**
2. Fill in the application details:
   - **App name**: e.g., "NetSuite Amazon Connector"
   - **API Type**: Select **SP API**
   - **IAM ARN**: You need an AWS IAM Role ARN (see below)
3. Select the **API sections** your app needs access to:

   | API Section | Required | Purpose |
   |-------------|----------|---------|
   | **Orders API** | Yes | Import orders into NetSuite |
   | **Feeds API** | Yes | Push inventory, pricing, fulfillment data |
   | **Reports API** | Yes | Download settlement and return reports |
   | **Catalog Items API** | Optional | Catalog sync |
   | **Product Pricing API** | Optional | Pricing sync |

4. Click **Submit** — approval is usually instant for self-authorized apps

### Setting Up the AWS IAM Role (Required)

Amazon SP-API requires an AWS IAM Role for authentication:

1. Sign in to the [AWS Console](https://console.aws.amazon.com/)
2. Go to **IAM** → **Roles** → **Create role**
3. Choose **Another AWS account** and enter Amazon's account ID: `437568002678`
4. Attach a policy with these permissions:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "execute-api:Invoke",
         "Resource": "arn:aws:execute-api:*:*:*"
       }
     ]
   }
   ```
5. Name the role (e.g., `AmazonSPAPIRole`) and create it
6. Copy the **Role ARN** (e.g., `arn:aws:iam::123456789012:role/AmazonSPAPIRole`)
7. Paste this ARN into the SP-API app registration form

### What you get from this step

| Value | Where to find it | Used for |
|-------|------------------|----------|
| **IAM Role ARN** | AWS Console → IAM → Roles | SP-API app registration |
| **App Client ID** | Seller Central → Develop Apps → Your app | This becomes your LWA Client ID |

---

## Step 3: Obtain LWA Credentials

LWA (Login with Amazon) credentials are the core authentication mechanism for SP-API.

### Where to go
Seller Central → **Apps & Services** → **Develop Apps** → Click on your app name

### Values to collect

#### 3a. Client ID and Client Secret

1. In your app details page, find the **LWA Credentials** section
2. Copy the **Client ID** — looks like: `amzn1.application-oa2-client.xxxxxxxxxx`
3. Click **View Secret** to reveal and copy the **Client Secret**

> **Store these securely.** The Client Secret is only shown once. If lost, you must generate a new one.

#### 3b. Refresh Token (Self-Authorization)

For a **self-authorized** app (your own seller account):

1. On your app details page, click **Authorize** (or the edit icon next to "OAuth")
2. In the authorization popup, click **Generate refresh token**
3. Copy the **Refresh Token** — looks like: `Atzr|xxxxxxxxxx`

> **This token does not expire** but can be revoked. Store it securely.

### Complete credentials summary

| Credential | Example Format | Where to find |
|-----------|---------------|---------------|
| **Client ID** | `amzn1.application-oa2-client.abc123...` | App details → LWA Credentials |
| **Client Secret** | `amzn1.oa2-cs.v1.abc123...` | App details → LWA Credentials → View Secret |
| **Refresh Token** | `Atzr\|IwEBIxxxxxxxxx...` | App details → Authorize → Generate refresh token |
| **Seller ID** | `A1B2C3D4E5F6G7` (14-char alphanumeric) | Seller Central → Settings → Account Info → Merchant Token |
| **Marketplace ID** | `ATVPDKIKX0DER` (for US) | See [Marketplace IDs table](#marketplace-ids--endpoints) |

---

## Step 4: Understand the SP-API Sandbox

### How the Sandbox Works

Amazon SP-API does **not** have a separate sandbox account or environment. Instead:

- **Same credentials** are used for both sandbox and production
- **Same regional endpoints** are used
- Sandbox calls use specific **request parameters** documented by Amazon that trigger static responses
- Each API has a set of predefined sandbox test cases

### Sandbox Call Pattern

Production call:
```
GET https://sellingpartnerapi-na.amazon.com/orders/v0/orders?MarketplaceIds=ATVPDKIKX0DER
```

Sandbox call (same endpoint, uses sandbox-specific test parameters):
```
GET https://sandbox.sellingpartnerapi-na.amazon.com/orders/v0/orders
```

**Important:** The sandbox endpoint prefix is `sandbox.` added before the regional endpoint.

### Sandbox Endpoints

| Region | Production Endpoint | Sandbox Endpoint |
|--------|-------------------|-----------------|
| North America | `sellingpartnerapi-na.amazon.com` | `sandbox.sellingpartnerapi-na.amazon.com` |
| Europe | `sellingpartnerapi-eu.amazon.com` | `sandbox.sellingpartnerapi-eu.amazon.com` |
| Far East | `sellingpartnerapi-fe.amazon.com` | `sandbox.sellingpartnerapi-fe.amazon.com` |

### Sandbox Limitations

- Returns **static mock data** only — not real account data
- Cannot create actual orders, feeds, or reports
- Test cases are predefined by Amazon (documented per API)
- Useful for verifying authentication and request/response parsing

---

## Step 5: Configure the Connector for Sandbox Testing

### In NetSuite

1. **Deploy** the connector (see `SETUP.md`)
2. Go to **Lists** → **Custom** → **Amazon Connector Config** → **New**
3. Fill in the configuration with your sandbox settings:

#### Amazon Credentials (Same for sandbox and production)

| Config Field | Value to Enter | Where You Got It |
|-------------|---------------|-----------------|
| **Marketplace** | Select your marketplace (e.g., US) | — |
| **Seller ID** | Your Merchant Token | Seller Central → Settings → Account Info |
| **Client ID** | Your LWA Client ID | App details → LWA Credentials |
| **Client Secret** | Your LWA Client Secret | App details → LWA Credentials |
| **Refresh Token** | Your LWA Refresh Token | App details → Authorize |
| **Endpoint** | `https://sandbox.sellingpartnerapi-na.amazon.com` | Use sandbox prefix |
| **Marketplace ID** | `ATVPDKIKX0DER` (for US) | See marketplace table |

> **Key difference for sandbox:** Use `sandbox.sellingpartnerapi-na.amazon.com` as the endpoint instead of `sellingpartnerapi-na.amazon.com`.

#### NetSuite Mapping (Use test/sandbox values)

| Config Field | Recommendation |
|-------------|---------------|
| **Subsidiary** | Your test subsidiary |
| **Location** | A test warehouse location |
| **Customer** | Create a test customer (e.g., "Amazon Sandbox Customer") |
| **Payment Method** | Any valid payment method |
| **Order Type** | Sales Order (for testing) |

#### Financial Accounts (Use test accounts)

| Config Field | Recommendation |
|-------------|---------------|
| Settlement Bank Account | Test bank account |
| Selling Fee Expense | Test expense account |
| FBA Fee Expense | Test expense account |
| Refund Account | Test expense account |
| Promotional Rebate Account | Test expense account |

#### Sync Toggles

Enable only the syncs you want to test. Start with **Order Sync** enabled and others disabled, then enable one at a time.

---

## Step 6: Test Each Integration Point

### Test 1: Authentication

Verify the connector can obtain an access token:

1. Open the Configuration Dashboard Suitelet
2. If the dashboard loads marketplace data without errors, authentication is working
3. Check **Integration Logs** for any authentication errors

### Test 2: Order Sync

1. Enable **Order Sync** in your config
2. Trigger a manual order sync from the dashboard
3. The sandbox will return mock order data
4. Verify a Sales Order or Cash Sale is created in NetSuite
5. Check the **Order Map** custom record for the mapping entry

### Test 3: Inventory Sync

1. Enable **Inventory Sync** in your config
2. Create an **Item Mapping** record linking an Amazon SKU to a NetSuite item
3. Trigger inventory sync
4. Check **Integration Logs** for the feed submission result

### Test 4: Settlement Sync

1. Enable **Settlement Sync** in your config
2. Trigger settlement sync
3. Verify the sandbox returns mock settlement data
4. Check the **Settlement** custom records

### Test 5: Fulfillment

1. Create a test Sales Order in NetSuite (from order sync or manually)
2. Create an Item Fulfillment with a tracking number
3. The User Event script should trigger and attempt to send fulfillment data to Amazon
4. Check **Integration Logs** for the feed result

---

## Step 7: Switch to Production

Once testing is complete:

1. **Edit** your Amazon Connector Config record
2. **Change the Endpoint** from sandbox to production:

   | From (Sandbox) | To (Production) |
   |----------------|-----------------|
   | `https://sandbox.sellingpartnerapi-na.amazon.com` | `https://sellingpartnerapi-na.amazon.com` |
   | `https://sandbox.sellingpartnerapi-eu.amazon.com` | `https://sellingpartnerapi-eu.amazon.com` |
   | `https://sandbox.sellingpartnerapi-fe.amazon.com` | `https://sellingpartnerapi-fe.amazon.com` |

3. **Update NetSuite mappings** to point to production subsidiary, location, customer, and financial accounts
4. **Enable sync toggles** one at a time, verifying each before enabling the next
5. **Set up scheduled deployments** with appropriate intervals (see `SETUP.md`)

> **Tip:** Consider creating a **separate** config record for production rather than editing the sandbox one, so you can keep the sandbox config for future testing.

---

## Credential Reference

### Complete list of values needed and where to find them

| # | Value | Where to Get It | Example |
|---|-------|----------------|---------|
| 1 | **Seller ID (Merchant Token)** | Seller Central → Settings → Account Info → Your Merchant Token | `A1B2C3D4E5F6G7` |
| 2 | **LWA Client ID** | Seller Central → Apps & Services → Develop Apps → Your App → LWA Credentials | `amzn1.application-oa2-client.abc123` |
| 3 | **LWA Client Secret** | Same page → Click "View Secret" | `amzn1.oa2-cs.v1.abc123` |
| 4 | **LWA Refresh Token** | Same page → Authorize → Generate Refresh Token | `Atzr\|IwEBIxxx...` |
| 5 | **Marketplace ID** | See table below (fixed per marketplace) | `ATVPDKIKX0DER` (US) |
| 6 | **SP-API Endpoint** | See table below (fixed per region) | `sellingpartnerapi-na.amazon.com` |
| 7 | **AWS IAM Role ARN** | AWS Console → IAM → Roles | `arn:aws:iam::123456789012:role/AmazonSPAPIRole` |

---

## Marketplace IDs & Endpoints

### North America

| Country | Marketplace ID | Endpoint |
|---------|---------------|----------|
| United States | `ATVPDKIKX0DER` | `sellingpartnerapi-na.amazon.com` |
| Canada | `A2EUQ1WTGCTBG2` | `sellingpartnerapi-na.amazon.com` |
| Mexico | `A1AM78C64UM0Y8` | `sellingpartnerapi-na.amazon.com` |
| Brazil | `A2Q3Y263D00KWC` | `sellingpartnerapi-na.amazon.com` |

### Europe

| Country | Marketplace ID | Endpoint |
|---------|---------------|----------|
| United Kingdom | `A1F83G8C2ARO7P` | `sellingpartnerapi-eu.amazon.com` |
| Germany | `A1PA6795UKMFR9` | `sellingpartnerapi-eu.amazon.com` |
| France | `A13V1IB3VIYZZH` | `sellingpartnerapi-eu.amazon.com` |
| Italy | `APJ6JRA9NG5V4` | `sellingpartnerapi-eu.amazon.com` |
| Spain | `A1RKKUPIHCS9HS` | `sellingpartnerapi-eu.amazon.com` |

### Far East

| Country | Marketplace ID | Endpoint |
|---------|---------------|----------|
| Japan | `A1VC38T7YXB528` | `sellingpartnerapi-fe.amazon.com` |
| Australia | `A39IBJ37TRP1C6` | `sellingpartnerapi-fe.amazon.com` |
| India | `A21TJRUUN4KGV` | `sellingpartnerapi-fe.amazon.com` |
| Singapore | `A19VAU5U5O7RUS` | `sellingpartnerapi-fe.amazon.com` |

---

## Troubleshooting

### Common Sandbox Issues

| Issue | Cause | Solution |
|-------|-------|---------|
| `InvalidSignature` error | Clock skew or incorrect credentials | Verify Client ID, Client Secret, and Refresh Token are correct |
| `AccessDenied` on sandbox | App not approved for the API section | Check your app's approved API sections in Seller Central |
| Empty/null responses | Using wrong sandbox test parameters | Review Amazon's sandbox documentation for the specific API |
| `UnrecognizedClientException` | Wrong Client ID | Double-check the Client ID from your app's LWA Credentials |
| Token refresh fails | Client Secret changed or token revoked | Re-generate the Refresh Token in Seller Central |
| 403 Forbidden | App authorization expired | Re-authorize the app: App details → Authorize |
| Sandbox returns production data | Not using sandbox endpoint | Ensure endpoint starts with `sandbox.` |

### Verifying Your Credentials

To test your credentials independently (outside of NetSuite), you can use curl:

```bash
curl -X POST https://api.amazon.com/auth/o2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "refresh_token=YOUR_REFRESH_TOKEN"
```

A successful response returns:
```json
{
  "access_token": "Atza|xxxxxxxxx...",
  "refresh_token": "Atzr|xxxxxxxxx...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

If this works, your LWA credentials are valid and you can proceed with configuring the connector.
