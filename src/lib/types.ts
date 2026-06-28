export type Role = "admin" | "staff" | "accountant";

export interface User {
  username: string;
  name: string;
  role: Role;
  email?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;

  address: string;
  city?: string;
  country?: string;
  postcode?: string;
  createdAt: string;
  productHistory?: string;
  outstandingBalance?: number;
  customerType?: string;
}

export interface Vendor {
  id: string;
  name: string;
  phone: string;
  email: string;

  address: string;
  city?: string;
  country?: string;
  postcode?: string;
  createdAt: string;
  productHistory?: string;
  outstandingPayable?: number;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  purchasePrice: number;
  sellingPrice: number;

  stock: number;
  reorderLevel: number;
  barcode?: string;
  supplierName?: string;
  warehouseLocation?: string;
  date?: string;
}

export interface InvoiceItem {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  discount: number;
  purchasePrice?: number;
}

export type PaymentStatus = "paid" | "pending" | "partial";
export type InvoiceStatus = "draft" | "sent" | "cancelled" | "paid";

export interface Invoice {
  id: string;
  number: string;
  date: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;

  billingAddress: string;
  shippingAddress: string;
  items: InvoiceItem[];
  subtotal: number;

  discountTotal?: number;
  shipping?: number;
  grandTotal: number;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  pdfUrl?: string;
  whatsappStatus?: string;
  emailStatus?: string;
  paymentMode?: string;
  invoiceStatus?: InvoiceStatus;
  salespersonName?: string;
  dueDate?: string;
  qrPaymentLink?: string;
  amountPaid?: number;
  balanceDue?: number;
}

export interface PurchaseBillItem {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
}

export interface PurchaseBill {
  id: string;
  number: string;
  date: string;
  dueDate?: string;
  vendorId: string;
  vendorName: string;
  vendorPhone: string;
  vendorEmail: string;

  vendorAddress: string;
  items: PurchaseBillItem[];
  subtotal: number;

  grandTotal: number;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  notes: string;
  amountPaid?: number;
  balanceDue?: number;
  purchaseOrderNumber?: string;
  vendorPaymentTerms?: string;
  expectedDeliveryDate?: string;
  purchaseCategory?: string;
  partyInvoiceNumber?: string;
}

export interface Expense {
  id: string;
  date: string;
  amount: number;
  paymentType: string;
  category: string;
}

export interface ActivityLog {
  id: string;
  referenceId: string;
  type: string;
  entityName: string;
  status: string;
  user: string;
  actionType: "Create" | "Edit" | "Delete";
  timestamp: string;
}

export interface PaymentTransaction {
  id: string;
  date: string;
  referenceId: string;
  type: "Sale" | "Purchase" | "Other" | "Balance Payment";
  amount: number;
  method: string;
}

export interface CompanySettings {
  companyName: string;

  address: string;
  email: string;
  phone: string;
  whatsapp: string;
  invoicePrefix: string;
  purchasePrefix: string;
  currency: string;
  appsScriptUrl: string;
  logoBase64: string;
  termsAndConditions: string;

  // Auto-send settings
  autoSendEmail?: boolean; // via Google Apps Script (Free)
  autoSendWhatsApp?: boolean; // via WhatsApp Cloud API

  // WhatsApp credentials
  waPhoneNumberId?: string;
  waAccessToken?: string;

  // Sales copy email addresses
  salesEmail1?: string;
  salesEmail2?: string;

  // Staff User credentials
  users?: Array<User & { password?: string }>;

  // API credentials
  apiKey?: string;
}
