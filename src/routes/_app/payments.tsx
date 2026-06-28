import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { onStoreChange, store } from "@/lib/storage";
import { inr, uid, fmtDate, getLocalTodayISO } from "@/lib/format";
import { syncToAppsScript } from "@/lib/api";
import type { PaymentTransaction } from "@/lib/types";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/payments")({
  component: PaymentsPage,
  head: () => ({ meta: [{ title: "Payments • Smart Invoice" }] }),
});

const empty: PaymentTransaction = {
  id: "",
  date: getLocalTodayISO(),
  amount: 0,
  method: "Cash",
  type: "Other",
  referenceId: "",
};

function PaymentsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [tick, setTick] = useState(0);
  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(empty);

  const list = useMemo(() => {
    const all = [...store.payments()].sort((a, b) => {
      const dateComp = b.date.localeCompare(a.date);
      if (dateComp !== 0) return dateComp;
      return (b.id || "").localeCompare(a.id || "");
    });
    if (!q.trim()) return all;
    const s = q.toLowerCase();
    return all.filter(
      (p) => p.referenceId.toLowerCase().includes(s) || p.method.toLowerCase().includes(s),
    );
  }, [q, tick]);

  const partyLookup = useMemo(() => {
    const invoices = store.invoices();
    const bills = store.purchaseBills();
    const map = new Map<string, string>();
    invoices.forEach((i) => map.set(`Sale-${i.number}`, i.customerName));
    bills.forEach((b) => map.set(`Purchase-${b.number}`, b.vendorName));
    invoices.forEach((i) => map.set(`Invoice Payment-${i.number}`, i.customerName));
    bills.forEach((b) => map.set(`Purchase Payment-${b.number}`, b.vendorName));
    invoices.forEach((i) => map.set(`Balance Payment-${i.number}`, i.customerName));
    bills.forEach((b) => map.set(`Balance Payment-${b.number}`, b.vendorName));
    return map;
  }, [tick]);

  const openNew = () => {
    setDraft({ ...empty, id: uid("pay_") });
    setOpen(true);
  };
  const openEdit = (p: PaymentTransaction) => {
    setDraft(p);
    setOpen(true);
  };
  const adjustReferenceBalance = (refId: string, amountChange: number) => {
    if (!refId || amountChange === 0) return;

    let updated = false;
    const allInvoices = store.invoices();
    const invIdx = allInvoices.findIndex((inv) => inv.number === refId);
    if (invIdx >= 0) {
      const inv = allInvoices[invIdx];
      const newAmountPaid = Math.max(0, (inv.amountPaid || 0) + amountChange);
      const newBalanceDue = inv.grandTotal - newAmountPaid;
      let newStatus: "paid" | "pending" | "partial" = "partial";
      if (newBalanceDue <= 0) newStatus = "paid";
      else if (newBalanceDue >= inv.grandTotal) newStatus = "pending";

      allInvoices[invIdx] = {
        ...inv,
        amountPaid: newAmountPaid,
        balanceDue: newBalanceDue,
        paymentStatus: newStatus,
      };
      store.saveInvoices(allInvoices);
      void syncToAppsScript({ type: "invoice.create", payload: allInvoices[invIdx] });
      updated = true;
    }

    const allBills = store.purchaseBills();
    const billIdx = allBills.findIndex((b) => b.number === refId);
    if (billIdx >= 0) {
      const bill = allBills[billIdx];
      const newAmountPaid = Math.max(0, (bill.amountPaid || 0) + amountChange);
      const newBalanceDue = bill.grandTotal - newAmountPaid;
      let newStatus: "paid" | "pending" | "partial" = "partial";
      if (newBalanceDue <= 0) newStatus = "paid";
      else if (newBalanceDue >= bill.grandTotal) newStatus = "pending";

      allBills[billIdx] = {
        ...bill,
        amountPaid: newAmountPaid,
        balanceDue: newBalanceDue,
        paymentStatus: newStatus,
      };
      store.savePurchaseBills(allBills);
      void syncToAppsScript({ type: "purchase.create", payload: allBills[billIdx] });
      updated = true;
    }

    if (updated) {
      setTick((t) => t + 1);
    }
  };

  const save = () => {
    const amountVal = Number(draft.amount) || 0;
    if (amountVal <= 0) return toast.error("Valid amount required");

    const finalDraft = { ...draft, amount: amountVal } as PaymentTransaction;
    const all = store.payments();
    const i = all.findIndex((x) => x.id === finalDraft.id);
    const isEdit = i >= 0;

    let oldAmount = 0;
    let oldRefId = "";
    if (i >= 0) {
      oldAmount = all[i].amount;
      oldRefId = all[i].referenceId;
      all[i] = finalDraft;
    } else {
      all.unshift(finalDraft);
    }

    store.savePayments(all);
    void syncToAppsScript({ type: "payment.create", payload: finalDraft });
    void logActivity(
      isEdit ? "Edit" : "Create",
      "Payment",
      finalDraft.referenceId || "Payment",
      finalDraft.id,
      `${isEdit ? "Modified" : "Recorded"} ${finalDraft.type} payment of ${inr(finalDraft.amount)} via ${finalDraft.method}`
    );

    if (oldRefId) adjustReferenceBalance(oldRefId, -oldAmount);
    if (finalDraft.referenceId) adjustReferenceBalance(finalDraft.referenceId, amountVal);

    setOpen(false);
    toast.success("Payment saved");
  };
  const remove = (id: string) => {
    if (!isAdmin) return toast.error("Unauthorized: Only Admins can delete payments.");
    if (!confirm("Delete payment?")) return;
    const all = store.payments();
    const p = all.find((x) => x.id === id);
    if (p) {
      if (p.referenceId) {
        adjustReferenceBalance(p.referenceId, -p.amount);
      }
      void logActivity("Delete", "Payment", p.referenceId || "Payment", p.id, `Deleted ${p.type} payment of ${inr(p.amount)}`);
    }
    store.savePayments(all.filter((x) => x.id !== id));
    void syncToAppsScript({ type: "payment.delete", payload: { id } });
    toast.success("Deleted");
  };


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search payments…"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Add Payment
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Reference / Details</TableHead>
                <TableHead>Party Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    No payments logged.
                  </TableCell>
                </TableRow>
              )}
              {list.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{fmtDate(p.date)}</TableCell>
                  <TableCell className="font-medium">{p.referenceId || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {partyLookup.get(`${p.type}-${p.referenceId}`) || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.type}</Badge>
                  </TableCell>
                  <TableCell>{p.method}</TableCell>
                  <TableCell className="text-right font-semibold">{inr(p.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {isAdmin && (
                      <Button size="icon" variant="ghost" onClick={() => remove(p.id)}>
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
              {draft.id && store.payments().some((c) => c.id === draft.id) ? "Edit" : "New"} Payment
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={draft.type}
                onValueChange={(v) => setDraft({ ...draft, type: v as PaymentTransaction["type"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sale">Sale</SelectItem>
                  <SelectItem value="Purchase">Purchase</SelectItem>
                  <SelectItem value="Balance Payment">Balance Payment</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={draft.method} onValueChange={(v) => setDraft({ ...draft, method: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reference ID / Details</Label>
              <Input
                value={draft.referenceId}
                placeholder="e.g. UTR Number or Invoice #"
                onChange={(e) => setDraft({ ...draft, referenceId: e.target.value })}
              />
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
    </div>
  );
}
