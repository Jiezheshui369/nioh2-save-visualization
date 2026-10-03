import type { AgentStatus, SaveSnapshot, SaveSourceOption, SnapshotSummary } from "./types";
import { isNativeApp } from "./runtime";
import { isSupportedSnapshot } from "./snapshotValidation";
import { validateSnapshotIndex } from "./snapshotSummary";
import { validateAgentStatus, validateSaveSources } from "./agentStatus";
export { isSupportedSnapshot } from "./snapshotValidation";
import { loadCachedSnapshot, loadCachedSnapshotById, loadCachedSnapshotIndex, saveCachedSnapshot, saveHistorySnapshot } from "./snapshotCache";

const API_BASE = "/api";
const TOKEN_KEY = "nioh2-pairing-token";
const MAX_SNAPSHOT_JSON_BYTES = 5 * 1024 * 1024;
export type SnapshotLoadSource = "api" | "cache" | "empty" | "import";
let lastLoadSource: SnapshotLoadSource = "api";

export function getLastLoadSource(): SnapshotLoadSource {
  return lastLoadSource;
}

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function pairingToken(): string {
  try {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("pair");
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      return token;
    }
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  if (isNativeApp()) throw new Error("手机应用展示本机档案，请通过“连接电脑”同步更新。");
  const token = pairingToken();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = window.setTimeout(() => controller.abort(new DOMException('电脑读取请求超时', 'TimeoutError')), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: token ? { "X-Nioh2-Token": token } : undefined });
    if (!response.ok) {
      let message = `请求失败：${response.status}`;
      try {
        const payload = await response.json() as { error?: string };
        if (payload && typeof payload.error === "string" && payload.error) message = payload.error;
      } catch {
        // Keep the status-based message when the response is not JSON.
      }
      throw new ApiRequestError(message, response.status);
    }
    const value = await response.json() as T;
    if (controller.signal.aborted) throw controller.signal.reason;
    return value;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function loadLatestSnapshot(signal?: AbortSignal): Promise<SaveSnapshot | null> {
  if (isNativeApp()) {
    const cached = await loadCachedSnapshot({ required: true });
    lastLoadSource = cached ? "cache" : "empty";
    return cached;
  }
  try {
    const snapshot = await fetchJson<SaveSnapshot>(`${API_BASE}/snapshots/latest`, signal);
    if (!isSupportedSnapshot(snapshot)) throw new Error("电脑返回的角色数据不完整，旧档案仍保留。");
    lastLoadSource = "api";
    await saveCachedSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ApiRequestError && error.status === 401) throw error;
    const cached = await loadCachedSnapshot();
    if (cached) {
      lastLoadSource = "cache";
      return cached;
    }
    lastLoadSource = "empty";
    return null;
  }
}

export async function loadSnapshotIndex(signal?: AbortSignal): Promise<SnapshotSummary[]> {
  try {
    return validateSnapshotIndex(await fetchJson<unknown>(`${API_BASE}/snapshots`, signal));
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ApiRequestError && error.status === 401) throw error;
    return loadCachedSnapshotIndex();
  }
}

export function loadPairingStatus(signal?: AbortSignal): Promise<{ enabled: boolean; urls: string[] }> {
  return fetchJson<{ enabled: boolean; urls: string[] }>(`${API_BASE}/pairing`, signal);
}

export async function loadAgentStatus(signal?: AbortSignal): Promise<AgentStatus> {
  return validateAgentStatus(await fetchJson<unknown>(`${API_BASE}/health`, signal));
}

export async function loadSaveSources(signal?: AbortSignal): Promise<SaveSourceOption[]> {
  return validateSaveSources(await fetchJson<unknown>(`${API_BASE}/sources`, signal));
}

export async function loadSnapshot(snapshotId: string, signal?: AbortSignal): Promise<SaveSnapshot> {
  try {
    const snapshot = await fetchJson<SaveSnapshot>(`${API_BASE}/snapshots/${encodeURIComponent(snapshotId)}`, signal);
    if (!isSupportedSnapshot(snapshot)) throw new Error("电脑返回的角色数据不完整，旧档案仍保留。");
    if (snapshot.snapshotId !== snapshotId) throw new Error("电脑返回的档案与所选档案不一致，旧档案仍保留。");
    lastLoadSource = "api";
    await saveCachedSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ApiRequestError && error.status === 401) throw error;
    const cached = await loadCachedSnapshotById(snapshotId);
    if (!cached) throw error;
    lastLoadSource = "cache";
    return cached;
  }
}

export async function cacheRecentSnapshots(limit = 20, signal?: AbortSignal): Promise<number> {
  const cappedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 20)) : 20;
  const summaries = validateSnapshotIndex(await fetchJson<unknown>(`${API_BASE}/snapshots`, signal));
  let saved = 0;
  for (const summary of summaries.slice(0, cappedLimit)) {
    const snapshot = await fetchJson<SaveSnapshot>(`${API_BASE}/snapshots/${encodeURIComponent(summary.snapshotId)}`, signal);
    if (!isSupportedSnapshot(snapshot)) throw new Error("下载的历史档案无效，已停止保存。");
    if (snapshot.snapshotId !== summary.snapshotId) throw new Error("下载的档案与列表不一致，已停止保存。");
    await saveHistorySnapshot(snapshot);
    saved += 1;
  }
  return saved;
}

export async function importSnapshot(file: File): Promise<SaveSnapshot> {
  if (file.size > MAX_SNAPSHOT_JSON_BYTES) {
    throw new Error("快照文件超过 5 MB 限制。");
  }
  const raw = await file.text();
  const value: unknown = JSON.parse(raw);
  if (!isSupportedSnapshot(value)) {
    throw new Error("文件不是受支持的仁王存档快照 JSON。 ");
  }
  const snapshot = value;
  lastLoadSource = "import";
  await saveCachedSnapshot(snapshot);
  return snapshot;
}

export async function refreshSnapshot(sourceId?: string, label?: string): Promise<SaveSnapshot> {
  if (isNativeApp()) throw new Error("请在电脑读取存档并发布，再从手机接收；手机不会直接读取电脑存档。");
  const token = pairingToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Nioh2-Desktop-Sync": "1" };
  if (token) headers["X-Nioh2-Token"] = token;
  const body: { sourceId?: string; label?: string } = {};
  if (sourceId) body.sourceId = sourceId;
  if (label?.trim()) body.label = label.trim();
  let response: Response;
  let value: unknown;
  try {
    response = await fetch(`${API_BASE}/refresh`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
    try { value = await response.json(); }
    catch (error) {
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) throw error;
      throw new Error(`电脑服务没有返回有效的刷新结果（HTTP ${response.status}），请稍后重试。`);
    }
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("等待刷新结果超时，电脑可能仍在解析，请稍后重试；这不代表解析已取消。");
    }
    if (error instanceof TypeError) throw new Error("无法连接电脑服务，请确认电脑程序仍在运行后重试。");
    throw error;
  }
  if (!response.ok) throw new Error(value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : `刷新失败：${response.status}`);
  const snapshot = value;
  if (!isSupportedSnapshot(snapshot)) throw new Error("刷新结果无效，旧档案仍保留。");
  lastLoadSource = "api";
  await saveCachedSnapshot(snapshot);
  return snapshot;
}
