import { store } from "./storage";
import type {
  Customer,
  Invoice,
  Product,
  PurchaseBill,
  Vendor,
  Expense,
  PaymentTransaction,
  ActivityLog,
  CompanySettings,
} from "./types";

// Optional Google Apps Script sync layer.
// When user configures `appsScriptUrl` in Settings, mutations are also POSTed
// to the Apps Script Web App which writes them to Google Sheets / Drive.

type SyncAction =
  | { type: "invoice.create"; payload: Invoice & { sendEmail?: boolean; sendWhatsApp?: boolean; company?: CompanySettings } }
  | { type: "invoice.delete"; payload: { number: string } }
  | { type: "purchase.create"; payload: PurchaseBill }
  | { type: "purchase.delete"; payload: { number: string } }
  | { type: "customer.upsert"; payload: Customer }
  | { type: "customer.delete"; payload: { id: string } }
  | { type: "vendor.upsert"; payload: Vendor }
  | { type: "vendor.delete"; payload: { id: string } }
  | { type: "product.upsert"; payload: Product }
  | { type: "product.delete"; payload: { id: string } }
  | { type: "expense.create"; payload: Expense }
  | { type: "expense.delete"; payload: { id: string } }
  | { type: "payment.create"; payload: PaymentTransaction }
  | { type: "payment.delete"; payload: { id: string } }
  | { type: "activity.create"; payload: ActivityLog }
  | { type: "database.pull"; payload?: { email?: string; otp?: string } }
  | { type: "database.clear" }
  | { type: "settings.sync"; payload: CompanySettings }
  | { type: "otp.send"; payload: { email: string; otp: string } }
  | { type: "invoice.send"; payload: {
      invoice: Invoice;
      company: CompanySettings;
      sendEmail: boolean;
      sendWhatsApp: boolean;
      whatsappToken?: string;
      whatsappPhoneId?: string;
    } };

export async function syncToAppsScript(action: SyncAction, overrideApiKey?: string) {
  const settings = store.getSettings();
  const url = settings.appsScriptUrl;
  if (!url) return { skipped: true };
  try {
    const session = store.getSession();
    const bodyPayload = {
      ...action,
      apiKey: overrideApiKey !== undefined ? overrideApiKey : (settings.apiKey || ""),
      currentUser: session ? { username: session.username, role: session.role } : null
    };

    // Use text/plain to avoid CORS preflight against Apps Script
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(bodyPayload),
    });
    return await res.json().catch(() => ({ ok: res.ok }));
  } catch (e) {
    console.warn("Apps Script sync failed", e);
    return { ok: false, error: String(e) };
  }
}
