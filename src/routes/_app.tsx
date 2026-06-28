import { createFileRoute, Outlet, redirect, useRouterState, Link } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/lib/auth";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { store } from "@/lib/storage";
import { Moon, Sun, RefreshCw, LayoutDashboard, FileText, ShoppingCart, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app")({
  beforeLoad: ({ location }) => {
    if (typeof window === "undefined") return;
    const s = store.getSession();
    if (!s) {
      throw redirect({ to: "/login", search: { redirect: location.pathname } });
    }
  },
  component: AppLayout,
});

const titles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/invoices": "Sales",
  "/invoices/new": "New Sale",
  "/purchases": "Purchases",
  "/purchases/new": "New Purchase Bill",
  "/customers": "Customers",
  "/vendors": "Vendors",
  "/inventory": "Inventory",
  "/statements": "Statements",
  "/reports": "Reports",
  "/settings": "Settings",
  "/expenses": "Expenses",
  "/payments": "Payments",
  "/cashflow": "Cash / Bank Flow",
  "/activity": "Activity Log",
};

function CloudSyncIndicator({
  status,
  onRetry,
}: {
  status: "idle" | "syncing" | "success" | "error";
  onRetry: () => void;
}) {
  if (status === "idle") return null;

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-card border-border shadow-sm transition-all duration-200 cursor-pointer select-none"
      onClick={status === "error" ? onRetry : undefined}
      title={
        status === "syncing"
          ? "Syncing data with Google Sheets..."
          : status === "success"
            ? "Synced and connected to Google Sheets"
            : "Offline or Sync failed. Click to retry."
      }
    >
      <span
        className={`h-2 w-2 rounded-full ${
          status === "syncing"
            ? "bg-amber-500 animate-pulse"
            : status === "success"
              ? "bg-emerald-500"
              : "bg-destructive animate-bounce"
        }`}
      />
      <span className="hidden sm:inline text-muted-foreground">
        {status === "syncing" && "Syncing..."}
        {status === "success" && "Connected"}
        {status === "error" && "Offline / Retry"}
      </span>
    </div>
  );
}

function AppLayout() {
  const { user } = useAuth();
  const nav = useNavigate();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return store.getTheme() === "dark";
  });
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");

  const syncDatabase = async () => {
    const url = store.getSettings().appsScriptUrl;
    if (!url) {
      setSyncStatus("idle");
      return;
    }
    setSyncStatus("syncing");
    try {
      const { syncToAppsScript } = await import("@/lib/api");
      const res = await syncToAppsScript({ type: "database.pull" });
      if (res && res.ok && res.data) {
        const data = res.data;

        // Restore settings if returned, keeping current URL
        if (data.settings) {
          const currentSettings = store.getSettings();
          store.saveSettings({ ...currentSettings, ...data.settings, appsScriptUrl: url });
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

        setSyncStatus("success");
      } else {
        console.warn("Silent background pull failed:", res?.error);
        setSyncStatus("error");
      }
    } catch (err) {
      console.error("Failed to sync database automatically:", err);
      setSyncStatus("error");
    }
  };

  // Trigger auto pull on login/mount
  useEffect(() => {
    if (user?.username) {
      void syncDatabase();
    }
  }, [user?.username]);

  // Apply dark mode class to <html>
  useEffect(() => {
    const html = document.documentElement;
    if (isDark) {
      html.classList.add("dark");
      store.setTheme("dark");
    } else {
      html.classList.remove("dark");
      store.setTheme("light");
    }
  }, [isDark]);

  // On mount, restore persisted theme
  useEffect(() => {
    const saved = store.getTheme();
    if (saved === "dark") {
      setIsDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  useEffect(() => {
    if (!user) nav({ to: "/login", search: { redirect: path } });
  }, [user, nav, path]);

  if (!user) return null;

  // Find title — also handle dynamic segments like /purchases/new
  const title =
    titles[path] ??
    (path.startsWith("/invoices/") ? "Invoice Detail" : null) ??
    (path.startsWith("/purchases/") ? "Purchase Detail" : null) ??
    "Smart Invoice";

  const mobileNavItems = [
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    { title: "Sales", url: "/invoices", icon: FileText },
    { title: "New Sale", url: "/invoices/new", icon: Plus, highlight: true },
    { title: "Purchases", url: "/purchases", icon: ShoppingCart },
    { title: "Inventory", url: "/inventory", icon: Package },
  ];

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-10 h-14 flex items-center gap-2 border-b bg-background/95 backdrop-blur-sm px-4 md:px-6">
            <SidebarTrigger />
            <h1 className="text-base md:text-lg font-semibold flex-1 truncate">{title}</h1>
            <CloudSyncIndicator status={syncStatus} onRetry={syncDatabase} />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.location.reload()}
              title="Refresh page"
              className="h-8 w-8"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsDark((d) => !d)}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              className="h-8 w-8"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </header>
          <main className="flex-1 p-3 md:p-5 overflow-auto pb-20 md:pb-5">
            <Outlet />
          </main>
          {/* Mobile Bottom Navigation Bar */}
          <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 bg-background/95 backdrop-blur-sm border-t flex items-center justify-around px-1 py-1 shadow-lg">
            {mobileNavItems.map((item) => {
              const isHighlight = (item as { highlight?: boolean }).highlight;
              const isActive = !isHighlight && (path === item.url || path.startsWith(item.url + "/"));
              return (
                <Link
                  key={item.url}
                  to={item.url}
                  className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all min-w-0 flex-1 ${
                    isHighlight
                      ? "bg-primary text-primary-foreground shadow-md scale-110 -mt-3"
                      : isActive
                        ? "text-primary"
                        : "text-muted-foreground"
                  }`}
                >
                  <item.icon className={isHighlight ? "h-5 w-5" : "h-4 w-4"} />
                  <span className="text-[10px] font-medium leading-tight truncate">{item.title}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </SidebarProvider>
  );
}
