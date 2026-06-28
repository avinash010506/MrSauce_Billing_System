import ExcelJS from "exceljs";
import { uid, getLocalTodayISO } from "./format";
import type { Customer, Vendor, Product } from "./types";

// Flexible synonym lists for column matching
const productMappings = {
  name: ["name", "product name", "product", "title", "item", "productname", "item name", "itemname"],
  purchasePrice: ["purchase price", "purchaseprice", "cost price", "costprice", "cost", "purchase", "buying price", "buyingprice"],
  sellingPrice: ["selling price", "sellingprice", "sell price", "sellprice", "price", "rate", "sell", "sales price", "salesprice"],
  stock: ["stock", "current stock", "currentstock", "qty", "quantity", "count", "stocks", "avail qty", "available qty"],
  reorderLevel: ["reorder level", "reorderlevel", "reorder", "minimum stock", "min stock", "minstock", "alert qty"],
  sku: ["sku", "item code", "itemcode", "code", "barcode", "product code", "productcode"],
  category: ["category", "group", "type", "class"],
  date: ["date", "added date", "addeddate", "created date", "createddate"]
};

const customerMappings = {
  name: ["name", "customer name", "customername", "client name", "clientname", "customer", "client", "contact name"],
  phone: ["phone", "phone number", "phonenumber", "mobile", "mobile number", "mobilenumber", "contact", "contact number"],
  email: ["email", "email address", "emailaddress", "mail"],
  address: ["address", "street", "billing address", "billingaddress", "location"],
  city: ["city", "town"],
  country: ["country", "nation"],
  postcode: ["postcode", "zipcode", "zip", "postal code", "postalcode", "post code"]
};

const vendorMappings = {
  name: ["name", "vendor name", "vendorname", "supplier name", "suppliername", "vendor", "supplier", "contact name"],
  phone: ["phone", "phone number", "phonenumber", "mobile", "mobile number", "mobilenumber", "contact", "contact number"],
  email: ["email", "email address", "emailaddress", "mail"],
  address: ["address", "street", "vendor address", "vendoraddress", "supplier address", "supplieraddress", "location"],
  city: ["city", "town"],
  country: ["country", "nation"],
  postcode: ["postcode", "zipcode", "zip", "postal code", "postalcode", "post code"]
};

// Helper to extract a value safely from row data
function findValue(rowData: Record<string, any>, synonyms: string[], defaultValue: any = ""): any {
  for (const synonym of synonyms) {
    const key = synonym.toLowerCase().trim();
    if (rowData[key] !== undefined && rowData[key] !== null) {
      const val = rowData[key];
      if (typeof val === "object" && val !== null) {
        if ("result" in val) return val.result;
        if ("text" in val) return val.text;
        return String(val);
      }
      return val;
    }
  }
  return defaultValue;
}

// Convert cell value to a number
function parseNumber(val: any, fallback = 0): number {
  if (typeof val === "number") return val;
  if (val === null || val === undefined) return fallback;
  const cleaned = String(val).replace(/[^0-9.-]/g, ""); // remove currency symbols etc.
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? fallback : parsed;
}

// Convert cell value to a formatted date string
function parseDate(val: any): string {
  if (val instanceof Date) {
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof val === "string" && val.trim()) {
    try {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split("T")[0];
      }
    } catch {}
  }
  return getLocalTodayISO();
}

// Parse Excel worksheet to flat row objects
async function parseExcelFile(fileBuffer: ArrayBuffer): Promise<Record<string, any>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = cell.value ? String(cell.value).trim().toLowerCase() : "";
  });

  const records: Record<string, any>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const rowData: Record<string, any> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) {
        rowData[header] = cell.value;
      }
    });
    // Check if the row has any content (not completely empty)
    const hasContent = Object.values(rowData).some(val => val !== null && val !== undefined && String(val).trim() !== "");
    if (hasContent) {
      records.push(rowData);
    }
  });

  return records;
}

export async function importProductsExcel(fileBuffer: ArrayBuffer, existingProducts: Product[]): Promise<{
  newProducts: Product[];
  updatedProducts: Product[];
  allProducts: Product[];
}> {
  const records = await parseExcelFile(fileBuffer);
  const newProducts: Product[] = [];
  const updatedProducts: Product[] = [];
  const allProducts = [...existingProducts];

  for (const rec of records) {
    const name = findValue(rec, productMappings.name, "").trim();
    if (!name) continue;

    const purchasePrice = parseNumber(findValue(rec, productMappings.purchasePrice, 0));
    const sellingPrice = parseNumber(findValue(rec, productMappings.sellingPrice, 0));
    const stock = parseNumber(findValue(rec, productMappings.stock, 0));
    const reorderLevel = parseNumber(findValue(rec, productMappings.reorderLevel, 5));
    const sku = findValue(rec, productMappings.sku, "").trim();
    const category = findValue(rec, productMappings.category, "General").trim();
    const date = parseDate(findValue(rec, productMappings.date, getLocalTodayISO()));

    const existingIdx = allProducts.findIndex(p => p.name.toLowerCase() === name.toLowerCase());

    if (existingIdx >= 0) {
      const p = allProducts[existingIdx];
      const updated: Product = {
        ...p,
        purchasePrice: purchasePrice || p.purchasePrice,
        sellingPrice: sellingPrice || p.sellingPrice,
        stock: stock !== undefined ? stock : p.stock,
        reorderLevel: reorderLevel || p.reorderLevel,
        sku: sku || p.sku,
        category: category !== "General" ? category : p.category,
        date: date || p.date,
      };
      allProducts[existingIdx] = updated;
      updatedProducts.push(updated);
    } else {
      const newP: Product = {
        id: uid("p_"),
        name,
        sku: sku || `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        category,
        purchasePrice,
        sellingPrice,
        stock,
        reorderLevel,
        date,
      };
      allProducts.unshift(newP);
      newProducts.push(newP);
    }
  }

  return { newProducts, updatedProducts, allProducts };
}

export async function importCustomersExcel(fileBuffer: ArrayBuffer, existingCustomers: Customer[]): Promise<{
  newCustomers: Customer[];
  updatedCustomers: Customer[];
  allCustomers: Customer[];
}> {
  const records = await parseExcelFile(fileBuffer);
  const newCustomers: Customer[] = [];
  const updatedCustomers: Customer[] = [];
  const allCustomers = [...existingCustomers];

  for (const rec of records) {
    const name = findValue(rec, customerMappings.name, "").trim();
    if (!name) continue;

    const phone = String(findValue(rec, customerMappings.phone, "")).trim();
    const email = String(findValue(rec, customerMappings.email, "")).trim();
    const address = String(findValue(rec, customerMappings.address, "")).trim();
    const city = String(findValue(rec, customerMappings.city, "")).trim();
    const country = String(findValue(rec, customerMappings.country, "")).trim();
    const postcode = String(findValue(rec, customerMappings.postcode, "")).trim();

    const existingIdx = allCustomers.findIndex(c => c.name.toLowerCase() === name.toLowerCase());

    if (existingIdx >= 0) {
      const c = allCustomers[existingIdx];
      const updated: Customer = {
        ...c,
        phone: phone || c.phone,
        email: email || c.email,
        address: address || c.address,
        city: city || c.city,
        country: country || c.country,
        postcode: postcode || c.postcode,
      };
      allCustomers[existingIdx] = updated;
      updatedCustomers.push(updated);
    } else {
      const newC: Customer = {
        id: uid("c_"),
        name,
        phone,
        email,
        address,
        city,
        country,
        postcode,
        createdAt: new Date().toISOString(),
      };
      allCustomers.unshift(newC);
      newCustomers.push(newC);
    }
  }

  return { newCustomers, updatedCustomers, allCustomers };
}

export async function importVendorsExcel(fileBuffer: ArrayBuffer, existingVendors: Vendor[]): Promise<{
  newVendors: Vendor[];
  updatedVendors: Vendor[];
  allVendors: Vendor[];
}> {
  const records = await parseExcelFile(fileBuffer);
  const newVendors: Vendor[] = [];
  const updatedVendors: Vendor[] = [];
  const allVendors = [...existingVendors];

  for (const rec of records) {
    const name = findValue(rec, vendorMappings.name, "").trim();
    if (!name) continue;

    const phone = String(findValue(rec, vendorMappings.phone, "")).trim();
    const email = String(findValue(rec, vendorMappings.email, "")).trim();
    const address = String(findValue(rec, vendorMappings.address, "")).trim();
    const city = String(findValue(rec, vendorMappings.city, "")).trim();
    const country = String(findValue(rec, vendorMappings.country, "")).trim();
    const postcode = String(findValue(rec, vendorMappings.postcode, "")).trim();

    const existingIdx = allVendors.findIndex(v => v.name.toLowerCase() === name.toLowerCase());

    if (existingIdx >= 0) {
      const v = allVendors[existingIdx];
      const updated: Vendor = {
        ...v,
        phone: phone || v.phone,
        email: email || v.email,
        address: address || v.address,
        city: city || v.city,
        country: country || v.country,
        postcode: postcode || v.postcode,
      };
      allVendors[existingIdx] = updated;
      updatedVendors.push(updated);
    } else {
      const newV: Vendor = {
        id: uid("v_"),
        name,
        phone,
        email,
        address,
        city,
        country,
        postcode,
        createdAt: new Date().toISOString(),
      };
      allVendors.unshift(newV);
      newVendors.push(newV);
    }
  }

  return { newVendors, updatedVendors, allVendors };
}
