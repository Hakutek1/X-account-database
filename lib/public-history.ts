type PublicRun = {
  id: string;
  fetched_at: string;
  success_count: number;
  error_count: number;
  source_summary?: string | null;
};

type PublicHistoryRow = {
  run_id: string;
  fetched_at: string;
};

type ReadStatement = {
  bind(...values: (string | number | null)[]): ReadStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

export type ReadOnlyHistoryDatabase = {
  prepare(query: string): ReadStatement;
};

function isImportedRun(sourceSummary: string | null | undefined) {
  if (!sourceSummary) return false;
  try {
    return JSON.parse(sourceSummary).imported === true;
  } catch {
    return false;
  }
}

export async function buildPublicHistoryResponse<Row extends PublicHistoryRow>(
  database: ReadOnlyHistoryDatabase,
  sessionId: string,
  loadRows: () => Promise<Row[]>,
) {
  const [runs, rows] = await Promise.all([
    database.prepare("SELECT id, fetched_at, success_count, error_count, source_summary FROM xstats_runs WHERE session_id = ? ORDER BY fetched_at DESC").bind(sessionId).all<PublicRun>(),
    loadRows(),
  ]);

  const knownRunIds = new Set(runs.results.map((run) => run.id));
  const syntheticRuns = [...new Map(
    rows
      .filter((row) => !knownRunIds.has(row.run_id))
      .map((row) => [row.run_id, { id: row.run_id, fetched_at: row.fetched_at, success_count: 0, error_count: 0 }]),
  ).values()];

  const latestCollectionRun = runs.results.find((run) => !isImportedRun(run.source_summary));
  const publicRuns = [
    ...runs.results.map((run) => ({
      id: run.id,
      fetched_at: run.fetched_at,
      success_count: run.success_count,
      error_count: run.error_count,
    })),
    ...syntheticRuns,
  ].sort((left, right) => right.fetched_at.localeCompare(left.fetched_at));

  return {
    runs: publicRuns,
    rows,
    latestCollection: latestCollectionRun
      ? {
          fetched_at: latestCollectionRun.fetched_at,
          success_count: latestCollectionRun.success_count,
          error_count: latestCollectionRun.error_count,
        }
      : null,
  };
}
