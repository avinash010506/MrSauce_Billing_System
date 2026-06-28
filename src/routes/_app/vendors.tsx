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
import type { Vendor, PurchaseBill, PaymentTransaction } from "@/lib/types";
import { Building2, History, Pencil, Plus, Search, Trash2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

export const Route = createFileRoute("/_app/vendors")({
  component: VendorsPage,
  head: () => ({ meta: [{ title: "Vendors • Smart Invoice" }] }),
});

const empty: Vendor = {
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

function VendorsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [tick, setTick] = useState(0);
  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Vendor>(empty);
  const [isImporting, setIsImporting] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [statementStart, setStatementStart] = useState("");
  const [statementEnd, setStatementEnd] = useState("");
  const [settleAmount, setSettleAmount] = useState<string | number>("");
  const [settleDate, setSettleDate] = useState(getLocalTodayISO());
  const [settleMethod, setSettleMethod] = useState("Cash");

  const list = useMemo(() => {
    const all = store.vendors();
    if (!q.trim()) return all;
    const s = q.toLowerCase();
    return all.filter(
      (v) =>
        v.name.toLowerCase().includes(s) ||
        v.phone.includes(s) ||
        v.email.toLowerCase().includes(s),
    );
  }, [q, tick]);

  const purchaseBills = store.purchaseBills();
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    const outstandingMap = new Map<string, number>();
    purchaseBills.forEach((b) => {
      map.set(b.vendorId, (map.get(b.vendorId) ?? 0) + b.grandTotal);
      if (b.paymentStatus !== "paid") {
        outstandingMap.set(
          b.vendorId,
          (outstandingMap.get(b.vendorId) ?? 0) + (b.balanceDue ?? b.grandTotal),
        );
      }
    });
    return { map, outstandingMap };
  }, [purchaseBills, tick]);

  const openNew = () => {
    setDraft({ ...empty, id: uid("v_"), createdAt: new Date().toISOString() });
    setOpen(true);
  };
  const openEdit = (v: Vendor) => {
    setDraft(v);
    setOpen(true);
  };
  const save = () => {
    if (!draft.name.trim()) return toast.error("Name required");
    const all = store.vendors();
    const i = all.findIndex((x) => x.id === draft.id);
    const isEdit = i >= 0;
    if (i >= 0) all[i] = draft;
    else all.unshift(draft);
    store.saveVendors(all);
    void syncToAppsScript({ type: "vendor.upsert", payload: draft });
    void logActivity(
      isEdit ? "Edit" : "Create",
      "Vendor",
      draft.name,
      draft.id,
      isEdit ? "Updated vendor details" : "Registered vendor"
    );
    setOpen(false);
    toast.success("Vendor saved");
  };
  const remove = (id: string) => {
    if (!isAdmin) return toast.error("Unauthorized: Only Admins can delete vendors.");
    const target = store.vendors().find((v) => v.id === id);
    const name = target ? target.name : id;
    if (!confirm("Delete vendor? This will not delete their purchase records.")) return;
    store.saveVendors(store.vendors().filter((v) => v.id !== id));
    void syncToAppsScript({ type: "vendor.delete", payload: { id } });
    void logActivity("Delete", "Vendor", name, id, "Deleted vendor");
    toast.success("Vendor deleted");
  };

  const openHistory = (v: Vendor) => {
    setSelectedVendor(v);
    setSettleAmount(totals.outstandingMap.get(v.id) || "");
    setSettleDate(getLocalTodayISO());
    setSettleMethod("Cash");
    setHistoryOpen(true);
  };

  const vendorPurchases = useMemo(() => {
    if (!selectedVendor) return [];
    return purchaseBills.filter((b) => b.vendorId === selectedVendor.id);
  }, [purchaseBills, selectedVendor, tick]);

  const vendorPayments = useMemo(() => {
    const billNumbers = new Set(vendorPurchases.map((b) => b.number));
    return store.payments().filter((p) => billNumbers.has(p.referenceId));
  }, [vendorPurchases, historyOpen, tick]);

  const statementLedger = useMemo(() => {
    if (!selectedVendor) return [];
    type LedgerEntry = {
      date: string;
      type: string;
      ref: string;
      debit: number;
      credit: number;
      balance: number;
    };
    const entries: Omit<LedgerEntry, "balance">[] = [];

    vendorPurchases.forEach((bill) => {
      const itemsDetail = bill.items.map((it) => `${it.name} (x${it.qty})`).join(", ");
      entries.push({
        date: bill.date.split("T")[0],
        type: "Purchase",
        ref: `${bill.number} - ${itemsDetail}`,
        debit: bill.grandTotal,
        credit: 0,
      });
    });
    vendorPayments.forEach((pay) => {
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
  }, [vendorPurchases, vendorPayments, statementStart, statementEnd]);

  const exportExcel = async () => {
    if (!selectedVendor || statementLedger.length === 0) return;
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
    const filename = `Statement_${selectedVendor.name}_${getLocalTodayISO()}.xlsx`;
    saveAs(new Blob([buffer]), filename);
    toast.success(`${filename} downloaded`);
  };

  const printStatement = () => {
    import("@/lib/pdf")
      .then(({ downloadStatementPDF }) => {
        downloadStatementPDF(selectedVendor!, statementLedger, store.getSettings());
      })
      .catch(() => {
        console.error("Failed to load PDF module");
      });
  };

  const settleBalance = () => {
    if (!selectedVendor || !settleAmount) return;
    let amountLeft = Number(settleAmount);
    if (amountLeft <= 0) return toast.error("Enter a valid amount");

    const outstanding = totals.outstandingMap.get(selectedVendor.id) || 0;
    if (amountLeft > outstanding) {
      return toast.error("Payment amount cannot exceed outstanding balance.");
    }

    const unpaidBills = vendorPurchases
      .filter((b) => b.paymentStatus !== "paid")
      .sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.number.localeCompare(b.number);
      });

    const allBills = store.purchaseBills();
    const newPayments: PaymentTransaction[] = [];

    for (const bill of unpaidBills) {
      if (amountLeft <= 0) break;

      const due = bill.balanceDue ?? bill.grandTotal;
      const pay = Math.min(due, amountLeft);

      amountLeft -= pay;

      const newAmountPaid = (bill.amountPaid || 0) + pay;
      const newBalanceDue = bill.grandTotal - newAmountPaid;
      const newStatus = newBalanceDue <= 0 ? "paid" : "partial";

      const idx = allBills.findIndex((x) => x.id === bill.id);
      if (idx >= 0) {
        allBills[idx] = {
          ...allBills[idx],
          amountPaid: newAmountPaid,
          balanceDue: newBalanceDue,
          paymentStatus: newStatus,
        };
        syncToAppsScript({ type: "purchase.create", payload: allBills[idx] });
      }

      newPayments.push({
        id: uid("pay_"),
        date: settleDate,
        amount: pay,
        method: settleMethod,
        type: "Balance Payment",
        referenceId: bill.number,
      });
    }

    store.savePurchaseBills(allBills);

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
          const { importVendorsExcel } = await import("@/lib/excel-import");
          const { newVendors, updatedVendors, allVendors } = await importVendorsExcel(buffer, store.vendors());

          const totalImported = newVendors.length + updatedVendors.length;
          if (totalImported === 0) {
            toast.dismiss(toastId);
            toast.info("No vendors found to import.");
            setIsImporting(false);
            return;
          }

          store.saveVendors(allVendors);
          toast.loading(`Imported ${totalImported} vendors locally. Syncing to cloud (0/${totalImported})...`, { id: toastId });

          let successCount = 0;
          const toSync = [...newVendors, ...updatedVendors];
          for (let i = 0; i < toSync.length; i++) {
            toast.loading(`Imported ${totalImported} vendors locally. Syncing to cloud (${i}/${totalImported})...`, { id: toastId });
            try {
              const res = await syncToAppsScript({ type: "vendor.upsert", payload: toSync[i] });
              if (res && res.ok) {
                successCount++;
              }
            } catch (syncErr) {
              console.warn("Import sync failed for vendor", toSync[i].name, syncErr);
            }
          }

          toast.dismiss(toastId);
          toast.success(`Successfully imported ${totalImported} vendors! (${successCount} synced to cloud)`);
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
            placeholder="Search vendors…"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            id="excel-import-vendors-input"
            accept=".xlsx"
            className="hidden"
            onChange={handleImportExcel}
            disabled={isImporting}
          />
          <Button
            variant="outline"
            onClick={() => document.getElementById("excel-import-vendors-input")?.click()}
            disabled={isImporting}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Import Excel
          </Button>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> Add Vendor
          </Button>
        </div>
      </div>

      {list.length === 0 && !q && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Building2 className="h-12 w-12 opacity-30" />
          <p className="text-sm">
            No vendors yet. Add your first vendor to start tracking purchases.
          </p>
        </div>
      )}

      {list.length > 0 && (
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
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Total Purchases</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell>{v.phone}</TableCell>
                    <TableCell>{v.email}</TableCell>
                    <TableCell>{v.city}</TableCell>
                    <TableCell>{v.country}</TableCell>
                    <TableCell>{v.postcode}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-muted-foreground text-sm">
                      {v.address || "—"}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {inr(totals.map.get(v.id) ?? 0)}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-amber-600">
                      {inr(totals.outstandingMap.get(v.id) ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openHistory(v)}
                        title="Statement"
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(v)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <Button size="icon" variant="ghost" onClick={() => remove(v.id)}>
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
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {draft.id && store.vendors().some((v) => v.id === draft.id) ? "Edit" : "New"} Vendor
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                placeholder="Vendor company name"
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
            <Button onClick={save}>Save Vendor</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="flex flex-row items-center justify-between pe-6">
            <DialogTitle>Statement: {selectedVendor?.name}</DialogTitle>
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
                <div className="text-sm text-muted-foreground">Total Purchases</div>
                <div className="text-lg font-semibold">
                  {inr(totals.map.get(selectedVendor?.id || "") ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Paid</div>
                <div className="text-lg font-semibold text-emerald-600">
                  {inr(
                    (totals.map.get(selectedVendor?.id || "") ?? 0) -
                      (totals.outstandingMap.get(selectedVendor?.id || "") ?? 0),
                  )}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Outstanding Balance</div>
                <div className="text-lg font-bold text-amber-600">
                  {inr(totals.outstandingMap.get(selectedVendor?.id || "") ?? 0)}
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

            {(totals.outstandingMap.get(selectedVendor?.id || "") ?? 0) > 0 && (
              <div className="space-y-4 border p-4 rounded-lg bg-slate-50 dark:bg-slate-900">
                <h3 className="text-sm font-semibold">Settle Outstanding Balance</h3>
                <p className="text-xs text-muted-foreground">
                  Payment will be automatically applied to the oldest unpaid bills first.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input
                      type="number"
                      min={1}
                      value={settleAmount}
                      onChange={(e) => setSettleAmount(e.target.value)}
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
