import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { onStoreChange, store } from "@/lib/storage";
import { uid, getCurrencySymbol, inr, toLocalDateString, getLocalTodayISO } from "@/lib/format";
import { syncToAppsScript } from "@/lib/api";
import type { PurchaseBill, PurchaseBillItem, Vendor, PaymentTransaction } from "@/lib/types";
import { Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { logActivity } from "@/lib/activity";

export const Route = createFileRoute("/_app/purchases/new")({
  component: NewPurchasePage,
  head: () => ({ meta: [{ title: "New Purchase Bill • Smart Invoice" }] }),
});

const emptyItem = (): PurchaseBillItem => ({
  productId: "",
  name: "",
  qty: 1,
  unitPrice: 0,
});

function calcTotals(items: any[]) {
  let subtotal = 0;
  for (const it of items) {
    const base = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
    subtotal += base;
  }
  return { subtotal, grandTotal: subtotal };
}

function NewPurchasePage() {
  const nav = useNavigate();
  const settings = store.getSettings();
  const [tick, setTick] = useState(0);

  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);

  const vendors = useMemo(() => store.vendors(), [tick]);
  const products = useMemo(() => store.products(), [tick]);

  const [date, setDate] = useState(getLocalTodayISO());
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return toLocalDateString(d);
  });
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorPhone, setVendorPhone] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");

  const [vendorAddress, setVendorAddress] = useState("");
  const [vendorCity, setVendorCity] = useState("");
  const [vendorCountry, setVendorCountry] = useState("");
  const [vendorPostcode, setVendorPostcode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "pending" | "partial">("pending");
  const [amountPaid, setAmountPaid] = useState<string | number>("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<any[]>([emptyItem()]);
  const [partyInvoiceNumber, setPartyInvoiceNumber] = useState("");

  const selectVendor = (id: string) => {
    setSelectedVendorId(id);
    if (id === "__manual__") {
      setVendorName("");
      setVendorPhone("");
      setVendorEmail("");

      setVendorAddress("");
      setVendorCity("");
      setVendorCountry("");
      setVendorPostcode("");
      return;
    }
    const v = vendors.find((x) => x.id === id);
    if (!v) return;
    setVendorName(v.name);
    setVendorPhone(v.phone);
    setVendorEmail(v.email);

    setVendorAddress(v.address);
    setVendorCity(v.city ?? "");
    setVendorCountry(v.country ?? "");
    setVendorPostcode(v.postcode ?? "");
  };

  const setItem = (i: number, patch: any) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const selectProduct = (i: number, productId: string) => {
    if (productId === "__manual__") {
      setItem(i, { productId: "", name: "", qty: 1, unitPrice: 0 });
      return;
    }
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setItem(i, {
      productId: p.id,
      name: p.name,
      qty: 1,
      unitPrice: p.purchasePrice,
    });
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const it of items) {
      const base = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
      subtotal += base;
    }
    return { subtotal, grandTotal: subtotal };
  }, [items]);

  const { subtotal, grandTotal } = totals;

  const { actualAmountPaid, balanceDue } = useMemo(() => {
    let paid = 0;
    if (paymentStatus === "paid") {
      paid = grandTotal;
    } else if (paymentStatus === "pending") {
      paid = 0;
    } else if (paymentStatus === "partial") {
      paid = Number(amountPaid) || 0;
    }
    return { actualAmountPaid: paid, balanceDue: Math.max(0, grandTotal - paid) };
  }, [grandTotal, paymentStatus, amountPaid]);

  const save = () => {
    if (!vendorName.trim()) return toast.error("Vendor name is required");
    if (items.some((it) => !it.name.trim())) return toast.error("All items need a name");
    if (items.some((it) => (Number(it.qty) || 0) <= 0)) return toast.error("Quantity must be > 0");

    if (paymentStatus === "partial") {
      const paid = Number(amountPaid) || 0;
      if (paid <= 0) {
        return toast.error("Amount paid must be greater than 0 for partial payment");
      }
      if (paid >= grandTotal) {
        return toast.error("Partial payment amount must be less than the grand total. Use 'Paid' status for full payment.");
      }
    }

    const number = store.nextPurchaseNumber(settings.purchasePrefix || "PUR");

    const cleanedItems = items.map((it) => ({
      ...it,
      qty: Number(it.qty) || 0,
      unitPrice: Number(it.unitPrice) || 0,
    }));

    const generatedVendorId =
      selectedVendorId && selectedVendorId !== "__manual__" ? selectedVendorId : uid("v_");
    const bill: PurchaseBill = {
      id: uid("b_"),
      number,
      date: date + "T00:00:00.000",
      dueDate: dueDate ? dueDate + "T00:00:00.000" : undefined,
      vendorId: generatedVendorId,
      vendorName,
      vendorPhone,
      vendorEmail,

      vendorAddress: [vendorAddress, vendorCity, vendorCountry, vendorPostcode]
        .filter(Boolean)
        .join(", "),
      items: cleanedItems,
      subtotal,

      grandTotal,
      paymentMethod,
      paymentStatus,
      amountPaid: actualAmountPaid,
      balanceDue,
      notes,
      partyInvoiceNumber,
    };

    // If new manual vendor, upsert to store
    if (!selectedVendorId || selectedVendorId === "__manual__") {
      const newV: Vendor = {
        id: bill.vendorId,
        name: vendorName,
        phone: vendorPhone,
        email: vendorEmail,
        address: vendorAddress,
        city: vendorCity,
        country: vendorCountry,
        postcode: vendorPostcode,
        createdAt: new Date().toISOString(),
      };
      store.saveVendors([newV, ...store.vendors()]);
      void syncToAppsScript({ type: "vendor.upsert", payload: newV });
    }

    // Save the bill
    const allBills = store.purchaseBills();
    store.savePurchaseBills([bill, ...allBills]);

    // Record initial payment in payments store if any amount is paid
    if (actualAmountPaid > 0) {
      const pms = store.payments();
      const pRec: PaymentTransaction = {
        id: uid("pay_"),
        date: bill.date.split("T")[0],
        referenceId: bill.number,
        type: "Purchase",
        amount: actualAmountPaid,
        method: bill.paymentMethod,
      };
      pms.unshift(pRec);
      store.savePayments(pms);
      void syncToAppsScript({ type: "payment.create", payload: pRec });
    }

    // Update inventory stock (add purchased quantities)
    const allProducts = store.products();
    cleanedItems.forEach((it) => {
      if (!it.productId) return;
      const idx = allProducts.findIndex((p) => p.id === it.productId);
      if (idx >= 0) allProducts[idx].stock += it.qty;
    });
    store.saveProducts(allProducts);

    // Sync to Apps Script
    void syncToAppsScript({ type: "purchase.create", payload: bill });
    void logActivity("Create", "Purchase", bill.vendorName, bill.number, `Created purchase bill for ${inr(bill.grandTotal)} (${bill.paymentStatus})`);

    toast.success(`Purchase bill ${number} saved!`);
    nav({ to: "/purchases" });
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="grid gap-4 md:grid-cols-3">
        {/* Vendor Details */}
        <div className="md:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Vendor Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Select Vendor</Label>
                <Select value={selectedVendorId} onValueChange={selectVendor}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose vendor or enter manually…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__manual__">— Enter manually —</SelectItem>
                    {vendors.filter(v => v.id && v.id.trim() !== "").map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Vendor Name *</Label>
                <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={vendorPhone} onChange={(e) => setVendorPhone(e.target.value)} />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={vendorEmail}
                  onChange={(e) => setVendorEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Vendor Address</Label>
                <Textarea
                  rows={2}
                  value={vendorAddress}
                  onChange={(e) => setVendorAddress(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>City</Label>
                <Input value={vendorCity} onChange={(e) => setVendorCity(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Country</Label>
                <Input value={vendorCountry} onChange={(e) => setVendorCountry(e.target.value)} />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Postcode</Label>
                <Input value={vendorPostcode} onChange={(e) => setVendorPostcode(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bill Dates */}
        <div className="md:col-span-1">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Bill Dates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Bill Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Party Invoice Number</Label>
                <Input
                  placeholder="e.g. INV-9988"
                  value={partyInvoiceNumber}
                  onChange={(e) => setPartyInvoiceNumber(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Items Purchased */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Items Purchased</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
            <Plus className="h-4 w-4" /> Add Item
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Product</TableHead>
                  <TableHead className="w-24">Qty</TableHead>
                  <TableHead className="w-32">Unit Price</TableHead>
                  <TableHead className="text-right w-32">Amount</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, i) => {
                  const total = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
                  const prod = products.find((x) => x.id === it.productId);
                  return (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="flex flex-col gap-1.5">
                          <Select
                            value={it.productId || "__manual__"}
                            onValueChange={(v) => selectProduct(i, v)}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Select Product">
                                {prod ? prod.name : undefined}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__manual__">— Manual entry —</SelectItem>
                              {products.filter(p => p.id && p.id.trim() !== "").map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name} — Cost: {inr(p.purchasePrice)} (Stock: {p.stock})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {/* If manual entry is selected, show item name text field */}
                          {(!it.productId || it.productId === "") && (
                            <Input
                              className="h-8"
                              placeholder="Enter manual product name"
                              value={it.name}
                              onChange={(e) => setItem(i, { name: e.target.value })}
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          className="h-8"
                          value={it.qty}
                          onChange={(e) => setItem(i, { qty: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          className="h-8"
                          value={it.unitPrice}
                          onChange={(e) => setItem(i, { unitPrice: e.target.value })}
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {inr(total)}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                          disabled={items.length === 1}
                        >
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Stacked Card View */}
          <div className="block sm:hidden space-y-4 p-4">
            {items.map((it, i) => {
              const total = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
              const prod = products.find((x) => x.id === it.productId);
              return (
                <div key={i} className="p-4 border rounded-lg space-y-3 bg-card relative">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-2 top-2 h-8 w-8 text-rose-600"
                    onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={items.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <div className="space-y-1 pr-6">
                    <Label className="text-xs">Product</Label>
                    <Select
                      value={it.productId || "__manual__"}
                      onValueChange={(v) => selectProduct(i, v)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select Product">
                          {prod ? prod.name : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__manual__">— Manual entry —</SelectItem>
                        {products.filter(p => p.id && p.id.trim() !== "").map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} — Cost: {inr(p.purchasePrice)} (Stock: {p.stock})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(!it.productId || it.productId === "") && (
                      <Input
                        className="h-9 mt-1"
                        placeholder="Enter manual product name"
                        value={it.name}
                        onChange={(e) => setItem(i, { name: e.target.value })}
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        className="h-9"
                        value={it.qty}
                        onChange={(e) => setItem(i, { qty: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Unit Price</Label>
                      <Input
                        type="number"
                        min={0}
                        className="h-9"
                        value={it.unitPrice}
                        onChange={(e) => setItem(i, { unitPrice: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t text-sm font-semibold">
                    <span>Amount</span>
                    <span>{inr(total)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {/* Payment Details */}
        <div className="md:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Payment Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select
                    value={paymentMethod}
                    onValueChange={setPaymentMethod}
                    disabled={paymentStatus === "pending"}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="N/A" />
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
                <div className="space-y-2">
                  <Label>Payment Status</Label>
                  <Select
                    value={paymentStatus}
                    onValueChange={(v) => {
                      const status = v as typeof paymentStatus;
                      setPaymentStatus(status);
                      if (status === "pending") {
                        setPaymentMethod("");
                      } else if (paymentMethod === "") {
                        setPaymentMethod("Cash");
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="pending">Not Paid</SelectItem>
                      <SelectItem value="partial">Partial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {paymentStatus === "partial" && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Amount Paid</Label>
                    <Input
                      type="number"
                      min={0}
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <div className="space-y-2 pt-2 border-t">
                <Label>Notes (Optional)</Label>
                <Textarea
                  rows={2}
                  placeholder="Any remarks or reference numbers…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Financial Summary & Actions */}
        <div className="md:col-span-1">
          <Card className="h-full flex flex-col justify-between">
            <CardHeader>
              <CardTitle>Financial Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 flex-grow">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{inr(subtotal)}</span>
                </div>

                <div className="flex justify-between text-base font-semibold pt-2 border-t">
                  <span>Grand Total</span>
                  <span className="text-primary font-bold">{inr(grandTotal)}</span>
                </div>

                <div className="flex justify-between text-sm text-emerald-600 font-medium pt-1">
                  <span>Amount Paid</span>
                  <span>{inr(actualAmountPaid)}</span>
                </div>

                <div className={`flex justify-between text-sm font-semibold pt-1 ${balanceDue > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  <span>Balance Due</span>
                  <span>{inr(balanceDue)}</span>
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t">
                <div className="flex flex-col gap-2">
                  <Button onClick={save} className="w-full">
                    <Save className="h-4 w-4 mr-2" /> Save Purchase Bill
                  </Button>
                  <Button variant="outline" onClick={() => nav({ to: "/purchases" })} className="w-full">
                    Cancel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

