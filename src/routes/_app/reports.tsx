import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { store, onStoreChange } from "@/lib/storage";
import { inr, fmtDate, getCurrencySymbol, getLocalTodayISO, getLocalFirstOfMonthISO } from "@/lib/format";
import { Download } from "lucide-react";
import { toast } from "sonner";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

export const Route = createFileRoute("/_app/reports")({
  beforeLoad: () => {
    const s = store.getSession();
    if (!s || (s.role !== "admin" && s.role !== "accountant")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Reports • Smart Invoice" }] }),
});

async function exportExcel(rows: (string | number)[][], filename: string) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Report");

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

function ReportsPage() {
  const today = getLocalTodayISO();
  const firstOfMonth = getLocalFirstOfMonthISO();
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);

  const invoices = store.invoices();
  const purchases = store.purchaseBills();
  const products = store.products();

  const [tick, setTick] = useState(0);
  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);

  const stockSummary = useMemo(() => {
    // We want to calculate:
    // Closing Balance (at 'to' date) = currentStock - (received > to) + (issued > to)
    // Period Received = received between 'from' and 'to'
    // Period Issued = issued between 'from' and 'to'
    // Opening Balance = Closing Balance - Period Received + Period Issued

    const map = new Map(
      products.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          currentStock: p.stock,
          minStock: p.reorderLevel,
          futureReceived: 0,
          futureIssued: 0,
          periodReceived: 0,
          periodIssued: 0,
        },
      ]),
    );

    // Track future and period issues (Sales)
    invoices.forEach((inv) => {
      const invDate = (inv.date || "").slice(0, 10);
      if (invDate > to) {
        inv.items.forEach((it) => {
          const st = map.get(it.productId);
          if (st) st.futureIssued += it.qty;
        });
      } else if (invDate >= from) {
        inv.items.forEach((it) => {
          const st = map.get(it.productId);
          if (st) st.periodIssued += it.qty;
        });
      }
    });

    // Track future and period receipts (Purchases)
    purchases.forEach((pur) => {
      const purDate = (pur.date || "").slice(0, 10);
      if (purDate > to) {
        pur.items.forEach((it) => {
          const st = map.get(it.productId);
          if (st) st.futureReceived += it.qty;
        });
      } else if (purDate >= from) {
        pur.items.forEach((it) => {
          const st = map.get(it.productId);
          if (st) st.periodReceived += it.qty;
        });
      }
    });

    return Array.from(map.values()).map((st) => {
      const closing = st.currentStock - st.futureReceived + st.futureIssued;
      const opening = closing - st.periodReceived + st.periodIssued;
      let status = "In Stock";
      if (closing <= 0) status = "Out of Stock";
      else if (closing <= st.minStock) status = "Low Stock";

      return {
        ...st,
        opening,
        closing,
        status,
      };
    });
  }, [products, invoices, purchases, from, to, tick]);

  const filtered = useMemo(() => {
    const inv = invoices.filter((i) => (i.date || "").slice(0, 10) >= from && (i.date || "").slice(0, 10) <= to);
    const pur = purchases.filter((p) => (p.date || "").slice(0, 10) >= from && (p.date || "").slice(0, 10) <= to);
    return { inv, pur };
  }, [invoices, purchases, from, to, tick]);

  // ── Sales Summary ────────────────────────────────────────────────────────
  const salesTotal = filtered.inv.reduce((s, i) => s + i.grandTotal, 0);

  const salesSubtotal = filtered.inv.reduce((s, i) => s + i.subtotal, 0);
  const salesPaid = filtered.inv
    .filter((i) => i.paymentStatus === "paid")
    .reduce((s, i) => s + i.grandTotal, 0);
  const salesPending = salesTotal - salesPaid;
  const salesDiscountTotal = filtered.inv.reduce((s, i) => s + (i.discountTotal || 0), 0);
  const salesShippingTotal = filtered.inv.reduce((s, i) => s + (i.shipping || 0), 0);

  // ── Purchase Summary ────────────────────────────────────────────────────
  const purTotal = filtered.pur.reduce((s, p) => s + p.grandTotal, 0);

  const purPaid = filtered.pur
    .filter((p) => p.paymentStatus === "paid")
    .reduce((s, p) => s + p.grandTotal, 0);
  const purPending = purTotal - purPaid;

  // ── Profit/Loss ─────────────────────────────────────────────────────────
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const { salesGrossRevenue, cogs } = useMemo(() => {
    let rev = 0;
    let cost = 0;
    filtered.inv.forEach((inv) => {
      inv.items.forEach((it) => {
        const prod = productMap.get(it.productId);
        const costPrice = prod ? prod.purchasePrice : 0;
        rev += (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
        cost += (Number(it.qty) || 0) * costPrice;
      });
    });
    return { salesGrossRevenue: rev, cogs: cost };
  }, [filtered.inv, productMap]);

  const grossProfit = salesGrossRevenue - cogs;
  const expensesInDateRange = store.expenses().filter((e) => (e.date || "").slice(0, 10) >= from && (e.date || "").slice(0, 10) <= to);
  const expensesTotal = expensesInDateRange.reduce((s, e) => s + e.amount, 0);
  const netProfit = grossProfit - salesDiscountTotal - expensesTotal;

  // ── Monthly Chart ────────────────────────────────────────────────────────
  const monthlyData = useMemo(() => {
    const map = new Map<string, { sales: number; purchases: number }>();
    invoices.forEach((inv) => {
      const m = (inv.date || "").slice(0, 7);
      const cur = map.get(m) ?? { sales: 0, purchases: 0 };
      map.set(m, { ...cur, sales: cur.sales + inv.grandTotal });
    });
    purchases.forEach((pur) => {
      const m = (pur.date || "").slice(0, 7);
      const cur = map.get(m) ?? { sales: 0, purchases: 0 };
      map.set(m, { ...cur, purchases: cur.purchases + pur.grandTotal });
    });
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, v]) => ({
        month: new Date(month + "-01").toLocaleDateString("en-IN", {
          month: "short",
          year: "2-digit",
        }),
        Sales: Math.round(v.sales),
        Purchases: Math.round(v.purchases),
        "Net Profit": Math.round(v.sales - v.purchases),
      }));
  }, [invoices, purchases, tick]);

  // ── Top Customers ────────────────────────────────────────────────────────
  const topCustomers = useMemo(() => {
    const map = new Map<string, number>();
    filtered.inv.forEach((i) =>
      map.set(i.customerName, (map.get(i.customerName) ?? 0) + i.grandTotal),
    );
    return [...map.entries()].sort(([, a], [, b]) => b - a).slice(0, 10);
  }, [filtered.inv, tick]);

  // ── Top Vendors ─────────────────────────────────────────────────────────
  const topVendors = useMemo(() => {
    const map = new Map<string, number>();
    filtered.pur.forEach((p) => map.set(p.vendorName, (map.get(p.vendorName) ?? 0) + p.grandTotal));
    return [...map.entries()].sort(([, a], [, b]) => b - a).slice(0, 10);
  }, [filtered.pur, tick]);

  return (
    <div className="space-y-5">
      {/* Date Range Filter */}
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const y = new Date().getFullYear();
                setFrom(`${y}-01-01`);
                setTo(`${y}-12-31`);
              }}
            >
              This Year
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: "Total Sales", value: inr(salesTotal), color: "text-emerald-600" },
          { label: "Due from Customers", value: inr(salesPending), color: "text-amber-600" },
          { label: "Total Purchases", value: inr(purTotal), color: "text-rose-600" },
          {
            label: "Net Profit",
            value: inr(netProfit),
            color: netProfit >= 0 ? "text-emerald-600" : "text-rose-600",
          },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{kpi.label}</div>
              <div className={`text-lg font-bold ${kpi.color}`}>{kpi.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabbed Reports */}
      <Tabs defaultValue="sales">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="sales">Sales Report</TabsTrigger>
          <TabsTrigger value="purchases">Purchase Report</TabsTrigger>
          <TabsTrigger value="profit">Profit & Loss</TabsTrigger>
          <TabsTrigger value="stock">Stock Summary</TabsTrigger>

          <TabsTrigger value="customers">Top Customers</TabsTrigger>
          <TabsTrigger value="vendors">Top Vendors</TabsTrigger>
        </TabsList>

        {/* ── Sales ──────────────────────────────────────── */}
        <TabsContent value="sales">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Sales Invoices ({filtered.inv.length})</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  exportExcel(
                    [
                      ["Invoice #", "Date", "Customer", "Subtotal", "Discount", "Shipping Fee", "Grand Total", "Status"],
                      ...filtered.inv.map((i) => [
                        i.number,
                        fmtDate(i.date),
                        i.customerName,
                        i.subtotal.toFixed(2),
                        (i.discountTotal || 0).toFixed(2),
                        (i.shipping || 0).toFixed(2),
                        i.grandTotal.toFixed(2),
                        i.paymentStatus,
                      ]),
                    ],
                    "sales-report.xlsx",
                  )
                }
              >
                <Download className="h-4 w-4" /> Export Excel
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Shipping Fee</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.inv.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        No invoices in this date range.
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.inv.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono text-sm">{i.number}</TableCell>
                      <TableCell>{fmtDate(i.date)}</TableCell>
                      <TableCell>{i.customerName}</TableCell>
                      <TableCell className="text-right">{inr(i.subtotal)}</TableCell>
                      <TableCell className="text-right text-rose-600">
                        {i.discountTotal && i.discountTotal > 0 ? `-${inr(i.discountTotal)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600">
                        {i.shipping && i.shipping > 0 ? inr(i.shipping) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {inr(i.grandTotal)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            i.paymentStatus === "paid"
                              ? "default"
                              : i.paymentStatus === "partial"
                                ? "secondary"
                                : "destructive"
                          }
                          className="capitalize"
                        >
                          {i.paymentStatus === "pending" ? "not paid" : i.paymentStatus}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.inv.length > 0 && (
                <div className="flex justify-end gap-6 p-4 border-t text-sm font-semibold flex-wrap">
                  <span>Subtotal: {inr(salesSubtotal)}</span>
                  <span>Discount: -{inr(salesDiscountTotal)}</span>
                  <span>Shipping: {inr(salesShippingTotal)}</span>
                  <span>Total: {inr(salesTotal)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Purchases ─────────────────────────────────── */}
        <TabsContent value="purchases">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Purchase Bills ({filtered.pur.length})</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  exportExcel(
                    [
                      ["Bill #", "Date", "Vendor", "Subtotal", "Grand Total", "Status"],
                      ...filtered.pur.map((p) => [
                        p.number,
                        fmtDate(p.date),
                        p.vendorName,
                        p.subtotal.toFixed(2),
                        p.subtotal.toFixed(2),
                        p.grandTotal.toFixed(2),
                        p.paymentStatus,
                      ]),
                    ],
                    "purchase-report.xlsx",
                  )
                }
              >
                <Download className="h-4 w-4" /> Export Excel
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bill #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>

                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.pur.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No purchases in this date range.
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.pur.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm">{p.number}</TableCell>
                      <TableCell>{fmtDate(p.date)}</TableCell>
                      <TableCell>{p.vendorName}</TableCell>
                      <TableCell className="text-right">{inr(p.subtotal)}</TableCell>

                      <TableCell className="text-right font-semibold">
                        {inr(p.grandTotal)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            p.paymentStatus === "paid"
                              ? "default"
                              : p.paymentStatus === "partial"
                                ? "secondary"
                                : "destructive"
                          }
                          className="capitalize"
                        >
                          {p.paymentStatus === "pending" ? "not paid" : p.paymentStatus}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.pur.length > 0 && (
                <div className="flex justify-end gap-6 p-4 border-t text-sm font-semibold">
                  <span>Subtotal: {inr(filtered.pur.reduce((s, p) => s + p.subtotal, 0))}</span>

                  <span>Total: {inr(purTotal)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Profit & Loss ─────────────────────────────── */}
        <TabsContent value="profit">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profit & Loss Statement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="max-w-sm space-y-3">
                {[
                  { label: "Total Revenue (Sales)", value: salesGrossRevenue, positive: true },
                  { label: "Total COGS (Cost of Goods Sold)", value: cogs, positive: false },
                  { label: "Gross Profit", value: grossProfit, positive: grossProfit >= 0 },
                  { label: "Invoice Discounts", value: salesDiscountTotal, positive: false },
                  { label: "Operating Expenses", value: expensesTotal, positive: false },
                  { label: "Net Profit / Loss", value: netProfit, positive: netProfit >= 0 },
                ].map(({ label, value, positive }) => (
                  <div
                    key={label}
                    className="flex justify-between py-2 border-b last:border-0 last:font-bold last:text-base"
                  >
                    <span className="text-sm">{label}</span>
                    <span className={positive ? "text-emerald-600" : "text-rose-600"}>
                      {inr(value)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-4">
                <h3 className="text-sm font-medium mb-3">Revenue Trend</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(v) => `${getCurrencySymbol()}${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => inr(v)} />
                      <Line
                        type="monotone"
                        dataKey="Sales"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Purchases"
                        stroke="#f43f5e"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Net Profit"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Top Customers ─────────────────────────────── */}
        <TabsContent value="customers">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Customers by Revenue</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Total Purchased</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCustomers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                        No data.
                      </TableCell>
                    </TableRow>
                  )}
                  {topCustomers.map(([name, total], i) => (
                    <TableRow key={name}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="text-right font-semibold">{inr(total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Top Vendors ───────────────────────────────── */}
        <TabsContent value="vendors">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Vendors by Purchase Volume</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Total Purchased</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topVendors.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                        No data.
                      </TableCell>
                    </TableRow>
                  )}
                  {topVendors.map(([name, total], i) => (
                    <TableRow key={name}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="text-right font-semibold">{inr(total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Stock Summary ───────────────────────────────── */}
        <TabsContent value="stock">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Stock Summary ({stockSummary.length})</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  exportExcel(
                    [
                      [
                        "Sr. No",
                        "Product Name",
                        "Opening Balance",
                        "Received Qty",
                        "Issued Qty",
                        "Closing Balance Qty",
                        "Stock Status",
                      ],
                      ...stockSummary.map((s, i) => [
                        String(i + 1),
                        s.name,
                        String(s.opening),
                        String(s.periodReceived),
                        String(s.periodIssued),
                        String(s.closing),
                        s.status,
                      ]),
                    ],
                    "stock-summary.xlsx",
                  )
                }
              >
                <Download className="h-4 w-4" /> Export Excel
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Sr. No</TableHead>
                    <TableHead>Product Name</TableHead>
                    <TableHead className="text-right">Opening Balance</TableHead>
                    <TableHead className="text-right">Received Qty</TableHead>
                    <TableHead className="text-right">Issued Qty</TableHead>
                    <TableHead className="text-right">Closing Balance</TableHead>
                    <TableHead>Stock Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockSummary.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No products in inventory.
                      </TableCell>
                    </TableRow>
                  )}
                  {stockSummary.map((s, i) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right">{s.opening}</TableCell>
                      <TableCell className="text-right">{s.periodReceived}</TableCell>
                      <TableCell className="text-right">{s.periodIssued}</TableCell>
                      <TableCell className="text-right font-semibold">{s.closing}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            s.status === "In Stock"
                              ? "default"
                              : s.status === "Low Stock"
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {s.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
