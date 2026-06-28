import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { onStoreChange, store } from "@/lib/storage";
import { inr, fmtDate, toLocalDateString, getLocalTodayISO, getLocalFirstOfMonthISO } from "@/lib/format";
import {
  TrendingUp,
  Users,
  Package,
  AlertTriangle,
  FileText,
  Plus,
  ShoppingCart,
  Building2,
  Banknote,
  Wallet,
  BarChart3,
  CreditCard,
  Box,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Filter,
  RotateCcw,
  Percent,
  Truck,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
} from "recharts";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard • Smart Invoice" }] }),
});

const TABS = ["Products", "Customers", "Vendors"] as const;
type Tab = (typeof TABS)[number];

// ── Helpers ────────────────────────────────────────────────
const todayISO = () => getLocalTodayISO();
const firstOfMonthISO = () => getLocalFirstOfMonthISO();


function formatDateRange(from: string, to: string) {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  return `${fmt(from)} – ${fmt(to)}`;
}

function Dashboard() {
  const { user } = useAuth();
  const isStaff = user?.role === "staff";
  const [tick, setTick] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("Products");
  const [chartMode, setChartMode] = useState<"Total" | "Actual">("Total");

  // ── Filter State ───────────────────────────────────────────
  const [fromDate, setFromDate] = useState(firstOfMonthISO());
  const [toDate, setToDate] = useState(todayISO());
  // Applied filter values (only update when "Filter" is clicked)
  const [appliedFrom, setAppliedFrom] = useState(firstOfMonthISO());
  const [appliedTo, setAppliedTo] = useState(todayISO());
  const [filterActive, setFilterActive] = useState(false);

  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);

  useEffect(() => {
    if (isStaff && activeTab === "Vendors") {
      setActiveTab("Products");
    }
  }, [isStaff, activeTab]);

  const applyFilter = useCallback(() => {
    setAppliedFrom(fromDate);
    setAppliedTo(toDate);
    setFilterActive(
      fromDate !== firstOfMonthISO() || toDate !== todayISO(),
    );
  }, [fromDate, toDate]);

  const resetFilter = useCallback(() => {
    const f = firstOfMonthISO();
    const t = todayISO();
    setFromDate(f);
    setToDate(t);
    setAppliedFrom(f);
    setAppliedTo(t);
    setFilterActive(false);
  }, []);

  // ── Data Computation ───────────────────────────────────────
  const data = useMemo(() => {
    const allInvoices = store.invoices();
    const allPurchases = store.purchaseBills();
    const customers = store.customers();
    const vendors = store.vendors();
    const products = store.products();
    const allExpenses = store.expenses();
    const allPayments = store.payments();

    // Date filter predicate
    const inRange = (dateStr: string) => {
      const d = dateStr.slice(0, 10);
      return d >= appliedFrom && d <= appliedTo;
    };

    // Filtered data sets
    const invoices = allInvoices.filter((i) => inRange(i.date));
    const purchases = allPurchases.filter((p) => inRange(p.date));
    const expenses = allExpenses.filter((e) => inRange(e.date));
    const payments = allPayments.filter((p) => inRange(p.date));

    // ── Core Totals ──────────────────────────────────────────
    const totalSales = invoices.reduce((s, i) => s + i.grandTotal, 0);
    const totalPurchases = purchases.reduce((s, p) => s + p.grandTotal, 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const totalShipping = invoices.reduce((s, i) => s + (i.shipping || 0), 0);
    const totalDiscount = invoices.reduce((s, i) => s + (i.discountTotal || 0), 0);
    const totalSalesNoShipping = totalSales - totalShipping;

    const productMap = new Map(products.map((p) => [p.id, p]));
    let grossProfit = 0;
    invoices.forEach((inv) => {
      inv.items.forEach((it) => {
        const prod = productMap.get(it.productId);
        const costPrice = prod ? prod.purchasePrice : 0;
        grossProfit += (Number(it.qty) || 0) * (Number(it.unitPrice) || 0) - (Number(it.qty) || 0) * costPrice;
      });
    });

    const netProfit = grossProfit - totalDiscount - totalExpenses;

    // ── Receivables / Payables (all time, not filtered) ───────
    const customerDue = allInvoices
      .filter((i) => (i.paymentStatus || "").toLowerCase() !== "paid")
      .reduce((s, i) => s + (i.balanceDue ?? i.grandTotal), 0);
    const vendorDue = allPurchases
      .filter((p) => (p.paymentStatus || "").toLowerCase() !== "paid")
      .reduce((s, p) => s + (p.balanceDue ?? p.grandTotal), 0);

    // ── Payment Totals ────────────────────────────────────────
    const isIncomingPayment = (p: (typeof payments)[0]) =>
      p.type === "Sale" ||
      (p.type === "Balance Payment" &&
        allInvoices.some((i) => i.number === p.referenceId));
    const isOutgoingPayment = (p: (typeof payments)[0]) =>
      p.type === "Purchase" ||
      (p.type === "Balance Payment" &&
        allPurchases.some((b) => b.number === p.referenceId));

    const amountReceived = payments
      .filter(isIncomingPayment)
      .reduce((s, p) => s + p.amount, 0);
    const amountReceivedFullyPaid = payments
      .filter((p) => {
        if (!isIncomingPayment(p)) return false;
        const inv = allInvoices.find((i) => i.number === p.referenceId);
        return inv ? (inv.paymentStatus || "").toLowerCase() === "paid" : false;
      })
      .reduce((s, p) => s + p.amount, 0);
    const amountPaid = payments
      .filter(isOutgoingPayment)
      .reduce((s, p) => s + p.amount, 0);

    // Vendor calculations (50/50 Split)
    const outgoingPayments = payments.filter(isOutgoingPayment);
    const vendorCashTotal = totalPurchases * 0.5;
    const vendorBankTotal = totalPurchases * 0.5;
    const vendorCashPaid = outgoingPayments.filter((p) => p.method === "Cash").reduce((s, p) => s + p.amount, 0);
    const vendorBankPaid = outgoingPayments.filter((p) => p.method === "Bank Transfer").reduce((s, p) => s + p.amount, 0);
    const vendorCashBalance = vendorCashTotal - vendorCashPaid;
    const vendorBankBalance = vendorBankTotal - vendorBankPaid;

    // ── Sales and P/L Cash vs Bank Split calculations ──────────────────────
    let salesCashCost = 0;
    let salesBankCost = 0;
    let salesCashPL = 0;
    let salesBankPL = 0;

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

    invoices.forEach((inv) => {
      const { cash, bank } = getInvoiceMethodRatios(inv.paymentMethod);
      let invCost = 0;
      let invRevenue = 0;
      inv.items.forEach((it) => {
        const prod = productMap.get(it.productId);
        const costPrice = prod ? prod.purchasePrice : 0;
        invCost += (Number(it.qty) || 0) * costPrice;
        invRevenue += (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
      });

      // Final Cost is total cost of paid/partial invoices
      const status = (inv.paymentStatus || "").toLowerCase();
      if (status === "paid" || status === "partial") {
        salesCashCost += invCost * cash;
        salesBankCost += invCost * bank;
      }

      // Profit/Loss is realized ONLY if fully paid
      if (status === "paid") {
        const invProfit = invRevenue - invCost;
        salesCashPL += invProfit * cash;
        salesBankPL += invProfit * bank;
      }
    });

    // ── Cash Flow (for donut) ─────────────────────────────────
    const cashIn = amountReceived;
    const cashOut = amountPaid + totalExpenses;
    const netCashFlow = cashIn - cashOut;

    // ── Cash in Hand / Bank Balance (all payments ever) ───────
    const allIsIn = (p: (typeof allPayments)[0]) =>
      p.type === "Sale" ||
      (p.type === "Balance Payment" &&
        allInvoices.some((i) => i.number === p.referenceId));
    const allIsOut = (p: (typeof allPayments)[0]) =>
      p.type === "Purchase" ||
      (p.type === "Balance Payment" &&
        allPurchases.some((b) => b.number === p.referenceId));

    const cashInHand =
      allPayments
        .filter((p) => p.method === "Cash" && allIsIn(p))
        .reduce((s, p) => s + p.amount, 0) -
      allPayments
        .filter((p) => p.method === "Cash" && allIsOut(p))
        .reduce((s, p) => s + p.amount, 0) -
      allExpenses
        .filter((e) => e.paymentType === "Cash")
        .reduce((s, e) => s + e.amount, 0);

    const bankBalance =
      allPayments
        .filter((p) => p.method === "Bank Transfer" && allIsIn(p))
        .reduce((s, p) => s + p.amount, 0) -
      allPayments
        .filter((p) => p.method === "Bank Transfer" && allIsOut(p))
        .reduce((s, p) => s + p.amount, 0) -
      allExpenses
        .filter((e) => e.paymentType === "Bank Transfer")
        .reduce((s, e) => s + e.amount, 0);

    const totalBalance = cashInHand + bankBalance;

    // ── Inventory (always all products) ───────────────────────
    const inventoryValue = products.reduce(
      (s, p) => s + p.stock * p.sellingPrice,
      0,
    );
    const totalStockQty = products.reduce((s, p) => s + p.stock, 0);
    const lowStock = products.filter(
      (p) => p.stock > 0 && p.stock <= p.reorderLevel,
    );
    const outOfStock = products.filter((p) => p.stock === 0);

    // ── Calendar Year Chart (Jan to Dec based on applied filter end date year) ─
    const anchorDate = new Date(appliedTo);
    const currentYear = anchorDate.getFullYear();
    const months: {
      label: string;
      "Net Sales": number;
      Purchases: number;
      Expenses: number;
      "Net Profit": number;
    }[] = [];
    for (let m = 0; m <= 11; m++) {
      const d = new Date(currentYear, m, 1);
      const label = d.toLocaleDateString("en-GB", { month: "short" });

      let sales = 0;
      let purs = 0;

      if (chartMode === "Total") {
        sales = allInvoices
          .filter((inv) => {
            const x = new Date(inv.date);
            return (
              x.getMonth() === d.getMonth() && x.getFullYear() === d.getFullYear()
            );
          })
          .reduce((s, inv) => s + inv.grandTotal, 0);
        purs = allPurchases
          .filter((pur) => {
            const x = new Date(pur.date);
            return (
              x.getMonth() === d.getMonth() && x.getFullYear() === d.getFullYear()
            );
          })
          .reduce((s, pur) => s + pur.grandTotal, 0);
      } else {
        // Actual (Cash-basis)
        sales = allPayments
          .filter((p) => {
            const x = new Date(p.date);
            return (
              x.getMonth() === d.getMonth() &&
              x.getFullYear() === d.getFullYear() &&
              isIncomingPayment(p)
            );
          })
          .reduce((s, p) => s + p.amount, 0);
        purs = allPayments
          .filter((p) => {
            const x = new Date(p.date);
            return (
              x.getMonth() === d.getMonth() &&
              x.getFullYear() === d.getFullYear() &&
              isOutgoingPayment(p)
            );
          })
          .reduce((s, p) => s + p.amount, 0);
      }

      const exps = allExpenses
        .filter((exp) => {
          const x = new Date(exp.date);
          return (
            x.getMonth() === d.getMonth() && x.getFullYear() === d.getFullYear()
          );
        })
        .reduce((s, exp) => s + exp.amount, 0);
      months.push({
        label,
        "Net Sales": Math.round(sales),
        Purchases: Math.round(purs),
        Expenses: Math.round(exps),
        "Net Profit": Math.round(sales - purs - exps),
      });
    }

    // ── Top Products (filtered) ───────────────────────────────
    const productSalesMap = new Map<string, number>();
    invoices.forEach((inv) =>
      inv.items.forEach((it) => {
        productSalesMap.set(
          it.name,
          (productSalesMap.get(it.name) ?? 0) + it.qty * it.unitPrice,
        );
      }),
    );
    const topProducts = [...productSalesMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));

    // ── Top Customers (filtered) ──────────────────────────────
    const customerSalesMap = new Map<string, number>();
    invoices.forEach((inv) => {
      customerSalesMap.set(
        inv.customerName,
        (customerSalesMap.get(inv.customerName) ?? 0) + inv.grandTotal,
      );
    });
    const topCustomers = [...customerSalesMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));

    // ── Top Vendors (filtered) ────────────────────────────────
    const vendorPurchasesMap = new Map<string, number>();
    purchases.forEach((pur) => {
      vendorPurchasesMap.set(
        pur.vendorName,
        (vendorPurchasesMap.get(pur.vendorName) ?? 0) + pur.grandTotal,
      );
    });
    const topVendors = [...vendorPurchasesMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));

    return {
      totalSales,
      totalShipping,
      totalPurchases,
      totalExpenses,
      totalDiscount,
      grossProfit,
      netProfit,
      customerDue,
      vendorDue,
      amountReceived,
      amountPaid,
      cashIn,
      cashOut,
      netCashFlow,
      cashInHand,
      bankBalance,
      totalBalance,
      inventoryValue,
      totalStockQty,
      lowStock,
      outOfStock,
      products,
      customers: customers.length,
      vendors: vendors.length,
      months,
      topProducts,
      topCustomers,
      topVendors,
      vendorCashTotal,
      vendorBankTotal,
      vendorCashPaid,
      vendorBankPaid,
      vendorCashBalance,
      vendorBankBalance,
      salesCashCost,
      salesBankCost,
      salesCashPL,
      salesBankPL,
      amountReceivedFullyPaid,
      recent: [...invoices]
        .sort((a, b) => {
          const dateComp = b.date.localeCompare(a.date);
          if (dateComp !== 0) return dateComp;
          const numA = parseInt(a.number.split('-')[1], 10) || 0;
          const numB = parseInt(b.number.split('-')[1], 10) || 0;
          return numB - numA;
        })
        .slice(0, 5),
      recentPurchases: [...purchases]
        .sort((a, b) => {
          const dateComp = b.date.localeCompare(a.date);
          if (dateComp !== 0) return dateComp;
          const numA = parseInt(a.number.split('-')[1], 10) || 0;
          const numB = parseInt(b.number.split('-')[1], 10) || 0;
          return numB - numA;
        })
        .slice(0, 5),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, appliedFrom, appliedTo, chartMode]);

  // ── Cash Flow Donut ───────────────────────────────────────
  const cashFlowData =
    data.cashIn === 0 && data.cashOut === 0
      ? [
        { name: "Cash In", value: 1 },
        { name: "Cash Out", value: 0 },
      ]
      : [
        { name: "Cash In", value: data.cashIn },
        { name: "Cash Out", value: data.cashOut },
      ];

  // ── Top By Tab Data ───────────────────────────────────────
  const topByData =
    activeTab === "Products"
      ? data.topProducts
      : activeTab === "Customers"
        ? data.topCustomers
        : data.topVendors;

  // ── KPI Row 1: Core Financial Totals (7 cards) ───────────
  const kpiRow1 = [
    {
      label: "Total Sales",
      value: inr(data.totalSales),
      icon: TrendingUp,
      trend: "Invoiced Amount",
      up: true,
      iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
    },
    {
      label: "Shipping Cost",
      value: inr(data.totalShipping),
      icon: Truck,
      trend: "Invoiced Shipping",
      up: true,
      iconBg: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
    },
    {
      label: "Total Purchases",
      value: inr(data.totalPurchases),
      icon: ShoppingCart,
      trend: "Purchase Bills",
      up: true,
      iconBg: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400",
    },
    {
      label: "Gross Profit / Loss",
      value: inr(data.grossProfit),
      icon: BarChart3,
      trend: "Sales − Purchases",
      up: data.grossProfit >= 0,
      iconBg: "bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400",
    },
    {
      label: "Total Discount",
      value: inr(data.totalDiscount),
      icon: Percent,
      trend: "Invoiced Discounts",
      up: true,
      iconBg: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
    },
    {
      label: "Total Expenses",
      value: inr(data.totalExpenses),
      icon: Wallet,
      trend: "Period Expenses",
      up: false,
      iconBg: "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400",
    },
    {
      label: "Net Profit",
      value: inr(data.netProfit),
      icon: TrendingUp,
      trend: "After All Expenses",
      up: data.netProfit >= 0,
      iconBg: "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400",
    },
  ];

  // ── KPI Row 2: Actual / Cash Basis Metrics (5 cards) ─────
  // "Actual" = real cash received/paid vs invoiced amounts
  const actualProfitLoss = data.amountReceivedFullyPaid - data.amountPaid;
  const actualNetProfit = data.amountReceivedFullyPaid - data.amountPaid - data.totalExpenses;
  const kpiRow2 = [
    {
      label: "Actual Sales",
      value: inr(data.amountReceived),
      icon: ArrowUpRight,
      trend: "Cash Received",
      up: true,
      iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
    },
    {
      label: "Actual Purchases",
      value: inr(data.amountPaid),
      icon: ArrowDownRight,
      trend: "Cash Paid Out",
      up: false,
      iconBg: "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400",
    },
    {
      label: "Actual Profit / Loss",
      value: inr(actualProfitLoss),
      icon: BarChart3,
      trend: "Received − Paid",
      up: actualProfitLoss >= 0,
      iconBg: "bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400",
    },
    {
      label: "Actual Net Profit",
      value: inr(actualNetProfit),
      icon: Banknote,
      trend: "After Expenses",
      up: actualNetProfit >= 0,
      iconBg: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
    },
  ];

  // ── KPI Row 3: Customers / Vendors / Inventory (6 cards) ──
  const kpiRow3 = [
    {
      label: "Customer Payment",
      value: inr(data.amountReceived),
      icon: Users,
      trend: "Received From Customers",
      up: true,
      iconBg: "bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400",
    },
    {
      label: "Customer Due",
      value: inr(data.customerDue),
      icon: Users,
      trend: "Receivables Outstanding",
      up: false,
      iconBg: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
    },
    {
      label: "Vendor Payments",
      value: inr(data.amountPaid),
      icon: Building2,
      trend: "Paid To Vendors",
      up: true,
      iconBg: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-400",
    },
    {
      label: "Vendor Due",
      value: inr(data.vendorDue),
      icon: Building2,
      trend: "Payables Outstanding",
      up: false,
      iconBg: "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400",
    },
    {
      label: "Total Products",
      value: data.products.length.toString(),
      icon: Package,
      trend: `${data.inventoryValue > 0 ? inr(data.inventoryValue) : "£0"} Value`,
      up: true,
      iconBg: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400",
    },
    {
      label: "Stock Quantity",
      value: data.totalStockQty.toLocaleString(),
      icon: Box,
      trend: `${data.lowStock.length} Low · ${data.outOfStock.length} Out`,
      up: data.lowStock.length === 0,
      iconBg: "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400",
    },
  ];

  const staffKpis = [
    {
      label: "Total Sales",
      value: inr(data.totalSales),
      icon: TrendingUp,
      trend: "Invoiced Amount",
      up: true,
      iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
    },
    {
      label: "Customer Due",
      value: inr(data.customerDue),
      icon: Users,
      trend: "Receivables Outstanding",
      up: false,
      iconBg: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
    },
    {
      label: "Total Products",
      value: data.products.length.toString(),
      icon: Package,
      trend: "Products Catalog",
      up: true,
      iconBg: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400",
    },
    {
      label: "Stock Quantity",
      value: data.totalStockQty.toLocaleString(),
      icon: Box,
      trend: `${data.lowStock.length} Low · ${data.outOfStock.length} Out`,
      up: data.lowStock.length === 0,
      iconBg: "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400",
    },
  ];

  const isDirty =
    fromDate !== appliedFrom || toDate !== appliedTo;

  return (
    <div className="space-y-4">
      {/* ── Page Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" className="h-9">
            <Link to="/purchases/new">
              <ShoppingCart className="h-4 w-4 mr-1" /> New Purchase
            </Link>
          </Button>
          <Button asChild size="sm" className="h-9">
            <Link to="/invoices/new">
              <Plus className="h-4 w-4 mr-1" /> New Sale
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Filter Bar ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border bg-card shadow-sm">
        {/* Date Range Display + Inputs */}
        <div className="flex items-center gap-1.5 bg-muted/60 border rounded-lg px-3 py-1.5 text-sm min-w-0">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground text-xs hidden sm:inline truncate">
            {formatDateRange(appliedFrom, appliedTo)}
          </span>
        </div>

        {/* From Date */}
        <div className="flex items-center gap-1">
          <label className="text-xs text-muted-foreground whitespace-nowrap">From</label>
          <input
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-8 rounded-lg border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 w-36 cursor-pointer"
          />
        </div>

        {/* To Date */}
        <div className="flex items-center gap-1">
          <label className="text-xs text-muted-foreground whitespace-nowrap">To</label>
          <input
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-8 rounded-lg border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 w-36 cursor-pointer"
          />
        </div>

        {/* Quick Range Presets */}
        <div className="flex items-center gap-1">
          {[
            { label: "This Month", getRange: () => [firstOfMonthISO(), todayISO()] },
            {
              label: "Last Month",
              getRange: () => {
                const d = new Date();
                const first = toLocalDateString(new Date(d.getFullYear(), d.getMonth() - 1, 1));
                const last = toLocalDateString(new Date(d.getFullYear(), d.getMonth(), 0));
                return [first, last];
              },
            },
            {
              label: "Last 3 Months",
              getRange: () => {
                const d = new Date();
                const first = toLocalDateString(new Date(d.getFullYear(), d.getMonth() - 2, 1));
                return [first, todayISO()];
              },
            },
            {
              label: "This Year",
              getRange: () => {
                const y = new Date().getFullYear();
                return [`${y}-01-01`, todayISO()];
              },
            },
          ].map(({ label, getRange }) => {
            const [f, t] = getRange();
            const isActive = appliedFrom === f && appliedTo === t;
            return (
              <button
                key={label}
                onClick={() => {
                  setFromDate(f);
                  setToDate(t);
                  setAppliedFrom(f);
                  setAppliedTo(t);
                  setFilterActive(
                    f !== firstOfMonthISO() || t !== todayISO(),
                  );
                }}
                className={`h-8 px-2.5 rounded-lg text-xs font-medium border transition-all cursor-pointer whitespace-nowrap ${isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                  }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-border hidden sm:block" />

        {/* Filter Button */}
        <Button
          size="sm"
          onClick={applyFilter}
          disabled={!isDirty}
          className="h-8 px-3 text-xs gap-1.5"
        >
          <Filter className="h-3.5 w-3.5" />
          Filter
        </Button>

        {/* Reset Button */}
        <Button
          size="sm"
          variant="outline"
          onClick={resetFilter}
          className={`h-8 px-3 text-xs gap-1.5 transition-all ${filterActive ? "border-primary text-primary hover:bg-primary/10" : ""}`}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>

        {/* Active filter badge */}
        {filterActive && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Filtered
          </span>
        )}
      </div>

      {/* ── KPI Rows ────────────────────────────────────────── */}
      {isStaff ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {staffKpis.map((s) => (
            <Card key={s.label} className="col-span-1 overflow-hidden border hover:shadow-md transition-all hover:-translate-y-0.5">
              <CardContent className="p-4">
                <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ${s.iconBg}`}>
                  <s.icon className="h-4.5 w-4.5" />
                </div>
                <div className="text-xs text-muted-foreground leading-tight font-medium mb-0.5">{s.label}</div>
                <div className="text-base font-bold tracking-tight">{s.value}</div>
                <div className={`text-[11px] mt-1.5 flex items-center gap-0.5 font-medium ${s.up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
                  {s.up ? <ArrowUpRight className="h-3 w-3 shrink-0" /> : <ArrowDownRight className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{s.trend}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {/* ── KPI Row 1: Core Financial Totals (7 cards) ──────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {kpiRow1.map((s) => (
              <Card key={s.label} className="col-span-1 overflow-hidden border hover:shadow-md transition-all hover:-translate-y-0.5">
                <CardContent className="p-4">
                  <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ${s.iconBg}`}>
                    <s.icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="text-xs text-muted-foreground leading-tight font-medium mb-0.5">{s.label}</div>
                  <div className="text-base font-bold tracking-tight">{s.value}</div>
                  <div className={`text-[11px] mt-1.5 flex items-center gap-0.5 font-medium ${s.up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
                    {s.up ? <ArrowUpRight className="h-3 w-3 shrink-0" /> : <ArrowDownRight className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{s.trend}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── KPI Row 2: Actual / Cash-Basis Metrics (4 cards) ─── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
            {kpiRow2.map((s) => (
              <Card key={s.label} className="col-span-1 overflow-hidden border hover:shadow-md transition-all hover:-translate-y-0.5">
                <CardContent className="p-4">
                  <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ${s.iconBg}`}>
                    <s.icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="text-xs text-muted-foreground leading-tight font-medium mb-0.5">{s.label}</div>
                  <div className="text-base font-bold tracking-tight">{s.value}</div>
                  <div className={`text-[11px] mt-1.5 flex items-center gap-0.5 font-medium ${s.up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
                    {s.up ? <ArrowUpRight className="h-3 w-3 shrink-0" /> : <ArrowDownRight className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{s.trend}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── KPI Row 3: Customer / Vendor / Inventory (6 cards) ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpiRow3.map((s) => (
              <Card key={s.label} className="col-span-1 overflow-hidden border hover:shadow-md transition-all hover:-translate-y-0.5">
                <CardContent className="p-4">
                  <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ${s.iconBg}`}>
                    <s.icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="text-xs text-muted-foreground leading-tight font-medium mb-0.5">{s.label}</div>
                  <div className="text-base font-bold tracking-tight">{s.value}</div>
                  <div className={`text-[11px] mt-1.5 flex items-center gap-0.5 font-medium ${s.up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
                    {s.up ? <ArrowUpRight className="h-3 w-3 shrink-0" /> : <ArrowDownRight className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{s.trend}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* ── Charts Row: Performance + Top By ────────────────── */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Monthly Business Performance */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm font-semibold">
                Monthly Business Performance
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex rounded-md overflow-hidden border text-[11px] bg-background shadow-sm">
                  {(["Total", "Actual"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setChartMode(mode)}
                      type="button"
                      className={`px-2.5 py-1 transition-all font-medium cursor-pointer ${chartMode === mode
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-background text-muted-foreground hover:bg-muted"
                        }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-md whitespace-nowrap">
                  Jan - Dec {new Date(appliedTo).getFullYear()}
                </span>
              </div>
            </div>
            <div className="flex items-center flex-wrap gap-3 text-[11px] text-muted-foreground mt-2">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" />
                Net Sales
              </span>
              {!isStaff && (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm bg-rose-500" />
                    Purchases
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm bg-amber-400" />
                    Expenses
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-8 h-0.5 rounded"
                      style={{ background: "#10b981" }}
                    />
                    Net Profit
                  </span>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="h-56 px-2 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data.months}
                margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="currentColor"
                  className="text-border opacity-50"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v: number) => inr(v)}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--card-foreground)",
                  }}
                />
                <Bar
                  dataKey="Net Sales"
                  fill="#3b82f6"
                  radius={[3, 3, 0, 0]}
                  barSize={12}
                />
                {!isStaff && (
                  <Bar
                    dataKey="Purchases"
                    fill="#f43f5e"
                    radius={[3, 3, 0, 0]}
                    barSize={12}
                  />
                )}
                {!isStaff && (
                  <Bar
                    dataKey="Expenses"
                    fill="#f59e0b"
                    radius={[3, 3, 0, 0]}
                    barSize={12}
                  />
                )}
                {!isStaff && (
                  <Line
                    dataKey="Net Profit"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#10b981", strokeWidth: 0 }}
                    type="monotone"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top By Panel */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Top By</CardTitle>
              <div className="flex rounded-md overflow-hidden border text-[11px]">
                {TABS.filter(t => !isStaff || t !== "Vendors").map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-2.5 py-1 transition-colors font-medium cursor-pointer ${activeTab === tab
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                      }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-56 px-2 pb-2">
            {topByData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <BarChart3 className="h-8 w-8 opacity-30" />
                <p className="text-sm">No data for this period</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topByData}
                  layout="vertical"
                  margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
                >
                  <XAxis
                    type="number"
                    tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={85}
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v: number) => inr(v)}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      color: "var(--card-foreground)",
                    }}
                  />
                  <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Middle Row: Cashflow + Outstanding + Inventory + Low Stock ── */}
      <div className={`grid gap-4 ${isStaff ? "lg:grid-cols-2" : "lg:grid-cols-4"}`}>
        {!isStaff && (
          <>
            {/* Cash Flow Overview */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">
                  Cash Flow Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 flex flex-col items-center">
                <div className="relative h-36 w-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={cashFlowData}
                        cx="50%"
                        cy="50%"
                        innerRadius={46}
                        outerRadius={65}
                        startAngle={90}
                        endAngle={-270}
                        dataKey="value"
                        stroke="none"
                      >
                        <Cell fill="#10b981" />
                        <Cell fill="#f43f5e" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="text-[9px] text-muted-foreground leading-tight text-center">
                      Net Cash Flow
                    </div>
                    <div
                      className={`text-[13px] font-bold leading-tight text-center ${data.netCashFlow >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}
                    >
                      {inr(data.netCashFlow)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 w-full space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
                      Cash In (Received)
                    </span>
                    <span className="font-semibold">{inr(data.cashIn)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shrink-0" />
                      Cash Out (Paid)
                    </span>
                    <span className="font-semibold">{inr(data.cashOut)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Outstanding Summary */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">
                  Outstanding Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <div className="flex items-center justify-between py-2.5 border-b">
                  <div className="text-xs text-muted-foreground leading-tight">
                    Customer Due
                    <br />
                    <span className="text-[10px]">(Receivables)</span>
                  </div>
                  <div className="text-sm font-bold text-orange-600 dark:text-orange-400">
                    {inr(data.customerDue)}
                  </div>
                </div>
                <div className="flex items-center justify-between py-2.5 border-b">
                  <div className="text-xs text-muted-foreground leading-tight">
                    Vendor Due
                    <br />
                    <span className="text-[10px]">(Payables)</span>
                  </div>
                  <div className="text-sm font-bold text-rose-600 dark:text-rose-400">
                    {inr(data.vendorDue)}
                  </div>
                </div>
                <div className="flex items-center justify-between py-2.5 bg-muted/60 rounded-lg px-3 -mx-1 mt-2">
                  <div className="text-sm font-semibold">Net Position</div>
                  <div
                    className={`text-sm font-bold ${data.customerDue - data.vendorDue >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                  >
                    {inr(data.customerDue - data.vendorDue)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Inventory Snapshot */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">
              Inventory Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1">
            <div className="flex items-center justify-between py-2 border-b">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Package className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                Inventory Value
              </div>
              <div className="text-sm font-bold">{inr(data.inventoryValue)}</div>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                Total Products
              </div>
              <div className="text-sm font-bold">{data.products.length}</div>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                Low Stock Items
              </div>
              <div className="text-sm font-bold text-amber-600 dark:text-amber-400">
                {data.lowStock.length}
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                Out of Stock Items
              </div>
              <div className="text-sm font-bold text-rose-600 dark:text-rose-400">
                {data.outOfStock.length}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Low Stock Alerts */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                Low Stock Alerts
              </CardTitle>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2 text-blue-600 hover:text-blue-700"
              >
                <Link to="/inventory">View all</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1">
            {data.lowStock.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
                <Package className="h-8 w-8 opacity-30" />
                <p className="text-xs">All products well stocked</p>
              </div>
            ) : (
              data.lowStock.slice(0, 4).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {p.category}
                    </div>
                  </div>
                  <Badge
                    variant="destructive"
                    className="text-[10px] px-1.5 py-0 ml-2 shrink-0 whitespace-nowrap"
                  >
                    Stock: {p.stock} left
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Balance Row: Financial Summary & Sales Ledger Table ── */}
      {!isStaff && (
        <Card className="overflow-hidden border shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4 bg-muted/20">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Financial Summary & Sales Ledger
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b bg-muted/40 font-semibold text-muted-foreground">
                    <th className="px-4 py-3 text-left">Method</th>
                    <th className="px-4 py-3 text-right">Actual</th>
                    <th className="px-4 py-3 text-right">Vendor</th>
                    <th className="px-4 py-3 text-right">Final Cost</th>
                    <th className="px-4 py-3 text-right">Profit / Loss</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3 font-medium flex items-center gap-2 whitespace-nowrap">
                      <Banknote className="h-4 w-4 text-emerald-500 shrink-0" />
                      Cash
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{inr(data.cashInHand)}</td>
                    <td className="px-4 py-3 text-right font-medium text-rose-500 dark:text-rose-400 whitespace-nowrap">
                      <div>{inr(data.vendorCashBalance)}</div>
                      <div className="text-[9px] text-muted-foreground font-normal">
                        Total: -{inr(data.vendorCashTotal)} | Paid: +{inr(data.vendorCashPaid)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{inr(data.salesCashCost)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${data.salesCashPL >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {inr(data.salesCashPL)}
                    </td>
                  </tr>
                  <tr className="border-b hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3 font-medium flex items-center gap-2 whitespace-nowrap">
                      <CreditCard className="h-4 w-4 text-blue-500 shrink-0" />
                      Bank
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{inr(data.bankBalance)}</td>
                    <td className="px-4 py-3 text-right font-medium text-rose-500 dark:text-rose-400 whitespace-nowrap">
                      <div>{inr(data.vendorBankBalance)}</div>
                      <div className="text-[9px] text-muted-foreground font-normal">
                        Total: -{inr(data.vendorBankTotal)} | Paid: +{inr(data.vendorBankPaid)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{inr(data.salesBankCost)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${data.salesBankPL >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {inr(data.salesBankPL)}
                    </td>
                  </tr>
                  <tr className="bg-primary/5 dark:bg-primary/15 font-bold border-b last:border-0">
                    <td className="px-4 py-3 flex items-center gap-2 text-foreground">
                      Total
                    </td>
                    <td className="px-4 py-3 text-right text-primary">
                      {inr(data.totalBalance)}
                    </td>
                    <td className="px-4 py-3 text-right text-rose-600 dark:text-rose-500">
                      {inr(data.vendorCashBalance + data.vendorBankBalance)}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {inr(data.salesCashCost + data.salesBankCost)}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${(data.salesCashPL + data.salesBankPL) >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-rose-600 dark:text-rose-500"}`}>
                      {inr(data.salesCashPL + data.salesBankPL)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Bottom Row: Recent Sales + Recent Purchases ── */}
      <div className={`grid gap-4 ${isStaff ? "grid-cols-1" : "lg:grid-cols-2"}`}>
        {/* Recent Sales */}
        <Card className={isStaff ? "col-span-1" : ""}>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                Recent Sales
              </CardTitle>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2 text-blue-600 hover:text-blue-700"
              >
                <Link to="/invoices">View all</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {data.recent.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                <FileText className="h-8 w-8 opacity-30" />
                <p className="text-sm">No sales in this period.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        Invoice #
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        Customer
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">
                        Date
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                        Amount
                      </th>
                      <th className="px-3 py-2 text-center font-medium text-muted-foreground">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((inv) => (
                      <tr
                        key={inv.id}
                        className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                      >
                        <td className="px-3 py-2 font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">
                          {inv.number}
                        </td>
                        <td className="px-3 py-2 max-w-[90px] truncate">
                          {inv.customerName}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                          {fmtDate(inv.date)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                          {inr(inv.grandTotal)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Badge
                            variant={
                              (inv.paymentStatus || "").toLowerCase() === "paid"
                                ? "default"
                                : (inv.paymentStatus || "").toLowerCase() === "partial"
                                  ? "secondary"
                                  : "destructive"
                            }
                            className="text-[10px] px-1.5 py-0 capitalize"
                          >
                            {(inv.paymentStatus || "").toLowerCase() === "pending"
                              ? "Unpaid"
                              : inv.paymentStatus}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Purchases */}
        {!isStaff && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  Recent Purchases
                </CardTitle>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs px-2 text-blue-600 hover:text-blue-700"
                >
                  <Link to="/purchases">View all</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {data.recentPurchases.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                  <ShoppingCart className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No purchases in this period.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          Bill #
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          Vendor
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">
                          Date
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                          Amount
                        </th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentPurchases.map((p) => (
                        <tr
                          key={p.id}
                          className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-3 py-2 font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">
                            {p.number}
                          </td>
                          <td className="px-3 py-2 max-w-[90px] truncate">
                            {p.vendorName}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                            {fmtDate(p.date)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                            {inr(p.grandTotal)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Badge
                              variant={
                                p.paymentStatus === "paid"
                                  ? "default"
                                  : p.paymentStatus === "partial"
                                    ? "secondary"
                                    : "destructive"
                              }
                              className="text-[10px] px-1.5 py-0 capitalize"
                            >
                              {p.paymentStatus === "pending"
                                ? "Unpaid"
                                : p.paymentStatus}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
