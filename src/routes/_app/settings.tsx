import { createFileRoute, redirect } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { store } from "@/lib/storage";
import { syncToAppsScript } from "@/lib/api";
import { toast } from "sonner";
import { Upload, X, Loader2, CloudUpload, Send, Mail, MessageSquare, Pencil, Trash2, Plus, Users, Key } from "lucide-react";
import { sendEmailAuto, sendWhatsAppAuto } from "@/lib/autosend";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_app/settings")({
  beforeLoad: () => {
    const s = store.getSession();
    if (!s || s.role !== "admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings • Smart Invoice" }] }),
});

// ── Toggle switch ──────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        checked ? "bg-emerald-500" : "bg-muted-foreground/30"
      }`}
      aria-pressed={checked}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
function SettingsPage() {
  const [s, setS] = useState(store.getSettings());
  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingWa, setTestingWa] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState({
    name: "",
    username: "",
    password: "",
    role: "staff" as "admin" | "staff" | "accountant",
    email: "",
  });

  const session = store.getSession();
  const currentUsername = session?.username || "";
  const usersList = s.users || [];

  const handleSaveUser = async () => {
    if (!userDraft.name.trim()) return toast.error("Name is required");
    if (!userDraft.username.trim()) return toast.error("Username is required");
    
    const usernameRegex = /^[a-z0-9_]{3,20}$/;
    if (!usernameRegex.test(userDraft.username)) {
      return toast.error("Username must be 3-20 characters, lowercase letters, numbers, or underscores only.");
    }

    if (userDraft.username === "mrsauce") {
      return toast.error("Cannot use reserved 'mrsauce' username");
    }

    const currentUsers = s.users || [];
    const userIndex = currentUsers.findIndex((u) => u.username === userDraft.username);

    if (!editingUser && !userDraft.password) {
      return toast.error("Password is required for new users");
    }

    if (userDraft.password && userDraft.password.length < 4) {
      return toast.error("Password must be at least 4 characters long");
    }

    let updatedUsers = [...currentUsers];
    const { hashPassword } = await import("@/lib/auth");

    if (editingUser) {
      const existingIdx = currentUsers.findIndex((u) => u.username === editingUser);
      if (existingIdx >= 0) {
        if (editingUser !== userDraft.username && userIndex >= 0) {
          return toast.error("Username already exists");
        }
        let newPassword = currentUsers[existingIdx].password;
        if (userDraft.password) {
          newPassword = await hashPassword(userDraft.password);
        }
        updatedUsers[existingIdx] = {
          name: userDraft.name,
          username: userDraft.username,
          role: userDraft.role,
          email: userDraft.email,
          password: newPassword,
        };
      }
    } else {
      if (userIndex >= 0) {
        return toast.error("Username already exists");
      }
      const hashedPassword = await hashPassword(userDraft.password);
      updatedUsers.push({
        name: userDraft.name,
        username: userDraft.username,
        role: userDraft.role,
        email: userDraft.email,
        password: hashedPassword,
      });
    }

    set("users", updatedUsers);
    setUserModalOpen(false);
    toast.success(editingUser ? "User updated in settings draft. Save settings to apply." : "User added to settings draft. Save settings to apply.");
  };

  const save = async () => {
    setSavingSettings(true);

    const oldSettings = store.getSettings();
    const oldApiKey = oldSettings.apiKey || "";

    // Auto-generate apiKey if empty and appsScriptUrl is present
    let finalSettings = { ...s };
    if (s.appsScriptUrl && !s.apiKey) {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let key = "";
      for (let i = 0; i < 32; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      finalSettings.apiKey = key;
      setS(finalSettings);
      toast.info(`Generated API key automatically: ${key}`);
    }

    // Always save locally first so user is never locked out of correcting settings
    store.saveSettings(finalSettings);

    if (finalSettings.appsScriptUrl) {
      try {
        // Resolve Catch-22: only use oldApiKey if it is non-empty AND we are rotating the key.
        // Otherwise, authenticate using the current finalSettings.apiKey (the one the user entered).
        const authKey = (oldApiKey && finalSettings.apiKey && finalSettings.apiKey !== oldApiKey)
          ? oldApiKey
          : (finalSettings.apiKey || "");

        const res = await syncToAppsScript({ type: "settings.sync", payload: finalSettings }, authKey);
        if (res.ok) {
          toast.success("Settings saved locally and backed up to Google Sheets!");
        } else {
          toast.warning("Settings saved locally, but failed to back up to cloud: " + (res.error || "check API Key"));
        }
      } catch (err) {
        toast.warning("Settings saved locally, but cloud backup failed (check console).");
      }
    } else {
      toast.success("Settings saved locally");
    }
    setSavingSettings(false);
  };
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS({ ...s, [k]: v });

  const handlePullFromCloud = async () => {
    if (!s.appsScriptUrl) return toast.error("Please configure and save a Web App URL first.");
    if (
      !confirm(
        "This will DOWNLOAD and RESTORE all data from Google Sheets, OVERWRITING your local browser storage. Continue?",
      )
    )
      return;

    setPulling(true);
    try {
      const res = await syncToAppsScript({ type: "database.pull" });
      if (!res.ok) {
        toast.error(`Failed to pull data: ${res.error || "Unknown error"}`);
        return;
      }

      const data = res.data;
      if (!data) {
        toast.error("No data returned from Google Sheets.");
        return;
      }

      // Restore settings if returned, otherwise keep current settings
      if (data.settings) {
        store.saveSettings({ ...s, ...data.settings });
        setS({ ...s, ...data.settings });
      }

      // Overwrite local databases
      if (Array.isArray(data.customers)) store.saveCustomers(data.customers);
      if (Array.isArray(data.vendors)) store.saveVendors(data.vendors);
      if (Array.isArray(data.products)) store.saveProducts(data.products);
      if (Array.isArray(data.invoices)) store.saveInvoices(data.invoices);
      if (Array.isArray(data.purchaseBills)) store.savePurchaseBills(data.purchaseBills);
      if (Array.isArray(data.expenses)) store.saveExpenses(data.expenses);
      if (Array.isArray(data.payments)) store.savePayments(data.payments);
      if (Array.isArray(data.activityLogs)) store.saveActivityLogs(data.activityLogs);

      toast.success("✅ Database restored successfully from Google Sheets!");
    } catch (err) {
      toast.error("Pull failed, check console.");
      console.error(err);
    } finally {
      setPulling(false);
    }
  };

  const handleForceSync = async () => {
    if (!s.appsScriptUrl) return toast.error("Please save a Web App URL first.");
    if (
      !confirm(
        "This will push all local data (customers, vendors, products, invoices, purchases, expenses, payments, activity logs) to Google Sheets. Continue?",
      )
    )
      return;

    setSyncing(true);
    let ok = 0;
    let fail = 0;
    store.saveSettings(s);

    try {
      for (const c of store.customers()) {
        const res = await syncToAppsScript({ type: "customer.upsert", payload: c });
        if (res.ok) ok++;
        else fail++;
      }
      for (const v of store.vendors()) {
        const res = await syncToAppsScript({ type: "vendor.upsert", payload: v });
        if (res.ok) ok++;
        else fail++;
      }
      for (const p of store.products()) {
        const res = await syncToAppsScript({ type: "product.upsert", payload: p });
        if (res.ok) ok++;
        else fail++;
      }
      for (const i of store.invoices()) {
        const res = await syncToAppsScript({ type: "invoice.create", payload: i });
        if (res.ok) ok++;
        else fail++;
      }
      for (const pb of store.purchaseBills()) {
        const res = await syncToAppsScript({ type: "purchase.create", payload: pb });
        if (res.ok) ok++;
        else fail++;
      }
      for (const exp of store.expenses()) {
        const res = await syncToAppsScript({ type: "expense.create", payload: exp });
        if (res.ok) ok++;
        else fail++;
      }
      for (const pmt of store.payments()) {
        const res = await syncToAppsScript({ type: "payment.create", payload: pmt });
        if (res.ok) ok++;
        else fail++;
      }
      for (const act of store.activityLogs()) {
        const res = await syncToAppsScript({ type: "activity.create", payload: act });
        if (res.ok) ok++;
        else fail++;
      }

      if (fail === 0 && ok > 0) toast.success(`Synced ${ok} records to Google Sheets!`);
      else if (fail > 0) toast.warning(`Synced ${ok} records, but ${fail} failed.`);
      else toast.info("No records to sync.");
    } catch {
      toast.error("Sync failed, check console.");
    } finally {
      setSyncing(false);
    }
  };

  const handleLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      toast.error("Logo must be under 500 KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("logoBase64", reader.result as string);
    reader.readAsDataURL(file);
  };

  // Test WhatsApp – sends a test message to your own number
  const handleTestWhatsApp = async () => {
    if (!s.waPhoneNumberId || !s.waAccessToken)
      return toast.error("Please fill in Phone Number ID and Access Token first.");
    const phone = s.phone.replace(/\D/g, "");
    if (!phone) return toast.error("Please set your company phone number first.");

    setTestingWa(true);
    store.saveSettings(s);
    const testInv: any = {
      number: "TEST-001",
      date: new Date().toISOString(),
      customerName: "Test Customer",
      customerPhone: phone,
      customerEmail: s.email,
      items: [{ name: "Test Item", qty: 1, unitPrice: 100 }],
      grandTotal: 100,
      discountTotal: 0,
      balanceDue: 0,
      paymentStatus: "paid",
    };
    const result = await sendWhatsAppAuto(testInv, { ...s });
    setTestingWa(false);
    if (result.ok) toast.success("✅ Test WhatsApp sent to your number!");
    else toast.error(`WhatsApp test failed: ${result.error}`);
  };

  // Test Email – sends a test email to your own address
  const handleTestEmail = async () => {
    if (!s.appsScriptUrl)
      return toast.error("Please configure and save Google Apps Script Web App URL first.");
    if (!s.email) return toast.error("Please set your company email first.");

    setTestingEmail(true);
    store.saveSettings(s);
    const testInv: any = {
      number: "TEST-001",
      date: new Date().toISOString(),
      customerName: "Test Customer",
      customerPhone: s.phone,
      customerEmail: s.email,
      items: [{ name: "Test Item", qty: 1, unitPrice: 100 }],
      grandTotal: 100,
      discountTotal: 0,
      balanceDue: 0,
      paymentStatus: "paid",
    };
    const result = await sendEmailAuto(testInv, { ...s });
    setTestingEmail(false);
    if (result.ok) toast.success("✅ Test email sent to your company email!");
    else toast.error(`Email test failed: ${result.error}`);
  };

  return (
    <div className="grid gap-5 max-w-3xl">
      {/* ── Company Details ─────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Company Details</CardTitle>
          <CardDescription>Appears on every invoice and purchase bill PDF.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Company Logo</Label>
            <div className="flex items-center gap-4">
              {s.logoBase64 ? (
                <div className="relative">
                  <img
                    src={s.logoBase64}
                    alt="Logo preview"
                    className="h-16 w-auto rounded border object-contain bg-muted px-2"
                  />
                  <button
                    onClick={() => set("logoBase64", "")}
                    className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div className="h-16 w-32 rounded border-2 border-dashed flex items-center justify-center text-xs text-muted-foreground">
                  No logo
                </div>
              )}
              <div>
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Upload Logo
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogo}
                />
                <p className="text-xs text-muted-foreground mt-1">PNG, JPG up to 500 KB</p>
              </div>
            </div>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>Company Name</Label>
            <Input value={s.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <Input value={s.currency} onChange={(e) => set("currency", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Invoice Prefix</Label>
            <Input
              placeholder="SAL"
              value={s.invoicePrefix}
              onChange={(e) => set("invoicePrefix", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Purchase Bill Prefix</Label>
            <Input
              placeholder="PUR"
              value={s.purchasePrefix}
              onChange={(e) => set("purchasePrefix", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={s.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={s.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>WhatsApp Number</Label>
            <Input
              placeholder="+91 98765 43210"
              value={s.whatsapp}
              onChange={(e) => set("whatsapp", e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Address</Label>
            <Textarea rows={2} value={s.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Terms &amp; Conditions (shown on PDFs)</Label>
            <Textarea
              rows={4}
              placeholder="1. Goods once sold will not be taken back&#10;2. Subject to local jurisdiction"
              value={s.termsAndConditions}
              onChange={(e) => set("termsAndConditions", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Google Apps Script ──────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Google Apps Script Sync</CardTitle>
          <CardDescription>
            Deploy the provided Apps Script as a Web App, then paste the URL below to automatically
            sync all records to Google Sheets and Drive.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Web App URL</Label>
            <Input
              placeholder="https://script.google.com/macros/s/AKfyc.../exec"
              value={s.appsScriptUrl || ""}
              onChange={(e) => set("appsScriptUrl", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>API Security Key (For backend authentication)</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Secure API key (Auto-generated on Save if blank)"
                value={s.apiKey || ""}
                onChange={(e) => set("apiKey", e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
                  let key = "";
                  for (let i = 0; i < 32; i++) {
                    key += chars.charAt(Math.floor(Math.random() * chars.length));
                  }
                  set("apiKey", key);
                  toast.success("API key generated. Save Settings to store it.");
                }}
              >
                Generate
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Protects your Google Apps Script backend sheet from unauthorized sync requests.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave blank to keep data local-only (browser storage). When set, all mutations are
            mirrored to Google Sheets and PDFs are saved to Google Drive.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={handleForceSync} disabled={syncing || pulling}>
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CloudUpload className="h-4 w-4 mr-2" />
              )}
              {syncing ? "Syncing..." : "Sync All Local Data to Cloud"}
            </Button>
            <Button variant="outline" onClick={handlePullFromCloud} disabled={syncing || pulling}>
              {pulling ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CloudUpload className="h-4 w-4 mr-2 rotate-180" />
              )}
              {pulling ? "Restoring..." : "Restore All Data from Cloud"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Auto-Send: WhatsApp Business Cloud API ───── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-green-600" />
                Auto-Send via WhatsApp
              </CardTitle>
              <CardDescription className="mt-1">
                Automatically sends the invoice to the customer&apos;s WhatsApp the moment it is
                saved. Uses the WhatsApp Business Cloud API (Meta) — no user interaction needed.
              </CardDescription>
            </div>
            <Toggle checked={!!s.autoSendWhatsApp} onChange={(v) => set("autoSendWhatsApp", v)} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-3 text-sm text-green-800 dark:text-green-200">
            <p className="font-semibold mb-1">📋 Setup (one-time)</p>
            <ol className="list-decimal pl-4 space-y-1 text-xs">
              <li>
                Go to <strong>developers.facebook.com</strong> → My Apps → Create App → Choose{" "}
                <em>Business</em> → Add <strong>WhatsApp</strong> product
              </li>
              <li>
                In <strong>WhatsApp → API Setup</strong>, note your{" "}
                <strong>Phone Number ID</strong>
              </li>
              <li>
                Go to <strong>Business Settings → System Users</strong> → create a System User →
                generate a <strong>Permanent Token</strong> with <em>whatsapp_business_messaging</em>{" "}
                permission
              </li>
              <li>Paste both values below, toggle ON, and click Save All Settings</li>
            </ol>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Phone Number ID</Label>
              <Input
                placeholder="123456789012345"
                value={s.waPhoneNumberId || ""}
                onChange={(e) => set("waPhoneNumberId", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Access Token</Label>
              <Input
                type="password"
                placeholder="EAAxxxxxxx…"
                value={s.waAccessToken || ""}
                onChange={(e) => set("waAccessToken", e.target.value)}
              />
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleTestWhatsApp}
            disabled={testingWa}
            className="gap-2"
          >
            {testingWa ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send Test WhatsApp to My Number
          </Button>
        </CardContent>
      </Card>

      {/* ── Auto-Send: Google Apps Script Email (Free) ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-600" />
                Auto-Send via Email (Free)
              </CardTitle>
              <CardDescription className="mt-1">
                Automatically emails the invoice summary to the customer as soon as it is saved.
                Uses your Google Apps Script Web App to send emails completely for free from your Google account.
              </CardDescription>
            </div>
            <Toggle checked={!!s.autoSendEmail} onChange={(v) => set("autoSendEmail", v)} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3 text-sm text-blue-800 dark:text-blue-200">
            <p className="font-semibold mb-1">📋 Setup (one-time)</p>
            <ol className="list-decimal pl-4 space-y-1 text-xs">
              <li>
                Ensure you have configured and saved the **Google Apps Script Web App URL** in the card above.
              </li>
              <li>
                The system will format and send professional HTML invoice emails automatically from the Google account linked to the Apps Script.
              </li>
              <li>
                There are no monthly fees, no setup tokens, and no email service limits to configure.
              </li>
            </ol>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Sales CC Email 1</Label>
              <Input
                type="email"
                placeholder="sales1@example.com"
                value={s.salesEmail1 || ""}
                onChange={(e) => set("salesEmail1", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Sales CC Email 2</Label>
              <Input
                type="email"
                placeholder="sales2@example.com"
                value={s.salesEmail2 || ""}
                onChange={(e) => set("salesEmail2", e.target.value)}
              />
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleTestEmail}
            disabled={testingEmail}
            className="gap-2"
          >
            {testingEmail ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send Test Email to My Address
          </Button>
        </CardContent>
      </Card>

      {/* ── Staff & User Management ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-600" />
              Staff & User Management
            </CardTitle>
            <CardDescription className="mt-1">
              Create and manage login accounts for your staff, accountants, and other administrators.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditingUser(null);
              setUserDraft({ name: "", username: "", password: "", role: "staff", email: "" });
              setUserModalOpen(true);
            }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> Add User
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Fallback default admin Mrsauce representation */}
                <TableRow>
                  <TableCell className="font-medium text-muted-foreground">System Admin (Default)</TableCell>
                  <TableCell className="font-mono text-muted-foreground">mrsauce</TableCell>
                  <TableCell className="text-muted-foreground">mrsaucereport@gmail.com</TableCell>
                  <TableCell>
                    <Badge variant="default" className="bg-indigo-600/80 hover:bg-indigo-600/80">admin</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded italic">Protected</span>
                  </TableCell>
                </TableRow>

                {/* Custom users */}
                {usersList.map((u) => (
                  <TableRow key={u.username}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="font-mono">{u.username}</TableCell>
                    <TableCell>{u.email || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : u.role === "accountant" ? "secondary" : "outline"} className="capitalize">
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditingUser(u.username);
                            setUserDraft({
                              name: u.name,
                              username: u.username,
                              password: "",
                              role: u.role,
                              email: u.email || "",
                            });
                            setUserModalOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={u.username === "mrsauce" || u.username === currentUsername}
                          onClick={() => {
                            if (!confirm(`Are you sure you want to delete user "${u.username}"?`)) return;
                            const updatedUsers = usersList.filter((x) => x.username !== u.username);
                            set("users", updatedUsers);
                            toast.success(`User ${u.username} marked for deletion. Save Settings to commit.`);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

                {usersList.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-xs text-muted-foreground italic">
                      No additional staff or custom accounts created. Click "Add User" to set up staff logins.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={userModalOpen} onOpenChange={setUserModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingUser ? "Edit User Account" : "Add User Account"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1">
              <Label>Full Name</Label>
              <Input
                placeholder="e.g. John Doe"
                value={userDraft.name}
                onChange={(e) => setUserDraft({ ...userDraft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Username (used to log in)</Label>
              <Input
                placeholder="e.g. johndoe"
                disabled={!!editingUser}
                value={userDraft.username}
                onChange={(e) => setUserDraft({ ...userDraft, username: e.target.value.toLowerCase().replace(/\s+/g, "") })}
              />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="e.g. john@example.com"
                value={userDraft.email}
                onChange={(e) => setUserDraft({ ...userDraft, email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Password {editingUser && <span className="text-[10px] text-muted-foreground">(leave blank to keep current)</span>}</Label>
              <Input
                type="password"
                placeholder={editingUser ? "••••••••" : "Enter password"}
                value={userDraft.password}
                onChange={(e) => setUserDraft({ ...userDraft, password: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select
                value={userDraft.role}
                onValueChange={(v) => setUserDraft({ ...userDraft, role: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin (Full Access)</SelectItem>
                  <SelectItem value="staff">Staff (Restricted Access, No Delete)</SelectItem>
                  <SelectItem value="accountant">Accountant (Expenses, Reports, Cashflow, No Delete)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveUser}>
              {editingUser ? "Save Changes" : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset System & Clear All Data ── */}
      <Card className="border-destructive/30 bg-destructive/5 dark:bg-destructive/10">
        <CardHeader>
          <CardTitle className="text-destructive dark:text-red-400">Danger Zone: Reset Database</CardTitle>
          <CardDescription>
            Completely delete all customer data, invoices, purchase bills, inventory stock, and activity logs from both this browser and Google Sheets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={async () => {
              if (!confirm("⚠️ WARNING: This will permanently DELETE all invoices, purchases, payments, customers, and inventory data from BOTH this browser and Google Sheets. This action is irreversible. Are you sure you want to continue?")) return;
              if (!confirm("🚨 DOUBLE CONFIRMATION: Are you absolutely sure? There is no backup and all sheets will be wiped!")) return;
              
              const tid = toast.loading("Clearing database in Google Sheets...");
              try {
                if (s.appsScriptUrl) {
                  await syncToAppsScript({ type: "database.clear" });
                }
                
                // Clear browser local storage keys (excluding settings and seeded flag)
                const keysToKeep = ["sibms.settings", "sibms.theme", "sibms.session", "sibms.seeded"];
                const keys = Object.keys(localStorage);
                keys.forEach((k) => {
                  if (k.startsWith("sibms.") && !keysToKeep.includes(k)) {
                    localStorage.removeItem(k);
                  }
                });
                // Note: We deliberately KEEP sibms.seeded so the sample data does NOT re-populate.
                
                toast.success("✅ Database reset complete!");
                setTimeout(() => {
                  window.location.href = "/";
                }, 1000);
              } catch (e) {
                toast.error("Wipe failed, check console.");
                console.error(e);
              } finally {
                toast.dismiss(tid);
              }
            }}
          >
            Reset All System Data
          </Button>
        </CardContent>
      </Card>

      <div className="flex gap-3 pb-8">
        <Button onClick={save} disabled={savingSettings}>
          {savingSettings ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save All Settings
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            if (!confirm("Discard all unsaved changes?")) return;
            setS(store.getSettings());
          }}
          disabled={savingSettings}
        >
          Discard Changes
        </Button>
      </div>
    </div>
  );
}
