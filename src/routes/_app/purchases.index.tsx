import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { onStoreChange, store } from "@/lib/storage";
import { inr, fmtDate, getDueDays, getDueDaysCount, toLocalDateString, getLocalTodayISO, getLocalFirstOfMonthISO } from "@/lib/format";
import { downloadPurchaseBillPDF, printPurchaseBillPDF } from "@/lib/pdf";
import { Download, Plus, Printer, Search, ShoppingCart, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { uid } from "@/lib/format";
import { syncToAppsScript } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import type { PurchaseBill, PaymentTransaction } from "@/lib/types";

export const Route = createFileRoute("/_app/purchases/")({
  component: PurchasesPage,
  head: () => ({ meta: [{ title: "Purchases • Smart Invoice" }] }),
});

function PurchasesPage() {
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
  const [selectedBill, setSelectedBill] = useState<PurchaseBill | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string | number>("");
  const [paymentDate, setPaymentDate] = useState(getLocalTodayISO());
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);

  useEffect(() => {
    if (!selectedBill) return;
    const billPayments = store.payments().filter((p) => p.referenceId === selectedBill.number);
    const paidCash = billPayments.filter(p => p.method === "Cash").reduce((sum, p) => sum + p.amount, 0);
    const paidBank = billPayments.filter(p => p.method === "Bank Transfer").reduce((sum, p) => sum + p.amount, 0);

    const totalCashTarget = selectedBill.grandTotal * 0.5;
    const totalBankTarget = selectedBill.grandTotal * 0.5;

    const cashRemaining = Math.max(0, totalCashTarget - paidCash);
    const bankRemaining = Math.max(0, totalBankTarget - paidBank);

    if (paymentMethod === "Cash") {
      setPaymentAmount(cashRemaining);
    } else {
      setPaymentAmount(bankRemaining);
    }
  }, [paymentMethod, selectedBill, tick]);

  const bills = useMemo(() => {
    let list = store.purchaseBills().sort((a, b) => {
      const dateComp = (b.date || "").localeCompare(a.date || "");
      if (dateComp !== 0) return dateComp;
      const numA = parseInt(a.number.split('-')[1], 10) || 0;
      const numB = parseInt(b.number.split('-')[1], 10) || 0;
      return numB - numA;
    });
    if (statusFilter !== "all") list = list.filter((b) => (b.paymentStatus || "").toLowerCase() === statusFilter);
    if (from) list = list.filter((b) => (b.date || "").slice(0, 10) >= from);
    if (to) list = list.filter((b) => (b.date || "").slice(0, 10) <= to);
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter(
      (b) =>
        b.number.toLowerCase().includes(s) ||
        b.vendorName.toLowerCase().includes(s) ||
        (b.partyInvoiceNumber && b.partyInvoiceNumber.toLowerCase().includes(s)) ||
        b.items.some((it) => it.name.toLowerCase().includes(s)),
    );
  }, [q, statusFilter, from, to, tick]);

  const settings = store.getSettings();

  const remove = (id: string) => {
    if (!isAdmin) return toast.error("Unauthorized: Only Admins can delete purchase bills.");
    if (!confirm("Delete this purchase bill?")) return;
    const allBills = store.purchaseBills();
    const bill = allBills.find((b) => b.id === id);
    if (!bill) return;

    // Save filtered bills
    store.savePurchaseBills(allBills.filter((b) => b.id !== id));
    void syncToAppsScript({ type: "purchase.delete", payload: { number: bill.number } });

    // Revert stock
    const prods = store.products();
    bill.items.forEach((it) => {
      const p = prods.find((x) => x.id === it.productId);
      if (p) {
        p.stock = Math.max(0, p.stock - it.qty);
        void syncToAppsScript({ type: "product.upsert", payload: p });
      }
    });
    store.saveProducts(prods);

    // Delete associated payments
    const payments = store.payments();
    const associatedPayments = payments.filter((p) => p.referenceId === bill.number);
    const updatedPayments = payments.filter((p) => p.referenceId !== bill.number);
    store.savePayments(updatedPayments);
    associatedPayments.forEach((p) => {
      void syncToAppsScript({ type: "payment.delete", payload: { id: p.id } });
    });

    // Delete associated activity logs
    const logs = store.activityLogs();
    const updatedLogs = logs.filter((l) => l.referenceId !== bill.number);
    store.saveActivityLogs(updatedLogs);

    void logActivity("Delete", "Purchase", bill.vendorName, bill.number, `Deleted purchase bill for ${inr(bill.grandTotal)}`);
    toast.success("Purchase bill deleted");
  };

  const openPaymentModal = (bill: PurchaseBill) => {
    setSelectedBill(bill);
    setPaymentDate(getLocalTodayISO());
    setPaymentMethod("Cash");
    setPaymentModalOpen(true);
  };

  const recordPayment = () => {
    if (!selectedBill || !paymentAmount) return;
    const amount = Number(paymentAmount);
    if (amount <= 0) return toast.error("Enter a valid amount");

    const currentBalance = selectedBill.balanceDue ?? selectedBill.grandTotal;
    if (amount > currentBalance) return toast.error("Payment exceeds balance due");

    // Enforce 50% Cash & Bank Transfer limit check
    const billPayments = store.payments().filter((p) => p.referenceId === selectedBill.number);
    const paidCash = billPayments.filter(p => p.method === "Cash").reduce((sum, p) => sum + p.amount, 0);
    const paidBank = billPayments.filter(p => p.method === "Bank Transfer").reduce((sum, p) => sum + p.amount, 0);

    const totalCashTarget = selectedBill.grandTotal * 0.5;
    const totalBankTarget = selectedBill.grandTotal * 0.5;

    const cashRemaining = Math.max(0, totalCashTarget - paidCash);
    const bankRemaining = Math.max(0, totalBankTarget - paidBank);

    const methodRemaining = paymentMethod === "Cash" ? cashRemaining : bankRemaining;
    if (amount > methodRemaining) {
      return toast.error(`Payment exceeds remaining allocation for ${paymentMethod} (${inr(methodRemaining)})`);
    }

    const newAmountPaid = (selectedBill.amountPaid || 0) + amount;
    const newBalanceDue = selectedBill.grandTotal - newAmountPaid;
    const newStatus = newBalanceDue <= 0 ? "paid" : "partial";

    // Update bill
    const all = store.purchaseBills();
    const idx = all.findIndex((i) => i.id === selectedBill.id);
    if (idx >= 0) {
      all[idx] = {
        ...all[idx],
        amountPaid: newAmountPaid,
        balanceDue: newBalanceDue,
        paymentStatus: newStatus,
      };
      store.savePurchaseBills(all);
      syncToAppsScript({ type: "purchase.create", payload: all[idx] });
    }

    // Add to payments store
    const payRec: PaymentTransaction = {
      id: uid("pay_"),
      date: paymentDate,
      amount,
      method: paymentMethod,
      type: "Balance Payment",
      referenceId: selectedBill.number,
    };
    store.savePayments([payRec, ...store.payments()]);
    syncToAppsScript({ type: "payment.create", payload: payRec });

    void logActivity(
      "Edit",
      "Purchase",
      selectedBill.vendorName,
      selectedBill.number,
      `Recorded payment of ${inr(amount)} via ${paymentMethod} for purchase bill ${selectedBill.number}`
    );

    toast.success("Payment recorded");
    setPaymentModalOpen(false);
  };

  const totalBills = bills.reduce((sum, b) => sum + b.grandTotal, 0);
  const paidPayment = bills.reduce(
    (s, b) => s + ((b.paymentStatus || "").toLowerCase() === "paid" ? (b.amountPaid ?? b.grandTotal) : (b.amountPaid ?? 0)),
    0,
  );
  const pendingPaymentAmount = bills.reduce(
    (s, b) => s + ((b.paymentStatus || "").toLowerCase() !== "paid" ? (b.balanceDue ?? b.grandTotal) : 0),
    0,
  );

  const partialBills = bills.filter((b) => (b.paymentStatus || "").toLowerCase() === "partial");
  const partialPaymentAmount = partialBills.reduce((s, b) => s + (b.balanceDue ?? b.grandTotal), 0);

  const notPaidBills = bills.filter((b) => (b.paymentStatus || "").toLowerCase() === "pending");
  const notPaidAmount = notPaidBills.reduce((s, b) => s + (b.balanceDue ?? b.grandTotal), 0);

  const uniqueVendors = new Set(bills.map((b) => b.vendorId)).size;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total Purchases</div>
            <div className="text-xl font-bold">{inr(totalBills)}</div>
            <div className="text-xs text-muted-foreground mt-1">{bills.length} Bills</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Paid Payment</div>
            <div className="text-xl font-bold text-emerald-600">{inr(paidPayment)}</div>
            <div className="text-xs text-muted-foreground mt-1">Successfully Paid</div>
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
              {partialBills.length} Partial Bills
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Not Paid</div>
            <div className="text-xl font-bold text-rose-600">{inr(notPaidAmount)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {notPaidBills.length} Unpaid Bills
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Vendors Used</div>
            <div className="text-xl font-bold">{uniqueVendors}</div>
            <div className="text-xs text-muted-foreground mt-1">Unique Vendors</div>
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

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by bill #, vendor, product…"
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
          <Link to="/purchases/new">
            <Plus className="h-4 w-4" /> New Purchase Bill
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
                <TableHead>Bill #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Due Days</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <ShoppingCart className="h-10 w-10 opacity-30" />
                      <span>
                        No purchase bills yet. Click <strong>New Purchase Bill</strong> to create
                        one.
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {bills.map((bill) => (
                <TableRow key={bill.id}>
                  <TableCell className="font-medium font-mono text-sm">
                    <div>{bill.number}</div>
                    {bill.partyInvoiceNumber && (
                      <div className="text-[11px] text-muted-foreground font-sans mt-0.5">
                        Party Inv: {bill.partyInvoiceNumber}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{fmtDate(bill.date)}</TableCell>
                  <TableCell>{bill.dueDate ? fmtDate(bill.dueDate) : "—"}</TableCell>
                  <TableCell>
                    {bill.paymentStatus === "paid" || !bill.dueDate
                      ? "—"
                      : (() => {
                          const days = getDueDaysCount(bill.dueDate);
                          const colorClass =
                            days !== null && days < 0
                              ? "text-rose-600 font-semibold"
                              : days !== null && days <= 10
                                ? "text-amber-600 font-semibold"
                                : "text-emerald-600 font-semibold";
                          return (
                            <span className={colorClass}>
                              {getDueDays(bill.date, bill.dueDate)}
                            </span>
                          );
                        })()}
                  </TableCell>
                  <TableCell>{bill.vendorName}</TableCell>
                  <TableCell
                    className="max-w-[200px] truncate text-xs text-muted-foreground"
                    title={bill.items.map((it) => `${it.name} (x${it.qty})`).join(", ")}
                  >
                    {bill.items.map((it) => `${it.name} (x${it.qty})`).join(", ")}
                  </TableCell>
                  <TableCell className="text-right font-semibold">{inr(bill.grandTotal)}</TableCell>
                  <TableCell className="text-right font-medium text-amber-600">
                    {(bill.paymentStatus || "").toLowerCase() !== "paid" ? inr(bill.balanceDue ?? bill.grandTotal) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        (bill.paymentStatus || "").toLowerCase() === "paid"
                          ? "default"
                          : (bill.paymentStatus || "").toLowerCase() === "partial"
                            ? "secondary"
                            : "destructive"
                      }
                      className="capitalize"
                    >
                      {(bill.paymentStatus || "").toLowerCase() === "pending" ? "not paid" : bill.paymentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {(bill.paymentStatus || "").toLowerCase() !== "paid" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openPaymentModal(bill)}
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
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => downloadPurchaseBillPDF(bill, settings)}
                        title="Download PDF"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => printPurchaseBillPDF(bill, settings)}
                        title="Print"
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => remove(bill.id)}
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
        {bills.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              <ShoppingCart className="h-10 w-10 opacity-30 mx-auto mb-2" />
              No purchase bills yet. Tap <strong>New Purchase Bill</strong> to create one.
            </CardContent>
          </Card>
        )}
        {bills.map((bill) => {
          const status = (bill.paymentStatus || "").toLowerCase();
          const isPaid = status === "paid";
          const isPartial = status === "partial";
          const isPending = status === "pending";
          return (
            <Card key={bill.id} className="overflow-hidden">
              <CardContent className="p-4">
                {/* Header row */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-mono text-sm font-bold text-primary">{bill.number}</div>
                    {bill.partyInvoiceNumber && (
                      <div className="text-[11px] text-muted-foreground">Party: {bill.partyInvoiceNumber}</div>
                    )}
                    <div className="font-semibold text-base mt-0.5">{bill.vendorName}</div>
                  </div>
                  <Badge
                    variant={isPaid ? "default" : isPartial ? "secondary" : "destructive"}
                    className="capitalize ml-2 shrink-0"
                  >
                    {isPending ? "Not Paid" : bill.paymentStatus}
                  </Badge>
                </div>

                {/* Amount row */}
                <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Total</div>
                    <div className="font-bold text-base">{inr(bill.grandTotal)}</div>
                  </div>
                  {!isPaid && (
                    <div>
                      <div className="text-xs text-muted-foreground">Balance Due</div>
                      <div className="font-bold text-base text-amber-600">{inr(bill.balanceDue ?? bill.grandTotal)}</div>
                    </div>
                  )}
                </div>

                {/* Date row */}
                <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium">Date: </span>{fmtDate(bill.date)}
                  </div>
                  {bill.dueDate && !isPaid && (
                    <div>
                      <span className="font-medium">Due: </span>
                      {(() => {
                        const days = getDueDaysCount(bill.dueDate);
                        const colorClass = days !== null && days < 0 ? "text-rose-600 font-bold" : days !== null && days <= 10 ? "text-amber-600 font-semibold" : "text-emerald-600";
                        return <span className={colorClass}>{getDueDays(bill.date, bill.dueDate)}</span>;
                      })()}
                    </div>
                  )}
                </div>

                {/* Items */}
                <div className="text-xs text-muted-foreground mb-3 truncate">
                  {bill.items.map((it) => `${it.name} (x${it.qty})`).join(", ")}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-wrap border-t pt-3">
                  {!isPaid && (
                    <Button size="sm" variant="outline" className="h-8 text-xs flex-1 min-w-[90px] text-emerald-600 border-emerald-200" onClick={() => openPaymentModal(bill)}>
                      💳 Pay
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => downloadPurchaseBillPDF(bill, settings)} title="Download PDF">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => printPurchaseBillPDF(bill, settings)} title="Print">
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                  {isAdmin && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(bill.id)} title="Delete">
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
              <div className="text-sm text-muted-foreground">Bill Number</div>
              <div className="font-medium">{selectedBill?.number}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Balance Due</div>
              <div className="font-medium text-amber-600">
                {selectedBill ? inr(selectedBill.balanceDue ?? selectedBill.grandTotal) : ""}
              </div>
            </div>

            {selectedBill && (() => {
              const billPayments = store.payments().filter((p) => p.referenceId === selectedBill.number);
              const paidCash = billPayments.filter(p => p.method === "Cash").reduce((sum, p) => sum + p.amount, 0);
              const paidBank = billPayments.filter(p => p.method === "Bank Transfer").reduce((sum, p) => sum + p.amount, 0);

              const totalCashTarget = selectedBill.grandTotal * 0.5;
              const totalBankTarget = selectedBill.grandTotal * 0.5;

              const cashRemaining = Math.max(0, totalCashTarget - paidCash);
              const bankRemaining = Math.max(0, totalBankTarget - paidBank);

              return (
                <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-100 dark:border-slate-800 space-y-2.5 text-xs">
                  <div className="flex justify-between items-center pb-1.5 border-b border-slate-200 dark:border-slate-800">
                    <span className="font-medium text-slate-900 dark:text-slate-100">Payment Allocation Summary</span>
                    <span className="text-[11px] text-muted-foreground font-mono">Total Purchase: {inr(selectedBill.grandTotal)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <div className="font-semibold text-slate-700 dark:text-slate-300">Cash</div>
                      <div className={cashRemaining === 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-semibold text-rose-600 dark:text-rose-400"}>
                        Amount: {cashRemaining === 0 ? "Nil" : inr(cashRemaining)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="font-semibold text-slate-700 dark:text-slate-300">Bank</div>
                      <div className={bankRemaining === 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-semibold text-rose-600 dark:text-rose-400"}>
                        Amount: {bankRemaining === 0 ? "Nil" : inr(bankRemaining)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div className="space-y-2">
              <Label>Payment Date</Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Amount Paid</Label>
              <Input
                type="number"
                min={1}
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Cash", "Bank Transfer"].map((m) => (
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
