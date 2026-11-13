export function isValidFreezeDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function shouldUnfreezeAfterCollection(freezeDate: string | null | undefined, collectionDate: string | null | undefined) {
  return Boolean(freezeDate && collectionDate && isValidFreezeDate(freezeDate) && isValidFreezeDate(collectionDate) && collectionDate > freezeDate);
}

export function frozenProjectionDate(selectedDate: string, freezeDate: string | null | undefined) {
  return freezeDate && isValidFreezeDate(freezeDate) && selectedDate >= freezeDate ? freezeDate : selectedDate;
}

type FreezeMetricPoint = { date: string; value: number; fetchedAt: string } | null;
type FreezeMetricValues = { followers: FreezeMetricPoint; following: FreezeMetricPoint; posts: FreezeMetricPoint };

export type FrozenMetricIndexEntry<Row> = {
  freezeDate: string;
  atFreeze: FreezeMetricValues;
  beforeFreeze: FreezeMetricValues;
  latestRow: Row | null;
};

export function buildFrozenMetricIndex<Row extends {
  account_id: string;
  account_status: string;
  freeze_date: string | null;
  fetched_at: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
}>(rows: readonly Row[], getRecordDate: (row: Row) => string | null) {
  const result = new Map<string, FrozenMetricIndexEntry<Row>>();
  const emptyMetrics = (): FreezeMetricValues => ({ followers: null, following: null, posts: null });
  for (const row of rows) {
    const freezeDate = row.freeze_date;
    if (row.account_status !== "suspended" || !isValidFreezeDate(freezeDate)) continue;
    const date = getRecordDate(row);
    if (!date || date > freezeDate) continue;
    let entry = result.get(row.account_id);
    if (!entry) {
      entry = { freezeDate, atFreeze: emptyMetrics(), beforeFreeze: emptyMetrics(), latestRow: null };
      result.set(row.account_id, entry);
    }
    if (!entry.latestRow) entry.latestRow = row;
    else {
      const currentDate = getRecordDate(entry.latestRow);
      if (!currentDate || date > currentDate || (date === currentDate && row.fetched_at >= entry.latestRow.fetched_at)) entry.latestRow = row;
    }
    for (const metric of ["followers", "following", "posts"] as const) {
      const value = row[metric];
      if (value === null || !Number.isFinite(value)) continue;
      const point = { date, value, fetchedAt: row.fetched_at };
      const latest = entry.atFreeze[metric];
      const previous = entry.beforeFreeze[metric];
      if (!latest || date > latest.date) {
        entry.beforeFreeze[metric] = latest;
        entry.atFreeze[metric] = point;
      } else if (date === latest.date) {
        if (row.fetched_at >= latest.fetchedAt) entry.atFreeze[metric] = point;
      } else if (!previous || date > previous.date) {
        entry.beforeFreeze[metric] = point;
      } else if (date === previous.date && row.fetched_at >= previous.fetchedAt) {
        entry.beforeFreeze[metric] = point;
      }
    }
  }
  return result;
}
