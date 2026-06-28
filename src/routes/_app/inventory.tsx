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
import { Badge } from "@/components/ui/badge";
import { onStoreChange, store } from "@/lib/storage";
import { inr, uid, getLocalTodayISO } from "@/lib/format";
import { syncToAppsScript } from "@/lib/api";
import type { Product } from "@/lib/types";
import { Pencil, Plus, Search, Trash2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const Route = createFileRoute("/_app/inventory")({
  component: InventoryPage,
  head: () => ({ meta: [{ title: "Inventory • Smart Invoice" }] }),
});

const empty: Product = {
  id: "",
  name: "",
  sku: "",
  category: "",
  purchasePrice: 0,
  sellingPrice: 0,
  stock: 0,
  reorderLevel: 5,
  date: getLocalTodayISO(),
};

function InventoryPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [tick, setTick] = useState(0);
  useEffect(() => onStoreChange(() => setTick((t) => t + 1)), []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  interface DraftProduct extends Omit<Product, "purchasePrice" | "sellingPrice" | "stock" | "reorderLevel"> {
    purchasePrice: string | number;
    sellingPrice: string | number;
    stock: string | number;
    reorderLevel: string | number;
  }
  const [draft, setDraft] = useState<DraftProduct>(empty);
  const [isImporting, setIsImporting] = useState(false);

  const list = useMemo(() => {
    const all = store.products();
    if (!q.trim()) return all;
    const s = q.toLowerCase();
    return all.filter((p) => p.name.toLowerCase().includes(s));
  }, [q, tick]);

  const save = () => {
    if (!draft.name.trim()) return toast.error("Name required");
    const cleanDraft: Product = {
      ...draft,
      purchasePrice: Number(draft.purchasePrice) || 0,
      sellingPrice: Number(draft.sellingPrice) || 0,
      stock: Number(draft.stock) || 0,
      reorderLevel: Number(draft.reorderLevel) || 0,
    };
    const all = store.products();
    const i = all.findIndex((x) => x.id === cleanDraft.id);
    const isEdit = i >= 0;
    if (i >= 0) all[i] = cleanDraft;
    else all.unshift({ ...cleanDraft, id: cleanDraft.id || uid("p_") });
    store.saveProducts(all);
    void syncToAppsScript({ type: "product.upsert", payload: cleanDraft });
    void logActivity(
      isEdit ? "Edit" : "Create",
      "Product",
      cleanDraft.name,
      cleanDraft.id || cleanDraft.sku,
      isEdit ? "Modified product catalog entry" : "Registered product in inventory"
    );
    setOpen(false);
    toast.success("Product saved");
  };
  const remove = (id: string) => {
    if (!isAdmin) return toast.error("Unauthorized: Only Admins can delete products.");
    const target = store.products().find((p) => p.id === id);
    const name = target ? target.name : id;
    if (!confirm("Delete product?")) return;
    store.saveProducts(store.products().filter((p) => p.id !== id));
    void syncToAppsScript({ type: "product.delete", payload: { id } });
    void logActivity("Delete", "Product", name, id, "Deleted product from inventory");
    toast.success("Deleted");
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
          const { importProductsExcel } = await import("@/lib/excel-import");
          const { newProducts, updatedProducts, allProducts } = await importProductsExcel(buffer, store.products());

          const totalImported = newProducts.length + updatedProducts.length;
          if (totalImported === 0) {
            toast.dismiss(toastId);
            toast.info("No products found to import.");
            setIsImporting(false);
            return;
          }

          store.saveProducts(allProducts);
          toast.loading(`Imported ${totalImported} products locally. Syncing to cloud (0/${totalImported})...`, { id: toastId });

          let successCount = 0;
          const toSync = [...newProducts, ...updatedProducts];
          for (let i = 0; i < toSync.length; i++) {
            toast.loading(`Imported ${totalImported} products locally. Syncing to cloud (${i}/${totalImported})...`, { id: toastId });
            try {
              const res = await syncToAppsScript({ type: "product.upsert", payload: toSync[i] });
              if (res && res.ok) {
                successCount++;
              }
            } catch (syncErr) {
              console.warn("Import sync failed for product", toSync[i].name, syncErr);
            }
          }

          toast.dismiss(toastId);
          toast.success(`Successfully imported ${totalImported} products! (${successCount} synced to cloud)`);
          setTick(t => t + 1); // trigger list refresh
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
            placeholder="Search products…"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            id="excel-import-input"
            accept=".xlsx"
            className="hidden"
            onChange={handleImportExcel}
            disabled={isImporting}
          />
          <Button
            variant="outline"
            onClick={() => document.getElementById("excel-import-input")?.click()}
            disabled={isImporting}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Import Excel
          </Button>
          <Button
            onClick={() => {
              setDraft({ ...empty, id: uid("p_") });
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add Product
          </Button>
        </div>
      </div>

      {/* Desktop Table */}
      <Card className="hidden sm:block">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Name</TableHead>
                <TableHead className="text-right">Cost Price</TableHead>
                <TableHead className="text-right">Sell Price</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                    No products.
                  </TableCell>
                </TableRow>
              )}
              {list.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-right">{inr(p.purchasePrice)}</TableCell>
                  <TableCell className="text-right">{inr(p.sellingPrice)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={p.stock <= p.reorderLevel ? "destructive" : "secondary"}>
                      {p.stock}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setDraft(p);
                        setOpen(true);
                      }}
                    >
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
        </CardContent>
      </Card>

      {/* Mobile Card View */}
      <div className="sm:hidden space-y-3">
        {list.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              No products. Tap <strong>Add Product</strong> to get started.
            </CardContent>
          </Card>
        )}
        {list.map((p) => (
          <Card key={p.id} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-semibold text-base">{p.name}</div>
                  {p.sku && <div className="text-xs text-muted-foreground">SKU: {p.sku}</div>}
                  {p.category && <div className="text-xs text-muted-foreground">{p.category}</div>}
                </div>
                <Badge variant={p.stock <= p.reorderLevel ? "destructive" : "secondary"} className="ml-2 shrink-0">
                  Stock: {p.stock}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Cost Price</div>
                  <div className="font-semibold">{inr(p.purchasePrice)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Sell Price</div>
                  <div className="font-semibold text-emerald-600">{inr(p.sellingPrice)}</div>
                </div>
              </div>
              {p.stock <= p.reorderLevel && (
                <div className="text-xs text-rose-600 font-medium mb-3">
                  ⚠️ Low stock — Reorder level: {p.reorderLevel}
                </div>
              )}
              <div className="flex items-center gap-2 border-t pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-xs"
                  onClick={() => {
                    setDraft(p);
                    setOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs text-rose-600 border-rose-200"
                    onClick={() => remove(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {store.products().some((p) => p.id === draft.id) ? "Edit" : "New"} Product
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={draft.date || getLocalTodayISO()}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Product Name *</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Cost Price</Label>
                <Input
                  type="number"
                  value={draft.purchasePrice}
                  onChange={(e) => setDraft({ ...draft, purchasePrice: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Sell Price</Label>
                <Input
                  type="number"
                  value={draft.sellingPrice}
                  onChange={(e) => setDraft({ ...draft, sellingPrice: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Current Stock</Label>
                <Input
                  type="number"
                  value={draft.stock}
                  onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Minimum Stock</Label>
                <Input
                  type="number"
                  value={draft.reorderLevel}
                  onChange={(e) => setDraft({ ...draft, reorderLevel: e.target.value })}
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
    </div>
  );
}
