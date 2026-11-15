import { dailyRecordDate } from "./daily-history.ts";

export type DailyExportBucket = {
  key: string;
  label: string;
  fetchedAt: number;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Apply the same JST daily bucket used by acquisition and the Excel export. */
export function dailyExportBucket(value: string | number | Date): DailyExportBucket | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const key = dailyRecordDate(date.toISOString());
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  return {
    key,
    label: `${String(year).slice(-2)}/${pad(month)}/${pad(day)}`,
    fetchedAt: date.getTime(),
  };
}
