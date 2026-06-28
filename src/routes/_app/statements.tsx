import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { store } from "@/lib/storage";
import { getLocalTodayISO, getLocalFirstOfMonthISO } from "@/lib/format";
import { toast } from "sonner";
import { Download, FileText } from "lucide-react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

export const Route = createFileRoute("/_app/statements")({
  component: StatementsPage,
  head: () => ({ meta: [{ title: "Statements • Smart Invoice" }] }),
});

async function exportExcel(rows: (string | number)[][], filename: string) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Statement");

  worksheet.addRows(rows);

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };

  worksheet.columns.forEach((column) => {
    let maxLength = 0;
    column.eachCell!({ includeEmpty: true }, (cell) => {
      const columnLength = cell.value ? cell.value.toString().length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });
    column.width = maxLength < 10 ? 10 : maxLength + 2;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), filename);
  toast.success(`${filename} downloaded`);
}

function StatementsPage() {
  const today = getLocalTodayISO();
  const firstOfMonth = getLocalFirstOfMonthISO();

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");

  const customers = store.customers();
  const vendors = store.vendors();
  const invoices = store.invoices();
  const purchases = store.purchaseBills();
  const payments = store.payments();
  const products = store.products();
  const expenses = store.expenses();

  const cashFlowAnalysis = useMemo(() => {
    type MonthData = {
      bankIn: number;
      bankOut: number;
      cashIn: number;
      cashOut: number;
    };
    const dataByMonth = new Map<string, MonthData>();

    const start = new Date(from);
    start.setDate(1);
    const end = new Date(to);

    let current = new Date(start);
    while (current <= end) {
      const yyyy = current.getFullYear();
      const mm = String(current.getMonth() + 1).padStart(2, "0");
      dataByMonth.set(`${yyyy}-${mm}`, { bankIn: 0, bankOut: 0, cashIn: 0, cashOut: 0 });
      current.setMonth(current.getMonth() + 1);
    }

    const getMonth = (d: string) => d.substring(0, 7);

    payments.forEach((p) => {
      if (p.date < from || p.date > to) return;
      const m = getMonth(p.date);
      if (!dataByMonth.has(m)) dataByMonth.set(m, { bankIn: 0, bankOut: 0, cashIn: 0, cashOut: 0 });
      const stats = dataByMonth.get(m)!;

      const isIncoming =
        p.type === "Sale" ||
        (p.type === "Balance Payment" && invoices.some((i) => i.number === p.referenceId));
      const isOutgoing =
        p.type === "Purchase" ||
        (p.type === "Balance Payment" && purchases.some((b) => b.number === p.referenceId));

      if (isIncoming) {
        if (p.method === "Bank Transfer") stats.bankIn += p.amount;
        if (p.method === "Cash") stats.cashIn += p.amount;
      } else if (isOutgoing) {
        if (p.method === "Bank Transfer") stats.bankOut += p.amount;
        if (p.method === "Cash") stats.cashOut += p.amount;
      }
    });

    expenses.forEach((e) => {
      if (e.date < from || e.date > to) return;
      const m = getMonth(e.date);
      if (!dataByMonth.has(m)) dataByMonth.set(m, { bankIn: 0, bankOut: 0, cashIn: 0, cashOut: 0 });
      const stats = dataByMonth.get(m)!;

      if (e.paymentType === "Bank Transfer") stats.bankOut += e.amount;
      if (e.paymentType === "Cash") stats.cashOut += e.amount;
    });

    const rows = Array.from(dataByMonth.keys())
      .sort()
      .map((m) => {
        const stats = dataByMonth.get(m)!;
        const dateObj = new Date(`${m}-01`);
        const monthName = dateObj
          .toLocaleString("default", { month: "long", year: "numeric" })
          .toUpperCase();
        return {
          monthKey: m,
          monthName,
          ...stats,
          bankNet: stats.bankIn - stats.bankOut,
          cashNet: stats.cashIn - stats.cashOut,
        };
      });

    const totals = rows.reduce(
      (acc, r) => ({
        bankIn: acc.bankIn + r.bankIn,
        bankOut: acc.bankOut + r.bankOut,
        bankNet: acc.bankNet + r.bankNet,
        cashIn: acc.cashIn + r.cashIn,
        cashOut: acc.cashOut + r.cashOut,
        cashNet: acc.cashNet + r.cashNet,
      }),
      { bankIn: 0, bankOut: 0, bankNet: 0, cashIn: 0, cashOut: 0, cashNet: 0 },
    );

    return { rows, totals };
  }, [from, to, payments, invoices, purchases, expenses]);

  // Helper to generate customer ledger
  const getCustomerLedger = (customerId: string, start: string, end: string) => {
    const customerInvoices = invoices.filter((i) => i.customerId === customerId);
    const customerPayments = payments.filter(
      (p) =>
        (p.type === "Balance Payment" || p.type === "Sale") &&
        customerInvoices.some((i) => i.number === p.referenceId),
    );

    const entries: {
      date: string;
      type: string;
      ref: string;
      debit: number;
      credit: number;
      balance: number;
    }[] = [];

    customerInvoices.forEach((inv) => {
      const itemsDetail = inv.items.map((it) => `${it.name} (x${it.qty})`).join("\n");
      entries.push({
        date: inv.date.split("T")[0],
        type: "Invoice",
        ref: `${inv.number}\n${itemsDetail}`,
        debit: inv.grandTotal,
        credit: 0,
        balance: 0,
      });
    });
    customerPayments.forEach((pay) => {
      entries.push({
        date: pay.date.split("T")[0],
        type: "Payment",
        ref: `${pay.referenceId} (${pay.method})`,
        debit: 0,
        credit: pay.amount,
        balance: 0,
      });
    });

    entries.sort((a, b) => a.date.localeCompare(b.date));

    let runningBalance = 0;
    return entries
      .map((e) => {
        runningBalance += e.debit - e.credit;
        return { ...e, balance: runningBalance };
      })
      .filter((e) => e.date >= start && e.date <= end);
  };

  // Helper to generate vendor ledger
  const getVendorLedger = (vendorId: string, start: string, end: string) => {
    const vendorBills = purchases.filter((p) => p.vendorId === vendorId);
    const vendorPayments = payments.filter(
      (p) =>
        (p.type === "Balance Payment" || p.type === "Purchase") &&
        vendorBills.some((b) => b.number === p.referenceId),
    );

    const entries: {
      date: string;
      type: string;
      ref: string;
      debit: number;
      credit: number;
      balance: number;
    }[] = [];

    vendorBills.forEach((bill) => {
      const itemsDetail = bill.items.map((it) => `${it.name} (x${it.qty})`).join("\n");
      entries.push({
        date: bill.date.split("T")[0],
        type: "Purchase",
        ref: `${bill.number}\n${itemsDetail}`,
        debit: 0,
        credit: bill.grandTotal,
        balance: 0,
      });
    });
    vendorPayments.forEach((pay) => {
      entries.push({
        date: pay.date.split("T")[0],
        type: "Payment",
        ref: `${pay.referenceId} (${pay.method})`,
        debit: pay.amount,
        credit: 0,
        balance: 0,
      });
    });

    entries.sort((a, b) => a.date.localeCompare(b.date));

    let runningBalance = 0; // Credit positive for vendors normally, but let's keep balance = credit - debit
    return entries
      .map((e) => {
        runningBalance += e.credit - e.debit;
        return { ...e, balance: runningBalance };
      })
      .filter((e) => e.date >= start && e.date <= end);
  };

  const handleDownloadCustomer = async (type: "pdf" | "csv") => {
    if (!selectedCustomerId) return toast.error("Please select a customer first.");
    const customer = customers.find((c) => c.id === selectedCustomerId);
    if (!customer) return;

    const ledger = getCustomerLedger(customer.id, from, to);
    if (ledger.length === 0) return toast.error("No transactions found for this date range.");

    if (type === "csv") {
      const rows = [
        ["Date", "Type", "Reference", "Debit", "Credit", "Balance"],
        ...ledger.map((e) => [e.date, e.type, e.ref, e.debit, e.credit, e.balance]),
      ];
      exportExcel(rows, `Statement_${customer.name}_${from}_to_${to}.xlsx`);
    } else {
      const { downloadStatementPDF } = await import("@/lib/pdf");
      downloadStatementPDF(customer, ledger, store.getSettings());
    }
  };

  const handleDownloadVendor = async (type: "pdf" | "csv") => {
    if (!selectedVendorId) return toast.error("Please select a vendor first.");
    const vendor = vendors.find((v) => v.id === selectedVendorId);
    if (!vendor) return;

    const ledger = getVendorLedger(vendor.id, from, to);
    if (ledger.length === 0) return toast.error("No transactions found for this date range.");

    if (type === "csv") {
      const rows = [
        ["Date", "Type", "Reference", "Debit", "Credit", "Balance"],
        ...ledger.map((e) => [e.date, e.type, e.ref, e.debit, e.credit, e.balance]),
      ];
      exportExcel(rows, `Statement_${vendor.name}_${from}_to_${to}.xlsx`);
    } else {
      const { downloadStatementPDF } = await import("@/lib/pdf");
      downloadStatementPDF(vendor, ledger, store.getSettings());
    }
  };

  const handleDownloadStock = () => {
    // Generate stock ledger between from and to dates
    const map = new Map(
      products.map((p) => [
        p.id,
        { name: p.name, opening: p.stock, received: 0, issued: 0, closing: p.stock },
      ]),
    );

    // Reverse engineer opening balance by removing things that happened after 'to' or adjusting back from current stock
    // Since we don't store historical snapshots, opening = currentStock - received(since start) + issued(since start)
    // Actually, stock tracking is: currentStock = opening + received - issued.
    // Let's do it like in reports.tsx
    products.forEach((p) => {
      let futureReceived = 0,
        futureIssued = 0,
        periodReceived = 0,
        periodIssued = 0;

      invoices.forEach((inv) => {
        const invDate = inv.date.slice(0, 10);
        if (invDate > to) {
          inv.items.forEach((it) => {
            if (it.productId === p.id) futureIssued += it.qty;
          });
        } else if (invDate >= from) {
          inv.items.forEach((it) => {
            if (it.productId === p.id) periodIssued += it.qty;
          });
        }
      });

      purchases.forEach((pur) => {
        const purDate = pur.date.slice(0, 10);
        if (purDate > to) {
          pur.items.forEach((it) => {
            if (it.productId === p.id) futureReceived += it.qty;
          });
        } else if (purDate >= from) {
          pur.items.forEach((it) => {
            if (it.productId === p.id) periodReceived += it.qty;
          });
        }
      });

      const closing = p.stock - futureReceived + futureIssued;
      const opening = closing - periodReceived + periodIssued;

      const st = map.get(p.id)!;
      st.opening = opening;
      st.received = periodReceived;
      st.issued = periodIssued;
      st.closing = closing;
    });

    const rows = [
      ["Product Name", "Opening Balance", "Received Qty", "Issued Qty", "Closing Balance"],
      ...Array.from(map.values()).map((s) => [s.name, s.opening, s.received, s.issued, s.closing]),
    ];
    exportExcel(rows, `Stock_Statement_${from}_to_${to}.xlsx`);
  };

  const handleDownloadProductLedger = () => {
    if (!selectedProductId) return toast.error("Please select a product first.");
    const product = products.find((p) => p.id === selectedProductId);
    if (!product) return;

    const entries: {
      date: string;
      type: string;
      ref: string;
      inQty: number;
      outQty: number;
    }[] = [];

    invoices.forEach((inv) => {
      if (inv.date.slice(0, 10) >= from && inv.date.slice(0, 10) <= to) {
        inv.items.forEach((it) => {
          if (it.productId === selectedProductId) {
            entries.push({
              date: inv.date.split("T")[0],
              type: "Sale",
              ref: inv.number,
              inQty: 0,
              outQty: it.qty,
            });
          }
        });
      }
    });

    purchases.forEach((pur) => {
      if (pur.date.slice(0, 10) >= from && pur.date.slice(0, 10) <= to) {
        pur.items.forEach((it) => {
          if (it.productId === selectedProductId) {
            entries.push({
              date: pur.date.split("T")[0],
              type: "Purchase",
              ref: pur.number,
              inQty: it.qty,
              outQty: 0,
            });
          }
        });
      }
    });

    entries.sort((a, b) => a.date.localeCompare(b.date));

    // To calculate running balance, we need opening balance.
    // Let's compute opening balance exactly like in handleDownloadStock
    let futureReceived = 0,
      futureIssued = 0,
      periodReceived = 0,
      periodIssued = 0;

    invoices.forEach((inv) => {
      const invDate = inv.date.slice(0, 10);
      if (invDate > to) {
        inv.items.forEach((it) => {
          if (it.productId === selectedProductId) futureIssued += it.qty;
        });
      } else if (invDate >= from) {
        inv.items.forEach((it) => {
          if (it.productId === selectedProductId) periodIssued += it.qty;
        });
      }
    });

    purchases.forEach((pur) => {
      const purDate = pur.date.slice(0, 10);
      if (purDate > to) {
        pur.items.forEach((it) => {
          if (it.productId === selectedProductId) futureReceived += it.qty;
        });
      } else if (purDate >= from) {
        pur.items.forEach((it) => {
          if (it.productId === selectedProductId) periodReceived += it.qty;
        });
      }
    });

    const closingStock = product.stock - futureReceived + futureIssued;
    let runningBalance = closingStock - periodReceived + periodIssued; // This is Opening Balance

    const rows = [
      ["Date", "Type", "Reference", "Qty In", "Qty Out", "Balance"],
      ["", "Opening Balance", "", "", "", runningBalance],
      ...entries.map((e) => {
        runningBalance += e.inQty - e.outQty;
        return [e.date, e.type, e.ref, e.inQty || "", e.outQty || "", runningBalance];
      }),
    ];

    exportExcel(rows, `Product_Ledger_${product.name}_${from}_to_${to}.xlsx`);
  };

  const handleDownloadSales = () => {
    const filtered = invoices.filter((i) => i.date.slice(0, 10) >= from && i.date.slice(0, 10) <= to);
    if (filtered.length === 0) return toast.error("No sales found for this date range.");

    const rows = [
      [
        "Date",
        "Invoice #",
        "Customer",
        "Subtotal",
        "Discount",
        "Shipping",
        "Grand Total",
        "Amount Paid",
        "Balance Due",
        "Status",
      ],
      ...filtered.map((i) => [
        i.date.split("T")[0],
        i.number,
        i.customerName,
        i.subtotal,
        i.discountTotal || 0,
        i.shipping || 0,
        i.grandTotal,
        i.amountPaid || 0,
        i.balanceDue ?? i.grandTotal,
        i.paymentStatus,
      ]),
    ];
    exportExcel(rows, `Sales_Statement_${from}_to_${to}.xlsx`);
  };

  const handleDownloadPurchases = () => {
    const filtered = purchases.filter((p) => p.date.slice(0, 10) >= from && p.date.slice(0, 10) <= to);
    if (filtered.length === 0) return toast.error("No purchases found for this date range.");

    const rows = [
      [
        "Date",
        "Bill #",
        "Vendor",
        "Grand Total",
        "Amount Paid",
        "Balance Due",
        "Status",
      ],
      ...filtered.map((p) => [
        p.date.split("T")[0],
        p.number,
        p.vendorName,
        p.grandTotal,
        p.amountPaid || 0,
        p.balanceDue ?? p.grandTotal,
        p.paymentStatus,
      ]),
    ];
    exportExcel(rows, `Purchases_Statement_${from}_to_${to}.xlsx`);
  };

  const handleDownloadPayments = () => {
    const filtered = payments.filter((p) => p.date >= from && p.date <= to);
    const rows = [
      ["DATE", "METHOD", "TYPE", "AMOUNT", "REFERENCE ID"],
      ...filtered.map((p) => [
        p.date.split("T")[0],
        p.method,
        p.type,
        p.amount.toFixed(2),
        p.referenceId || "N/A",
      ]),
    ];
    exportExcel(rows, `Payment_History_${from}_to_${to}.xlsx`);
  };

  const handleDownloadCashFlowCombined = () => {
    type MonthData = {
      bankIn: number;
      bankOut: number;
      cashIn: number;
      cashOut: number;
      notPaidIn: number;
      notPaidOut: number;
      partialIn: number;
      partialOut: number;
      fullPaidIn: number;
      fullPaidOut: number;
    };
    const dataByMonth = new Map<string, MonthData>();

    const start = new Date(from);
    start.setDate(1);
    const end = new Date(to);

    let current = new Date(start);
    while (current <= end) {
      const yyyy = current.getFullYear();
      const mm = String(current.getMonth() + 1).padStart(2, "0");
      dataByMonth.set(`${yyyy}-${mm}`, {
        bankIn: 0,
        bankOut: 0,
        cashIn: 0,
        cashOut: 0,
        notPaidIn: 0,
        notPaidOut: 0,
        partialIn: 0,
        partialOut: 0,
        fullPaidIn: 0,
        fullPaidOut: 0,
      });
      current.setMonth(current.getMonth() + 1);
    }

    const getMonth = (d: string) => d.substring(0, 7);

    const productMap = new Map(products.map((p) => [p.id, p]));

    const getInvoiceMethodRatios = (method: string) => {
      const m = method || "";
      if (m === "Cash" || (m.toLowerCase().includes("cash") && !m.toLowerCase().includes("split"))) {
        return { cash: 1, bank: 0 };
      }
      if (m === "Bank Transfer" || (m.toLowerCase().includes("bank") && !m.toLowerCase().includes("split"))) {
        return { cash: 0, bank: 1 };
      }
      if (m.toLowerCase().includes("split")) {
        const match = m.match(/Split\s*\(Cash:\s*([\d.]+),\s*Bank:\s*([\d.]+)\)/i);
        if (match) {
          const cashVal = parseFloat(match[1]) || 0;
          const bankVal = parseFloat(match[2]) || 0;
          const totalSplit = cashVal + bankVal;
          if (totalSplit > 0) {
            return { cash: cashVal / totalSplit, bank: bankVal / totalSplit };
          }
        }
        return { cash: 0.5, bank: 0.5 };
      }
      return { cash: 1, bank: 0 }; // fallback
    };

    invoices.forEach((i) => {
      const iDate = i.date.slice(0, 10);
      if (iDate < from || iDate > to) return;
      const m = getMonth(iDate);
      if (!dataByMonth.has(m)) {
        dataByMonth.set(m, {
          bankIn: 0,
          bankOut: 0,
          cashIn: 0,
          cashOut: 0,
          notPaidIn: 0,
          notPaidOut: 0,
          partialIn: 0,
          partialOut: 0,
          fullPaidIn: 0,
          fullPaidOut: 0,
        });
      }
      const stats = dataByMonth.get(m)!;

      let invoiceCost = 0;
      let invoiceRevenue = 0;
      i.items.forEach((it) => {
        const prod = productMap.get(it.productId);
        const costPrice = it.purchasePrice !== undefined && it.purchasePrice !== null
          ? Number(it.purchasePrice)
          : (prod ? prod.purchasePrice : 0);
        invoiceCost += (Number(it.qty) || 0) * costPrice;
        invoiceRevenue += (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
      });

      const { cash, bank } = getInvoiceMethodRatios(i.paymentMethod);

      // Distribute payment status portions
      const status = (i.paymentStatus || "").toLowerCase().trim();
      if (status === "pending" || status === "unpaid" || status === "not paid" || status === "") {
        // Not paid: show grand total in notPaidIn, and the final cost of the invoice in notPaidOut
        stats.notPaidIn += i.grandTotal || 0;
        stats.notPaidOut += invoiceCost;
        // NOT added to cash/bank at all
      } else if (status === "partial") {
        const paidAmount = i.amountPaid || 0;
        const totalAmount = i.grandTotal || 1;
        const ratio = Math.min(1, Math.max(0, paidAmount / totalAmount));

        // Proportional cost based on what was paid
        const paidCost = invoiceCost * ratio;

        stats.partialIn += paidAmount;
        stats.partialOut += paidCost;

        // Cash and Bank get the actual paid portion only
        stats.bankIn += paidAmount * bank;
        stats.bankOut += paidCost * bank;
        stats.cashIn += paidAmount * cash;
        stats.cashOut += paidCost * cash;
      } else if (status === "paid") {
        const amount = i.grandTotal || 0;
        stats.fullPaidIn += amount;
        stats.fullPaidOut += invoiceCost;

        // Cash and Bank totals and costs are populated ONLY from fully paid invoices
        stats.bankIn += amount * bank;
        stats.bankOut += invoiceCost * bank;
        stats.cashIn += amount * cash;
        stats.cashOut += invoiceCost * cash;
      }
    });

    const rows = Array.from(dataByMonth.keys())
      .sort()
      .map((m) => {
        const stats = dataByMonth.get(m)!;
        const dateObj = new Date(`${m}-01`);
        const monthName = dateObj
          .toLocaleString("default", { month: "long", year: "numeric" })
          .toUpperCase();
        return {
          monthName,
          ...stats,
          bankNet: stats.bankIn - stats.bankOut,
          cashNet: stats.cashIn - stats.cashOut,
          notPaidNet: stats.notPaidIn - stats.notPaidOut,
          partialNet: stats.partialIn - stats.partialOut,
          fullPaidNet: stats.fullPaidIn - stats.fullPaidOut,
        };
      });

    const totals = rows.reduce(
      (acc, r) => ({
        bankIn: acc.bankIn + r.bankIn,
        bankOut: acc.bankOut + r.bankOut,
        bankNet: acc.bankNet + r.bankNet,
        cashIn: acc.cashIn + r.cashIn,
        cashOut: acc.cashOut + r.cashOut,
        cashNet: acc.cashNet + r.cashNet,
        notPaidIn: acc.notPaidIn + r.notPaidIn,
        notPaidOut: acc.notPaidOut + r.notPaidOut,
        notPaidNet: acc.notPaidNet + r.notPaidNet,
        partialIn: acc.partialIn + r.partialIn,
        partialOut: acc.partialOut + r.partialOut,
        partialNet: acc.partialNet + r.partialNet,
        fullPaidIn: acc.fullPaidIn + r.fullPaidIn,
        fullPaidOut: acc.fullPaidOut + r.fullPaidOut,
        fullPaidNet: acc.fullPaidNet + r.fullPaidNet,
      }),
      {
        bankIn: 0,
        bankOut: 0,
        bankNet: 0,
        cashIn: 0,
        cashOut: 0,
        cashNet: 0,
        notPaidIn: 0,
        notPaidOut: 0,
        notPaidNet: 0,
        partialIn: 0,
        partialOut: 0,
        partialNet: 0,
        fullPaidIn: 0,
        fullPaidOut: 0,
        fullPaidNet: 0,
      },
    );

    const csvRows: (string | number)[][] = [
      [
        "MONTH",
        "BANK TOTAL (RECEIVED)",
        "BANK FINAL COST",
        "BANK PROFIT/LOSS",
        "CASH TOTAL (RECEIVED)",
        "CASH FINAL COST",
        "CASH PROFIT/LOSS",
        "NOT PAID (OUTSTANDING AMOUNT)",
        "NOT PAID FINAL COST (N/A - NOT RECEIVED)",
        "NOT PAID PROFIT/LOSS (N/A)",
        "PARTIAL RECEIVED TOTAL",
        "PARTIAL RECEIVED FINAL COST (PROPORTIONAL)",
        "PARTIAL RECEIVED PROFIT/LOSS",
        "FULL PAID TOTAL (AMOUNT RECEIVED)",
        "FULL PAID FINAL COST",
        "FULL PAID PROFIT/LOSS",
      ],
    ];

    rows.forEach((r) => {
      csvRows.push([
        r.monthName,
        r.bankIn.toFixed(2),
        r.bankOut.toFixed(2),
        r.bankNet.toFixed(2),
        r.cashIn.toFixed(2),
        r.cashOut.toFixed(2),
        r.cashNet.toFixed(2),
        r.notPaidIn.toFixed(2),
        r.notPaidOut.toFixed(2),
        r.notPaidNet.toFixed(2),
        r.partialIn.toFixed(2),
        r.partialOut.toFixed(2),
        r.partialNet.toFixed(2),
        r.fullPaidIn.toFixed(2),
        r.fullPaidOut.toFixed(2),
        r.fullPaidNet.toFixed(2),
      ]);
    });

    csvRows.push([
      "GRAND TOTAL",
      totals.bankIn.toFixed(2),
      totals.bankOut.toFixed(2),
      totals.bankNet.toFixed(2),
      totals.cashIn.toFixed(2),
      totals.cashOut.toFixed(2),
      totals.cashNet.toFixed(2),
      totals.notPaidIn.toFixed(2),
      totals.notPaidOut.toFixed(2),
      totals.notPaidNet.toFixed(2),
      totals.partialIn.toFixed(2),
      totals.partialOut.toFixed(2),
      totals.partialNet.toFixed(2),
      totals.fullPaidIn.toFixed(2),
      totals.fullPaidOut.toFixed(2),
      totals.fullPaidNet.toFixed(2),
    ]);

    exportExcel(csvRows, `CashFlow_Analysis_${from}_to_${to}.xlsx`);
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-col md:flex-row items-center gap-4 bg-card p-4 rounded-xl border shadow-sm">
        <div className="flex-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> Global Date Range
          </h2>
          <p className="text-sm text-muted-foreground">
            Select the period for your downloaded statements.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <Label className="text-xs">From Date</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To Date</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="customers" className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-7 h-auto rounded-lg gap-1 bg-transparent p-0">
          <TabsTrigger
            value="customers"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 border shadow-sm rounded-lg bg-card"
          >
            Customers
          </TabsTrigger>
          <TabsTrigger
            value="vendors"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 border shadow-sm rounded-lg bg-card"
          >
            Vendors
          </TabsTrigger>
          <TabsTrigger
            value="stock"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 border shadow-sm rounded-lg bg-card"
          >
            Inventory
          </TabsTrigger>
          <TabsTrigger
            value="sales"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 border shadow-sm rounded-lg bg-card"
          >
            Sales
          </TabsTrigger>
          <TabsTrigger
            value="purchases"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 border shadow-sm rounded-lg bg-card"
          >
            Purchases
          </TabsTrigger>
          <TabsTrigger
            value="cashflow"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 border shadow-sm rounded-lg bg-card"
          >
            Cash / Bank Flow
          </TabsTrigger>
          <TabsTrigger
            value="payments"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2 border shadow-sm rounded-lg bg-card"
          >
            Payments
          </TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="customers">
            <Card>
              <CardHeader>
                <CardTitle>Customer Statement</CardTitle>
                <CardDescription>
                  Download a detailed ledger statement for a specific customer.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2 max-w-sm">
                  <Label>Select Customer</Label>
                  <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a customer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-3">
                  <Button onClick={() => handleDownloadCustomer("pdf")} variant="default">
                    <Download className="mr-2 h-4 w-4" /> Download PDF
                  </Button>
                  <Button onClick={() => handleDownloadCustomer("csv")} variant="outline">
                    <Download className="mr-2 h-4 w-4" /> Export Excel
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="vendors">
            <Card>
              <CardHeader>
                <CardTitle>Vendor Statement</CardTitle>
                <CardDescription>
                  Download a detailed ledger statement for a specific vendor.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2 max-w-sm">
                  <Label>Select Vendor</Label>
                  <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a vendor..." />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-3">
                  <Button onClick={() => handleDownloadVendor("pdf")} variant="default">
                    <Download className="mr-2 h-4 w-4" /> Download PDF
                  </Button>
                  <Button onClick={() => handleDownloadVendor("csv")} variant="outline">
                    <Download className="mr-2 h-4 w-4" /> Export Excel
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stock">
            <Card>
              <CardHeader>
                <CardTitle>Inventory Statement</CardTitle>
                <CardDescription>
                  Download a comprehensive summary of inventory movements across the selected date
                  range, or a detailed ledger for a specific product.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="text-sm font-medium mb-3">Overall Inventory Summary</h4>
                  <Button onClick={handleDownloadStock} variant="outline">
                    <Download className="mr-2 h-4 w-4" /> Export Inventory Summary Excel
                  </Button>
                </div>

                <div className="pt-4 border-t space-y-4">
                  <h4 className="text-sm font-medium">Detailed Product Ledger</h4>
                  <div className="space-y-2 max-w-sm">
                    <Label>Select Product</Label>
                    <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a product..." />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleDownloadProductLedger} variant="outline">
                    <Download className="mr-2 h-4 w-4" /> Export Product Ledger Excel
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sales">
            <Card>
              <CardHeader>
                <CardTitle>Sales Statement</CardTitle>
                <CardDescription>
                  Download a complete list of sales invoices generated in the selected date range.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleDownloadSales} variant="outline">
                  <Download className="mr-2 h-4 w-4" /> Export Sales Excel
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="purchases">
            <Card>
              <CardHeader>
                <CardTitle>Purchases Statement</CardTitle>
                <CardDescription>
                  Download a complete list of purchase bills generated in the selected date range.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleDownloadPurchases} variant="outline">
                  <Download className="mr-2 h-4 w-4" /> Export Purchases Excel
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cashflow">
            <Card>
              <CardHeader>
                <CardTitle>Cash / Bank Flow Statement</CardTitle>
                <CardDescription>
                  Download a month-by-month cash and bank analysis spreadsheet matching your
                  required format.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleDownloadCashFlowCombined} variant="outline">
                  <Download className="mr-2 h-4 w-4" /> Export Cash / Bank Flow Excel
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <CardTitle>Payment History Statement</CardTitle>
                <CardDescription>
                  Download a complete list of all payments received and sent in the selected date
                  range.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleDownloadPayments} variant="outline">
                  <Download className="mr-2 h-4 w-4" /> Export Payment History Excel
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
