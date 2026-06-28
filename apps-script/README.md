# Google Apps Script Backend

This folder contains the complete Google Apps Script backend for the
**Smart Invoice & Billing Management System**.

It syncs all data to **Google Sheets**, saves PDFs to **Google Drive**,
sends invoice emails via **Gmail**, and sends WhatsApp messages via the
**WhatsApp Cloud API**.

---

## Quick Setup (5 minutes)

### Step 1 – Create the Script

1. Go to [script.google.com](https://script.google.com) and click **New Project**
2. Name it: `Smart Invoice Backend`
3. Replace the default `Code.gs` content with the contents of [`Code.gs`](file:///c:/Users/hp/Downloads/smart-bill-send-main/smart-bill-send-main/apps-script/Code.gs)

### Step 2 – Run Setup

1. In the script editor, select function **`setup`** from the dropdown menu in the toolbar
2. Click **Run** → Authorize the requested permissions (Sheets + Drive + Mail + URL Fetch)
3. This automatically creates:
   - A Google Spreadsheet `Smart Invoice — Master Sheet` in your Google Drive with all required sheets
   - A Google Drive folder `Smart Invoice — PDFs` with `Invoices/` and `Purchase Bills/` subfolders for PDFs

### Step 3 – Deploy as Web App

1. In the Apps Script project, click **Deploy → New Deployment**
2. Click the gear icon next to "Select type" and choose **Web App**
3. Set **Execute as:** `Me` (your Google Account)
4. Set **Who has access:** `Anyone`
5. Click **Deploy** and copy the generated **Web App URL** (ends in `/exec`)

### Step 4 – Connect the Frontend

1. Open your web app (e.g., [http://localhost:8080/](http://localhost:8080/)) and go to **Settings**
2. Paste the copied URL into **Google Apps Script Sync → Web App URL**
3. Scroll down, toggle **Auto-Send via Email (Free)** or **Auto-Send via WhatsApp** ON.
4. (Optional) For WhatsApp: paste your **Phone Number ID** and **Access Token** directly in the Settings UI (no need to edit the script file!).
5. Click **Save All Settings** at the bottom.


From now on, every invoice, purchase, customer, vendor, and product change
is automatically mirrored to Google Sheets, and PDFs are saved to Google Drive.

---

## Sheets Created

| Sheet       | Contents                             |
| ----------- | ------------------------------------ |
| `Sales`     | All sales invoices with full details |
| `Purchases` | All purchase bills with vendor info  |
| `Customers` | Customer master data                 |
| `Vendors`   | Vendor master data                   |
| `Inventory` | Product catalog with stock levels    |

---

## Actions Handled

| Action            | Effect                                                                   |
| ----------------- | ------------------------------------------------------------------------ |
| `invoice.create`  | Insert into Sales sheet + save PDF to Drive + send email + send WhatsApp |
| `purchase.create` | Insert into Purchases sheet + save PDF to Drive                          |
| `customer.upsert` | Insert or update Customers sheet                                         |
| `customer.delete` | Delete row from Customers sheet                                          |
| `vendor.upsert`   | Insert or update Vendors sheet                                           |
| `vendor.delete`   | Delete row from Vendors sheet                                            |
| `product.upsert`  | Insert or update Inventory sheet                                         |
| `product.delete`  | Delete row from Inventory sheet                                          |

---

## Notes

- The frontend uses `Content-Type: text/plain` to avoid CORS preflight issues with Apps Script.
- All data is also stored locally in the browser (localStorage) as the primary source of truth.
- Google Sheets acts as a cloud backup and reporting layer.
- WhatsApp messages are sent via the Meta Cloud API (v18.0). You need a verified WhatsApp Business number.
