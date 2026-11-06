export type ChartAxisDomain = { lower: number; upper: number };

const MIN_DOMAIN_SPAN = 1e-9;

export function resolveLinearAxisDomain({
  baseline,
  values,
  min,
  max,
}: {
  baseline: number;
  values: readonly number[];
  min: number | null;
  max: number | null;
}): ChartAxisDomain {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  const autoLower = Math.min(baseline, finiteValues.length ? Math.min(...finiteValues) : baseline);
  const autoUpper = Math.max(baseline, finiteValues.length ? Math.max(...finiteValues) : baseline + 1);
  const lower = min ?? autoLower;
  const upper = max ?? autoUpper;

  return upper > lower ? { lower, upper } : { lower, upper: lower + MIN_DOMAIN_SPAN };
}
