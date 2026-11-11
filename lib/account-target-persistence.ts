import { normalizeStoredHandleTargets } from "./account-targets";

export const ACCOUNT_TARGETS_STORAGE_KEY = "x-account-stats-account-targets-v1";
const MAX_ACCOUNT_TARGETS = 500;

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function normalizeTargetList(values: unknown[]) {
  return normalizeStoredHandleTargets(values.filter((value): value is string => typeof value === "string").join("\n")).handles.slice(0, MAX_ACCOUNT_TARGETS);
}

export function loadPersistedAccountTargets(storage: BrowserStorage, dashboardStorageKey: string): string[] {
  try {
    const current = storage.getItem(ACCOUNT_TARGETS_STORAGE_KEY);
    if (current !== null) {
      const parsed: unknown = JSON.parse(current);
      if (Array.isArray(parsed)) return normalizeTargetList(parsed);
    }
  } catch {
    // Fall back to the previous combined dashboard setting when the new value is missing or malformed.
  }

  try {
    const legacy = storage.getItem(dashboardStorageKey);
    if (!legacy) return [];
    const parsed = JSON.parse(legacy) as { accountInput?: unknown };
    if (typeof parsed.accountInput !== "string") return [];
    const handles = normalizeStoredHandleTargets(parsed.accountInput).handles.slice(0, MAX_ACCOUNT_TARGETS);
    storage.setItem(ACCOUNT_TARGETS_STORAGE_KEY, JSON.stringify(handles));
    return handles;
  } catch {
    return [];
  }
}

export function savePersistedAccountTargets(storage: BrowserStorage, handles: string[]) {
  const normalized = normalizeTargetList(handles);
  storage.setItem(ACCOUNT_TARGETS_STORAGE_KEY, JSON.stringify(normalized));
}

export function clearCachedDashboardAccountData(storage: BrowserStorage, dashboardStorageKey: string) {
  try {
    const saved = storage.getItem(dashboardStorageKey);
    if (!saved) return;
    const parsed = JSON.parse(saved) as Record<string, unknown>;
    for (const key of ["accountInput", "rows", "selectedHandles", "displayNameOverrides", "legendColors"]) {
      delete parsed[key];
    }
    storage.setItem(dashboardStorageKey, JSON.stringify(parsed));
  } catch {
    storage.removeItem(dashboardStorageKey);
  }
}
