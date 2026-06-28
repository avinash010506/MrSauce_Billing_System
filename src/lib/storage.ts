import type {
  CompanySettings,
  Customer,
  Invoice,
  Product,
  PurchaseBill,
  Vendor,
  Expense,
  PaymentTransaction,
  ActivityLog,
  User,
} from "./types";

const K = {
  customers: "sibms.customers",
  products: "sibms.products",
  invoices: "sibms.invoices",
  purchaseBills: "sibms.purchaseBills",
  vendors: "sibms.vendors",
  expenses: "sibms.expenses",
  payments: "sibms.payments",
  activityLogs: "sibms.activityLogs",
  settings: "sibms.settings",
  session: "sibms.session",
  counter: "sibms.invoiceCounter",
  purchaseCounter: "sibms.purchaseCounter",
  theme: "sibms.theme",
};

const read = <T>(k: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (k: string, v: unknown) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(k, JSON.stringify(v));
  window.dispatchEvent(new CustomEvent("sibms:change", { detail: k }));
};

export const defaultSettings: CompanySettings = {
  companyName: "Mr Sauce",
  address: "Company Registered Office New Road, Mitcham, Surrey CR4 4LT",
  email: "mrsaucereport@gmail.com",
  phone: "07462252658",
  whatsapp: "07462252658",
  invoicePrefix: "SAL",
  purchasePrefix: "PUR",
  currency: "GBP",
  appsScriptUrl:
    import.meta.env.VITE_APPS_SCRIPT_URL ||
    "https://script.google.com/macros/s/AKfycby-bAjX2dsOU1zE4vsAqsqWvnsnpmZs0byR7LnZZ0WAOsDKMZnvQAyco-NbTEFJptq5VQ/exec",
  logoBase64: "https://www.mrsauce.co.uk/public/assets/img/logo.png",
  termsAndConditions:
    "1. Goods once sold will not be taken back.\n2. Subject to local jurisdiction.\n3. Payment due within 14 days of invoice date.",
  // Auto-send defaults (off)
  autoSendEmail: false,
  waPhoneNumberId: "",
  waAccessToken: "",
  autoSendWhatsApp: false,
};

// Seed sample data on first run
const seed = () => {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("sibms.seeded")) return;
  localStorage.setItem("sibms.seeded", "1");

  const products: Product[] = [
    {
      id: "p1",
      name: "Wireless Mouse",
      sku: "MOU-001",
      category: "Electronics",
      purchasePrice: 350,
      sellingPrice: 599,
      stock: 42,
      reorderLevel: 10,
    },
    {
      id: "p2",
      name: "USB-C Cable 1m",
      sku: "CAB-001",
      category: "Electronics",
      purchasePrice: 80,
      sellingPrice: 199,
      stock: 8,
      reorderLevel: 15,
    },
    {
      id: "p3",
      name: "Notebook A5",
      sku: "STA-001",
      category: "Stationery",
      purchasePrice: 45,
      sellingPrice: 120,
      stock: 120,
      reorderLevel: 25,
    },
    {
      id: "p4",
      name: "Office Chair",
      sku: "FUR-001",
      category: "Furniture",
      purchasePrice: 4200,
      sellingPrice: 6499,
      stock: 5,
      reorderLevel: 3,
    },
  ];
  const customers: Customer[] = [
    {
      id: "c1",
      name: "Rahul Sharma",
      phone: "9876543210",
      email: "rahul@example.com",
      address: "Pune, MH",
      createdAt: new Date().toISOString(),
    },
    {
      id: "c2",
      name: "Acme Traders",
      phone: "9123456780",
      email: "billing@acme.in",
      address: "456 Client St, Mumbai",
      createdAt: new Date().toISOString(),
    },
  ];
  const vendors: Vendor[] = [
    {
      id: "v1",
      name: "TechSupply Co.",
      phone: "9988776655",
      email: "supply@techco.in",
      address: "Tech Hub, Phase 1, Bangalore",
      createdAt: new Date().toISOString(),
    },
    {
      id: "v2",
      name: "Global Tech Supplies",
      phone: "07700 900 123",
      email: "sales@globaltech.co.uk",
      address: "15 Tech Park\nCambridge\nCB4 0WS",
      createdAt: new Date().toISOString(),
    },
  ];
  write(K.products, products);
  write(K.customers, customers);
  write(K.vendors, vendors);
  write(K.invoices, []);
  write(K.purchaseBills, []);
  write(K.expenses, []);
  write(K.payments, []);
  write(K.activityLogs, []);
};

const toLocalIsoString = (val: string | Date | undefined | null): string => {
  if (!val) return "";
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
  } catch {
    return String(val);
  }
};

if (typeof window !== "undefined") seed();

export const store = {
  // settings
  getSettings: (): CompanySettings => {
    const saved = read<Partial<CompanySettings>>("sibms.settings", {});
    let modified = false;

    // Migration for new company details
    if (saved.email === "enquiries@mrsauce.co.uk") {
      saved.email = "mrsaucereport@gmail.com";
      modified = true;
    }
    if (saved.phone === "07508 104 472") {
      saved.phone = "07462252658";
      modified = true;
    }
    if (saved.whatsapp === "07508 104 472") {
      saved.whatsapp = "07462252658";
      modified = true;
    }
    if (saved.address === "New Road, Mitcham, CR4 4LT") {
      saved.address = "Company Registered Office New Road, Mitcham, Surrey CR4 4LT";
      modified = true;
    }
    if (
      !saved.termsAndConditions ||
      saved.termsAndConditions ===
        "1. Goods once sold will not be taken back.\n2. Subject to local jurisdiction.\n3. Payment due within 30 days of invoice date."
    ) {
      saved.termsAndConditions =
        "1. Goods once sold will not be taken back.\n2. Subject to local jurisdiction.\n3. Payment due within 14 days of invoice date.";
      modified = true;
    }

    if (
      saved.appsScriptUrl &&
      (saved.appsScriptUrl.includes("AKfycbzvs2iHhs") ||
        saved.appsScriptUrl.includes("AKfycbyflvljw") ||
        saved.appsScriptUrl.includes("AKfychzcqn"))
    ) {
      delete saved.appsScriptUrl;
      modified = true;
    }

    if (modified && typeof window !== "undefined") {
      try {
        localStorage.setItem("sibms.settings", JSON.stringify(saved));
      } catch {}
    }
    return { ...defaultSettings, ...saved };
  },
  saveSettings: (s: CompanySettings) => {
    if (typeof window === "undefined") return;
    localStorage.setItem("sibms.settings", JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("sibms:change", { detail: "sibms.settings" }));
  },

  // theme
  getTheme: (): "light" | "dark" => read<"light" | "dark">(K.theme, "light"),
  setTheme: (t: "light" | "dark") => write(K.theme, t),

  // session
  getSession: () => read<User | null>(K.session, null),
  setSession: (s: unknown) => write(K.session, s),
  clearSession: () => write(K.session, null),

  // customers
  customers: (): Customer[] => read(K.customers, []),
  saveCustomers: (v: Customer[]) => write(K.customers, v),

  // vendors
  vendors: (): Vendor[] => read(K.vendors, []),
  saveVendors: (v: Vendor[]) => write(K.vendors, v),

  // products
  products: (): Product[] => {
    const list = read<Product[]>(K.products, []);
    return list.map((p) => ({
      ...p,
      purchasePrice: Number(p.purchasePrice) || 0,
      sellingPrice: Number(p.sellingPrice) || 0,
      stock: Number(p.stock) || 0,
      reorderLevel: Number(p.reorderLevel) || 0,
    }));
  },
  saveProducts: (v: Product[]) => write(K.products, v),

  // invoices
  invoices: (): Invoice[] => {
    const list = read<Invoice[]>(K.invoices, []);
    return list.map((i) => ({
      ...i,
      date: toLocalIsoString(i.date),
      dueDate: i.dueDate ? toLocalIsoString(i.dueDate) : i.dueDate,
    }));
  },
  saveInvoices: (v: Invoice[]) => {
    const list = v.map((i) => ({
      ...i,
      date: toLocalIsoString(i.date),
      dueDate: i.dueDate ? toLocalIsoString(i.dueDate) : i.dueDate,
    }));
    write(K.invoices, list);
  },

  // purchase bills
  purchaseBills: (): PurchaseBill[] => {
    const list = read<PurchaseBill[]>(K.purchaseBills, []);
    return list.map((b) => ({
      ...b,
      date: toLocalIsoString(b.date),
    }));
  },
  savePurchaseBills: (v: PurchaseBill[]) => {
    const list = v.map((b) => ({
      ...b,
      date: toLocalIsoString(b.date),
    }));
    write(K.purchaseBills, list);
  },

  // expenses
  expenses: (): Expense[] => {
    const list = read<Expense[]>(K.expenses, []);
    return list.map((e) => ({
      ...e,
      date: toLocalIsoString(e.date),
    }));
  },
  saveExpenses: (v: Expense[]) => {
    const list = v.map((e) => ({
      ...e,
      date: toLocalIsoString(e.date),
    }));
    write(K.expenses, list);
  },

  // payments
  payments: (): PaymentTransaction[] => {
    const list = read<PaymentTransaction[]>(K.payments, []);
    return list.map((p) => ({
      ...p,
      date: toLocalIsoString(p.date),
    }));
  },
  savePayments: (v: PaymentTransaction[]) => {
    const list = v.map((p) => ({
      ...p,
      date: toLocalIsoString(p.date),
    }));
    write(K.payments, list);
  },

  // activityLogs
  activityLogs: (): ActivityLog[] => {
    const list = read<ActivityLog[]>(K.activityLogs, []);
    return list.map((l) => ({
      ...l,
      timestamp: toLocalIsoString(l.timestamp),
    }));
  },
  saveActivityLogs: (v: ActivityLog[]) => {
    const list = v.map((l) => ({
      ...l,
      timestamp: toLocalIsoString(l.timestamp),
    }));
    write(K.activityLogs, list);
  },

  nextInvoiceNumber: (prefix: string) => {
    const list = read<Invoice[]>(K.invoices, []);
    const numbers = list
      .map((inv) => {
        if (!inv.number) return null;
        const regex = new RegExp(`^${prefix}-(\\d+)$`);
        const match = inv.number.match(regex);
        return match ? parseInt(match[1], 10) : null;
      })
      .filter((n): n is number => n !== null);
    const defaultMax = 619;
    const max = numbers.length > 0 ? Math.max(...numbers, defaultMax) : defaultMax;
    const n = max + 1;
    write(K.counter, n);
    const padded = String(n).padStart(3, '0');
    return `${prefix}-${padded}`;
  },

  nextPurchaseNumber: (prefix: string) => {
    const list = read<PurchaseBill[]>(K.purchaseBills, []);
    const numbers = list
      .map((bill) => {
        if (!bill.number) return null;
        const regex = new RegExp(`^${prefix}-(\\d+)$`);
        const match = bill.number.match(regex);
        return match ? parseInt(match[1], 10) : null;
      })
      .filter((n): n is number => n !== null);
    const defaultMax = 0;
    const max = numbers.length > 0 ? Math.max(...numbers, defaultMax) : defaultMax;
    const n = max + 1;
    write(K.purchaseCounter, n);
    const padded = String(n).padStart(3, '0');
    return `${prefix}-${padded}`;
  },
};

export const onStoreChange = (cb: () => void) => {
  const h = () => cb();
  window.addEventListener("sibms:change", h);
  window.addEventListener("storage", h);
  return () => {
    window.removeEventListener("sibms:change", h);
    window.removeEventListener("storage", h);
  };
};
