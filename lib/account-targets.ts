export type HandleTargetParseResult = {
  handles: string[];
  errors: string[];
};

export type AddHandleTargetsResult = HandleTargetParseResult & {
  added: string[];
  overflow: number;
};

const HANDLE_PATTERN = /^@?([A-Za-z0-9_]{1,15})$/;
const INPUT_SEPARATOR = /[\n,\s]+/;

function uniqueHandles(handles: string[]) {
  const seen = new Set<string>();
  return handles.filter((handle) => {
    const key = handle.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function valueToHandle(value: string) {
  const direct = value.match(HANDLE_PATTERN);
  if (direct) return direct[1];

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!/(^|\.)((x|twitter)\.com)$/.test(host)) return null;
    const firstSegment = url.pathname.split("/").filter(Boolean)[0];
    const profile = firstSegment?.match(HANDLE_PATTERN);
    return profile?.[1] ?? null;
  } catch {
    return null;
  }
}

export function parseHandleTargetInput(value: string): HandleTargetParseResult {
  const handles: string[] = [];
  const errors: string[] = [];

  for (const rawValue of value.split(INPUT_SEPARATOR)) {
    const token = rawValue.trim();
    if (!token) continue;
    const handle = valueToHandle(token);
    if (handle) handles.push(handle);
    else errors.push(token);
  }

  return { handles: uniqueHandles(handles), errors };
}

export function normalizeStoredHandleTargets(value: string): HandleTargetParseResult {
  return parseHandleTargetInput(value);
}

export function addHandleTargets(existing: string[], input: string, maximum = 500): AddHandleTargetsResult {
  const handles = uniqueHandles(existing.map((handle) => handle.replace(/^@/, "")));
  const parsed = parseHandleTargetInput(input);
  const seen = new Set(handles.map((handle) => handle.toLowerCase()));
  const candidates = parsed.handles.filter((handle) => {
    const key = handle.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const room = Math.max(0, maximum - handles.length);
  const added = candidates.slice(0, room);

  return {
    handles: [...handles, ...added],
    added,
    errors: parsed.errors,
    overflow: candidates.length - added.length,
  };
}

export function removeHandleTarget(handles: string[], target: string) {
  const targetKey = target.replace(/^@/, "").toLowerCase();
  return handles.filter((handle) => handle.replace(/^@/, "").toLowerCase() !== targetKey);
}
