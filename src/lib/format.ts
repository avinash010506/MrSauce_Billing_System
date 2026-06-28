import { store } from "./storage";

export const formatCurrency = (n: number, currencyCode?: string) => {
  const code = currencyCode || store.getSettings().currency || "GBP";
  let locale = "en-GB";
  if (code === "INR") locale = "en-IN";
  else if (code === "USD") locale = "en-US";
  else if (code === "EUR") locale = "en-DE";
  
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
};

export const inr = (n: number) => formatCurrency(n);

export const getCurrencySymbol = (currencyCode?: string) => {
  const code = currencyCode || store.getSettings().currency || "GBP";
  if (code === "GBP") return "£";
  if (code === "INR") return "₹";
  if (code === "USD") return "$";
  if (code === "EUR") return "€";
  return code;
};

export const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

export const uid = (prefix = "") =>
  prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const toLocalDateString = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const getLocalTodayISO = (): string => {
  return toLocalDateString(new Date());
};

export const getLocalFirstOfMonthISO = (): string => {
  return toLocalDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
};


export const getDueDays = (dateStr: string, dueDateStr?: string) => {
  if (!dueDateStr) return "—";
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(dueDateStr.split("T")[0]);
    const diffTime = end.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return `${Math.abs(diffDays)} Days Overdue`;
    } else if (diffDays === 0) {
      return "Due Today";
    } else {
      return `${diffDays} Days Left`;
    }
  } catch {
    return "—";
  }
};

export const getDueDaysCount = (dueDateStr?: string): number | null => {
  if (!dueDateStr) return null;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(dueDateStr.split("T")[0]);
    const diffTime = end.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
};
