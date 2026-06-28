/**
 * autosend.ts
 * Handles automated invoice delivery via Google Apps Script backend.
 * Free, secure, and bypasses client-side CORS issues.
 */

import { syncToAppsScript } from "./api";
import type { Invoice, CompanySettings } from "./types";

/**
 * Sends an email via Google Apps Script (Free, using GmailApp/MailApp).
 */
export async function sendEmailAuto(
  inv: Invoice,
  company: CompanySettings,
): Promise<{ ok: boolean; error?: string }> {
  if (!company.appsScriptUrl) {
    return { ok: false, error: "Google Apps Script Web App URL not configured." };
  }
  if (!company.salesEmail1 && !company.salesEmail2) {
    return { ok: false, error: "No sales email addresses configured." };
  }

  try {
    const res = await syncToAppsScript({
      type: "invoice.send",
      payload: {
        invoice: inv,
        company: company,
        sendEmail: true,
        sendWhatsApp: false,
      },
    });

    if (res && res.ok && (!res.results || !res.results.email || res.results.email.ok)) {
      return { ok: true };
    }
    return {
      ok: false,
      error: res?.results?.email?.error || res?.error || "Failed to send email.",
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Sends a WhatsApp message via WhatsApp Cloud API, routed through Apps Script to bypass CORS.
 */
export async function sendWhatsAppAuto(
  inv: Invoice,
  company: CompanySettings,
): Promise<{ ok: boolean; error?: string }> {
  if (!company.appsScriptUrl) {
    return { ok: false, error: "Google Apps Script Web App URL not configured." };
  }
  if (!inv.customerPhone) {
    return { ok: false, error: "Customer has no phone number." };
  }

  try {
    const res = await syncToAppsScript({
      type: "invoice.send",
      payload: {
        invoice: inv,
        company: company,
        sendEmail: false,
        sendWhatsApp: true,
        whatsappToken: company.waAccessToken,
        whatsappPhoneId: company.waPhoneNumberId,
      },
    });

    if (res && res.ok && (!res.results || !res.results.whatsapp || res.results.whatsapp.ok)) {
      return { ok: true };
    }
    return {
      ok: false,
      error: res?.results?.whatsapp?.error || res?.error || "Failed to send WhatsApp message.",
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Triggers all enabled auto-send channels (WhatsApp + Email) for a new invoice.
 */
export async function autoSendInvoice(
  inv: Invoice,
  company: CompanySettings,
): Promise<{ whatsapp?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string } }> {
  const results: {
    whatsapp?: { ok: boolean; error?: string };
    email?: { ok: boolean; error?: string };
  } = {};

  const tasks: Promise<void>[] = [];

  if (company.autoSendWhatsApp) {
    tasks.push(
      sendWhatsAppAuto(inv, company).then((r) => {
        results.whatsapp = r;
      }),
    );
  }

  if (company.autoSendEmail) {
    tasks.push(
      sendEmailAuto(inv, company).then((r) => {
        results.email = r;
      }),
    );
  }

  await Promise.all(tasks);
  return results;
}
