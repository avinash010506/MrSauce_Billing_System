import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CompanySettings, Invoice, PurchaseBill } from "./types";
import { fmtDate } from "./format";
import { logoBase64 } from "./logo";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCurrencySymbol(settings: CompanySettings): string {
  switch (settings.currency) {
    case "INR": return "₹";
    case "USD": return "$";
    case "EUR": return "€";
    case "GBP": return "£";
    default: return settings.currency || "£";
  }
}

function pdfFmt(n: number, symbol: string) {
  return (
    symbol +
    (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function drawHeader(doc: jsPDF, title: string, settings: CompanySettings) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(65, 120, 192);
  doc.rect(0, 0, pageW, 32, "F");

  // Draw Logo
  doc.addImage(logoBase64, "PNG", 14, 6, 20, 20);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(settings.companyName, 38, 12);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Quality & Consistency", 38, 17);

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");

  const addressLines = settings.address.split(",").join(", ");
  doc.text(addressLines, 38, 22);
  doc.text(`Phone: ${settings.phone}   |   Email: ${settings.email}`, 38, 27);

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(title, pageW - 14, 20, { align: "right" });
}

// ─── Sales Invoice PDF ───────────────────────────────────────────────────────

export function generateInvoicePDF(inv: Invoice, settings: CompanySettings) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  drawHeader(doc, "Non VAT Invoice", settings);

  // Invoice meta
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  let y = 42;
  doc.text(`Invoice #: ${inv.number}`, 14, y);
  doc.text(`Date: ${fmtDate(inv.date)}`, pageW - 14, y, { align: "right" });
  y += 6;
  doc.text(
    `Payment: ${inv.paymentMethod} (${inv.paymentStatus === "pending" ? "NOT PAID" : inv.paymentStatus.toUpperCase()})`,
    14,
    y,
  );

  // Bill to
  y += 10;
  const billToStartY = y;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Bill To:", 14, y);
  doc.setFont("helvetica", "normal");
  y += 5;
  doc.text(inv.customerName, 14, y);

  if (inv.billingAddress) {
    y += 5;
    const lines = doc.splitTextToSize(inv.billingAddress, 90);
    doc.text(lines, 14, y);
    y += (lines.length - 1) * 4;
  }
  if (inv.customerPhone) {
    y += 5;
    doc.text(`Phone: ${inv.customerPhone}`, 14, y);
  }


  let finalY = y;



  // Items table
  const sym = getCurrencySymbol(settings);
  const rows = inv.items.map((it, i) => {
    const total = it.qty * it.unitPrice;
    return [String(i + 1), it.name, String(it.qty), pdfFmt(it.unitPrice, sym), pdfFmt(total, sym)];
  });

  autoTable(doc, {
    startY: finalY + 8,
    head: [["#", "Item", "Qty", "Rate", "Amount"]],
    body: rows,
    theme: "grid",
    headStyles: { fillColor: [65, 120, 192], textColor: 255, fontStyle: "bold", fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 10 },
      2: { halign: "right", cellWidth: 20 },
      3: { halign: "right", cellWidth: 35 },
      4: { halign: "right", cellWidth: 35 },
    },
  });

  // Totals
  // @ts-expect-error lastAutoTable is added by autoTable
  const endY = doc.lastAutoTable.finalY + 8;
  const tx = pageW - 80;
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");

  const gross = inv.subtotal + (inv.discountTotal || 0);
  const totalRows: [string, string][] = [["Gross Amount:", pdfFmt(gross, sym)]];
  if (inv.discountTotal && inv.discountTotal > 0) {
    const pct = Math.round((inv.discountTotal * 100) / gross);
    totalRows.push([`Discount (${pct}%):`, "-" + pdfFmt(inv.discountTotal, sym)]);
  }
  totalRows.push(["Subtotal:", pdfFmt(inv.subtotal, sym)]);
  if (inv.shipping && inv.shipping > 0) {
    totalRows.push(["Shipping:", pdfFmt(inv.shipping, sym)]);
  }
  totalRows.forEach(([label, val], idx) => {
    doc.text(label, tx, endY + idx * 6);
    doc.text(val as string, pageW - 14, endY + idx * 6, { align: "right" });
  });
  const grandY = endY + totalRows.length * 6 + 4;
  doc.setFillColor(65, 120, 192);
  doc.rect(tx - 4, grandY - 5, pageW - tx + 4, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Grand Total:", tx, grandY + 1);
  doc.text(pdfFmt(inv.grandTotal, sym), pageW - 14, grandY + 1, { align: "right" });

  let currentY = grandY + 10;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text("Amount Paid:", tx, currentY);
  doc.text(pdfFmt(inv.amountPaid || 0, sym), pageW - 14, currentY, { align: "right" });
  currentY += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Balance Due:", tx, currentY);
  doc.text(pdfFmt(inv.balanceDue ?? inv.grandTotal, sym), pageW - 14, currentY, { align: "right" });

  // Terms
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const pageH = doc.internal.pageSize.getHeight();
  const terms = (settings.termsAndConditions || "Goods once sold will not be taken back.")
    .split("\n")
    .slice(0, 3);
  doc.setTextColor(120);
  doc.text("Terms & Conditions:", 14, pageH - 24);
  terms.forEach((line, i) => doc.text(line, 14, pageH - 20 + i * 4));
  doc.text(`${settings.email} • ${settings.phone}`, 14, pageH - 8);
  doc.text("Authorised Signatory", pageW - 14, pageH - 8, { align: "right" });

  return doc;
}

export function downloadInvoicePDF(inv: Invoice, settings: CompanySettings) {
  const doc = generateInvoicePDF(inv, settings);
  doc.save(`${inv.number}.pdf`);
}

export function printInvoicePDF(inv: Invoice, settings: CompanySettings) {
  const doc = generateInvoicePDF(inv, settings);
  doc.autoPrint();
  const url = doc.output("bloburl");
  window.open(url.toString(), "_blank");
}

// ─── Purchase Bill PDF ───────────────────────────────────────────────────────

export function generatePurchaseBillPDF(bill: PurchaseBill, settings: CompanySettings) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  drawHeader(doc, "PURCHASE BILL", settings);

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  let y = 42;
  doc.text(`Bill #: ${bill.number}`, 14, y);
  doc.text(`Date: ${fmtDate(bill.date)}`, pageW - 14, y, { align: "right" });
  y += 6;
  doc.text(
    `Payment: ${bill.paymentMethod} (${bill.paymentStatus === "pending" ? "NOT PAID" : bill.paymentStatus.toUpperCase()})`,
    14,
    y,
  );
  if (bill.partyInvoiceNumber) {
    doc.text(`Party Invoice #: ${bill.partyInvoiceNumber}`, pageW - 14, y, { align: "right" });
  }

  // Vendor details
  y += 10;
  doc.setFont("helvetica", "bold");
  doc.text("Vendor:", 14, y);
  doc.setFont("helvetica", "normal");
  y += 5;
  doc.text(bill.vendorName, 14, y);

  if (bill.vendorAddress) {
    y += 5;
    const lines = doc.splitTextToSize(bill.vendorAddress, 90);
    doc.text(lines, 14, y);
    y += (lines.length - 1) * 4;
  }
  if (bill.vendorPhone) {
    y += 5;
    doc.text(`Phone: ${bill.vendorPhone}`, 14, y);
  }

  // Items table
  const sym = getCurrencySymbol(settings);
  const rows = bill.items.map((it, i) => {
    const total = it.qty * it.unitPrice;
    return [String(i + 1), it.name, String(it.qty), pdfFmt(it.unitPrice, sym), pdfFmt(total, sym)];
  });

  autoTable(doc, {
    startY: y + 8,
    head: [["#", "Item", "Qty", "Unit Price", "Amount"]],
    body: rows,
    theme: "grid",
    headStyles: { fillColor: [65, 120, 192], textColor: 255, fontStyle: "bold", fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 10 },
      2: { halign: "right", cellWidth: 14 },
      3: { halign: "right", cellWidth: 30 },
      4: { halign: "right", cellWidth: 30 },
    },
  });

  // @ts-expect-error lastAutoTable is added by autoTable
  const endY = doc.lastAutoTable.finalY + 8;
  const tx = pageW - 80;
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  doc.text("Subtotal:", tx, endY);
  doc.text(pdfFmt(bill.subtotal, sym), pageW - 14, endY, { align: "right" });

  const grandY = endY + 10;
  doc.setFillColor(65, 120, 192);
  doc.rect(tx - 4, grandY - 5, pageW - tx + 4, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Grand Total:", tx, grandY + 1);
  doc.text(pdfFmt(bill.grandTotal, sym), pageW - 14, grandY + 1, { align: "right" });

  let currentY = grandY + 10;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text("Amount Paid:", tx, currentY);
  doc.text(pdfFmt(bill.amountPaid || 0, sym), pageW - 14, currentY, { align: "right" });
  currentY += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Balance Due:", tx, currentY);
  doc.text(pdfFmt(bill.balanceDue ?? bill.grandTotal, sym), pageW - 14, currentY, { align: "right" });


  // Notes
  if (bill.notes) {
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(`Notes: ${bill.notes}`, 14, grandY + 14);
  }

  const pageH = doc.internal.pageSize.getHeight();
  doc.setTextColor(120);
  doc.setFontSize(7.5);
  doc.text(`${settings.email} • ${settings.phone}`, 14, pageH - 8);
  doc.text("Authorised Signatory", pageW - 14, pageH - 8, { align: "right" });

  return doc;
}

export function downloadPurchaseBillPDF(bill: PurchaseBill, settings: CompanySettings) {
  const doc = generatePurchaseBillPDF(bill, settings);
  doc.save(`${bill.number}.pdf`);
}

export function printPurchaseBillPDF(bill: PurchaseBill, settings: CompanySettings) {
  const doc = generatePurchaseBillPDF(bill, settings);
  doc.autoPrint();
  const url = doc.output("bloburl");
  window.open(url.toString(), "_blank");
}

// ─── Statement PDF ───────────────────────────────────────────────────────────

export function downloadStatementPDF(
  entity: { name: string; address?: string; phone?: string; email?: string },
  ledger: {
    date: string;
    type: string;
    ref: string;
    debit: number;
    credit: number;
    balance: number;
  }[],
  settings: CompanySettings,
) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  drawHeader(doc, "STATEMENT OF ACCOUNT", settings);

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  let y = 42;
  doc.text("To:", 14, y);
  doc.setFont("helvetica", "normal");
  y += 5;
  doc.text(entity.name, 14, y);

  if (entity.address) {
    y += 5;
    const lines = doc.splitTextToSize(entity.address, 90);
    doc.text(lines, 14, y);
    y += (lines.length - 1) * 4;
  }

  if (entity.phone) {
    y += 5;
    doc.text(`Phone: ${entity.phone}`, 14, y);
  }

  if (entity.email) {
    y += 5;
    doc.text(`Email: ${entity.email}`, 14, y);
  }

  doc.setFontSize(9);
  doc.text(`Generated on: ${fmtDate(new Date().toISOString())}`, pageW - 14, 42, {
    align: "right",
  });

  const sym = getCurrencySymbol(settings);
  const rows = ledger.map((row) => [
    fmtDate(row.date),
    `${row.type} ${row.ref}`,
    row.debit > 0 ? pdfFmt(row.debit, sym) : "",
    row.credit > 0 ? pdfFmt(row.credit, sym) : "",
    pdfFmt(row.balance, sym),
  ]);

  autoTable(doc, {
    startY: y + 10,
    head: [["Date", "Details", "Debit (" + sym + ")", "Credit (" + sym + ")", "Balance (" + sym + ")"]],
    body: rows,
    theme: "grid",
    headStyles: { fillColor: [65, 120, 192], textColor: 255, fontStyle: "bold", fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 25 },
      2: { halign: "right", cellWidth: 30 },
      3: { halign: "right", cellWidth: 30 },
      4: { halign: "right", cellWidth: 30, fontStyle: "bold" },
    },
  });

  doc.save(`Statement_${entity.name.replace(/[^a-z0-9]/gi, "_")}.pdf`);
}
