import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { onStoreChange, store } from "@/lib/storage";
import { inr, fmtDate, getDueDays, getDueDaysCount, toLocalDateString, getLocalTodayISO, getLocalFirstOfMonthISO } from "@/lib/format";
import { downloadInvoicePDF, printInvoicePDF } from "@/lib/pdf";
import { Download, Mail, MessageCircle, Plus, Printer, Search, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { Invoice, PaymentTransaction, CompanySettings, Product } from "@/lib/types";
import { uid } from "@/lib/format";
import { syncToAppsScript } from "@/lib/api";
import { sendEmailAuto, sendWhatsAppAuto } from "@/lib/autosend";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const Route = createFileRoute("/_app/invoices/")({
  component: InvoicesPage,
  head: () => ({ meta: [{ title: "Sales • Smart Invoice" }] }),
});

async function sendEmail(inv: Invoice, settings: CompanySettings) {
  const { appsScriptUrl } = settings;
  const isConfigured = !!appsScriptUrl;
  const toList = [settings.salesEmail1, settings.salesEmail2].filter(Boolean);

  if (isConfigured && toList.length > 0) {
    const tid = toast.loading("Sending email via Google Apps Script...");
    const res = await sendEmailAuto(inv, settings);
    toast.dismiss(tid);
    if (res.ok) {
      toast.success("✅ Email sent successfully!");
      return;
    } else {
      toast.error(`Email failed: ${res.error}. Opening email client...`);
    }
  }

  const subject = encodeURIComponent(`Invoice ${inv.number} from ${settings.companyName}`);
  const body = encodeURIComponent(
    `Dear ${inv.customerName},\n\nThank you for your business.\n\nPlease find your invoice details below:\n\nInvoice Number: ${inv.number}\nDate: ${fmtDate(inv.date)}\nAmount: £${inv.grandTotal.toFixed(2)}\nStatus: ${inv.paymentStatus.toUpperCase()}\n\nKindly make the payment at your earliest convenience.\n\nRegards,\n${settings.companyName}`,
  );
  const to = encodeURIComponent(toList.join(","));
  window.open(`mailto:${to}?subject=${subject}&body=${body}`, "_blank");
  if (!isConfigured) toast.success("Email client opened");
}

async function sendWhatsApp(inv: Invoice, settings: CompanySettings) {
  const { waPhoneNumberId, waAccessToken } = settings;
  const isConfigured = !!(waPhoneNumberId && waAccessToken);

  if (isConfigured && inv.customerPhone) {
    const tid = toast.loading("Sending WhatsApp via Cloud API...");
    const res = await sendWhatsAppAuto(inv, settings);
    toast.dismiss(tid);
    if (res.ok) {
      toast.success("✅ WhatsApp message sent via Cloud API!");
      return;
    } else {
      toast.error(`WhatsApp API failed: ${res.error}. Opening WhatsApp Web...`);
    }
  }

  const phone = (inv.customerPhone || "").replace(/\D/g, "");
  if (!phone) {
    toast.error("Customer has no phone number");
    return;
  }
  const msg = encodeURIComponent(
    `Hello ${inv.customerName},\n\nThank you for your purchase from *${settings.companyName}*.\n\n📄 *Invoice #:* ${inv.number}\n📅 *Date:* ${fmtDate(inv.date)}\n💰 *Amount:* £${inv.grandTotal.toFixed(2)}\n✅ *Status:* ${inv.paymentStatus.toUpperCase()}\n\nPlease contact us for any queries.\n\nRegards,\n${settings.companyName}`,
  );
  window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
  if (!isConfigured) toast.success("WhatsApp opened");
}

function InvoicesPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const today = getLocalTodayISO();
  const firstOfMonth = getLocalFirstOfMonthISO();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number | "">("");
  const [paymentDate, setPaymentDate] = useState(getLocalTodayISO());
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);

  const settings = useMemo(() => store.getSettings(), [tick]);
  const products = useMemo(() => store.products(), [tick]);

  const invoices = useMemo(() => {
    let list = store.invoices().sort((a, b) => {
      const dateComp = b.date.localeCompare(a.date);
      if (dateComp !== 0) return dateComp;
      const numA = parseInt(a.number.split('-')[1], 10) || 0;
      const numB = parseInt(b.number.split('-')[1], 10) || 0;
      return numB - numA;
    });
    if (statusFilter !== "all") list = list.filter((i) => (i.paymentStatus || "").toLowerCase() === statusFilter);
    if (from) list = list.filter((i) => i.date.slice(0, 10) >= from);
    if (to) list = list.filter((i) => i.date.slice(0, 10) <= to);
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter(
      (i) =>
        i.number.toLowerCase().includes(s) ||
        i.customerName.toLowerCase().includes(s) ||
        i.items.some((it) => it.name.toLowerCase().includes(s)),
    );
  }, [q, statusFilter, from, to, tick]);

  const remove = (id: string) => {
    if (!isAdmin) return toast.error("Unauthorized: Only Admins can delete sales invoices.");
    if (!confirm("Delete this invoice?")) return;
    const allInvoices = store.invoices();
    const inv = allInvoices.find((i) => i.id === id);
    if (!inv) return;

    // Save filtered invoices
    store.saveInvoices(allInvoices.filter((i) => i.id !== id));
    void syncToAppsScript({ type: "invoice.delete", payload: { number: inv.number } });

    // Restore stock
    const prods = store.products();
    inv.items.forEach((it) => {
      const p = prods.find((x) => x.id === it.productId);
      if (p) {
        p.stock = p.stock + it.qty;
        void syncToAppsScript({ type: "product.upsert", payload: p });
      }
    });
    store.saveProducts(prods);

    // Delete associated payments
    const payments = store.payments();
    const associatedPayments = payments.filter((p) => p.referenceId === inv.number);
    const updatedPayments = payments.filter((p) => p.referenceId !== inv.number);
    store.savePayments(updatedPayments);
    associatedPayments.forEach((p) => {
      void syncToAppsScript({ type: "payment.delete", payload: { id: p.id } });
    });

    // Delete associated activity logs
    const logs = store.activityLogs();
    const updatedLogs = logs.filter((l) => l.referenceId !== inv.number);
    store.saveActivityLogs(updatedLogs);

    void logActivity("Delete", "Sale", inv.customerName, inv.number, `Deleted invoice for ${inr(inv.grandTotal)}`);
    toast.success("Sale deleted");
  };

  const allowedPaymentMethods = useMemo(() => {
    if (!selectedInvoice) return ["Cash", "Bank Transfer"];
    const originalMethod = selectedInvoice.paymentMethod;
    if (originalMethod === "Cash") return ["Cash"];
    if (originalMethod === "Bank Transfer") return ["Bank Transfer"];
    return ["Cash", "Bank Transfer"];
  }, [selectedInvoice]);

  const openPaymentModal = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setPaymentAmount(inv.balanceDue || inv.grandTotal);
    setPaymentDate(getLocalTodayISO());
    const originalMethod = inv.paymentMethod;
    setPaymentMethod(
      originalMethod === "Bank Transfer" || originalMethod === "Cash" ? originalMethod : "Cash"
    );
    setPaymentModalOpen(true);
  };

  const recordPayment = () => {
    if (!selectedInvoice || !paymentAmount) return;
    const amount = Number(paymentAmount);
    if (amount <= 0) return toast.error("Enter a valid amount");

    const currentBalance = selectedInvoice.balanceDue ?? selectedInvoice.grandTotal;
    if (amount > currentBalance) return toast.error("Payment exceeds balance due");

    const newAmountPaid = (selectedInvoice.amountPaid || 0) + amount;
    const newBalanceDue = selectedInvoice.grandTotal - newAmountPaid;
    const newStatus = newBalanceDue <= 0 ? "paid" : "partial";

    // Update invoice
    const all = store.invoices();
    const idx = all.findIndex((i) => i.id === selectedInvoice.id);
    if (idx >= 0) {
      all[idx] = {
        ...all[idx],
        amountPaid: newAmountPaid,
        balanceDue: newBalanceDue,
        paymentStatus: newStatus,
        paymentMethod: all[idx].paymentMethod || paymentMethod,
      };
      store.saveInvoices(all);
      syncToAppsScript({ type: "invoice.create", payload: all[idx] });
    }

    // Add to payments store
    const payRec: PaymentTransaction = {
      id: uid("pay_"),
      date: paymentDate,
      amount,
      method: paymentMethod,
      type: "Balance Payment",
      referenceId: selectedInvoice.number,
    };
    store.savePayments([payRec, ...store.payments()]);
    syncToAppsScript({ type: "payment.create", payload: payRec });

    void logActivity(
      "Edit",
      "Sale",
      selectedInvoice.customerName,
      selectedInvoice.number,
      `Recorded payment of ${inr(amount)} via ${paymentMethod} for invoice ${selectedInvoice.number}`
    );

    toast.success("Payment recorded");
    setPaymentModalOpen(false);
  };

  const totalSales = invoices.reduce((s, i) => s + i.grandTotal, 0);
  const paidPayment = invoices.reduce(
    (s, i) => s + ((i.paymentStatus || "").toLowerCase() === "paid" ? (i.amountPaid ?? i.grandTotal) : (i.amountPaid ?? 0)),
    0,
  );
  const pendingPaymentAmount = invoices.reduce(
    (s, i) => s + ((i.paymentStatus || "").toLowerCase() !== "paid" ? (i.balanceDue ?? i.grandTotal) : 0),
    0,
  );

  const partialInvoices = invoices.filter((i) => (i.paymentStatus || "").toLowerCase() === "partial");
  const partialPaymentAmount = partialInvoices.reduce(
    (s, i) => s + (i.balanceDue ?? i.grandTotal),
    0,
  );

  const notPaidInvoices = invoices.filter((i) => (i.paymentStatus || "").toLowerCase() === "pending");
  const notPaidAmount = notPaidInvoices.reduce((s, i) => s + (i.balanceDue ?? i.grandTotal), 0);

  const uniqueCustomers = new Set(invoices.map((i) => i.customerId)).size;

  const getInvoiceCostAndProfit = (inv: Invoice) => {
    let cost = 0;
    inv.items.forEach((it) => {
      const itemCost = it.purchasePrice !== undefined && it.purchasePrice !== null
        ? Number(it.purchasePrice)
        : (products.find((p) => p.id === it.productId || p.name === it.name)?.purchasePrice || 0);
      cost += (Number(it.qty) || 0) * itemCost;
    });
    const profit = inv.grandTotal - cost;
    return { cost, profit };
  };

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total Sales</div>
            <div className="text-xl font-bold">{inr(totalSales)}</div>
            <div className="text-xs text-muted-foreground mt-1">{invoices.length} Sales</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Paid Payment</div>
            <div className="text-xl font-bold text-emerald-600">{inr(paidPayment)}</div>
            <div className="text-xs text-muted-foreground mt-1">Successfully Collected</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total Outstanding</div>
            <div className="text-xl font-bold text-amber-600">{inr(pendingPaymentAmount)}</div>
            <div className="text-xs text-muted-foreground mt-1">Partial + Not Paid</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Partial Payment</div>
            <div className="text-xl font-bold text-orange-500">{inr(partialPaymentAmount)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {partialInvoices.length} Partial Invoices
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Not Paid</div>
            <div className="text-xl font-bold text-rose-600">{inr(notPaidAmount)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {notPaidInvoices.length} Unpaid Invoices
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Customers Billed</div>
            <div className="text-xl font-bold">{uniqueCustomers}</div>
            <div className="text-xs text-muted-foreground mt-1">Unique Customers</div>
          </CardContent>
        </Card>
      </div>

      {/* Date Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">From Date</Label>
              <Input
                type="date"
                className="h-9 w-40"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To Date</Label>
              <Input
                type="date"
                className="h-9 w-40"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFrom(firstOfMonth);
                setTo(today);
              }}
            >
              This Month
            </Button>
            {(from || to) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search invoice #, customer, product…"
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="pending">Not Paid</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button asChild>
          <Link to="/invoices/new">
            <Plus className="h-4 w-4" /> New Sale
          </Link>
        </Button>
      </div>

      {/* Desktop Table */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sale #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Due Days</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                    No sales found. Click <span className="font-medium">New Sale</span> to
                    create one.
                  </TableCell>
                </TableRow>
              )}
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium font-mono text-sm">{inv.number}</TableCell>
                  <TableCell>{fmtDate(inv.date)}</TableCell>
                  <TableCell>{inv.dueDate ? fmtDate(inv.dueDate) : "—"}</TableCell>
                  <TableCell>
                    {(inv.paymentStatus || "").toLowerCase() === "paid" || !inv.dueDate
                      ? "—"
                      : (() => {
                          const days = getDueDaysCount(inv.dueDate);
                          const colorClass =
                            days !== null && days < 0
                              ? "text-rose-600 font-semibold"
                              : days !== null && days <= 10
                                ? "text-amber-600 font-semibold"
                                : "text-emerald-600 font-semibold";
                          return (
                            <span className={colorClass}>{getDueDays(inv.date, inv.dueDate)}</span>
                          );
                        })()}
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{inv.customerName}</div>
                    {inv.customerPhone && (
                      <div className="text-xs text-muted-foreground">{inv.customerPhone}</div>
                    )}
                    {(() => {
                      const { cost, profit } = getInvoiceCostAndProfit(inv);
                      return (
                        <div className="text-xs mt-1.5 flex flex-col gap-0.5">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground font-medium">Cost:</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-300">{inr(cost)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground font-medium">P/L:</span>
                            <span className={`font-bold ${profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              {profit >= 0 ? "+" : ""}{inr(profit)}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell
                    className="max-w-[200px] truncate text-xs text-muted-foreground"
                    title={inv.items.map((it) => `${it.name} (x${it.qty})`).join(", ")}
                  >
                    {inv.items.map((it) => `${it.name} (x${it.qty})`).join(", ")}
                  </TableCell>
                  <TableCell className="text-right font-semibold">{inr(inv.grandTotal)}</TableCell>
                  <TableCell className="text-right font-medium text-amber-600">
                    {(inv.paymentStatus || "").toLowerCase() !== "paid" ? inr(inv.balanceDue ?? inv.grandTotal) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        (inv.paymentStatus || "").toLowerCase() === "paid"
                          ? "default"
                          : (inv.paymentStatus || "").toLowerCase() === "partial"
                            ? "secondary"
                            : "destructive"
                      }
                      className="capitalize"
                    >
                      {(inv.paymentStatus || "").toLowerCase() === "pending" ? "not paid" : inv.paymentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-0.5">
                      {(inv.paymentStatus || "").toLowerCase() !== "paid" && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openPaymentModal(inv)}
                            title="Record Payment"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="text-emerald-600"
                            >
                              <rect width="20" height="12" x="2" y="6" rx="2" />
                              <circle cx="12" cy="12" r="2" />
                              <path d="M6 12h.01M18 12h.01" />
                            </svg>
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            asChild
                            title="Edit Invoice"
                          >
                            <Link to="/invoices/new" search={{ edit: inv.id }}>
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-blue-600"
                              >
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
                            </Link>
                          </Button>
                        </>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => downloadInvoicePDF(inv, settings)}
                        title="Download PDF"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => printInvoicePDF(inv, settings)}
                        title="Print"
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => sendEmail(inv, settings)}
                        title="Send Email"
                      >
                        <Mail className="h-4 w-4 text-blue-500" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => sendWhatsApp(inv, settings)}
                        title="Send WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4 text-green-500" />
                      </Button>
                      {isAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => remove(inv.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {invoices.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              No sales found. Tap <span className="font-medium">New Sale</span> to create one.
            </CardContent>
          </Card>
        )}
        {invoices.map((inv) => {
          const status = (inv.paymentStatus || "").toLowerCase();
          const isPaid = status === "paid";
          const isPartial = status === "partial";
          const isPending = status === "pending";
          return (
            <Card key={inv.id} className="overflow-hidden">
              <CardContent className="p-4">
                {/* Header row */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-mono text-sm font-bold text-primary">{inv.number}</div>
                    <div className="font-semibold text-base mt-0.5">{inv.customerName}</div>
                    {inv.customerPhone && (
                      <div className="text-xs text-muted-foreground">{inv.customerPhone}</div>
                    )}
                    {(() => {
                      const { cost, profit } = getInvoiceCostAndProfit(inv);
                      return (
                        <div className="text-xs mt-1.5 flex flex-wrap items-center gap-x-2 bg-slate-50 dark:bg-slate-900/50 p-1 px-2 rounded border border-slate-100 dark:border-slate-800/80 w-fit">
                          <div>
                            <span className="text-muted-foreground text-[11px]">Cost: </span>
                            <span className="font-medium text-slate-700 dark:text-slate-300">{inr(cost)}</span>
                          </div>
                          <span className="text-slate-300 dark:text-slate-700">•</span>
                          <div>
                            <span className="text-muted-foreground text-[11px]">P/L: </span>
                            <span className={`font-semibold ${profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              {profit >= 0 ? "+" : ""}{inr(profit)}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <Badge
                    variant={isPaid ? "default" : isPartial ? "secondary" : "destructive"}
                    className="capitalize ml-2 shrink-0"
                  >
                    {isPending ? "Not Paid" : inv.paymentStatus}
                  </Badge>
                </div>

                {/* Amount row */}
                <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Total</div>
                    <div className="font-bold text-base">{inr(inv.grandTotal)}</div>
                  </div>
                  {!isPaid && (
                    <div>
                      <div className="text-xs text-muted-foreground">Balance Due</div>
                      <div className="font-bold text-base text-amber-600">{inr(inv.balanceDue ?? inv.grandTotal)}</div>
                    </div>
                  )}
                </div>

                {/* Date row */}
                <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium">Date: </span>{fmtDate(inv.date)}
                  </div>
                  {inv.dueDate && !isPaid && (
                    <div>
                      <span className="font-medium">Due: </span>
                      {(() => {
                        const days = getDueDaysCount(inv.dueDate);
                        const colorClass = days !== null && days < 0 ? "text-rose-600 font-bold" : days !== null && days <= 10 ? "text-amber-600 font-semibold" : "text-emerald-600";
                        return <span className={colorClass}>{getDueDays(inv.date, inv.dueDate)}</span>;
                      })()}
                    </div>
                  )}
                </div>

                {/* Items */}
                <div className="text-xs text-muted-foreground mb-3 truncate">
                  {inv.items.map((it) => `${it.name} (x${it.qty})`).join(", ")}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-wrap border-t pt-3">
                  {!isPaid && (
                    <>
                      <Button size="sm" variant="outline" className="h-8 text-xs flex-1 min-w-[90px] text-emerald-600 border-emerald-200" onClick={() => openPaymentModal(inv)}>
                        💳 Pay
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs flex-1 min-w-[90px] text-blue-600 border-blue-200" asChild>
                        <Link to="/invoices/new" search={{ edit: inv.id }}>
                          ✏️ Edit
                        </Link>
                      </Button>
                    </>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => downloadInvoicePDF(inv, settings)} title="Download PDF">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => printInvoicePDF(inv, settings)} title="Print">
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => sendEmail(inv, settings)} title="Email">
                    <Mail className="h-3.5 w-3.5 text-blue-500" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => sendWhatsApp(inv, settings)} title="WhatsApp">
                    <MessageCircle className="h-3.5 w-3.5 text-green-500" />
                  </Button>
                  {isAdmin && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(inv.id)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={paymentModalOpen} onOpenChange={setPaymentModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <div className="text-sm text-muted-foreground">Sale Number</div>
              <div className="font-medium">{selectedInvoice?.number}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Balance Due</div>
              <div className="font-medium text-amber-600">
                {selectedInvoice
                  ? inr(selectedInvoice.balanceDue ?? selectedInvoice.grandTotal)
                  : ""}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Payment Date</Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Amount Received</Label>
              <Input
                type="number"
                min={1}
                value={paymentAmount}
                onChange={(e) =>
                  setPaymentAmount(e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedPaymentMethods.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={recordPayment}>Save Payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
