import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { inr, uid, toLocalDateString, getLocalTodayISO } from "@/lib/format";
import { syncToAppsScript } from "@/lib/api";
import { autoSendInvoice } from "@/lib/autosend";
import { downloadInvoicePDF } from "@/lib/pdf";
import type { Invoice, InvoiceItem, Customer, PaymentTransaction } from "@/lib/types";
import { Plus, Trash2, Save, FileDown } from "lucide-react";
import { toast } from "sonner";
import { logActivity } from "@/lib/activity";

export const Route = createFileRoute("/_app/invoices/new")({
  validateSearch: (s: Record<string, unknown>): { edit?: string } => ({
    edit: typeof s.edit === "string" ? s.edit : undefined,
  }),
  component: NewInvoice,
  head: () => ({ meta: [{ title: "New Invoice • Smart Invoice" }] }),
});

function NewInvoice() {
  const nav = useNavigate();
  const { edit } = Route.useSearch();
  const settings = store.getSettings();
  const [tick, setTick] = useState(0);

  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);

  const products = useMemo(() => store.products(), [tick]);
  const customers = useMemo(() => store.customers(), [tick]);

  const [date, setDate] = useState(getLocalTodayISO());
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return toLocalDateString(d);
  });
  const [customerId, setCustomerId] = useState<string>("");
  const [customer, setCustomer] = useState<Partial<Customer>>({
    name: "",
    phone: "",
    email: "",
    address: "",
  });
  const [shippingAddr, setShippingAddr] = useState("");
  const [shippingFee, setShippingFee] = useState<string | number>("");
  const [discountPercent, setDiscountPercent] = useState<string | number>("");
  const [items, setItems] = useState<any[]>([
    { productId: "", name: "", qty: 1, unitPrice: 0, discount: 0, purchasePrice: 0 },
  ]);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "pending" | "partial">("paid");
  const [amountPaid, setAmountPaid] = useState<string | number>("");

  const existingInvoices = useMemo(() => store.invoices(), [tick]);

  const invoiceToEdit = useMemo(() => {
    if (!edit) return null;
    return existingInvoices.find((inv) => inv.id === edit || inv.number === edit) || null;
  }, [edit, existingInvoices]);

  useEffect(() => {
    if (invoiceToEdit) {
      setDate(invoiceToEdit.date.slice(0, 10));
      setDueDate(invoiceToEdit.dueDate ? invoiceToEdit.dueDate.slice(0, 10) : "");
      setCustomerId(invoiceToEdit.customerId);
      
      const c = store.customers().find((x) => x.id === invoiceToEdit.customerId);
      setCustomer(c || {
        name: invoiceToEdit.customerName,
        phone: invoiceToEdit.customerPhone,
        email: invoiceToEdit.customerEmail,
        address: invoiceToEdit.billingAddress,
      });

      setShippingAddr(invoiceToEdit.shippingAddress || "");
      setShippingFee(invoiceToEdit.shipping !== undefined ? invoiceToEdit.shipping : "");
      
      let computedDiscountPercent = 0;
      if (invoiceToEdit.discountTotal && invoiceToEdit.subtotal) {
        const gross = invoiceToEdit.subtotal + invoiceToEdit.discountTotal;
        if (gross > 0) {
          computedDiscountPercent = Math.round((invoiceToEdit.discountTotal / gross) * 100 * 100) / 100;
        }
      }
      setDiscountPercent(computedDiscountPercent || "");

      setItems(invoiceToEdit.items.map((it) => ({
        productId: it.productId,
        name: it.name,
        qty: it.qty,
        unitPrice: it.unitPrice,
        discount: it.discount || 0,
        purchasePrice: it.purchasePrice,
      })));

      setPaymentMethod(invoiceToEdit.paymentMethod || "Cash");
      setPaymentStatus(invoiceToEdit.paymentStatus);
      setAmountPaid(invoiceToEdit.amountPaid !== undefined ? invoiceToEdit.amountPaid : "");
    }
  }, [invoiceToEdit]);

  const pickCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c) {
      // Avoid automatically appending city, country, and postcode to customer.address.
      // We also clean up the address if it was saved with duplicates in the past.
      let cleanAddress = c.address || "";
      const parts = [c.city, c.country, c.postcode].filter(Boolean);
      if (parts.length > 0) {
        const suffix1 = `\n${parts.join(", ")}`;
        const suffix2 = `, ${parts.join(", ")}`;
        if (cleanAddress.endsWith(suffix1)) {
          cleanAddress = cleanAddress.slice(0, -suffix1.length);
        } else if (cleanAddress.endsWith(suffix2)) {
          cleanAddress = cleanAddress.slice(0, -suffix2.length);
        }
      }
      setCustomer({ ...c, address: cleanAddress });

      // If any products are already selected, update their prices based on this customer's history
      const pastInvoices = store.invoices().filter((inv) => inv.customerId === id);
      pastInvoices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setItems((prev) =>
        prev.map((it) => {
          if (!it.productId) return it;
          // Find if this customer has a past price for this product
          for (const inv of pastInvoices) {
            const pastItem = inv.items.find((pi) => pi.productId === it.productId);
            if (pastItem) {
              return { ...it, unitPrice: pastItem.unitPrice };
            }
          }
          return it;
        }),
      );
    }
  };

  const setItem = (i: number, patch: any) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };

  const pickProduct = (i: number, pid: string) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return;

    let defaultPrice = p.sellingPrice;

    if (customerId) {
      const pastInvoices = store.invoices().filter((inv) => inv.customerId === customerId);
      pastInvoices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      for (const inv of pastInvoices) {
        const item = inv.items.find((it) => it.productId === pid);
        if (item) {
          defaultPrice = item.unitPrice;
          break;
        }
      }
    }

    setItem(i, { productId: p.id, name: p.name, unitPrice: defaultPrice, purchasePrice: p.purchasePrice });
  };

  const addRow = () =>
    setItems((p) => [...p, { productId: "", name: "", qty: 1, unitPrice: 0, discount: 0, purchasePrice: 0 }]);
  const removeRow = (i: number) => setItems((p) => p.filter((_, idx) => idx !== i));

  const totals = useMemo(() => {
    let grossAmount = 0;
    let totalCost = 0;
    items.forEach((it) => {
      grossAmount += (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
      const itemProduct = products.find((p) => p.id === it.productId);
      const costPrice = it.purchasePrice !== undefined ? Number(it.purchasePrice) || 0 : (itemProduct ? itemProduct.purchasePrice : 0);
      totalCost += (Number(it.qty) || 0) * costPrice;
    });
    const dp = Number(discountPercent) || 0;
    const discountTotal = (grossAmount * dp) / 100;
    const subtotal = grossAmount - discountTotal;
    const sf = Number(shippingFee) || 0;
    const grandTotal = subtotal + sf;
    const profit = grandTotal - totalCost;
    return { grossAmount, discountTotal, subtotal, grandTotal, totalCost, profit };
  }, [items, products, discountPercent, shippingFee]);

  const { actualAmountPaid, balanceDue } = useMemo(() => {
    const grandTotal = totals.grandTotal;
    let paid = 0;
    if (paymentStatus === "paid") {
      paid = grandTotal;
    } else if (paymentStatus === "pending") {
      paid = 0;
    } else if (paymentStatus === "partial") {
      paid = Number(amountPaid) || 0;
    }
    return { actualAmountPaid: paid, balanceDue: Math.max(0, grandTotal - paid) };
  }, [totals.grandTotal, paymentStatus, amountPaid]);


  const validate = () => {
    if (!customer.name?.trim()) return "Customer name required";
    if (items.length === 0) return "Add at least one item";
    if (items.some((it) => !it.name.trim() || Number(it.qty) <= 0 || Number(it.unitPrice) < 0))
      return "Each item needs a name, qty > 0 and valid price";

    const dp = Number(discountPercent) || 0;
    if (dp < 0 || dp > 100) return "Discount must be between 0% and 100%";

    for (const it of items) {
      if (!it.productId) continue;
      const p = products.find((x) => x.id === it.productId);
      if (p) {
        const originalQty = invoiceToEdit
          ? (invoiceToEdit.items.find((oldIt) => oldIt.productId === it.productId)?.qty || 0)
          : 0;
        const availableStock = p.stock + originalQty;
        if ((Number(it.qty) || 0) > availableStock) {
          return `Quantity for "${p.name}" cannot exceed available stock (${availableStock}).`;
        }
      }
    }

    if (paymentStatus === "partial") {
      const paid = Number(amountPaid) || 0;
      if (paid <= 0) {
        return "Amount paid must be greater than 0 for partial payment";
      }
      if (paid >= totals.grandTotal) {
        return "Partial payment amount must be less than the grand total. If fully paid, change status to Paid.";
      }
    }

    return null;
  };

  const buildInvoice = (): Invoice => {
    const isEditMode = !!invoiceToEdit;
    const number = isEditMode ? invoiceToEdit.number : store.nextInvoiceNumber(settings.invoicePrefix || "SAL");
    const grandTotal = totals.grandTotal;
    let finalStatus = paymentStatus;
    let finalMethod = paymentStatus === "pending" ? "" : paymentMethod;

    const cleanedItems = items.map((it) => ({
      ...it,
      qty: Number(it.qty) || 0,
      unitPrice: Number(it.unitPrice) || 0,
      purchasePrice: it.purchasePrice !== undefined ? Number(it.purchasePrice) || 0 : undefined,
    }));

    return {
      id: isEditMode ? invoiceToEdit.id : uid("inv_"),
      number,
      date: date + "T00:00:00.000",
      dueDate: dueDate ? dueDate + "T00:00:00.000" : undefined,
      customerId: customerId || (isEditMode ? invoiceToEdit.customerId : uid("c_")),
      customerName: customer.name!,
      customerPhone: customer.phone ?? "",
      customerEmail: customer.email ?? "",
      billingAddress: [customer.address, customer.city, customer.country, customer.postcode]
        .filter(Boolean)
        .join("\n"),
      shippingAddress: shippingAddr || "",
      items: cleanedItems,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      shipping: Number(shippingFee) || 0,
      grandTotal,
      paymentMethod: finalMethod,
      paymentStatus: finalStatus,
      amountPaid: actualAmountPaid,
      balanceDue,
      invoiceStatus: finalStatus === "paid" ? "paid" : (invoiceToEdit?.invoiceStatus || "draft"),
    };
  };

  const persist = (inv: Invoice) => {
    // Save invoice
    if (invoiceToEdit) {
      store.saveInvoices(store.invoices().map((i) => i.id === inv.id ? inv : i));
    } else {
      store.saveInvoices([inv, ...store.invoices()]);
    }

    // Upsert customer if new
    if (!customerId && customer.name) {
      const newC: Customer = {
        id: inv.customerId,
        name: customer.name,
        phone: customer.phone ?? "",
        email: customer.email ?? "",
        address: customer.address ?? "",
        city: customer.city ?? "",
        country: customer.country ?? "",
        postcode: customer.postcode ?? "",
        createdAt: new Date().toISOString(),
      };
      store.saveCustomers([newC, ...store.customers()]);
      void syncToAppsScript({ type: "customer.upsert", payload: newC });
    }

    // Adjust stock (restore old stock first, then decrement new stock)
    const prods = store.products();
    if (invoiceToEdit) {
      invoiceToEdit.items.forEach((oldIt) => {
        const p = prods.find((x) => x.id === oldIt.productId);
        if (p) {
          p.stock = p.stock + oldIt.qty;
        }
      });
    }
    inv.items.forEach((it) => {
      const p = prods.find((x) => x.id === it.productId);
      if (p) p.stock = Math.max(0, p.stock - it.qty);
    });
    store.saveProducts(prods);

    // Sync affected products to sheet
    const affectedProdIds = new Set([
      ...(invoiceToEdit?.items.map(it => it.productId) || []),
      ...inv.items.map(it => it.productId)
    ]);
    affectedProdIds.forEach((pid) => {
      const p = prods.find((x) => x.id === pid);
      if (p) {
        void syncToAppsScript({ type: "product.upsert", payload: p });
      }
    });

    // Recreate associated payments
    const pms = store.payments();
    let updatedPms = pms;
    if (invoiceToEdit) {
      const associatedPayments = pms.filter((p) => p.referenceId === inv.number);
      associatedPayments.forEach((p) => {
        void syncToAppsScript({ type: "payment.delete", payload: { id: p.id } });
      });
      updatedPms = pms.filter((p) => p.referenceId !== inv.number);
    }
    if (inv.amountPaid && inv.amountPaid > 0) {
      const pSingle: PaymentTransaction = {
        id: uid("pay_"),
        date: inv.date.split("T")[0],
        referenceId: inv.number,
        type: "Sale",
        amount: inv.amountPaid,
        method: paymentMethod,
      };
      updatedPms.unshift(pSingle);
      void syncToAppsScript({ type: "payment.create", payload: pSingle });
    }
    store.savePayments(updatedPms);

    void syncToAppsScript({ type: "invoice.create", payload: inv });
    void logActivity(
      invoiceToEdit ? "Edit" : "Create",
      "Sale",
      inv.customerName,
      inv.number,
      invoiceToEdit
        ? `Updated invoice for ${inr(inv.grandTotal)} (${inv.paymentStatus})`
        : `Created invoice for ${inr(inv.grandTotal)} (${inv.paymentStatus})`
    );
  };

  const save = (alsoPdf: boolean) => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    const inv = buildInvoice();
    persist(inv);
    toast.success(`Invoice ${inv.number} saved`);
    if (alsoPdf) downloadInvoicePDF(inv, settings);

    // Auto-send via WhatsApp / Email if configured
    const currentSettings = store.getSettings();
    if (currentSettings.autoSendWhatsApp || currentSettings.autoSendEmail) {
      toast.loading("Sending invoice automatically…", { id: "autosend" });
      autoSendInvoice(inv, currentSettings).then((results) => {
        toast.dismiss("autosend");
        const anySent = results.whatsapp?.ok || results.email?.ok;
        if (anySent && inv.invoiceStatus !== "paid") {
          // Upgrade invoice status to "sent" in localStorage + sheet
          const updated = { ...inv, invoiceStatus: "sent" as const };
          store.saveInvoices(
            store.invoices().map((i) => (i.id === inv.id ? updated : i))
          );
          void syncToAppsScript({ type: "invoice.create", payload: updated });
        }
        if (results.whatsapp) {
          if (results.whatsapp.ok) {
            toast.success(`✅ WhatsApp sent to ${inv.customerPhone}`);
          } else {
            toast.error(`WhatsApp failed: ${results.whatsapp.error}`);
          }
        }
        if (results.email) {
          if (results.email.ok) {
            const dest = [currentSettings.salesEmail1, currentSettings.salesEmail2].filter(Boolean).join(", ");
            toast.success(`✅ Email sent to ${dest || "sales emails"}`);
          } else {
            toast.error(`Email failed: ${results.email.error}`);
          }
        }
      });
    }

    nav({ to: "/invoices" });
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {invoiceToEdit ? `Edit Sale Invoice: ${invoiceToEdit.number}` : "Create New Sale"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {invoiceToEdit ? "Modify invoice details and save updates." : "Generate a new sales invoice for billing."}
          </p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {/* Customer Details */}
        <div className="md:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Customer Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Select Customer</Label>
                <Select value={customerId} onValueChange={pickCustomer}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select or fill new below" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.filter(c => c.id && c.id.trim() !== "").map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.phone && `• ${c.phone}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={customer.name ?? ""}
                  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={customer.phone ?? ""}
                  onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Billing Address</Label>
                <Textarea
                  rows={2}
                  value={customer.address ?? ""}
                  onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  value={customer.city ?? ""}
                  onChange={(e) => setCustomer({ ...customer, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Input
                  value={customer.country ?? ""}
                  onChange={(e) => setCustomer({ ...customer, country: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Postcode</Label>
                <Input
                  value={customer.postcode ?? ""}
                  onChange={(e) => setCustomer({ ...customer, postcode: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Invoice Dates */}
        <div className="md:col-span-1">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Invoice Dates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Line Items</CardTitle>
          <Button size="sm" variant="outline" onClick={addRow}>
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
                  <TableHead className="w-32">Rate</TableHead>
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
                        <div className="flex flex-col gap-1">
                          <Select value={it.productId} onValueChange={(v) => pickProduct(i, v)}>
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Pick Product">
                                {prod ? prod.name : undefined}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {products.filter(p => p.id && p.id.trim() !== "").map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name} — {inr(p.sellingPrice)} (Stock: {p.stock})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {prod && (
                            <span className="text-xs text-muted-foreground mt-0.5">
                              Stock available: <span className="font-semibold text-emerald-600">{prod.stock}</span>
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          value={it.qty}
                          onChange={(e) => setItem(i, { qty: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          value={it.unitPrice}
                          onChange={(e) => setItem(i, { unitPrice: e.target.value })}
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium">{inr(total)}</TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeRow(i)}
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
                    onClick={() => removeRow(i)}
                    disabled={items.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <div className="space-y-1 pr-6">
                    <Label className="text-xs">Product</Label>
                    <Select value={it.productId} onValueChange={(v) => pickProduct(i, v)}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Pick Product">
                          {prod ? prod.name : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {products.filter(p => p.id && p.id.trim() !== "").map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} — {inr(p.sellingPrice)} (Stock: {p.stock})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {prod && (
                      <span className="text-[11px] text-muted-foreground mt-0.5 block">
                        Stock available: <span className="font-semibold text-emerald-600">{prod.stock}</span>
                      </span>
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
                      <Label className="text-xs">Rate</Label>
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
                  <Label>Payment Status</Label>
                  <Select
                    value={paymentStatus}
                    onValueChange={(v) => {
                      const status = v as "paid" | "pending" | "partial";
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
                <Label>Remark / Note (Optional)</Label>
                <Textarea
                  rows={2}
                  placeholder="Any additional notes..."
                  value={shippingAddr}
                  onChange={(e) => setShippingAddr(e.target.value)}
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
                  <span className="text-muted-foreground">Gross Amount</span>
                  <span className="font-medium">{inr(totals.grossAmount)}</span>
                </div>

                <div className="flex justify-between items-center py-1 gap-2">
                  <span className="text-muted-foreground">Discount (%)</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="w-24 h-8 text-right text-rose-600 font-semibold"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                  />
                </div>

                {totals.discountTotal > 0 && (
                  <div className="flex justify-between text-xs text-rose-600">
                    <span>Discount Amount</span>
                    <span>-{inr(totals.discountTotal)}</span>
                  </div>
                )}

                <div className="flex justify-between font-medium pt-1 border-t">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{inr(totals.subtotal)}</span>
                </div>

                <div className="flex justify-between items-center py-1 gap-2">
                  <span className="text-muted-foreground">Shipping Fee</span>
                  <Input
                    type="number"
                    min={0}
                    className="w-24 h-8 text-right"
                    value={shippingFee}
                    onChange={(e) => setShippingFee(e.target.value)}
                  />
                </div>

                <div className="flex justify-between text-base font-semibold pt-2 border-t">
                  <span>Grand Total</span>
                  <span className="text-primary font-bold">{inr(totals.grandTotal)}</span>
                </div>

                <div className="flex justify-between text-sm text-emerald-600 font-medium pt-1">
                  <span>Amount Paid</span>
                  <span>{inr(actualAmountPaid)}</span>
                </div>

                <div className={`flex justify-between text-sm font-semibold pt-1 ${balanceDue > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  <span>Balance Due</span>
                  <span>{inr(balanceDue)}</span>
                </div>

                <div className="flex justify-between text-xs pt-2 border-t text-muted-foreground font-medium">
                  <span>Est. Cost Price</span>
                  <span>{inr(totals.totalCost)}</span>
                </div>

                <div className={`flex justify-between text-sm font-semibold pt-1 ${totals.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  <span>Est. Profit / Loss</span>
                  <span>{inr(totals.profit)}</span>
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t">
                <div className="flex flex-col gap-2">
                  <Button onClick={() => save(false)} className="w-full">
                    <Save className="h-4 w-4 mr-2" /> {invoiceToEdit ? "Update Invoice" : "Save Invoice"}
                  </Button>
                  <Button variant="outline" onClick={() => save(true)} className="w-full">
                    <FileDown className="h-4 w-4 mr-2" /> {invoiceToEdit ? "Update & Download PDF" : "Save & Download PDF"}
                  </Button>
                </div>
                {(settings.autoSendWhatsApp || settings.autoSendEmail) && (
                  <div className="flex flex-col gap-1 text-xs text-muted-foreground pt-1">
                    <span className="font-medium">Auto-send on save:</span>
                    <div className="flex gap-1.5 flex-wrap">
                      {settings.autoSendWhatsApp && (
                        <span className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 font-medium">
                          📱 WhatsApp
                        </span>
                      )}
                      {settings.autoSendEmail && (
                        <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium">
                          ✉️ Email
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

