import { ACCOUNT_STATUSES, type AccountStatus } from "./account-status.ts";

export type ChartPickerAccount = {
  handle: string;
  displayName: string;
  accountStatus: AccountStatus;
};

export type ChartPickerGroup<T extends ChartPickerAccount = ChartPickerAccount> = {
  status: AccountStatus;
  rows: T[];
};

export function filterChartPickerAccounts<T extends ChartPickerAccount>(
  rows: readonly T[],
  options: { query: string; selectedOnly: boolean; selectedHandles: readonly string[] },
) {
  const query = options.query.trim().replace(/^@/, "").toLocaleLowerCase("ja-JP");
  const selected = new Set(options.selectedHandles.map((handle) => handle.replace(/^@/, "").toLocaleLowerCase("ja-JP")));
  return rows.filter((row) => {
    const handle = row.handle.replace(/^@/, "").toLocaleLowerCase("ja-JP");
    const name = row.displayName.toLocaleLowerCase("ja-JP");
    return (!query || handle.includes(query) || name.includes(query))
      && (!options.selectedOnly || selected.has(handle));
  });
}

export function groupChartPickerAccounts<T extends ChartPickerAccount>(rows: readonly T[]): ChartPickerGroup<T>[] {
  return ACCOUNT_STATUSES
    .map((status) => ({ status, rows: rows.filter((row) => row.accountStatus === status) }))
    .filter((group) => group.rows.length > 0);
}

export function updateChartSelection(
  currentHandles: readonly string[],
  visibleRows: readonly Pick<ChartPickerAccount, "handle">[],
  enabled: boolean,
) {
  const visible = new Set(visibleRows.map((row) => row.handle.toLocaleLowerCase("ja-JP")));
  const current = currentHandles.map((handle) => handle.toLocaleLowerCase("ja-JP"));
  if (!enabled) return current.filter((handle) => !visible.has(handle));
  return [...new Set([...current, ...visible])];
}

export function getRovingTabIndex(currentIndex: number, key: string, count: number): number | null {
  if (count <= 0 || currentIndex < 0 || currentIndex >= count) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % count;
  if (key === "ArrowLeft") return (currentIndex - 1 + count) % count;
  return null;
}

export function getNextChartMarkIndex(currentIndex: number, key: string, count: number): number | null {
  if (count <= 0 || currentIndex < 0 || currentIndex >= count) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (currentIndex + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (currentIndex - 1 + count) % count;
  return null;
}
