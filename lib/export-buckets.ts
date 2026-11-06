const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const THREE_HOUR_MS = 3 * 60 * 60 * 1000;

export type ThreeHourExportBucket = {
  key: string;
  label: string;
  endAt: number;
  distance: number;
  fetchedAt: number;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Return the JST three-hour export bucket for a timestamp.
 *
 * Buckets end at 00:00, 03:00, ..., 21:00 JST. A timestamp exactly on an
 * endpoint belongs to that endpoint; timestamps after it belong to the next
 * endpoint. Within a bucket, the caller can use `distance` to keep the sample
 * closest to the endpoint.
 */
export function threeHourExportBucket(value: string | number | Date): ThreeHourExportBucket | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const local = new Date(date.getTime() + JST_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const hour = local.getUTCHours();
  const minute = local.getUTCMinutes();
  const second = local.getUTCSeconds();
  const millisecond = local.getUTCMilliseconds();
  const elapsed = (((hour * 60 + minute) * 60 + second) * 1000) + millisecond;
  const endElapsed = elapsed % THREE_HOUR_MS === 0 ? elapsed : Math.ceil(elapsed / THREE_HOUR_MS) * THREE_HOUR_MS;
  const endpointLocal = new Date(Date.UTC(year, month, day) + endElapsed);
  const endpointUtc = endpointLocal.getTime() - JST_OFFSET_MS;
  const endpointYear = endpointLocal.getUTCFullYear();
  const endpointMonth = endpointLocal.getUTCMonth() + 1;
  const endpointDay = endpointLocal.getUTCDate();
  const endpointHour = endpointLocal.getUTCHours();
  const datePart = `${endpointYear}-${pad(endpointMonth)}-${pad(endpointDay)}`;
  const key = `${datePart} ${pad(endpointHour)}:00`;
  const label = `${String(endpointYear).slice(-2)}/${pad(endpointMonth)}/${pad(endpointDay)} ${pad(endpointHour)}:00`;
  return { key, label, endAt: endpointUtc, distance: Math.max(0, endpointUtc - date.getTime()), fetchedAt: date.getTime() };
}
