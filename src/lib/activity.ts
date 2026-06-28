import { store } from "./storage";
import { syncToAppsScript } from "./api";
import { uid } from "./format";
import type { ActivityLog } from "./types";

export async function logActivity(
  actionType: "Create" | "Edit" | "Delete",
  type: string, // e.g., "Customer", "Vendor", "Product", "Sale", "Purchase", "Payment"
  entityName: string,
  referenceId: string,
  status: string
) {
  const session = store.getSession();
  const userName = session ? session.name : "System";

  const log: ActivityLog = {
    id: uid("log_"),
    referenceId,
    type,
    entityName,
    status,
    user: userName,
    actionType,
    timestamp: new Date().toISOString(),
  };

  // 1. Save locally
  const currentLogs = store.activityLogs();
  store.saveActivityLogs([log, ...currentLogs]);

  // 2. Sync to cloud
  try {
    await syncToAppsScript({ type: "activity.create", payload: log });
  } catch (err) {
    console.warn("Failed to sync activity log to cloud", err);
  }
}
