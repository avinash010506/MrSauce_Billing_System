import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { store, onStoreChange } from "@/lib/storage";
import { inr, toLocalDateString, getLocalTodayISO, getLocalFirstOfMonthISO } from "@/lib/format";
import { ArrowDownRight, ArrowUpRight, Banknote } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/cashflow")({
  beforeLoad: () => {
    const s = store.getSession();
    if (!s || (s.role !== "admin" && s.role !== "accountant")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: CashflowPage,
  head: () => ({ meta: [{ title: "Cash Flow • Smart Invoice" }] }),
});

function CashflowPage() {
  const [tick, setTick] = useState(0);
  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);

  const today = getLocalTodayISO();
  const firstOfMonth = getLocalFirstOfMonthISO();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const data = useMemo(() => {
    const invoices = store.invoices();
    const purchases = store.purchaseBills();
    const expenses = store.expenses();
    const payments = store.payments();

    const incomingPayments = payments.filter(
      (p) =>
        (!from || p.date >= from) &&
        (!to || p.date <= to) &&
        (p.type === "Sale" ||
          (p.type === "Balance Payment" && invoices.some((i) => i.number === p.referenceId))),
    );
    const outgoingPayments = payments.filter(
      (p) =>
        (!from || p.date >= from) &&
        (!to || p.date <= to) &&
        (p.type === "Purchase" ||
          (p.type === "Balance Payment" && purchases.some((b) => b.number === p.referenceId))),
    );

    const cashIn_Cash = incomingPayments
      .filter((p) => p.method === "Cash")
      .reduce((s, p) => s + p.amount, 0);
    const cashIn_Bank = incomingPayments
      .filter((p) => p.method === "Bank Transfer")
      .reduce((s, p) => s + p.amount, 0);

    const filteredExpenses = expenses.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));

    const exp_Cash = filteredExpenses
      .filter((e) => e.paymentType === "Cash")
      .reduce((s, e) => s + e.amount, 0);
    const exp_Bank = filteredExpenses
      .filter((e) => e.paymentType === "Bank Transfer")
      .reduce((s, e) => s + e.amount, 0);

    const outPay_Cash = outgoingPayments
      .filter((p) => p.method === "Cash")
      .reduce((s, p) => s + p.amount, 0);
    const outPay_Bank = outgoingPayments
      .filter((p) => p.method === "Bank Transfer")
      .reduce((s, p) => s + p.amount, 0);

    const cashOut_Cash = outPay_Cash + exp_Cash;
    const cashOut_Bank = outPay_Bank + exp_Bank;

    // Vendor calculations: split total purchases 50/50 automatically
    const filteredPurchases = purchases.filter(
      (p) => (!from || p.date.slice(0, 10) >= from) && (!to || p.date.slice(0, 10) <= to)
    );
    const totalPurchasesInPeriod = filteredPurchases.reduce((s, p) => s + p.grandTotal, 0);

    const vendorCashTotal = totalPurchasesInPeriod * 0.5;
    const vendorBankTotal = totalPurchasesInPeriod * 0.5;

    const vendorCashPaid = outPay_Cash;
    const vendorBankPaid = outPay_Bank;

    const vendorCashBalance = vendorCashTotal - vendorCashPaid;
    const vendorBankBalance = vendorBankTotal - vendorBankPaid;

    return {
      cashIn_Cash,
      cashIn_Bank,
      cashOut_Cash,
      cashOut_Bank,
      net_Cash: cashIn_Cash - cashOut_Cash,
      net_Bank: cashIn_Bank - cashOut_Bank,
      inv_Cash: cashIn_Cash,
      inv_Bank: cashIn_Bank,
      pur_Cash: outPay_Cash,
      pur_Bank: outPay_Bank,
      exp_Cash,
      exp_Bank,
      vendorCashTotal,
      vendorBankTotal,
      vendorCashPaid,
      vendorBankPaid,
      vendorCashBalance,
      vendorBankBalance,
    };
  }, [from, to, tick]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Cash / Bank Flow</h2>
          <p className="text-sm text-muted-foreground">Monitor your cash and bank transaction flows.</p>
        </div>
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

      <div>
        <h2 className="text-xl font-bold mb-4">Cash Flow</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cash In</CardTitle>
              <ArrowUpRight className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">{inr(data.cashIn_Cash)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cash Out</CardTitle>
              <ArrowDownRight className="h-4 w-4 text-rose-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-rose-600">{inr(data.cashOut_Cash)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Net Cash</CardTitle>
              <Banknote className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${data.net_Cash >= 0 ? "text-emerald-600" : "text-rose-600"}`}
              >
                {inr(data.net_Cash)}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary (Cash)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="font-medium text-muted-foreground">Invoices (Received)</span>
                  <span className="text-emerald-600 font-semibold">+{inr(data.inv_Cash)}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="font-medium text-muted-foreground">Purchase Bills (Paid)</span>
                  <span className="text-rose-600 font-semibold">-{inr(data.pur_Cash)}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="font-medium text-muted-foreground">Direct Expenses</span>
                  <span className="text-rose-600 font-semibold">-{inr(data.exp_Cash)}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="font-bold">Net</span>
                  <span
                    className={`font-bold ${data.net_Cash >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    {inr(data.net_Cash)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vendor Cash Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="font-medium text-muted-foreground">Total Purchases (Cash Share)</span>
                  <span className="text-rose-600 font-semibold">-{inr(data.vendorCashTotal)}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="font-medium text-muted-foreground">Vendor Paid (Cash)</span>
                  <span className="text-emerald-600 font-semibold">+{inr(data.vendorCashPaid)}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="font-bold">Outstanding Cash Balance</span>
                  <span
                    className={`font-bold ${data.vendorCashBalance <= 0 ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    {inr(data.vendorCashBalance)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-bold mb-4">Bank Flow</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Bank In</CardTitle>
              <ArrowUpRight className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">{inr(data.cashIn_Bank)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Bank Out</CardTitle>
              <ArrowDownRight className="h-4 w-4 text-rose-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-rose-600">{inr(data.cashOut_Bank)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Net Bank</CardTitle>
              <Banknote className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${data.net_Bank >= 0 ? "text-emerald-600" : "text-rose-600"}`}
              >
                {inr(data.net_Bank)}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary (Bank Transfer)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="font-medium text-muted-foreground">Invoices (Received)</span>
                  <span className="text-emerald-600 font-semibold">+{inr(data.inv_Bank)}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="font-medium text-muted-foreground">Purchase Bills (Paid)</span>
                  <span className="text-rose-600 font-semibold">-{inr(data.pur_Bank)}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="font-medium text-muted-foreground">Direct Expenses</span>
                  <span className="text-rose-600 font-semibold">-{inr(data.exp_Bank)}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="font-bold">Net</span>
                  <span
                    className={`font-bold ${data.net_Bank >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    {inr(data.net_Bank)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vendor Bank Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="font-medium text-muted-foreground">Total Purchases (Bank Share)</span>
                  <span className="text-rose-600 font-semibold">-{inr(data.vendorBankTotal)}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="font-medium text-muted-foreground">Vendor Paid (Bank Transfer)</span>
                  <span className="text-emerald-600 font-semibold">+{inr(data.vendorBankPaid)}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="font-bold">Remaining Bank Balance</span>
                  <span
                    className={`font-bold ${data.vendorBankBalance <= 0 ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    {inr(data.vendorBankBalance)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
