// ============================================================
//  Smart Invoice & Billing Management System – Apps Script Backend
//  Deploy as: Web App → Execute as: Me → Access: Anyone
// ============================================================

// ── CONFIGURATION ────────────────────────────────────────────
var SPREADSHEET_ID = ""; // Leave blank to auto-create
var DRIVE_FOLDER_NAME = "Smart Invoice — PDFs";
var WHATSAPP_TOKEN = ""; // Meta WhatsApp Cloud API token
var WHATSAPP_PHONE_ID = ""; // Meta Phone Number ID

// Helper to download image URL and convert to Base64 data URI to avoid Cloudflare/TLS blocks in Apps Script PDF engine
function getLogoAsBase64(url) {
  if (!url) return "";
  if (url.indexOf("http") !== 0) return url;
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      var blob = response.getBlob();
      return "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes());
    }
  } catch (e) {
    Logger.log("getLogoAsBase64 failed for url: " + url + ". Error: " + e.toString());
  }
  return url;
}

// ── TIMEZONE HELPER (UK TIME) ─────────────────────────────────
function getUKTimeISO() {
  return Utilities.formatDate(new Date(), "Europe/London", "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
}
function getUKDateString() {
  return Utilities.formatDate(new Date(), "Europe/London", "yyyy-MM-dd");
}

// ── ENTRY POINTS ─────────────────────────────────────────────
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  var incomingApiKey = e && e.parameter && e.parameter.apiKey;
  var ss = getOrCreateSpreadsheet();

  if (action === "ping") return jsonResp({ ok: true, message: "Apps Script is running" });
  if (action === "read") {
    if (!validateApiKey(ss, incomingApiKey)) {
      return jsonResp({ ok: false, error: "Unauthorized access: Invalid or missing API Key" });
    }
    return handleRead(e.parameter);
  }
  return jsonResp({ ok: true, message: "Smart Invoice API ready" });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var type = body.type;
    var payload = body.payload;
    var ss = getOrCreateSpreadsheet();

    // 1. Enforce API Key validation (with bypass for OTP verification actions)
    var incomingApiKey = body.apiKey || "";
    var isOtpSend = (type === "otp.send");
    var isValidOtpPull = false;

    if (type === "database.pull" && payload && payload.email && payload.otp) {
      isValidOtpPull = validateTemporaryOtp(payload.email, payload.otp);
    }

    if (!isOtpSend && !isValidOtpPull && !validateApiKey(ss, incomingApiKey)) {
      var debugSettings = getCompanySettings(ss);
      var debugStoredKey = (debugSettings && debugSettings.apiKey) || "";
      return jsonResp({ 
        ok: false, 
        error: "Unauthorized access: Invalid or missing API Key. (Incoming: '" + incomingApiKey + "', Stored: '" + debugStoredKey + "')" 
      });
    }

    // 2. Enforce Role check on destructive/protected operations
    var protectedActions = [
      "customer.delete", "vendor.delete", "product.delete",
      "expense.delete", "payment.delete", "database.clear",
      "invoice.delete", "purchase.delete"
    ];
    if (protectedActions.indexOf(type) >= 0) {
      if (!validateAdminRole(ss, body.currentUser)) {
        return jsonResp({ ok: false, error: "Forbidden: You do not have permission to execute this operation." });
      }
    }

    if (type === "invoice.send") return handleInvoiceSend(payload);
    if (type === "otp.send") return handleOtpSend(payload);
    if (type === "invoice.create") return handleInvoiceCreate(ss, payload);
    if (type === "invoice.delete") return handleInvoiceDelete(ss, payload);
    if (type === "purchase.create") return handlePurchaseCreate(ss, payload);
    if (type === "purchase.delete") return handlePurchaseDelete(ss, payload);
    if (type === "customer.upsert") return handleCustomerUpsert(ss, payload);
    if (type === "customer.delete") return handleCustomerDelete(ss, payload);
    if (type === "vendor.upsert") return handleVendorUpsert(ss, payload);
    if (type === "vendor.delete") return handleVendorDelete(ss, payload);
    if (type === "product.upsert") return handleProductUpsert(ss, payload);
    if (type === "product.delete") return handleProductDelete(ss, payload);
    if (type === "expense.create") return handleExpenseCreate(ss, payload);
    if (type === "expense.delete") return handleExpenseDelete(ss, payload);
    if (type === "payment.create") return handlePaymentCreate(ss, payload);
    if (type === "payment.delete") return handlePaymentDelete(ss, payload);
    if (type === "activity.create") return handleActivityCreate(ss, payload);
    if (type === "database.pull") return handlePull(ss);
    if (type === "database.clear") return handleClearAllData(ss);
    if (type === "settings.sync") return handleSettingsSync(ss, payload);

    return jsonResp({ ok: false, error: "Unknown action: " + type });
  } catch (err) {
    return jsonResp({ ok: false, error: err.toString() });
  }
}

// ── SECURITY HELPERS ──────────────────────────────────────────
function validateApiKey(ss, incomingApiKey) {
  var settings = getCompanySettings(ss);
  if (!settings) {
    return true; // No settings saved yet, allow sync registration
  }
  var storedApiKey = settings.apiKey || "";
  if (storedApiKey === "") {
    return true; // No API Key configured on spreadsheet, allow request to store it
  }
  return incomingApiKey === storedApiKey;
}

function validateAdminRole(ss, currentUser) {
  if (!currentUser || !currentUser.username) {
    return false;
  }
  if (currentUser.username === "mrsauce") {
    return currentUser.role === "admin";
  }
  var settings = getCompanySettings(ss);
  if (!settings || !settings.users) {
    return false;
  }
  var users = settings.users;
  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === currentUser.username.toLowerCase()) {
      return users[i].role === "admin";
    }
  }
  return false;
}

// ── READ HANDLER ─────────────────────────────────────────────
function handleRead(params) {
  var ss = getOrCreateSpreadsheet();
  var sheet = params.sheet || "Sales Transactions";
  var sh = ss.getSheetByName(sheet);
  if (!sh) return jsonResp({ ok: false, error: "Sheet not found: " + sheet });
  var data = sh.getDataRange().getValues();
  return jsonResp({ ok: true, data: data });
}

// ── HELPERS FOR DYNAMIC FORMATTING & CONFIG ──────────────────
function getCompanySettings(ss) {
  var settingsSh = ss.getSheetByName("Settings");
  if (settingsSh) {
    try {
      var val = settingsSh.getRange(2, 1).getValue();
      if (val) {
        return JSON.parse(val);
      }
    } catch (e) {}
  }
  return null;
}

function getCurrencySymbol(payload, ss) {
  var company = payload.company || (ss ? getCompanySettings(ss) : null);
  if (company && company.currency) {
    var cur = company.currency;
    if (cur === "GBP") return "£";
    if (cur === "INR") return "₹";
    if (cur === "USD") return "$";
    if (cur === "EUR") return "€";
    return cur;
  }
  return "£"; // Default to GBP £
}

function formatPdfDate(isoString) {
  if (!isoString) return "";
  try {
    var dateStr = isoString.split("T")[0];
    var parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var day = date.getDate();
    var month = months[date.getMonth()];
    var year = date.getFullYear();
    if (day < 10) day = "0" + day;
    return day + " " + month + " " + year;
  } catch (e) {
    return isoString.split("T")[0];
  }
}

// ── INVOICE ──────────────────────────────────────────────────
function handleInvoiceCreate(ss, inv) {
  // Sales Transactions schema (19 columns)
  var sh = getOrCreateSheet(ss, "Sales Transactions", [
    "Invoice ID",           // col 1  (index 0)
    "Customer Name",        // col 2  (index 1)
    "Contact Info",         // col 3  (index 2)
    "Items JSON",           // col 4  (index 3)
    "Discount Total",       // col 5  (index 4)
    "Shipping",             // col 6  (index 5)
    "Payment Status",       // col 7  (index 6)
    "PDF URL",              // col 8  (index 7)
    "WhatsApp Status",      // col 9  (index 8)
    "Email Status",         // col 10 (index 9)
    "Payment Mode",         // col 11 (index 10)
    "Invoice Status",       // col 12 (index 11)
    "Due Date",             // col 13 (index 12)
    "QR Payment Link",      // col 14 (index 13)
    "Subtotal",             // col 15 (index 14)
    "Grand Total",          // col 16 (index 15)
    "Amount Paid",          // col 17 (index 16)
    "Balance Due",          // col 18 (index 17)
    "Invoice Date",         // col 19 (index 18)
  ]);

  var productDetails = JSON.stringify(inv.items);

  // 1. Save PDF to Drive first to get URL
  var savedUrl = "";
  try {
    var currencySymbol = getCurrencySymbol(inv, ss);
    var pdfBlob = createInvoicePdfBlob(inv, currencySymbol);
    savedUrl = savePdfToDrive(pdfBlob, inv.number + ".pdf", "Invoices");
  } catch (e) {
    Logger.log("PDF save failed: " + e);
  }

  // Update in-memory invoice PDF URL for email/WhatsApp
  var finalPdfUrl = inv.pdfUrl || savedUrl || "";
  inv.pdfUrl = finalPdfUrl;

  var finalPaymentMode = inv.paymentMode || inv.paymentMethod || "";

  // Send email with PDF attachment
  var emailStatusVal = inv.emailStatus || "Not Sent";
  if (inv.sendEmail) {
    try {
      sendInvoiceEmail(inv, inv.company);
      emailStatusVal = "Sent";
    } catch (e) {
      Logger.log("Email failed: " + e);
      emailStatusVal = "Failed";
    }
  }

  // Send WhatsApp
  var whatsappStatusVal = inv.whatsappStatus || "Not Sent";
  if (inv.customerPhone && inv.sendWhatsApp) {
    try {
      sendWhatsAppMessage(inv, undefined, undefined, inv.company);
      whatsappStatusVal = "Sent";
    } catch (e) {
      Logger.log("WhatsApp failed: " + e);
      whatsappStatusVal = "Failed";
    }
  }

  // Resolve invoiceStatus
  var finalInvoiceStatus = inv.invoiceStatus;
  if (!finalInvoiceStatus) {
    if (inv.paymentStatus === "paid") {
      finalInvoiceStatus = "paid";
    } else if (emailStatusVal === "Sent" || whatsappStatusVal === "Sent") {
      finalInvoiceStatus = "sent";
    } else {
      finalInvoiceStatus = "draft";
    }
  }

  var rowData = [
    inv.number,
    inv.customerName,
    inv.customerPhone + (inv.customerEmail ? " / " + inv.customerEmail : ""),
    productDetails,
    inv.discountTotal || 0,
    inv.shipping || 0,
    inv.paymentStatus || "pending",
    finalPdfUrl,
    whatsappStatusVal,
    emailStatusVal,
    finalPaymentMode,
    finalInvoiceStatus,
    inv.dueDate || "",
    inv.qrPaymentLink || "",
    inv.subtotal || 0,
    inv.grandTotal || 0,
    inv.amountPaid || 0,
    inv.balanceDue || 0,
    inv.date || getUKTimeISO(),
  ];

  // Try to find and update existing row to avoid duplicates
  var data = sh.getDataRange().getValues();
  var updated = false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(inv.number)) {
      sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      updated = true;
      break;
    }
  }

  if (!updated) {
    sh.appendRow(rowData);
  }

  return jsonResp({ 
    ok: true, 
    number: inv.number, 
    pdfUrl: finalPdfUrl,
    emailStatus: emailStatusVal,
    whatsappStatus: whatsappStatusVal,
    invoiceStatus: finalInvoiceStatus
  });
}

// ── PURCHASE ─────────────────────────────────────────────────
function handlePurchaseCreate(ss, bill) {
  // Purchase Transactions schema (15 columns)
  var sh = getOrCreateSheet(ss, "Purchase Transactions", [
    "Bill Number",              // col 1  (index 0)
    "Vendor Name",              // col 2  (index 1)
    "Vendor Phone",             // col 3  (index 2)
    "Vendor Email",             // col 4  (index 3)
    "Vendor Address",           // col 5  (index 4)
    "Items JSON",               // col 6  (index 5)
    "Subtotal",                 // col 7  (index 6)
    "Grand Total",              // col 8  (index 7)
    "Amount Paid",              // col 9  (index 8)
    "Balance Due",              // col 10 (index 9)
    "Payment Status",           // col 11 (index 10)
    "Payment Method",           // col 12 (index 11)
    "PDF URL",                  // col 13 (index 12)
    "Bill Date",                // col 14 (index 13)
    "Party Invoice Number",     // col 15 (index 14)
  ]);

  var productDetails = JSON.stringify(bill.items);

  // 1. Save PDF to Drive first to get URL
  var savedUrl = "";
  try {
    var currencySymbol = getCurrencySymbol(bill, ss);
    var pdfBlob = createPurchasePdfBlob(bill, currencySymbol);
    savedUrl = savePdfToDrive(pdfBlob, bill.number + ".pdf", "Purchase Bills");
  } catch (e) {
    Logger.log("Purchase PDF save failed: " + e);
  }

  var finalPdfUrl = bill.pdfUrl || savedUrl || "";

  var rowData = [
    bill.number,
    bill.vendorName || "",
    bill.vendorPhone || "",
    bill.vendorEmail || "",
    bill.vendorAddress || "",
    productDetails,
    bill.subtotal || 0,
    bill.grandTotal || 0,
    bill.amountPaid || 0,
    bill.balanceDue || 0,
    bill.paymentStatus || "pending",
    bill.paymentMethod || "",
    finalPdfUrl,
    bill.date || getUKTimeISO(),
    bill.partyInvoiceNumber || "",
  ];

  // Try to find and update existing row to avoid duplicates (match on bill number)
  var data = sh.getDataRange().getValues();
  var updated = false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(bill.number)) {
      sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      updated = true;
      break;
    }
  }

  if (!updated) {
    sh.appendRow(rowData);
  }

  return jsonResp({ ok: true, number: bill.number, pdfUrl: finalPdfUrl });
}

// ── EXPENSE ──────────────────────────────────────────────────
function handleExpenseCreate(ss, exp) {
  var sh = getOrCreateSheet(ss, "Expenses", [
    "Expense ID",
    "Expense Date",
    "Expense Amount",
    "Payment Type",
    "Expense Category"
  ]);

  var rowData = [exp.id, exp.date, exp.amount, exp.paymentType, exp.category];
  var data = sh.getDataRange().getValues();
  var updated = false;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || "") === String(exp.id)) {
      sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      updated = true;
      break;
    }
  }

  if (!updated) {
    sh.appendRow(rowData);
  }

  return jsonResp({ ok: true, id: exp.id });
}

function handleExpenseDelete(ss, payload) {
  deleteRowByColumn(ss, "Expenses", payload.id, 0); // Expense ID is index 0
  return jsonResp({ ok: true });
}

// ── PAYMENT ──────────────────────────────────────────────────
function handlePaymentCreate(ss, pmt) {
  var sh = getOrCreateSheet(ss, "Payment Transactions", [
    "ID",
    "Date",
    "Reference ID",
    "Type",
    "Amount",
    "Method",
  ]);

  var rowData = [pmt.id, pmt.date, pmt.referenceId, pmt.type, pmt.amount, pmt.method];
  var data = sh.getDataRange().getValues();
  var updated = false;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || "") === String(pmt.id)) {
      sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      updated = true;
      break;
    }
  }

  if (!updated) {
    sh.appendRow(rowData);
  }

  return jsonResp({ ok: true, id: pmt.id });
}

function handlePaymentDelete(ss, payload) {
  deleteRowByColumn(ss, "Payment Transactions", payload.id, 0); // ID is index 0
  return jsonResp({ ok: true });
}

// ── ACTIVITY LOG ─────────────────────────────────────────────
function handleActivityCreate(ss, act) {
  var sh = getOrCreateSheet(ss, "Activity Log", [
    "Log ID",
    "Reference ID",
    "Type",
    "Customer/Supplier",
    "Status",
    "User",
    "Action Type",
    "Timestamp",
  ]);

  var rowData = [
    act.id,
    act.referenceId,
    act.type,
    act.entityName,
    act.status,
    act.user,
    act.actionType,
    act.timestamp,
  ];

  var data = sh.getDataRange().getValues();
  var updated = false;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || "") === String(act.id)) {
      sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      updated = true;
      break;
    }
  }

  if (!updated) {
    sh.appendRow(rowData);
  }

  return jsonResp({ ok: true, id: act.id });
}

// ── CUSTOMER ─────────────────────────────────────────────────
function handleCustomerUpsert(ss, c) {
  var sh = getOrCreateSheet(ss, "Customers", [
    "Customer ID",
    "Customer Name",
    "Phone",
    "Email",
    "Address",
    "City",
    "Country",
    "Postcode",
    "Outstanding Balance",
    "Created At",
  ]);

  var rowData = [
    c.id,
    c.name,
    c.phone || "",
    c.email || "",
    c.address || "",
    c.city || "",
    c.country || "",
    c.postcode || "",
    c.outstandingBalance || 0,
    c.createdAt || new Date().toISOString(),
  ];

  var data = sh.getDataRange().getValues();
  var updated = false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(c.id)) {
      sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      updated = true;
      break;
    }
  }
  if (!updated) {
    sh.appendRow(rowData);
  }
  return jsonResp({ ok: true, id: c.id });
}

function handleCustomerDelete(ss, payload) {
  deleteRowByColumn(ss, "Customers", payload.id, 0); // Customer ID is index 0
  return jsonResp({ ok: true });
}

// ── VENDOR ───────────────────────────────────────────────────
function handleVendorUpsert(ss, v) {
  var sh = getOrCreateSheet(ss, "Suppliers", [
    "Supplier ID",
    "Vendor Name",
    "Phone",
    "Email",
    "Address",
    "City",
    "Country",
    "Postcode",
    "Outstanding Payable",
    "Created At",
  ]);

  var rowData = [
    v.id,
    v.name,
    v.phone || "",
    v.email || "",
    v.address || "",
    v.city || "",
    v.country || "",
    v.postcode || "",
    v.outstandingPayable || 0,
    v.createdAt || new Date().toISOString(),
  ];

  var data = sh.getDataRange().getValues();
  var updated = false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(v.id)) {
      sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      updated = true;
      break;
    }
  }
  if (!updated) {
    sh.appendRow(rowData);
  }
  return jsonResp({ ok: true, id: v.id });
}

function handleVendorDelete(ss, payload) {
  deleteRowByColumn(ss, "Suppliers", payload.id, 0); // Supplier ID is index 0
  return jsonResp({ ok: true });
}

// ── PRODUCT ──────────────────────────────────────────────────
function handleProductUpsert(ss, p) {
  var sh = getOrCreateSheet(ss, "Inventory", [
    "Product ID",
    "Product Name",
    "SKU Code",
    "Product Category",
    "Cost Price",
    "Sell Price",
    "Current Stock",
    "Minimum Stock",
    "Date Added"
  ]);

  var rowData = [
    p.id,
    p.name,
    p.sku || "",
    p.category || "",
    p.purchasePrice || 0,
    p.sellingPrice || 0,
    p.stock || 0,
    p.reorderLevel || 0,
    p.date || new Date().toISOString().split("T")[0]
  ];

  var data = sh.getDataRange().getValues();
  var updated = false;

  for (var i = 1; i < data.length; i++) {
    var rowId = String(data[i][0] || "");
    var rowSku = String(data[i][2] || "");
    if ((p.id && rowId === String(p.id)) || (p.sku && rowSku === String(p.sku))) {
      sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      updated = true;
      break;
    }
  }

  if (!updated) {
    sh.appendRow(rowData);
  }

  return jsonResp({ ok: true, id: p.id });
}

function handleProductDelete(ss, payload) {
  deleteRowByColumn(ss, "Inventory", payload.id, 0); // Product ID is index 0
  return jsonResp({ ok: true });
}

function handleOtpSend(payload) {
  var email = payload.email;
  var otp = payload.otp;
  
  // Store the OTP temporarily for validation/bypass
  saveTemporaryOtp(email, otp);

  var subject = "Your Smart Invoice Login OTP";
  var html = 
    '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;color:#1e293b;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#ffffff">' +
      '<div style="background:#0f172a;color:#fff;padding:20px;text-align:center">' +
        '<h2 style="margin:0;color:#ffffff">Smart Invoice Security</h2>' +
      '</div>' +
      '<div style="padding:24px;text-align:center">' +
        '<p style="font-size:16px;margin-top:0">Hello,</p>' +
        '<p style="font-size:15px;color:#475569">Your one-time password (OTP) for login is:</p>' +
        '<div style="background:#f1f5f9;padding:12px 24px;border-radius:8px;font-size:32px;font-weight:bold;letter-spacing:6px;color:#0f172a;margin:20px 0;display:inline-block">' + otp + '</div>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:0">This OTP is valid for 5 minutes. Do not share this code with anyone.</p>' +
      '</div>' +
    '</div>';

  MailApp.sendEmail({
    to: email,
    subject: subject,
    htmlBody: html
  });
  return jsonResp({ ok: true });
}

function saveTemporaryOtp(email, otp) {
  var props = PropertiesService.getScriptProperties();
  var now = new Date().getTime();
  props.setProperty("TEMP_OTP_" + email.toLowerCase(), otp + "_" + now);
}

function validateTemporaryOtp(email, otp) {
  var props = PropertiesService.getScriptProperties();
  var val = props.getProperty("TEMP_OTP_" + email.toLowerCase());
  if (!val) return false;
  var parts = val.split("_");
  var storedOtp = parts[0];
  var timestamp = Number(parts[1]);
  var now = new Date().getTime();
  
  // OTP is valid for 5 minutes (300,000 milliseconds)
  if (storedOtp === otp && (now - timestamp) < 300000) {
    // Consume the OTP so it can't be reused
    props.deleteProperty("TEMP_OTP_" + email.toLowerCase());
    return true;
  }
  return false;
}

// ── EMAIL ────────────────────────────────────────────────────
function sendInvoiceEmail(inv, company) {
  if (!company) {
    try {
      var ss = getOrCreateSpreadsheet();
      company = getCompanySettings(ss);
    } catch(e) {}
  }
  var companyName = company ? company.companyName : "Smart Invoice";
  var currencySymbol = company ? (company.currency === "GBP" ? "£" : company.currency === "INR" ? "₹" : company.currency === "USD" ? "$" : company.currency === "EUR" ? "€" : company.currency) : "£";
  var subject = "Invoice " + inv.number + " from " + companyName;

  var itemsRows = inv.items
    .map(function(it) {
      var price = typeof it.unitPrice === "number" ? it.unitPrice : Number(it.unitPrice) || 0;
      var qty = typeof it.qty === "number" ? it.qty : Number(it.qty) || 0;
      return '<tr>' +
        '<td style="padding:10px 12px; border-bottom:1px solid #e2e8f0; color:#334155; text-align:left;">' + it.name + '</td>' +
        '<td style="padding:10px 12px; border-bottom:1px solid #e2e8f0; color:#334155; text-align:center;">' + qty + '</td>' +
        '<td style="padding:10px 12px; border-bottom:1px solid #e2e8f0; color:#334155; text-align:right;">' + currencySymbol + price.toFixed(2) + '</td>' +
        '<td style="padding:10px 12px; border-bottom:1px solid #e2e8f0; color:#334155; text-align:right; font-weight:600;">' + currencySymbol + (qty * price).toFixed(2) + '</td>' +
        '</tr>';
    })
    .join("");

  var companyAddress = company ? company.address || "" : "";
  var companyPhone = company ? company.phone || "" : "";
  var companyEmail = company ? company.email || "" : "";

  var logoHtml = "";
  if (company && company.logoBase64) {
    var src = company.logoBase64;
    if (src.indexOf("http") === 0) {
      logoHtml = '<img src="' + src + '" style="max-height:80px; max-width:180px; margin-bottom:8px; object-fit:contain; display:block;" />';
    } else if (src.indexOf("data:image") === 0) {
      logoHtml = '<img src="' + src + '" style="max-height:80px; max-width:180px; margin-bottom:8px; object-fit:contain; display:block;" />';
    } else {
      logoHtml = '<img src="data:image/png;base64,' + src + '" style="max-height:80px; max-width:180px; margin-bottom:8px; object-fit:contain; display:block;" />';
    }
  }

  var formattedInvoiceDate = formatPdfDate(inv.date);
  var formattedDueDate = formatPdfDate(inv.dueDate);

  var subtotal = Number(inv.subtotal) || 0;
  var discountTotal = Number(inv.discountTotal) || 0;
  var shipping = Number(inv.shipping) || 0;
  var grandTotal = Number(inv.grandTotal) || 0;
  var amountPaid = Number(inv.amountPaid) || 0;
  var balanceDue = Number(inv.balanceDue) || 0;
  var grossAmount = subtotal + discountTotal;

  var totalsHtml = '<tr><td style="padding:6px 0; color:#64748b;">Gross Amount:</td><td style="padding:6px 0; text-align:right; color:#334155;">' + currencySymbol + grossAmount.toFixed(2) + '</td></tr>';
  if (discountTotal > 0) {
    var pct = Math.round((discountTotal * 100) / grossAmount);
    totalsHtml += '<tr><td style="padding:6px 0; color:#64748b;">Discount (' + pct + '%):</td><td style="padding:6px 0; text-align:right; color:#dc2626;">-' + currencySymbol + discountTotal.toFixed(2) + '</td></tr>';
  }
  totalsHtml += '<tr><td style="padding:6px 0; color:#64748b;">Subtotal:</td><td style="padding:6px 0; text-align:right; color:#334155;">' + currencySymbol + subtotal.toFixed(2) + '</td></tr>';
  if (shipping > 0) {
    totalsHtml += '<tr><td style="padding:6px 0; color:#64748b;">Shipping:</td><td style="padding:6px 0; text-align:right; color:#334155;">' + currencySymbol + shipping.toFixed(2) + '</td></tr>';
  }
  totalsHtml += '<tr style="border-top:2px solid #e2e8f0;"><td style="padding:10px 0 6px 0; font-size:14px; font-weight:bold; color:#1e3a8a;">Grand Total:</td><td style="padding:10px 0 6px 0; text-align:right; font-size:14px; font-weight:bold; color:#1e3a8a;">' + currencySymbol + grandTotal.toFixed(2) + '</td></tr>' +
    '<tr><td style="padding:6px 0; color:#64748b;">Amount Paid:</td><td style="padding:6px 0; text-align:right; color:#334155;">' + currencySymbol + amountPaid.toFixed(2) + '</td></tr>' +
    '<tr style="border-top:1px solid #f1f5f9;"><td style="padding:8px 0 0 0; font-size:14px; font-weight:bold; color:#dc2626;">Balance Due:</td><td style="padding:8px 0 0 0; text-align:right; font-size:14px; font-weight:bold; color:#dc2626;">' + currencySymbol + balanceDue.toFixed(2) + '</td></tr>';

  var html =
    '<div style="font-family:\'Segoe UI\', Arial, sans-serif; max-width:600px; margin:0 auto; color:#334155; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; background:#ffffff; box-shadow:0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);">' +
    '  <div style="height:6px; background:#1e3a8a;"></div>' +
    '  <div style="padding:24px 24px 20px 24px; border-bottom:1px solid #e2e8f0; background:#ffffff;">' +
    '    <table style="width:100%; border-collapse:collapse; margin:0; padding:0;">' +
    '      <tr>' +
    '        <td style="vertical-align:top; text-align:left; padding:0;">' +
    '          ' + logoHtml +
    '          <div style="font-size:24px; font-weight:bold; color:#1e3a8a; margin:0; line-height:1.2;">' + companyName + '</div>' +
    '          <div style="font-size:12px; color:#475569; margin:3px 0 0 0;">Quality & Consistency</div>' +
    '          <div style="font-size:11px; color:#64748b; margin:6px 0 0 0; line-height:1.4;">' +
    '            ' + companyAddress + '<br/>' +
    '            Phone: ' + companyPhone + ' | Email: ' + companyEmail +
    '          </div>' +
    '        </td>' +
    '        <td style="vertical-align:top; text-align:right; width:45%; padding:0;">' +
    '          <div style="font-size:12px; font-weight:bold; color:#64748b; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px;">Non VAT Invoice</div>' +
    '          <div style="font-size:13px; color:#334155; margin-bottom:4px;"><strong>Invoice #:</strong> ' + inv.number + '</div>' +
    '          <div style="font-size:13px; color:#334155; margin-bottom:4px;"><strong>Date:</strong> ' + formattedInvoiceDate + '</div>' +
    '          <div style="font-size:13px; color:#334155;"><strong>Due Date:</strong> ' + formattedDueDate + '</div>' +
    '        </td>' +
    '      </tr>' +
    '    </table>' +
    '  </div>' +
    '  <div style="padding:24px;">' +
    '    <p style="margin-top:0; font-size:14px; color:#334155;">Dear <strong>' + inv.customerName + '</strong>,</p>' +
    '    <p style="font-size:14px; color:#475569;">Thank you for your business. Please find your invoice summary below:</p>' +
    '    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:12px 16px; margin:20px 0;">' +
    '      <div style="font-size:11px; text-transform:uppercase; font-weight:bold; color:#475569; letter-spacing:0.5px; margin-bottom:4px;">Bill To</div>' +
    '      <div style="font-size:14px; font-weight:bold; color:#1e293b;">' + inv.customerName + '</div>' +
    '      ' + (inv.billingAddress ? '<div style="font-size:13px; color:#475569; margin-top:2px;">' + inv.billingAddress.replace(/\n/g, "<br>") + '</div>' : '') +
    '      ' + (inv.customerPhone ? '<div style="font-size:13px; color:#475569; margin-top:2px;">Phone: ' + inv.customerPhone + '</div>' : '') +
    '    </div>' +
    '    <table style="width:100%; border-collapse:collapse; margin:20px 0; font-size:13px;">' +
    '      <thead>' +
    '        <tr style="background:#1e3a8a; color:#ffffff;">' +
    '          <th style="padding:10px 12px; font-weight:600; text-align:left; text-transform:uppercase; font-size:11px; letter-spacing:0.5px; border-radius:4px 0 0 0;">Item</th>' +
    '          <th style="padding:10px 12px; font-weight:600; text-align:center; width:60px; text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">Qty</th>' +
    '          <th style="padding:10px 12px; font-weight:600; text-align:right; width:100px; text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">Rate</th>' +
    '          <th style="padding:10px 12px; font-weight:600; text-align:right; width:120px; text-transform:uppercase; font-size:11px; letter-spacing:0.5px; border-radius:0 4px 0 0;">Amount</th>' +
    '        </tr>' +
    '      </thead>' +
    '      <tbody>' + itemsRows + '</tbody>' +
    '    </table>' +
    '    <table style="width:100%; margin-top:20px; border-collapse:collapse;">' +
    '      <tr>' +
    '        <td style="width:50%; vertical-align:top; text-align:left; padding-right:20px;">' +
    '          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:12px; display:inline-block; min-width:180px;">' +
    '            <span style="font-size:11px; text-transform:uppercase; color:#64748b; font-weight:600; display:block; margin-bottom:4px; letter-spacing:0.5px;">Payment Status</span>' +
    '            <span style="text-transform:uppercase; font-weight:bold; font-size:14px; color:' + (inv.paymentStatus === 'paid' ? '#16a34a' : '#ea580c') + ';">' +
    '              ' + inv.paymentStatus +
    '            </span>' +
    '          </div>' +
    '        </td>' +
    '        <td style="width:50%; vertical-align:top;">' +
    '          <table style="width:100%; border-collapse:collapse; font-size:13px;">' +
    '            ' + totalsHtml +
    '          </table>' +
    '        </td>' +
    '      </tr>' +
    '    </table>' +
    '    ' + (company && company.termsAndConditions ? '<div style="margin-top:30px; padding:16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:12px; color:#475569; line-height:1.5;"><strong>Terms & Conditions:</strong><br><div style="margin-top:6px; color:#64748b;">' + company.termsAndConditions.replace(/\n/g, "<br>") + '</div></div>' : '') +
    '    <p style="margin-top:25px; font-size:13px; color:#475569;">If you have any questions, please contact us at <a href="mailto:' + (company ? company.email : "") + '" style="color:#1e3a8a; text-decoration:none;">' + (company ? company.email : "") + '</a> or call ' + (company ? company.phone : "") + '.</p>' +
    '    <p style="color:#94a3b8; font-size:11px; margin-top:35px; border-top:1px solid #e2e8f0; padding-top:15px; text-align:center;">This is an automated invoice transmission. Please do not reply directly to this message.</p>' +
    '  </div>' +
    '</div>';

  var attachments = [];
  try {
    var pdfBlob = createInvoicePdfBlob(inv, currencySymbol);
    attachments.push(pdfBlob);
  } catch (e) {
    Logger.log("Failed to attach PDF to email: " + e);
  }

  var toList = [];
  if (company) {
    if (company.salesEmail1) toList.push(company.salesEmail1.trim());
    if (company.salesEmail2) toList.push(company.salesEmail2.trim());
  }

  if (toList.length === 0) {
    Logger.log("No sales email configured. Email not sent.");
    return;
  }

  var emailOptions = {
    to: toList.join(","),
    subject: subject,
    htmlBody: html,
    replyTo: company ? company.email : undefined,
    attachments: attachments
  };

  MailApp.sendEmail(emailOptions);
}

// ── WHATSAPP ─────────────────────────────────────────────────
function sendWhatsAppMessage(inv, token, phoneId, company) {
  var waToken = token || WHATSAPP_TOKEN;
  var waPhoneId = phoneId || WHATSAPP_PHONE_ID;
  if (!waToken || !waPhoneId) {
    throw new Error("WhatsApp Cloud API credentials not configured.");
  }

  var phone = inv.customerPhone.replace(/\D/g, "");
  if (!phone) {
    throw new Error("Customer has no phone number.");
  }
  if (phone.length === 10) phone = "91" + phone;

  var currencySymbol = company ? (company.currency === "GBP" ? "£" : company.currency === "INR" ? "₹" : company.currency === "USD" ? "$" : company.currency === "EUR" ? "€" : company.currency) : "£";

  var itemsLines = inv.items
    .map(function(it) {
      var price = typeof it.unitPrice === "number" ? it.unitPrice : Number(it.unitPrice) || 0;
      var qty = typeof it.qty === "number" ? it.qty : Number(it.qty) || 0;
      return "  • " + it.name + " × " + qty + " @ " + currencySymbol + price.toFixed(2);
    })
    .join("\n");

  var msg =
    "Hello " + inv.customerName + ",\n\n" +
    "Thank you for your purchase from *" + (company ? company.companyName : "us") + "*! 🙏\n\n" +
    "📄 *Invoice #:* " + inv.number + "\n" +
    "📅 *Date:* " + (inv.date ? inv.date.split("T")[0] : "") + "\n" +
    "🛒 *Items:*\n" + itemsLines + "\n" +
    "💰 *Total Amount:* " + currencySymbol + inv.grandTotal.toFixed(2) + "\n" +
    "✅ *Status:* " + inv.paymentStatus.toUpperCase() + "\n" +
    (inv.balanceDue && inv.balanceDue > 0 ? "⚠️ *Balance Due:* " + currencySymbol + inv.balanceDue.toFixed(2) + "\n" : "") +
    "\nPlease contact us for any queries.\n\nRegards,\n" + (company ? company.companyName : "");

  var url = "https://graph.facebook.com/v19.0/" + waPhoneId + "/messages";
  var payload = JSON.stringify({
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: msg },
  });

  var res = UrlFetchApp.fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + waToken,
      "Content-Type": "application/json"
    },
    payload: payload,
    muteHttpExceptions: true
  });
  var resData = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error(resData.error ? resData.error.message : res.getContentText());
  }
}

// ── MANUAL AUTO-SEND ROUTE ──────────────────────────────────
function handleInvoiceSend(payload) {
  var inv = payload.invoice;
  var company = payload.company;
  var sendEmailFlag = payload.sendEmail;
  var sendWhatsAppFlag = payload.sendWhatsApp;
  var whatsappToken = payload.whatsappToken;
  var whatsappPhoneId = payload.whatsappPhoneId;

  var results = {};
  var emailStatus = undefined;
  var whatsappStatus = undefined;
  var invoiceStatus = undefined;

  if (sendEmailFlag) {
    var salesEmail1 = company ? company.salesEmail1 : undefined;
    var salesEmail2 = company ? company.salesEmail2 : undefined;
    if (!salesEmail1 && !salesEmail2) {
      results.email = { ok: false, error: "No sales copy emails configured." };
    } else {
      try {
        sendInvoiceEmail(inv, company);
        results.email = { ok: true };
        emailStatus = "Sent";
        invoiceStatus = inv.paymentStatus === "paid" ? "paid" : "sent";
      } catch (e) {
        results.email = { ok: false, error: e.toString() };
      }
    }
  }

  if (sendWhatsAppFlag) {
    if (!inv.customerPhone) {
      results.whatsapp = { ok: false, error: "Customer has no phone number." };
    } else {
      try {
        sendWhatsAppMessage(inv, whatsappToken, whatsappPhoneId, company);
        results.whatsapp = { ok: true };
        whatsappStatus = "Sent";
        invoiceStatus = inv.paymentStatus === "paid" ? "paid" : "sent";
      } catch (e) {
        results.whatsapp = { ok: false, error: e.toString() };
      }
    }
  }

  // Update status in sheet
  if (emailStatus !== undefined || whatsappStatus !== undefined) {
    try {
      updateInvoiceStatusInSheet(inv.number, emailStatus, whatsappStatus, invoiceStatus);
    } catch (e) {
      Logger.log("Failed to update status in sheet: " + e);
    }
  }

  return jsonResp({ ok: true, results: results });
}

function updateInvoiceStatusInSheet(invoiceNumber, emailStatus, whatsappStatus, invoiceStatus) {
  var ss = getOrCreateSpreadsheet();
  var sh = ss.getSheetByName("Sales Transactions");
  if (!sh) return;
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(invoiceNumber)) {
      if (emailStatus !== undefined) {
        sh.getRange(i + 1, 10).setValue(emailStatus); // col 10 (index 9) = Email Status
      }
      if (whatsappStatus !== undefined) {
        sh.getRange(i + 1, 9).setValue(whatsappStatus); // col 9 (index 8) = WhatsApp Status
      }
      if (invoiceStatus !== undefined) {
        sh.getRange(i + 1, 12).setValue(invoiceStatus); // col 12 (index 11) = Invoice Status
      }
      break;
    }
  }
}

// ── PDF GENERATION (HTML → Drive PDF) ────────────────────────
function createInvoicePdfBlob(inv, currencySymbol) {
  var ss = getOrCreateSpreadsheet();
  if (!inv.company) {
    inv.company = getCompanySettings(ss);
  }
  var html = buildInvoiceHtml(inv, currencySymbol);
  var blob = Utilities.newBlob(html, "text/html", inv.number + ".html");
  return blob.getAs("application/pdf").setName(inv.number + ".pdf");
}

function createPurchasePdfBlob(bill, currencySymbol) {
  var ss = getOrCreateSpreadsheet();
  if (!bill.company) {
    bill.company = getCompanySettings(ss);
  }
  var html = buildPurchaseHtml(bill, currencySymbol);
  var blob = Utilities.newBlob(html, "text/html", bill.number + ".html");
  return blob.getAs("application/pdf").setName(bill.number + ".pdf");
}

function buildInvoiceHtml(inv, currencySymbol) {
  var symbol = currencySymbol || "£";
  var itemsHtml = (inv.items || [])
    .map(function (it, i) {
      var qty = Number(it.qty) || 0;
      var unitPrice = Number(it.unitPrice) || 0;
      var amount = qty * unitPrice;
      return (
        "<tr>" +
        "<td>" + (i + 1) + "</td>" +
        "<td>" + it.name + "</td>" +
        "<td style='text-align: center;'>" + qty + "</td>" +
        "<td style='text-align: right;'>" + symbol + unitPrice.toFixed(2) + "</td>" +
        "<td style='text-align: right; font-weight: bold;'>" + symbol + amount.toFixed(2) + "</td>" +
        "</tr>"
      );
    })
    .join("");

  var discountTotal = Number(inv.discountTotal) || 0;
  var shipping = Number(inv.shipping) || 0;
  var subtotal = Number(inv.subtotal) || 0;
  var grandTotal = Number(inv.grandTotal) || 0;
  var amountPaid = Number(inv.amountPaid) || 0;
  var balanceDue = Number(inv.balanceDue) || 0;

  var grossAmount = subtotal + discountTotal;

  var company = inv.company || {};
  var companyName = company.companyName || "Smart Invoice";
  var companyAddress = company.address || "";
  var companyPhone = company.phone || "";
  var companyEmail = company.email || "";

  var logoHtml = "";
  if (company.logoBase64) {
    var src = company.logoBase64;
    if (src.indexOf("http") === 0) {
      src = getLogoAsBase64(src);
    }
    if (src.indexOf("data:image") === 0 || src.indexOf("http") === 0) {
      logoHtml = '<img src="' + src + '" style="max-height: 75px; max-width: 180px; object-fit: contain; display: block;" />';
    } else {
      logoHtml = '<img src="data:image/png;base64,' + src + '" style="max-height: 75px; max-width: 180px; object-fit: contain; display: block;" />';
    }
  }

  var termsHtml = company.termsAndConditions 
    ? "<div class='terms'><h3>Terms & Conditions</h3><p>" + company.termsAndConditions.replace(/\n/g, "<br>") + "</p></div>"
    : "";

  var totalsHtml = '<div><span>Gross Amount:</span><span>' + symbol + grossAmount.toFixed(2) + '</span></div>';
  if (discountTotal > 0) {
    var pct = Math.round((discountTotal * 100) / grossAmount);
    totalsHtml += '<div><span>Discount (' + pct + '%):</span><span>-' + symbol + discountTotal.toFixed(2) + '</span></div>';
  }
  totalsHtml += '<div><span>Subtotal:</span><span>' + symbol + subtotal.toFixed(2) + '</span></div>';
  if (shipping > 0) {
    totalsHtml += '<div><span>Shipping:</span><span>' + symbol + shipping.toFixed(2) + '</span></div>';
  }
  totalsHtml += '<div class="grand"><span>Grand Total:</span><span>' + symbol + grandTotal.toFixed(2) + '</span></div>' +
    '<div><span>Amount Paid:</span><span>' + symbol + amountPaid.toFixed(2) + '</span></div>' +
    '<div class="balance-due-row"><span>Balance Due:</span><span>' + symbol + balanceDue.toFixed(2) + '</span></div>';

  return (
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    'body { font-family: "Segoe UI", Arial, sans-serif; margin: 40px; color: #334155; line-height: 1.5; }' +
    '.header { display: flex; justify-content: space-between; border-bottom: 2px solid #3b82f6; padding-bottom: 20px; margin-bottom: 30px; }' +
    '.company-details { text-align: left; }' +
    '.company-name { font-size: 32px; font-weight: bold; color: #1e3a8a; margin: 0; line-height: 1.1; }' +
    '.company-info { font-size: 13px; color: #64748b; margin: 0; }' +
    '.invoice-title-box { text-align: right; }' +
    '.invoice-title { font-size: 16px; font-weight: bold; color: #64748b; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 1.5px; }' +
    '.invoice-meta { font-size: 13px; color: #475569; margin: 2px 0; }' +
    '.details-row { display: flex; justify-content: space-between; margin-bottom: 30px; gap: 20px; }' +
    '.bill-to { flex: 1; background: #f8fafc; padding: 15px; border-radius: 6px; border: 1px solid #e2e8f0; }' +
    '.bill-to h3 { margin: 0 0 8px 0; font-size: 14px; text-transform: uppercase; color: #475569; letter-spacing: 0.5px; }' +
    '.bill-to p { margin: 2px 0; font-size: 14px; color: #1e293b; }' +
    'table { width: 100%; border-collapse: collapse; margin: 20px 0; }' +
    'th { background: #1e3a8a; color: #ffffff; padding: 10px 12px; font-size: 13px; font-weight: 600; text-align: left; text-transform: uppercase; }' +
    'td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155; }' +
    '.totals-box { width: 40%; margin-left: auto; margin-top: 20px; font-size: 14px; }' +
    '.totals-box > div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9; }' +
    '.totals-box > .grand { font-size: 16px; font-weight: bold; color: #1e3a8a; border-top: 2px solid #e2e8f0; border-bottom: none; padding-top: 10px; }' +
    '.totals-box > .balance-due-row { font-size: 16px; font-weight: bold; color: #dc2626; border-top: 1px solid #f1f5f9; padding-top: 6px; }' +
    '.terms { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; }' +
    '.terms h3 { margin: 0 0 6px 0; font-size: 12px; text-transform: uppercase; color: #475569; }' +
    '</style></head><body>' +
    '<div class="header">' +
    '  <div class="company-details">' +
    '    <table style="border-collapse: collapse; margin-bottom: 10px;">' +
    '      <tr>' +
    (logoHtml ? '        <td style="vertical-align: middle; padding-right: 15px;">' + logoHtml + '</td>' : '') +
    '        <td style="vertical-align: middle;">' +
    '          <h1 class="company-name">' + companyName + '</h1>' +
    '          <p class="company-info" style="font-weight: 600; color: #475569; margin: 2px 0 0 0;">Quality & Consistency</p>' +
    '        </td>' +
    '      </tr>' +
    '    </table>' +
    '    <p class="company-info">' + companyAddress + '</p>' +
    '    <p class="company-info">Phone: ' + companyPhone + ' | Email: ' + companyEmail + '</p>' +
    '  </div>' +
    '  <div class="invoice-title-box">' +
    '    <h1 class="invoice-title">Non VAT Invoice</h1>' +
    '    <p class="invoice-meta"><strong>Invoice #:</strong> ' + inv.number + '</p>' +
    '    <p class="invoice-meta"><strong>Date:</strong> ' + formatPdfDate(inv.date) + '</p>' +
    '    <p class="invoice-meta"><strong>Due Date:</strong> ' + formatPdfDate(inv.dueDate) + '</p>' +
    '  </div>' +
    '</div>' +
    '<div class="details-row">' +
    '  <div class="bill-to">' +
    '    <h3>Bill To</h3>' +
    '    <p><strong>' + inv.customerName + '</strong></p>' +
    '    <p>' + (inv.billingAddress || "") + '</p>' +
    '    <p>Phone: ' + (inv.customerPhone || "—") + '</p>' +
    '  </div>' +
    '</div>' +
    '<table>' +
    '  <thead>' +
    '    <tr>' +
    '      <th style="width: 5%;">#</th>' +
    '      <th style="width: 55%;">Item Description</th>' +
    '      <th style="width: 10%; text-align: center;">Qty</th>' +
    '      <th style="width: 15%; text-align: right;">Rate</th>' +
    '      <th style="width: 15%; text-align: right;">Amount</th>' +
    '    </tr>' +
    '  </thead>' +
    '  <tbody>' + itemsHtml + '</tbody>' +
    '</table>' +
    '<div class="totals-box">' +
       totalsHtml +
    '</div>' +
    termsHtml +
    '</body></html>'
  );
}

function buildPurchaseHtml(bill, currencySymbol) {
  var symbol = currencySymbol || "£";
  var itemsHtml = (bill.items || [])
    .map(function (it, i) {
      var qty = Number(it.qty) || 0;
      var unitPrice = Number(it.unitPrice) || 0;
      var amount = qty * unitPrice;
      return (
        "<tr>" +
        "<td>" + (i + 1) + "</td>" +
        "<td>" + it.name + "</td>" +
        "<td style='text-align: center;'>" + qty + "</td>" +
        "<td style='text-align: right;'>" + symbol + unitPrice.toFixed(2) + "</td>" +
        "<td style='text-align: right; font-weight: bold;'>" + symbol + amount.toFixed(2) + "</td>" +
        "</tr>"
      );
    })
    .join("");

  var subtotal = Number(bill.subtotal) || 0;
  var grandTotal = Number(bill.grandTotal) || 0;
  var amountPaid = Number(bill.amountPaid) || 0;
  var balanceDue = Number(bill.balanceDue) || 0;

  var vendorName = bill.vendorName || "";
  var vendorPhone = bill.vendorPhone || "";
  var vendorAddress = bill.vendorAddress || "";

  var company = bill.company || {};
  var companyName = company.companyName || "Smart Invoice";
  var companyAddress = company.address || "";
  var companyPhone = company.phone || "";
  var companyEmail = company.email || "";

  var logoHtml = "";
  if (company.logoBase64) {
    var src = company.logoBase64;
    if (src.indexOf("http") === 0) {
      src = getLogoAsBase64(src);
    }
    if (src.indexOf("data:image") === 0 || src.indexOf("http") === 0) {
      logoHtml = '<img src="' + src + '" style="max-height: 75px; max-width: 180px; object-fit: contain; display: block;" />';
    } else {
      logoHtml = '<img src="data:image/png;base64,' + src + '" style="max-height: 75px; max-width: 180px; object-fit: contain; display: block;" />';
    }
  }

  return (
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    'body { font-family: "Segoe UI", Arial, sans-serif; margin: 40px; color: #334155; line-height: 1.5; }' +
    '.header { display: flex; justify-content: space-between; border-bottom: 2px solid #10b981; padding-bottom: 20px; margin-bottom: 30px; }' +
    '.company-details { text-align: left; }' +
    '.company-name { font-size: 32px; font-weight: bold; color: #065f46; margin: 0; line-height: 1.1; }' +
    '.company-info { font-size: 13px; color: #64748b; margin: 0; }' +
    '.invoice-title-box { text-align: right; }' +
    '.invoice-title { font-size: 16px; font-weight: 800; color: #065f46; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 1.5px; }' +
    '.invoice-meta { font-size: 13px; color: #475569; margin: 2px 0; }' +
    '.details-row { display: flex; justify-content: space-between; margin-bottom: 30px; gap: 20px; }' +
    '.bill-to { flex: 1; background: #f8fafc; padding: 15px; border-radius: 6px; border: 1px solid #e2e8f0; }' +
    '.bill-to h3 { margin: 0 0 8px 0; font-size: 14px; text-transform: uppercase; color: #475569; letter-spacing: 0.5px; }' +
    '.bill-to p { margin: 2px 0; font-size: 14px; color: #1e293b; }' +
    'table { width: 100%; border-collapse: collapse; margin: 20px 0; }' +
    'th { background: #065f46; color: #ffffff; padding: 10px 12px; font-size: 13px; font-weight: 600; text-align: left; text-transform: uppercase; }' +
    'td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155; }' +
    '.totals-box { width: 40%; margin-left: auto; margin-top: 20px; font-size: 14px; }' +
    '.totals-box > div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9; }' +
    '.totals-box > .grand { font-size: 16px; font-weight: bold; color: #065f46; border-top: 2px solid #e2e8f0; border-bottom: none; padding-top: 10px; }' +
    '.totals-box > .balance-due-row { font-size: 16px; font-weight: bold; color: #dc2626; border-top: 1px solid #f1f5f9; padding-top: 6px; }' +
    '</style></head><body>' +
    '<div class="header">' +
    '  <div class="company-details">' +
    '    <table style="border-collapse: collapse; margin-bottom: 10px;">' +
    '      <tr>' +
    (logoHtml ? '        <td style="vertical-align: middle; padding-right: 15px;">' + logoHtml + '</td>' : '') +
    '        <td style="vertical-align: middle;">' +
    '          <h1 class="company-name">Deliver To: ' + companyName + '</h1>' +
    '        </td>' +
    '      </tr>' +
    '    </table>' +
    '    <p class="company-info">' + companyAddress + '</p>' +
    '    <p class="company-info">Phone: ' + companyPhone + ' | Email: ' + companyEmail + '</p>' +
    '  </div>' +
    '  <div class="invoice-title-box">' +
    '    <h1 class="invoice-title">Purchase Bill</h1>' +
    '    <p class="invoice-meta"><strong>Bill #:</strong> ' + bill.number + '</p>' +
    (bill.partyInvoiceNumber ? '    <p class="invoice-meta"><strong>Party Invoice #:</strong> ' + bill.partyInvoiceNumber + '</p>' : '') +
    '    <p class="invoice-meta"><strong>Date:</strong> ' + formatPdfDate(bill.date) + '</p>' +
    '  </div>' +
    '</div>' +
    '<div class="details-row">' +
    '  <div class="bill-to">' +
    '    <h3>Vendor / Supplier Details</h3>' +
    '    <p><strong>' + vendorName + '</strong></p>' +
    '    <p>' + (vendorAddress || "") + '</p>' +
    '    <p>Phone: ' + (vendorPhone || "—") + '</p>' +
    '  </div>' +
    '</div>' +
    '<table>' +
    '  <thead>' +
    '    <tr>' +
    '      <th style="width: 5%;">#</th>' +
    '      <th style="width: 60%;">Item Description</th>' +
    '      <th style="width: 10%; text-align: center;">Qty</th>' +
    '      <th style="width: 15%; text-align: right;">Unit Price</th>' +
    '      <th style="width: 10%; text-align: right;">Amount</th>' +
    '    </tr>' +
    '  </thead>' +
    '  <tbody>' + itemsHtml + '</tbody>' +
    '</table>' +
    '<div class="totals-box">' +
    '  <div><span>Subtotal:</span><span>' + symbol + subtotal.toFixed(2) + '</span></div>' +
    '  <div class="grand"><span>Grand Total:</span><span>' + symbol + grandTotal.toFixed(2) + '</span></div>' +
    '  <div><span>Amount Paid:</span><span>' + symbol + amountPaid.toFixed(2) + '</span></div>' +
    '  <div class="balance-due-row"><span>Balance Due:</span><span>' + symbol + balanceDue.toFixed(2) + '</span></div>' +
    '</div>' +
    '</body></html>'
  );
}

// ── DRIVE ────────────────────────────────────────────────────
function savePdfToDrive(pdfBlob, filename, subfolder) {
  var rootFolder = getOrCreateDriveFolder(DRIVE_FOLDER_NAME);
  var sub = getOrCreateDriveFolder(subfolder, rootFolder);
  var file = sub.createFile(pdfBlob);
  return file.getUrl();
}

function getOrCreateDriveFolder(name, parent) {
  var search = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (search.hasNext()) return search.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

// ── SHEETS HELPERS ───────────────────────────────────────────
function getOrCreateSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var id = SPREADSHEET_ID || props.getProperty("SPREADSHEET_ID");
  var ss;
  if (id) {
    try {
      ss = SpreadsheetApp.openById(id);
      ss.setSpreadsheetTimeZone("Europe/London");
      return ss;
    } catch (e) {}
  }

  // Look for an existing spreadsheet named "Smart Invoice — Master Sheet" in Drive to reuse it
  var files = DriveApp.getFilesByName("Smart Invoice — Master Sheet");
  if (files.hasNext()) {
    var file = files.next();
    try {
      var existingSs = SpreadsheetApp.openById(file.getId());
      props.setProperty("SPREADSHEET_ID", existingSs.getId());
      existingSs.setSpreadsheetTimeZone("Europe/London");
      return existingSs;
    } catch (e) {}
  }

  // If none exists, create a new one
  ss = SpreadsheetApp.create("Smart Invoice — Master Sheet");
  props.setProperty("SPREADSHEET_ID", ss.getId());
  ss.setSpreadsheetTimeZone("Europe/London");
  Logger.log("Created spreadsheet: " + ss.getUrl());
  return ss;
}

function getOrCreateSheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setBackground("#0f172a")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function deleteRowByColumn(ss, sheetName, id, colIndex) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][colIndex]) === String(id)) {
      sh.deleteRow(i + 1);
      return;
    }
  }
}

// ── SETUP ────────────────────────────────────────────────────
function setup() {
  var ss = getOrCreateSpreadsheet();

  var sheetsMap = {
    "Sales Transactions": [
      "Invoice ID", "Customer Name", "Contact Info", "Items JSON",
      "Discount Total", "Shipping", "Payment Status", "PDF URL",
      "WhatsApp Status", "Email Status", "Payment Mode",
      "Invoice Status", "Due Date", "QR Payment Link",
      "Subtotal", "Grand Total", "Amount Paid", "Balance Due", "Invoice Date"
    ],
    "Purchase Transactions": [
      "Bill Number", "Vendor Name", "Vendor Phone", "Vendor Email",
      "Vendor Address", "Items JSON", "Subtotal", "Grand Total",
      "Amount Paid", "Balance Due", "Payment Status", "Payment Method",
      "PDF URL", "Bill Date", "Party Invoice Number"
    ],
    "Activity Log": [
      "Log ID", "Reference ID", "Type", "Customer/Supplier", "Status",
      "User", "Action Type", "Timestamp"
    ],
    "Payment Transactions": ["ID", "Date", "Reference ID", "Type", "Amount", "Method"],
    "Inventory": [
      "Product ID", "Product Name", "SKU Code", "Product Category",
      "Cost Price", "Sell Price", "Current Stock", "Minimum Stock", "Date Added"
    ],
    "Expenses": ["Expense ID", "Expense Date", "Expense Amount", "Payment Type", "Expense Category"],
    "Customers": [
      "Customer ID", "Customer Name", "Phone", "Email", "Address",
      "City", "Country", "Postcode", "Outstanding Balance", "Created At"
    ],
    "Suppliers": [
      "Supplier ID", "Vendor Name", "Phone", "Email", "Address",
      "City", "Country", "Postcode", "Outstanding Payable", "Created At"
    ],
    "Settings": ["Settings JSON"],
  };

  for (var sheetName in sheetsMap) {
    getOrCreateSheet(ss, sheetName, sheetsMap[sheetName]);
  }

  ensureAndMigrateSchemas(ss);

  setupDashboardSummary(ss);
  getOrCreateDriveFolder(DRIVE_FOLDER_NAME);
  Logger.log("✅ Setup complete! Spreadsheet: " + ss.getUrl());
}

function setupDashboardSummary(ss) {
  var sheetName = "Dashboard Summary";
  var sh = ss.getSheetByName(sheetName);
  if (sh) {
    sh.clear();
  } else {
    sh = ss.insertSheet(sheetName);
  }

  sh.getRange("A1:C1").merge().setValue("SMART BILL & SEND - BUSINESS DASHBOARD")
    .setBackground("#0f172a")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setFontSize(14)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sh.setRowHeight(1, 40);

  sh.setRowHeight(2, 15);

  sh.getRange("A3:C3").setValues([["KPI Metric", "Value", "Description"]])
    .setBackground("#334155")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setFontSize(11)
    .setHorizontalAlignment("left");
  sh.getRange("B3").setHorizontalAlignment("right");
  sh.setRowHeight(3, 25);

  var metrics = [
    ["Total Sales (Invoiced)", "=SUM('Sales Transactions'!P2:P)", "Total amount of all sales invoices generated"],
    ["Total Collected (Sales)", "=SUM('Sales Transactions'!Q2:Q)", "Total payments received from customers"],
    ["Outstanding Receivables", "=SUM('Sales Transactions'!R2:R)", "Total unpaid balance due from customers"],
    ["Total Purchases (Billed)", "=SUM('Purchase Transactions'!H2:H)", "Total amount of supplier purchase bills"],
    ["Total Paid (Purchases)", "=SUM('Purchase Transactions'!I2:I)", "Total payments made to suppliers"],
    ["Outstanding Payables", "=SUM('Purchase Transactions'!J2:J)", "Total unpaid balance due to suppliers"],
    ["Total Expenses", "=SUM('Expenses'!C2:C)", "Total business operational expenses logged"],
    ["Net Profit", "=B4-B7-B10", "Net profit calculated as (Sales - Purchases - Expenses)"]
  ];

  sh.getRange("A4:C11").setValues(metrics);

  sh.getRange("A4:A11").setFontWeight("bold").setFontColor("#1e293b");

  // Use plain number format — no hardcoded $ symbol
  sh.getRange("B4:B11")
    .setFontWeight("bold")
    .setHorizontalAlignment("right")
    .setNumberFormat("#,##0.00;(#,##0.00);\"-\"");

  sh.getRange("C4:C11").setFontColor("#64748b").setFontStyle("italic");

  for (var r = 4; r <= 11; r++) {
    sh.setRowHeight(r, 22);
  }

  var netProfitRange = sh.getRange("A11:C11");
  netProfitRange.setBackground("#dcfce7").setFontColor("#15803d");

  sh.getRange("B11").setBorder(true, null, true, null, null, null, "#15803d", SpreadsheetApp.BorderStyle.DOUBLE);

  sh.autoResizeColumns(1, 3);
  sh.setColumnWidth(1, Math.max(sh.getColumnWidth(1) + 20, 200));
  sh.setColumnWidth(2, Math.max(sh.getColumnWidth(2) + 20, 120));
  sh.setColumnWidth(3, Math.max(sh.getColumnWidth(3) + 40, 300));

  try {
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(1);
  } catch (e) {
    Logger.log("Failed to move Dashboard Summary to first position: " + e);
  }
}

// ── UTIL ─────────────────────────────────────────────────────
function jsonResp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function handleSettingsSync(ss, payload) {
  var sh = getOrCreateSheet(ss, "Settings", ["Settings JSON"]);
  sh.getRange(2, 1).setValue(JSON.stringify(payload));
  return jsonResp({ ok: true });
}

// ── PULL (database.pull) ─────────────────────────────────────
function handlePull(ss) {
  ensureAndMigrateSchemas(ss);
  var data = {};

  // 1. Customers
  data.customers = readSheetToObjects(ss, "Customers", function(row) {
    return {
      id: String(row[0]),
      name: String(row[1]),
      phone: String(row[2]),
      email: String(row[3]),
      address: String(row[4]),
      city: String(row[5] || ""),
      country: String(row[6] || ""),
      postcode: String(row[7] || ""),
      outstandingBalance: Number(row[8]) || 0,
      createdAt: String(row[9] || getUKTimeISO())
    };
  });

  // 2. Suppliers
  data.vendors = readSheetToObjects(ss, "Suppliers", function(row) {
    return {
      id: String(row[0]),
      name: String(row[1]),
      phone: String(row[2]),
      email: String(row[3]),
      address: String(row[4]),
      city: String(row[5] || ""),
      country: String(row[6] || ""),
      postcode: String(row[7] || ""),
      outstandingPayable: Number(row[8]) || 0,
      createdAt: String(row[9] || getUKTimeISO())
    };
  });

  // 3. Inventory (Products)
  data.products = readSheetToObjects(ss, "Inventory", function(row) {
    return {
      id: String(row[0]),
      name: String(row[1]),
      sku: String(row[2] || ""),
      category: String(row[3] || ""),
      purchasePrice: Number(row[4]) || 0,
      sellingPrice: Number(row[5]) || 0,
      stock: Number(row[6]) || 0,
      reorderLevel: Number(row[7]) || 0,
      date: String(row[8] || getUKDateString())
    };
  });

  // 4. Sales Transactions (Invoices)
  data.invoices = readSheetToObjects(ss, "Sales Transactions", function(row) {
    var contact = String(row[2] || "");
    var phone = contact.split(" / ")[0] || "";
    var email = contact.includes(" / ") ? contact.split(" / ")[1] : "";
    var items = [];
    try {
      items = JSON.parse(row[3] || "[]");
    } catch (e) {}
    return {
      id: String(row[0]),
      number: String(row[0]),
      customerName: String(row[1]),
      customerPhone: phone,
      customerEmail: email,
      items: items,
      discountTotal: Number(row[4]) || 0,
      shipping: Number(row[5]) || 0,
      paymentStatus: String(row[6] || "pending"),
      pdfUrl: String(row[7] || ""),
      whatsappStatus: String(row[8] || "Not Sent"),
      emailStatus: String(row[9] || "Not Sent"),
      paymentMode: String(row[10] || ""),
      invoiceStatus: String(row[11] || "draft"),
      dueDate: String(row[12] || ""),
      qrPaymentLink: String(row[13] || ""),
      subtotal: Number(row[14]) || 0,
      grandTotal: Number(row[15]) || 0,
      amountPaid: Number(row[16]) || 0,
      balanceDue: Number(row[17]) || 0,
      date: String(row[18] || getUKTimeISO())
    };
  });

  // 5. Purchase Transactions
  data.purchaseBills = readSheetToObjects(ss, "Purchase Transactions", function(row) {
    var items = [];
    try {
      items = JSON.parse(row[5] || "[]");
    } catch (e) {}
    return {
      id: String(row[0]),
      number: String(row[0]),
      vendorName: String(row[1]),
      vendorPhone: String(row[2]),
      vendorEmail: String(row[3] || ""),
      vendorAddress: String(row[4] || ""),
      items: items,
      subtotal: Number(row[6]) || 0,
      grandTotal: Number(row[7]) || 0,
      amountPaid: Number(row[8]) || 0,
      balanceDue: Number(row[9]) || 0,
      paymentStatus: String(row[10] || "pending"),
      paymentMethod: String(row[11] || ""),
      pdfUrl: String(row[12] || ""),
      date: String(row[13] || getUKTimeISO()),
      partyInvoiceNumber: String(row[14] || "")
    };
  });

  // 6. Expenses
  data.expenses = readSheetToObjects(ss, "Expenses", function(row) {
    return {
      id: String(row[0]),
      date: String(row[1]),
      amount: Number(row[2]) || 0,
      paymentType: String(row[3] || ""),
      category: String(row[4] || "")
    };
  });

  // 7. Payments
  data.payments = readSheetToObjects(ss, "Payment Transactions", function(row) {
    return {
      id: String(row[0]),
      date: String(row[1]),
      referenceId: String(row[2]),
      type: String(row[3]),
      amount: Number(row[4]) || 0,
      method: String(row[5] || "")
    };
  });

  // 8. Activity Logs
  data.activityLogs = readSheetToObjects(ss, "Activity Log", function(row) {
    return {
      id: String(row[0]),
      referenceId: String(row[1]),
      type: String(row[2]),
      entityName: String(row[3]),
      status: String(row[4]),
      user: String(row[5]),
      actionType: String(row[6]),
      timestamp: String(row[7])
    };
  });

  // 9. Settings
  data.settings = null;
  var settingsSh = ss.getSheetByName("Settings");
  if (settingsSh) {
    try {
      var val = settingsSh.getRange(2, 1).getValue();
      if (val) {
        data.settings = JSON.parse(val);
      }
    } catch (e) {
      Logger.log("Failed to parse settings JSON: " + e);
    }
  }

  return jsonResp({ ok: true, data: data });
}

function readSheetToObjects(ss, sheetName, mapper) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  var list = [];
  for (var i = 1; i < values.length; i++) {
    try {
      // Ignore rows with blank IDs or placeholders
      if (!values[i] || values[i][0] === "") continue;
      list.push(mapper(values[i]));
    } catch (err) {
      Logger.log("Error mapping row " + i + " in " + sheetName + ": " + err);
    }
  }
  return list;
}

function ensureAndMigrateSchemas(ss) {
  var sheetsMap = {
    "Sales Transactions": [
      "Invoice ID", "Customer Name", "Contact Info", "Items JSON",
      "Discount Total", "Shipping", "Payment Status", "PDF URL",
      "WhatsApp Status", "Email Status", "Payment Mode",
      "Invoice Status", "Due Date", "QR Payment Link",
      "Subtotal", "Grand Total", "Amount Paid", "Balance Due", "Invoice Date"
    ],
    "Purchase Transactions": [
      "Bill Number", "Vendor Name", "Vendor Phone", "Vendor Email",
      "Vendor Address", "Items JSON", "Subtotal", "Grand Total",
      "Amount Paid", "Balance Due", "Payment Status", "Payment Method",
      "PDF URL", "Bill Date", "Party Invoice Number"
    ],
    "Activity Log": [
      "Log ID", "Reference ID", "Type", "Customer/Supplier", "Status",
      "User", "Action Type", "Timestamp"
    ],
    "Inventory": [
      "Product ID", "Product Name", "SKU Code", "Product Category",
      "Cost Price", "Sell Price", "Current Stock", "Minimum Stock", "Date Added"
    ],
    "Expenses": ["Expense ID", "Expense Date", "Expense Amount", "Payment Type", "Expense Category"],
    "Customers": [
      "Customer ID", "Customer Name", "Phone", "Email", "Address",
      "City", "Country", "Postcode", "Outstanding Balance", "Created At"
    ],
    "Suppliers": [
      "Supplier ID", "Vendor Name", "Phone", "Email", "Address",
      "City", "Country", "Postcode", "Outstanding Payable", "Created At"
    ]
  };

  for (var sheetName in sheetsMap) {
    try {
      var sh = ss.getSheetByName(sheetName);
      if (!sh) continue;
      
      var range = sh.getDataRange();
      var values = range.getValues();
      if (values.length === 0) continue;
      
      var existingHeaders = values[0].map(function(h) { return String(h).trim(); });
      var targetHeaders = sheetsMap[sheetName];
      
      var match = true;
      if (existingHeaders.length !== targetHeaders.length) {
        match = false;
      } else {
        for (var i = 0; i < targetHeaders.length; i++) {
          if (existingHeaders[i] !== targetHeaders[i]) {
            match = false;
            break;
          }
        }
      }
      
      if (match) continue; // Already matches
      
      Logger.log("Migrating sheet schema for: " + sheetName);
      
      // Map from header names to old column index
      var colMap = {};
      for (var k = 0; k < existingHeaders.length; k++) {
        colMap[existingHeaders[k]] = k;
      }
      
      var newRows = [];
      for (var r = 1; r < values.length; r++) {
        var oldRow = values[r];
        var newRow = new Array(targetHeaders.length).fill("");
        
        for (var c = 0; c < targetHeaders.length; c++) {
          var header = targetHeaders[c];
          var oldIdx = colMap[header];
          
          // Fallbacks for renaming or merging fields
          if (oldIdx === undefined) {
            if (header === "Customer Name" && colMap["Customer name"] !== undefined) {
              oldIdx = colMap["Customer name"];
            } else if (header === "Cost Price" && colMap["Purchase Price"] !== undefined) {
              oldIdx = colMap["Purchase Price"];
            } else if (header === "Sell Price" && colMap["Selling Price"] !== undefined) {
              oldIdx = colMap["Selling Price"];
            } else if (header === "Current Stock" && colMap["Closing Balance"] !== undefined) {
              oldIdx = colMap["Closing Balance"];
            } else if (header === "Minimum Stock" && colMap["Reorder Level"] !== undefined) {
              oldIdx = colMap["Reorder Level"];
            } else if (header === "Date Added" && colMap["Bill Date"] !== undefined) {
              oldIdx = colMap["Bill Date"];
            } else if (header === "Created At" && colMap["Date Added"] !== undefined) {
              oldIdx = colMap["Date Added"];
            } else if (header === "Log ID" && colMap["Log ID"] !== undefined) {
              oldIdx = colMap["Log ID"];
            } else if (header === "Reference ID" && colMap["Invoice ID"] !== undefined) {
              oldIdx = colMap["Invoice ID"];
            } else if (header === "User" && colMap["User who performed action"] !== undefined) {
              oldIdx = colMap["User who performed action"];
            } else if (header === "Action Type" && colMap["Action type"] !== undefined) {
              oldIdx = colMap["Action type"];
            }
          }
          
          if (oldIdx !== undefined && oldRow[oldIdx] !== undefined) {
            newRow[c] = oldRow[oldIdx];
          } else {
            // Sensible defaults
            if (header === "Created At" || header === "Date Added" || header === "Bill Date") {
              newRow[c] = getUKTimeISO();
            } else if (header === "Current Stock" && colMap["Opening Balance"] !== undefined) {
              newRow[c] = oldRow[colMap["Opening Balance"]] || 0;
            } else if (header === "Outstanding Balance" || header === "Outstanding Payable" || header === "Cost Price" || header === "Sell Price" || header === "Minimum Stock") {
              newRow[c] = 0;
            } else {
              newRow[c] = "";
            }
          }
        }
        
        // Additional custom row transformations
        if (sheetName === "Purchase Transactions" && !String(newRow[0] || "").startsWith("PUR-")) {
          var oldBillNum = oldRow[colMap["Bill Number"]];
          if (oldBillNum) {
            newRow[0] = oldBillNum;
          } else {
            newRow[0] = "PUR-" + (2000 + r);
          }
        }
        
        newRows.push(newRow);
      }
      
      sh.clear();
      sh.getRange(1, 1, 1, targetHeaders.length)
        .setValues([targetHeaders])
        .setBackground("#0f172a")
        .setFontColor("#ffffff")
        .setFontWeight("bold");
      sh.setFrozenRows(1);
      
      if (newRows.length > 0) {
        sh.getRange(2, 1, newRows.length, targetHeaders.length).setValues(newRows);
      }
      
      Logger.log("Successfully migrated sheet: " + sheetName);
    } catch (err) {
      Logger.log("Error migrating sheet " + sheetName + ": " + err);
    }
  }
}

function handleClearAllData(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name !== "Settings") {
      try {
        ss.deleteSheet(sheets[i]);
      } catch (e) {
        sheets[i].clear();
      }
    }
  }
  setup();
  return jsonResp({ ok: true, message: "Database cleared and reset successfully." });
}

function handleInvoiceDelete(ss, payload) {
  deleteRowByColumn(ss, "Sales Transactions", payload.number, 0); // Invoice ID is index 0
  return jsonResp({ ok: true });
}

function handlePurchaseDelete(ss, payload) {
  deleteRowByColumn(ss, "Purchase Transactions", payload.number, 0); // Bill Number is index 0
  return jsonResp({ ok: true });
}
