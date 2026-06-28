import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FileText,
  Users,
  Package,
  Settings as SettingsIcon,
  LogOut,
  Receipt,
  ShoppingCart,
  Building2,
  BarChart3,
  Wallet,
  CreditCard,
  Activity,
  PoundSterling,
  FileDown,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

const mainItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Sales", url: "/invoices", icon: FileText },
  { title: "Purchases", url: "/purchases", icon: ShoppingCart },
  { title: "Expenses", url: "/expenses", icon: Wallet },
  { title: "Payments", url: "/payments", icon: CreditCard },
];

const masterItems = [
  { title: "Customers", url: "/customers", icon: Users },
  { title: "Vendors", url: "/vendors", icon: Building2 },
  { title: "Inventory", url: "/inventory", icon: Package },
];

const otherItems = [
  { title: "Cash / Bank Flow", url: "/cashflow", icon: PoundSterling },
  { title: "Statements", url: "/statements", icon: FileDown },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Activity Log", url: "/activity", icon: Activity },
];

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { user, logout } = useAuth();
  const isActive = (u: string) => path === u || path.startsWith(u + "/");

  const isAdmin = user?.role === "admin";
  const isStaff = user?.role === "staff";

  // Filter items based on user role
  const filteredMainItems = mainItems.filter((item) => {
    if (isStaff && item.url === "/expenses") return false;
    return true;
  });

  const filteredOtherItems = otherItems.filter((item) => {
    if (isStaff) {
      const restricted = ["/cashflow", "/reports", "/activity"];
      if (restricted.includes(item.url)) return false;
    }
    return true;
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-10 w-10 items-center justify-center shrink-0">
            <img
              src="https://www.mrsauce.co.uk/public/assets/img/logo.png"
              alt="Mr Sauce Logo"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">Mr Sauce</span>
            <span className="text-xs text-muted-foreground">Billing System</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Transactions</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredMainItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Master Data</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {masterItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Analytics</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredOtherItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>System</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/settings")} tooltip="Settings">
                    <Link to="/settings">
                      <SettingsIcon />
                      <span>Settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <div className="px-2 py-2 group-data-[collapsible=icon]:hidden">
          <div className="text-sm font-medium">{user?.name}</div>
          <div className="text-xs text-muted-foreground capitalize">{user?.role}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={logout} className="justify-start gap-2">
          <LogOut className="h-4 w-4" />
          <span className="group-data-[collapsible=icon]:hidden">Logout</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
