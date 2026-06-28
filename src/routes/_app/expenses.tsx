import { createFileRoute, redirect } from "@tanstack/react-router";
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
import { inr, uid, fmtDate, toLocalDateString, getLocalTodayISO, getLocalFirstOfMonthISO } from "@/lib/format";
import { syncToAppsScript } from "@/lib/api";
import type { Expense } from "@/lib/types";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const Route = createFileRoute("/_app/expenses")({
  beforeLoad: () => {
    const s = store.getSession();
    if (!s || (s.role !== "admin" && s.role !== "accountant")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: ExpensesPage,
  head: () => ({ meta: [{ title: "Expenses • Smart Invoice" }] }),
});

const empty: Expense = {
  id: "",
  date: getLocalTodayISO(),
  amount: 0,
  paymentType: "Cash",
  category: "",
};

function ExpensesPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [tick, setTick] = useState(0);
  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Expense>(empty);

  const today = getLocalTodayISO();
  const firstOfMonth = getLocalFirstOfMonthISO();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const list = useMemo(() => {
    let all = [...store.expenses()].sort((a, b) => {
      const dateComp = b.date.localeCompare(a.date);
      if (dateComp !== 0) return dateComp;
      return (b.id || "").localeCompare(a.id || "");
    });
    if (from) all = all.filter((e) => e.date.slice(0, 10) >= from);
    if (to) all = all.filter((e) => e.date.slice(0, 10) <= to);
    if (!q.trim()) return all;
    const s = q.toLowerCase();
    return all.filter(
      (c) => c.category.toLowerCase().includes(s) || c.paymentType.toLowerCase().includes(s),
    );
  }, [q, from, to, tick]);

  const totalExpenses = list.reduce((s, e) => s + e.amount, 0);
  const cashPaid = list.filter((e) => e.paymentType === "Cash").reduce((s, e) => s + e.amount, 0);
  const bankPaid = list
    .filter((e) => e.paymentType === "Bank Transfer")
    .reduce((s, e) => s + e.amount, 0);

  const openNew = () => {
    setDraft({ ...empty, id: uid("exp_") });
    setOpen(true);
  };
  const openEdit = (e: Expense) => {
    setDraft(e);
    setOpen(true);
  };
  const save = () => {
    if (draft.amount <= 0) return toast.error("Valid amount required");
    if (!draft.category) return toast.error("Particular required");
    const all = store.expenses();
    const i = all.findIndex((x) => x.id === draft.id);
    const isEdit = i >= 0;
    if (i >= 0) all[i] = draft;
    else all.unshift(draft);
    store.saveExpenses(all);
    void syncToAppsScript({ type: "expense.create", payload: draft });
    void logActivity(
      isEdit ? "Edit" : "Create",
      "Expense",
      draft.category,
      draft.id,
      `${isEdit ? "Modified" : "Recorded"} expense entry for ${inr(draft.amount)} (${draft.paymentType})`
    );
    setOpen(false);
    toast.success("Expense saved");
  };
  const remove = (id: string) => {
    if (!isAdmin) return toast.error("Unauthorized: Only Admins can delete expenses.");
    const target = store.expenses().find((c) => c.id === id);
    const name = target ? target.category : id;
    const amount = target ? target.amount : 0;
    if (!confirm("Delete expense?")) return;
    store.saveExpenses(store.expenses().filter((c) => c.id !== id));
    void syncToAppsScript({ type: "expense.delete", payload: { id } });
    void logActivity("Delete", "Expense", name, id, `Deleted expense entry of ${inr(amount)}`);
    toast.success("Deleted");
  };


  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total Expenses</div>
            <div className="text-xl font-bold">{inr(totalExpenses)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Cash Paid</div>
            <div className="text-xl font-bold text-emerald-600">{inr(cashPaid)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Bank Paid</div>
            <div className="text-xl font-bold text-blue-600">{inr(bankPaid)}</div>
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
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search expenses…"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Add Expense
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Particular</TableHead>
                <TableHead>Payment Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                    No expenses logged.
                  </TableCell>
                </TableRow>
              )}
              {list.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{fmtDate(e.date)}</TableCell>
                  <TableCell className="font-medium">{e.category}</TableCell>
                  <TableCell>{e.paymentType}</TableCell>
                  <TableCell className="text-right font-semibold">{inr(e.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(e)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {isAdmin && (
                      <Button size="icon" variant="ghost" onClick={() => remove(e.id)}>
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
              {draft.id && store.expenses().some((c) => c.id === draft.id) ? "Edit" : "New"} Expense
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
              <Label>Particular</Label>
              <Input
                value={draft.category}
                placeholder="e.g. Rent, Fuel, Salary"
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Type</Label>
              <Select
                value={draft.paymentType}
                onValueChange={(v) => setDraft({ ...draft, paymentType: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                value={draft.amount || ""}
                onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
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
