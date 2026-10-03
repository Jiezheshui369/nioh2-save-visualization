import { isSupportedSnapshot } from "./snapshotValidation";
import { isSavedBuildList } from "./buildLibrary";
import type { SavedBuild } from "./buildLibrary";
import { createShareBuild, createShareSnapshot } from "./privacy";
import type { SaveSnapshot } from "./types";

export const ASSET_PACKAGE_FORMAT = "nioh2-character-assets";

export interface CharacterAssetPackage {
  format: typeof ASSET_PACKAGE_FORMAT;
  version: "1.0.0";
  exportedAt: string;
  character: SaveSnapshot;
  builds: SavedBuild[];
}

export function createAssetPackage(snapshot: SaveSnapshot, builds: SavedBuild[], exportedAt = new Date().toISOString()): CharacterAssetPackage {
  if (typeof exportedAt !== 'string' || exportedAt.length > 80 || !Number.isFinite(Date.parse(exportedAt))) {
    throw new Error('档案导出时间无效，未生成档案。');
  }
  if (builds.length > 50 || !isSavedBuildList(builds)) {
    throw new Error("配装册含有无效记录或超过 50 套，未生成不完整档案。请检查配装册后重试。");
  }
  return {
    format: ASSET_PACKAGE_FORMAT,
    version: "1.0.0",
    exportedAt,
    character: createShareSnapshot(snapshot),
    builds: builds.map(createShareBuild),
  };
}

export function isAssetPackage(value: unknown): value is CharacterAssetPackage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CharacterAssetPackage>;
  return candidate.format === ASSET_PACKAGE_FORMAT
    && candidate.version === "1.0.0"
    && typeof candidate.exportedAt === "string"
    && candidate.exportedAt.length <= 80
    && Number.isFinite(Date.parse(candidate.exportedAt))
    && isSupportedSnapshot(candidate.character)
    && Array.isArray(candidate.builds)
    && candidate.builds.length <= 50
    && isSavedBuildList(candidate.builds);
}

export async function readAssetFile(file: File): Promise<CharacterAssetPackage | SaveSnapshot> {
  if (file.size > 25 * 1024 * 1024) throw new Error("档案文件超过 25 MB 限制。");
  const value: unknown = JSON.parse(await file.text());
  if (isAssetPackage(value)) return value;
  if (isSupportedSnapshot(value)) return value;
  throw new Error("文件不是受支持的角色档案包或快照 JSON。");
}
