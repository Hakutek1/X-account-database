"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ACCOUNT_STATUS_LABELS, ACCOUNT_STATUSES, isAccountStatus, type AccountStatus } from "../lib/account-status";
import { getRovingTabIndex } from "../lib/chart-accessibility";

type MetricKey = "followers" | "following" | "posts";
type AccountField = "accountId" | "handle" | "displayName" | "status";

type EditorAccount = {
  key: string;
  originalAccountId: string;
  accountId: string;
  handle: string;
  displayName: string;
  status: AccountStatus;
  avatarUrl: string | null;
};

type HistoricalResponse = {
  metric?: MetricKey;
  revision?: number;
  accounts?: Array<{ accountId: string; handle: string; displayName: string; status?: AccountStatus; avatarUrl?: string | null }>;
  dates?: string[];
  values?: Record<string, Record<string, number | null>>;
  error?: string;
};

const metricLabels: Record<MetricKey, string> = {
  followers: "フォロワー数",
  following: "フォロー数",
  posts: "投稿数",
};

function handleMetricTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>, onChange: (metric: MetricKey) => void) {
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
  const nextIndex = getRovingTabIndex(currentIndex, event.key, tabs.length);
  const metrics = Object.keys(metricLabels) as MetricKey[];
  if (nextIndex === null || !metrics[nextIndex] || !tabs[nextIndex]) return;
  event.preventDefault();
  onChange(metrics[nextIndex]);
  tabs[nextIndex].focus();
}

const MAX_AVATAR_BYTES = 512 * 1024;
const DIRECT_AVATAR_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(?:jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.name);
}

async function prepareAvatarFile(file: File) {
  if (!isImageFile(file)) throw new Error("画像ファイルを選択してください。");
  if (file.size <= 0) throw new Error("画像ファイルが空です。");
  if (file.size <= MAX_AVATAR_BYTES && DIRECT_AVATAR_CONTENT_TYPES.has(file.type)) return file;
  if (typeof createImageBitmap !== "function") throw new Error("この画像形式をブラウザで読み込めません。JPEG・PNG画像をお試しください。");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("この画像形式を読み込めません。JPEG・PNG・WebP画像をお試しください。");
  }

  try {
    let scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    let smallest: Blob | null = null;
    for (let round = 0; round < 6; round += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.68, 0.54, 0.42]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!blob) continue;
        smallest = !smallest || blob.size < smallest.size ? blob : smallest;
        if (blob.size <= MAX_AVATAR_BYTES) {
          const baseName = file.name.replace(/\.[^.]+$/, "") || "avatar";
          return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
        }
      }
      scale *= 0.75;
    }
    if (smallest && smallest.size <= MAX_AVATAR_BYTES) {
      const baseName = file.name.replace(/\.[^.]+$/, "") || "avatar";
      return new File([smallest], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    }
  } finally {
    bitmap.close();
  }
  throw new Error("画像を512KB以下に圧縮できませんでした。別の画像をお試しください。");
}

const CUTOFF = "2026-07-22";

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year.slice(2)}/${month}/${day}`;
}

function newKey() {
  return `new-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const HistoricalDataRow = memo(function HistoricalDataRow({ account, dates, metric, rowValues, onUpdateAccount, onUpdateCell, onRemove, onUploadAvatar, onRemoveAvatar, isUploadingAvatar }: {
  account: EditorAccount;
  dates: string[];
  metric: MetricKey;
  rowValues?: Record<string, number | null>;
  onUpdateAccount: (key: string, field: AccountField, value: string) => void;
  onUpdateCell: (accountKey: string, date: string, rawValue: string) => void;
  onRemove: (account: EditorAccount) => void;
  onUploadAvatar: (account: EditorAccount, file: File) => void;
  onRemoveAvatar: (account: EditorAccount) => void;
  isUploadingAvatar: boolean;
}) {
  return <tr>
    <td><input value={account.accountId} onChange={(event) => onUpdateAccount(account.key, "accountId", event.target.value)} aria-label={`${account.handle}のアカウントID`} /></td>
    <td><input value={account.handle} onChange={(event) => onUpdateAccount(account.key, "handle", event.target.value)} aria-label={`${account.accountId}のハンドル名`} /></td>
    <td><input value={account.displayName} onChange={(event) => onUpdateAccount(account.key, "displayName", event.target.value)} aria-label={`${account.accountId}の表示名`} /></td>
    <td className="historical-status-cell"><select value={account.status} onChange={(event) => onUpdateAccount(account.key, "status", event.target.value)} aria-label={`${account.accountId}の活動状態`}>{ACCOUNT_STATUSES.map((status) => <option key={status} value={status}>{ACCOUNT_STATUS_LABELS[status]}</option>)}</select></td>
    <td className="historical-avatar-cell"><div className="historical-avatar-editor">{account.avatarUrl ? <img src={account.avatarUrl} alt="" className="historical-avatar-preview" /> : <span className="historical-avatar-empty">未設定</span>}<label className="historical-avatar-upload"><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadAvatar(account, file); event.currentTarget.value = ""; }} disabled={isUploadingAvatar} /><span>{isUploadingAvatar ? "保存中…" : "画像を選択"}</span></label>{account.avatarUrl && <button type="button" className="historical-avatar-remove" onClick={() => onRemoveAvatar(account)} disabled={isUploadingAvatar}>削除</button>}</div></td>
    {dates.map((date) => <td key={date}><input className="historical-number-input" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} defaultValue={rowValues?.[date] ?? ""} onChange={(event) => onUpdateCell(account.key, date, event.target.value)} aria-label={`${account.accountId} ${displayDate(date)} ${metricLabels[metric]}`} /></td>)}
    <td><button type="button" className="historical-row-delete" onClick={() => onRemove(account)}>行を削除</button></td>
  </tr>;
});

export default function HistoricalDataEditor({ onSaved }: { onSaved: () => Promise<void> }) {
  const [metric, setMetric] = useState<MetricKey>("followers");
  const [accounts, setAccounts] = useState<EditorAccount[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, Record<string, number | null>>>({});
  const [revision, setRevision] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newAccount, setNewAccount] = useState({ accountId: "", handle: "", displayName: "" });
  const [uploadingAvatarKey, setUploadingAvatarKey] = useState<string | null>(null);
  const [tableVersion, setTableVersion] = useState(0);
  const draftValuesRef = useRef<Record<string, Record<string, number | null>>>({});

  const load = async (nextMetric: MetricKey) => {
    setIsLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/historical-data?metric=${nextMetric}`, { credentials: "same-origin", cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as HistoricalResponse;
      if (!response.ok) throw new Error(payload.error ?? "過去データを読み込めませんでした。");
      const nextAccounts = (payload.accounts ?? []).map((account) => ({ key: account.accountId, originalAccountId: account.accountId, avatarUrl: account.avatarUrl ?? null, accountId: account.accountId, handle: account.handle, displayName: account.displayName, status: account.status ?? "active" as const }));
      const nextValues: Record<string, Record<string, number | null>> = {};
      for (const account of nextAccounts) nextValues[account.key] = { ...(payload.values?.[account.accountId] ?? {}) };
      draftValuesRef.current = nextValues;
      setAccounts(nextAccounts);
      setDates([...(payload.dates ?? [])].sort());
      setValues(nextValues);
      setRevision(Number(payload.revision ?? 0));
      setTableVersion((current) => current + 1);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "過去データを読み込めませんでした。");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(metric); }, 0);
    return () => window.clearTimeout(timer);
  }, [metric]);

  const updateAccount = useCallback((key: string, field: AccountField, value: string) => {
    setAccounts((current) => current.map((account) => {
      if (account.key !== key) return account;
      if (field === "status") return isAccountStatus(value) ? { ...account, status: value } : account;
      return { ...account, [field]: value };
    }));
  }, []);

  const updateCell = useCallback((accountKey: string, date: string, rawValue: string) => {
    if (rawValue !== "" && !/^\d+$/.test(rawValue)) return;
    const value = rawValue === "" ? null : Number(rawValue);
    if (value !== null && !Number.isSafeInteger(value)) return;
    draftValuesRef.current[accountKey] = { ...(draftValuesRef.current[accountKey] ?? {}), [date]: Number.isFinite(value) ? value : null };
  }, []);

  const addDate = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      setError("日付はYYYY-MM-DD形式で入力してください。");
      return;
    }
    const parsed = new Date(`${newDate}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== newDate) {
      setError("存在する日付を入力してください。");
      return;
    }
    if (dates.includes(newDate)) {
      setError("その日付は既に存在します。");
      return;
    }
    setDates((current) => [...current, newDate].sort());
    setNewDate("");
    setError(null);
  };

  const removeDate = useCallback((date: string) => {
    if (!window.confirm(`${displayDate(date)}の${metricLabels[metric]}データを削除しますか？`)) return;
    setDates((current) => current.filter((item) => item !== date));
    setValues((current) => {
      const next = { ...current };
      for (const accountKey of Object.keys(next)) {
        const row = { ...(next[accountKey] ?? {}) };
        delete row[date];
        next[accountKey] = row;
      }
      return next;
    });
    for (const row of Object.values(draftValuesRef.current)) delete row[date];
  }, [metric]);

  const addAccount = () => {
    const accountId = newAccount.accountId.trim();
    const handle = newAccount.handle.trim().replace(/^@/, "").toLowerCase();
    const displayName = newAccount.displayName.trim();
    if (!accountId || !handle || !displayName) {
      setError("新しいアカウントのID・ハンドル名・表示名を入力してください。");
      return;
    }
    if (accounts.some((account) => account.accountId === accountId || account.handle.toLowerCase() === handle)) {
      setError("同じアカウントIDまたはハンドル名が既に存在します。");
      return;
    }
    const account = { key: newKey(), originalAccountId: accountId, accountId, handle, displayName, status: "active" as const, avatarUrl: null };
    setAccounts((current) => [...current, account]);
    setValues((current) => ({ ...current, [account.key]: {} }));
    draftValuesRef.current[account.key] = {};
    setNewAccount({ accountId: "", handle: "", displayName: "" });
    setError(null);
  };

  const removeAccount = useCallback((account: EditorAccount) => {
    if (!window.confirm(`@${account.handle}をサイトと共有サーバーから完全に削除しますか？過去データ・取得履歴・アイコンが削除され、元に戻せません。`)) return;
    setAccounts((current) => current.filter((item) => item.key !== account.key));
    setValues((current) => {
      const next = { ...current };
      delete next[account.key];
      return next;
    });
    delete draftValuesRef.current[account.key];
  }, []);

  const uploadAvatar = useCallback(async (account: EditorAccount, file: File) => {
    if (!isImageFile(file)) { setError("画像ファイルを選択してください。"); return; }
    setUploadingAvatarKey(account.key);
    setError(null);
    setMessage(null);
    try {
      const uploadFile = await prepareAvatarFile(file);
      const form = new FormData();
      form.set("accountId", account.accountId.trim());
      form.set("file", uploadFile);
      const response = await fetch("/api/admin/avatar", { method: "POST", credentials: "same-origin", cache: "no-store", body: form });
      const result = await response.json().catch(() => ({})) as { error?: string; avatarUrl?: string };
      if (!response.ok || !result.avatarUrl) throw new Error(result.error ?? "アイコンを保存できませんでした。");
      setAccounts((current) => current.map((item) => item.key === account.key ? { ...item, avatarUrl: result.avatarUrl ?? null } : item));
      setMessage("補填アイコンを保存しました。");
      await onSaved();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "アイコンを保存できませんでした。");
    } finally {
      setUploadingAvatarKey(null);
    }
  }, [onSaved]);

  const removeAvatar = useCallback(async (account: EditorAccount) => {
    if (!window.confirm(`@${account.handle}の補填アイコンを削除しますか？`)) return;
    setUploadingAvatarKey(account.key);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/avatar", { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify({ accountId: account.accountId.trim() }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "アイコンを削除できませんでした。");
      setAccounts((current) => current.map((item) => item.key === account.key ? { ...item, avatarUrl: null } : item));
      setMessage("補填アイコンを削除しました。");
      await onSaved();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "アイコンを削除できませんでした。");
    } finally {
      setUploadingAvatarKey(null);
    }
  }, [onSaved]);

  const save = async () => {
    if (isSaving || isLoading) return;
    if (!window.confirm("保存しますか？")) return;
    const payload = {
      metric,
      revision,
      accounts: accounts.map((account) => ({ accountId: account.accountId.trim(), originalAccountId: account.originalAccountId, handle: account.handle.trim().replace(/^@/, "").toLowerCase(), displayName: account.displayName.trim(), status: account.status })),
      dates,
      values: Object.fromEntries(accounts.map((account) => [account.accountId.trim(), Object.fromEntries(dates.map((date) => [date, draftValuesRef.current[account.key]?.[date] ?? null]))])),
    };
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/historical-data", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({})) as { error?: string; revision?: number; accounts?: number; dates?: number; cells?: number };
      if (!response.ok) throw new Error(result.error ?? "過去データを保存できませんでした。");
      setRevision(Number(result.revision ?? revision + 1));
      setMessage(`保存しました（${result.accounts ?? accounts.length}アカウント・${result.dates ?? dates.length}日・${result.cells ?? 0}セル）。`);
      await onSaved();
      await load(metric);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "過去データを保存できませんでした。");
    } finally {
      setIsSaving(false);
    }
  };

  const editorBusy = isLoading || isSaving || Boolean(uploadingAvatarKey);

  return <div className="historical-editor panel-card analysis-workspace-panel" role="tabpanel" id="dashboard-panel-historical" aria-labelledby="dashboard-tab-historical" tabIndex={0} aria-label="過去データ追加" aria-busy={editorBusy}>
    <div className="section-heading historical-editor-toolbar">
      <div>
        <p className="eyebrow">ADMINISTRATOR EDITOR</p>
        <h2>過去データ追加</h2>
        <p className="historical-editor-help">Excelの日次履歴と同じ形式です。日付・アカウント・数値を管理者が編集できます。</p>
      </div>
      <div className="historical-editor-actions"><button type="button" className="secondary-button" onClick={() => void load(metric)} disabled={editorBusy} aria-busy={isLoading}>{isLoading ? <><span className="button-spinner historical-button-spinner" aria-hidden="true" />読み込み中…</> : "再読み込み"}</button><button type="button" className="primary-button" onClick={() => void save()} disabled={editorBusy} aria-busy={isSaving}>{isSaving ? <><span className="button-spinner" aria-hidden="true" />保存中…</> : "変更を保存"}</button></div>
    </div>
    <div className="historical-metric-tabs" role="tablist" aria-label="編集する指標" onKeyDown={(event) => handleMetricTabKeyDown(event, setMetric)}>
      {(Object.keys(metricLabels) as MetricKey[]).map((item) => <button key={item} id={"historical-metric-tab-" + item} type="button" role="tab" aria-selected={metric === item} aria-controls={"historical-metric-panel-" + item} tabIndex={metric === item ? 0 : -1} className={metric === item ? "is-active" : ""} onClick={() => setMetric(item)} disabled={editorBusy}>{metricLabels[item]}</button>)}
    </div>
    <div id={"historical-metric-panel-" + metric} role="tabpanel" aria-labelledby={"historical-metric-tab-" + metric} tabIndex={0}>
    {error && <div className="notice notice-error" role="alert"><span>!</span>{error}</div>}
    {message && <div className="notice notice-success" role="status"><span>✓</span>{message}</div>}
    <div className="historical-editor-add-row">
      <label><span>日付を追加</span><input type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} disabled={editorBusy} /></label><button type="button" className="secondary-button" onClick={addDate} disabled={editorBusy}>{isLoading ? <><span className="button-spinner historical-button-spinner" aria-hidden="true" />読み込み中…</> : "日付を追加"}</button>
      <div className="historical-account-add"><span>アカウントを追加</span><input value={newAccount.accountId} onChange={(event) => setNewAccount((current) => ({ ...current, accountId: event.target.value }))} placeholder="アカウントID" aria-label="新しいアカウントID" disabled={editorBusy} /><input value={newAccount.handle} onChange={(event) => setNewAccount((current) => ({ ...current, handle: event.target.value }))} placeholder="ハンドル名" aria-label="新しいハンドル名" disabled={editorBusy} /><input value={newAccount.displayName} onChange={(event) => setNewAccount((current) => ({ ...current, displayName: event.target.value }))} placeholder="表示名" aria-label="新しい表示名" disabled={editorBusy} /><button type="button" className="secondary-button" onClick={addAccount} disabled={editorBusy}>{isLoading ? <><span className="button-spinner historical-button-spinner" aria-hidden="true" />読み込み中…</> : "追加"}</button></div>
    </div>
    {isLoading ? <div className="historical-editor-empty"><span className="button-spinner historical-loading-spinner" aria-hidden="true" />過去データを読み込んでいます…</div> : !accounts.length || !dates.length ? <div className="historical-editor-empty">編集するデータがありません。日付とアカウントを追加してください。</div> : <><p id="historical-grid-scroll-help" className="historical-scroll-hint">表は左右にスクロールできます。</p><div className="historical-grid-wrap" aria-describedby="historical-grid-scroll-help"><table key={tableVersion} className="historical-grid"><thead><tr><th>アカウントID</th><th>ハンドル名</th><th>表示名</th><th>活動状態</th><th>補填アイコン</th>{dates.map((date) => <th key={date}><span>{displayDate(date)}</span><button type="button" className="historical-delete-button" onClick={() => removeDate(date)} aria-label={`${displayDate(date)}を削除`} disabled={editorBusy}>×</button></th>)}<th>行操作</th></tr></thead><tbody>{accounts.map((account) => <HistoricalDataRow key={account.key} account={account} dates={dates} metric={metric} rowValues={values[account.key]} onUpdateAccount={updateAccount} onUpdateCell={updateCell} onRemove={removeAccount} onUploadAvatar={uploadAvatar} onRemoveAvatar={removeAvatar} isUploadingAvatar={uploadingAvatarKey === account.key} />)}</tbody></table></div></>}
    <div className="historical-editor-footnote">保存先：共有サーバーD1。Excelは保存後に「データ出力」を押すと最新状態で生成されます。日付列の削除は選択中の指標だけに適用されます。</div>
    </div>
    {(Object.keys(metricLabels) as MetricKey[]).filter((item) => item !== metric).map((item) => <div key={item} id={"historical-metric-panel-" + item} role="tabpanel" aria-labelledby={"historical-metric-tab-" + item} hidden />)}
  </div>;
}
