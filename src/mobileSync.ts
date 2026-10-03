import { registerPlugin } from "@capacitor/core";
import { isAssetPackage } from "./assetPackage";
import type { CharacterAssetPackage } from "./assetPackage";
import { parsePairingQr } from "./pairing";

export interface SyncStatus {
  enabled: boolean; urls: string[]; devices: number; lastSent?: string | null; expiresIn?: number;
  revision?: string; publishedAt?: string | null; publishedSnapshotId?: string | null;
}

export function validateSyncStatus(value: unknown): SyncStatus {
  if (!value || typeof value !== "object") throw new Error("电脑同步状态无效，请重试或升级电脑程序。");
  const row = value as Partial<SyncStatus>;
  const date = (v: unknown) => v === undefined || v === null || typeof v === "string" && v.length <= 80 && Number.isFinite(Date.parse(v));
  if (typeof row.enabled !== "boolean" || !Number.isInteger(row.devices) || row.devices! < 0 || row.devices! > 8
    || !Array.isArray(row.urls) || row.urls.length > 64 || row.urls.some(url => typeof url !== "string")
    || (!row.enabled && row.urls.length !== 0) || !date(row.lastSent) || !date(row.publishedAt)
    || row.expiresIn !== undefined && (!Number.isInteger(row.expiresIn) || row.expiresIn < 0 || row.expiresIn > 600)
    || row.revision !== undefined && (typeof row.revision !== "string" || !/^[a-f0-9]{64}$/.test(row.revision))
    || row.publishedSnapshotId != null && (typeof row.publishedSnapshotId !== "string" || row.publishedSnapshotId.length > 160)) {
    throw new Error("电脑同步状态无效，请重试或升级电脑程序。");
  }
  try { row.urls.forEach(url => parsePairingQr(url)); }
  catch { throw new Error("电脑返回的配对信息无效，已停止展示二维码，请重试。"); }
  return row as SyncStatus;
}
export const LocalSync = registerPlugin<{
  scan(): Promise<{ value: string }>;
  status(): Promise<{ paired: boolean; host: string }>;
  forget(): Promise<void>;
  receive(options: { qr?: string }): Promise<{ archive: unknown; revision: string }>;
}>("LocalSync");

export async function desktopSync(action: "status" | "publish" | "stop", archive?: CharacterAssetPackage, newInvite = false): Promise<SyncStatus> {
  try {
    const response = await fetch(`/api/mobile-sync/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Nioh2-Desktop-Sync": "1" },
      body: JSON.stringify({ archive, newInvite }), signal: AbortSignal.timeout(20000),
    });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(value && typeof value === "object" && "error" in value && typeof value.error === "string"
      ? value.error : "电脑同步服务不可用，请使用新版电脑程序。");
    return validateSyncStatus(value);
  } catch (reason) {
    if (reason instanceof DOMException && (reason.name === "TimeoutError" || reason.name === "AbortError")) throw new Error("同步操作等待超时，结果尚未确认。请等待状态更新后重试。");
    if (reason instanceof SyntaxError) throw new Error("电脑服务未返回有效的同步状态，请确认程序正在运行后重试。");
    if (reason instanceof TypeError) throw new Error("无法连接电脑同步服务，请确认程序正在运行后重试。");
    throw reason;
  }
}

export function validateSyncResponse(value: { archive: unknown; revision: string }): CharacterAssetPackage {
  if (!value || typeof value !== "object" || !isAssetPackage(value.archive) || typeof value.revision !== "string" || value.revision.length !== 64 || !/^[a-f0-9]{64}$/.test(value.revision)) throw new Error("电脑返回的档案无效，旧档案未改变。");
  return value.archive;
}
