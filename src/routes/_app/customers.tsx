import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { onStoreChange, store } from "@/lib/storage";
import { inr, fmtDate, uid, getLocalTodayISO } from "@/lib/format";
import { syncToAppsScript } from "@/lib/api";
import type { Customer, Invoice, PaymentTransaction } from "@/lib/types";
import { History, Pencil, Plus, Search, Trash2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

export const Route = createFileRoute("/_app/customers")({
  component: CustomersPage,
  head: () => ({ meta: [{ title: "Customers • Smart Invoice" }] }),
});

const empty: Customer = {
  id: "",
  name: "",
  phone: "",
  email: "",

  address: "",
  city: "",
  country: "",
  postcode: "",
  createdAt: "",
};

function CustomersPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [tick, setTick] = useState(0);
  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Customer>(empty);
  const [isImporting, setIsImporting] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [statementStart, setStatementStart] = useState("");
  const [statementEnd, setStatementEnd] = useState("");
  const [settleAmount, setSettleAmount] = useState<number | "">("");
  const [settleDate, setSettleDate] = useState(getLocalTodayISO());
  const [settleMethod, setSettleMethod] = useState("Cash");

  const list = useMemo(() => {
    const all = store.customers();
    if (!q.trim()) return all;
    const s = q.toLowerCase();
    return all.filter(
      (c) =>
        c.name.toLowerCase().includes(s) ||
        c.phone.includes(s) ||
        c.email.toLowerCase().includes(s),
    );
  }, [q, tick]);

  const totals = useMemo(() => {
    const invoices = store.invoices();
    const map = new Map<string, number>();
    const outstandingMap = new Map<string, number>();
    invoices.forEach((i) => {
      map.set(i.customerId, (map.get(i.customerId) ?? 0) + i.grandTotal);
      if (i.paymentStatus !== "paid") {
        outstandingMap.set(
          i.customerId,
          (outstandingMap.get(i.customerId) ?? 0) + (i.balanceDue ?? i.grandTotal),
        );
      }
    });
    return { map, outstandingMap };
  }, [tick]);

  const openNew = () => {
    setDraft({ ...empty, id: uid("c_"), createdAt: new Date().toISOString() });
    setOpen(true);
  };
  const openEdit = (c: Customer) => {
    setDraft(c);
    setOpen(true);
  };
  const save = () => {
    if (!draft.name.trim()) return toast.error("Name required");
    const all = store.customers();
    const i = all.findIndex((x) => x.id === draft.id);
    const isEdit = i >= 0;
    if (i >= 0) all[i] = draft;
    else all.unshift(draft);
    store.saveCustomers(all);
    void syncToAppsScript({ type: "customer.upsert", payload: draft });
    void logActivity(
      isEdit ? "Edit" : "Create",
      "Customer",
      draft.name,
      draft.id,
      isEdit ? "Updated customer details" : "Registered customer"
    );
    setOpen(false);
    toast.success("Customer saved");
  };
  const remove = (id: string) => {
    if (!isAdmin) return toast.error("Unauthorized: Only Admins can delete customers.");
    const target = store.customers().find((c) => c.id === id);
    const name = target ? target.name : id;
    if (!confirm("Delete customer?")) return;
    store.saveCustomers(store.customers().filter((c) => c.id !== id));
    void syncToAppsScript({ type: "customer.delete", payload: { id } });
    void logActivity("Delete", "Customer", name, id, "Deleted customer");
    toast.success("Deleted");
  };

  const openHistory = (c: Customer) => {
    setSelectedCustomer(c);
    setSettleAmount(totals.outstandingMap.get(c.id) || "");
    setSettleDate(getLocalTodayISO());
    setSettleMethod("Cash");
    setHistoryOpen(true);
  };

  const customerInvoices = useMemo(() => {
    if (!selectedCustomer) return [];
    return store.invoices().filter((i) => i.customerId === selectedCustomer.id);
  }, [selectedCustomer, tick]);

  const customerPayments = useMemo(() => {
    const invNumbers = new Set(customerInvoices.map((i) => i.number));
    return store.payments().filter((p) => invNumbers.has(p.referenceId));
  }, [customerInvoices, historyOpen, tick]);

  const statementLedger = useMemo(() => {
    if (!selectedCustomer) return [];
    type LedgerEntry = {
      date: string;
      type: string;
      ref: string;
      debit: number;
      credit: number;
      balance: number;
    };
    const entries: Omit<LedgerEntry, "balance">[] = [];

    customerInvoices.forEach((inv) => {
      const itemsDetail = inv.items.map((it) => `${it.name} (x${it.qty})`).join(", ");
      entries.push({
        date: inv.date.split("T")[0],
        type: "Invoice",
        ref: `${inv.number} - ${itemsDetail}`,
        debit: inv.grandTotal,
        credit: 0,
      });
    });
    customerPayments.forEach((pay) => {
      entries.push({
        date: pay.date.split("T")[0],
        type: "Payment",
        ref: pay.referenceId,
        debit: 0,
        credit: pay.amount,
      });
    });

    entries.sort((a, b) => a.date.localeCompare(b.date));

    let runningBalance = 0;
    return entries
      .map((e) => {
        runningBalance += e.debit - e.credit;
        return { ...e, balance: runningBalance };
      })
      .filter((e) => {
        if (statementStart && e.date < statementStart) return false;
        if (statementEnd && e.date > statementEnd) return false;
        return true;
      });
  }, [customerInvoices, customerPayments, statementStart, statementEnd]);

  const exportExcel = async () => {
    if (!selectedCustomer || statementLedger.length === 0) return;
    const rows = [
      ["Date", "Type", "Reference", "Debit", "Credit", "Balance"],
      ...statementLedger.map((e) => [e.date, e.type, e.ref, e.debit, e.credit, e.balance]),
    ];

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
    const filename = `Statement_${selectedCustomer.name}_${getLocalTodayISO()}.xlsx`;
    saveAs(new Blob([buffer]), filename);
    toast.success(`${filename} downloaded`);
  };

  const printStatement = () => {
    import("@/lib/pdf")
      .then(({ downloadStatementPDF }) => {
        downloadStatementPDF(selectedCustomer!, statementLedger, store.getSettings());
      })
      .catch(() => {
        // toast is not imported at the top level of this block; handled gracefully
        console.error("Failed to load PDF module");
      });
  };

  const settleBalance = () => {
    if (!selectedCustomer || !settleAmount) return;
    let amountLeft = Number(settleAmount);
    if (amountLeft <= 0) return toast.error("Enter a valid amount");

    const outstanding = totals.outstandingMap.get(selectedCustomer.id) || 0;
    if (amountLeft > outstanding) {
      return toast.error("Payment amount cannot exceed outstanding balance.");
    }

    // Find unpaid invoices, oldest first (same-day invoices sorted by number ascending)
    const unpaidInvoices = customerInvoices
      .filter((i) => i.paymentStatus !== "paid")
      .sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.number.localeCompare(b.number);
      });

    const allInvoices = store.invoices();
    const newPayments: PaymentTransaction[] = [];

    for (const inv of unpaidInvoices) {
      if (amountLeft <= 0) break;

      const due = inv.balanceDue ?? inv.grandTotal;
      const pay = Math.min(due, amountLeft);

      amountLeft -= pay;

      const newAmountPaid = (inv.amountPaid || 0) + pay;
      const newBalanceDue = inv.grandTotal - newAmountPaid;
      const newStatus = newBalanceDue <= 0 ? "paid" : "partial";

      const idx = allInvoices.findIndex((x) => x.id === inv.id);
      if (idx >= 0) {
        allInvoices[idx] = {
          ...allInvoices[idx],
          amountPaid: newAmountPaid,
          balanceDue: newBalanceDue,
          paymentStatus: newStatus,
        };
        syncToAppsScript({ type: "invoice.create", payload: allInvoices[idx] });
      }

      newPayments.push({
        id: uid("pay_"),
        date: settleDate,
        amount: pay,
        method: settleMethod,
        type: "Balance Payment",
        referenceId: inv.number,
      });
    }

    store.saveInvoices(allInvoices);

    if (newPayments.length > 0) {
      const currentPayments = store.payments();
      store.savePayments([...newPayments, ...currentPayments]);
      newPayments.forEach((p) => syncToAppsScript({ type: "payment.create", payload: p }));
    }

    toast.success("Balance settled successfully");
    setHistoryOpen(false);
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const toastId = toast.loading("Reading Excel file...");

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const buffer = evt.target?.result as ArrayBuffer;
          const { importCustomersExcel } = await import("@/lib/excel-import");
          const { newCustomers, updatedCustomers, allCustomers } = await importCustomersExcel(buffer, store.customers());

          const totalImported = newCustomers.length + updatedCustomers.length;
          if (totalImported === 0) {
            toast.dismiss(toastId);
            toast.info("No customers found to import.");
            setIsImporting(false);
            return;
          }

          store.saveCustomers(allCustomers);
          toast.loading(`Imported ${totalImported} customers locally. Syncing to cloud (0/${totalImported})...`, { id: toastId });

          let successCount = 0;
          const toSync = [...newCustomers, ...updatedCustomers];
          for (let i = 0; i < toSync.length; i++) {
            toast.loading(`Imported ${totalImported} customers locally. Syncing to cloud (${i}/${totalImported})...`, { id: toastId });
            try {
              const res = await syncToAppsScript({ type: "customer.upsert", payload: toSync[i] });
              if (res && res.ok) {
                successCount++;
              }
            } catch (syncErr) {
              console.warn("Import sync failed for customer", toSync[i].name, syncErr);
            }
          }

          toast.dismiss(toastId);
          toast.success(`Successfully imported ${totalImported} customers! (${successCount} synced to cloud)`);
          setTick(t => t + 1);
        } catch (parseErr) {
          toast.dismiss(toastId);
          toast.error("Failed to parse Excel file. Make sure it has correct columns.");
          console.error(parseErr);
        } finally {
          setIsImporting(false);
        }
      };

      reader.readAsArrayBuffer(file);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error("Error reading file.");
      console.error(err);
      setIsImporting(false);
    }

    e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers…"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            id="excel-import-customers-input"
            accept=".xlsx"
            className="hidden"
            onChange={handleImportExcel}
            disabled={isImporting}
          />
          <Button
            variant="outline"
            onClick={() => document.getElementById("excel-import-customers-input")?.click()}
            disabled={isImporting}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Import Excel
          </Button>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> Add Customer
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Postcode</TableHead>
                <TableHead className="text-right">Total Invoiced</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    No customers yet.
                  </TableCell>
                </TableRow>
              )}
              {list.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.phone}</TableCell>
                  <TableCell>{c.email}</TableCell>
                  <TableCell>{c.city}</TableCell>
                  <TableCell>{c.country}</TableCell>
                  <TableCell>{c.postcode}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {inr(totals.map.get(c.id) ?? 0)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-amber-600">
                    {inr(totals.outstandingMap.get(c.id) ?? 0)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openHistory(c)}
                      title="Statement"
                    >
                      <History className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => openEdit(c)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {isAdmin && (
                      <Button size="icon" variant="ghost" onClick={() => remove(c.id)}>
                        <Trash2 className="h-4 w-4 text-rose-600" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {draft.id && store.customers().some((c) => c.id === draft.id) ? "Edit" : "New"}{" "}
              Customer
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Address</Label>
              <Textarea
                rows={2}
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  value={draft.city || ""}
                  onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Input
                  value={draft.country || ""}
                  onChange={(e) => setDraft({ ...draft, country: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Postcode</Label>
                <Input
                  value={draft.postcode || ""}
                  onChange={(e) => setDraft({ ...draft, postcode: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="flex flex-row items-center justify-between pe-6">
            <DialogTitle>Statement: {selectedCustomer?.name}</DialogTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={exportExcel}>
                Export Excel
              </Button>
              <Button size="sm" variant="outline" onClick={printStatement}>
                Print PDF
              </Button>
            </div>
          </DialogHeader>

          <div className="flex gap-4 items-end py-2">
            <div className="space-y-1">
              <Label>From Date</Label>
              <Input
                type="date"
                value={statementStart}
                onChange={(e) => setStatementStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>To Date</Label>
              <Input
                type="date"
                value={statementEnd}
                onChange={(e) => setStatementEnd(e.target.value)}
              />
            </div>
            {(statementStart || statementEnd) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatementStart("");
                  setStatementEnd("");
                }}
              >
                Clear
              </Button>
            )}
          </div>

          <div className="grid gap-6 py-2">
            <div className="grid grid-cols-3 gap-4 border-b pb-4">
              <div>
                <div className="text-sm text-muted-foreground">Total Invoiced</div>
                <div className="text-lg font-semibold">
                  {inr(totals.map.get(selectedCustomer?.id || "") ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Paid</div>
                <div className="text-lg font-semibold text-emerald-600">
                  {inr(
                    (totals.map.get(selectedCustomer?.id || "") ?? 0) -
                      (totals.outstandingMap.get(selectedCustomer?.id || "") ?? 0),
                  )}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Outstanding Balance</div>
                <div className="text-lg font-bold text-amber-600">
                  {inr(totals.outstandingMap.get(selectedCustomer?.id || "") ?? 0)}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Ledger</h3>
              <div className="border rounded-md max-h-64 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statementLedger.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                          No transactions found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      statementLedger.map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{fmtDate(row.date)}</TableCell>
                          <TableCell>
                            {row.type} {row.ref}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.debit > 0 ? inr(row.debit) : ""}
                          </TableCell>
                          <TableCell className="text-right text-emerald-600">
                            {row.credit > 0 ? inr(row.credit) : ""}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {inr(row.balance)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {(totals.outstandingMap.get(selectedCustomer?.id || "") ?? 0) > 0 && (
              <div className="space-y-4 border p-4 rounded-lg bg-slate-50 dark:bg-slate-900">
                <h3 className="text-sm font-semibold">Settle Outstanding Balance</h3>
                <p className="text-xs text-muted-foreground">
                  Payment will be automatically applied to the oldest unpaid invoices first.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input
                      type="number"
                      min={1}
                      value={settleAmount}
                      onChange={(e) =>
                        setSettleAmount(e.target.value === "" ? "" : Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={settleDate}
                      onChange={(e) => setSettleDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Method</Label>
                    <Select value={settleMethod} onValueChange={setSettleMethod}>
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
                <div className="flex justify-end pt-2">
                  <Button onClick={settleBalance}>Settle Balance</Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
