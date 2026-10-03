import type { CharacterStatus } from "./characterStatus";

export interface EffectValueDetail {
  rawValue: number;
  kind: 'numeric' | 'grade' | 'condition' | 'non-numeric' | 'unresolved-grade' | 'unverified-unit' | 'unknown';
  encoding: 'verified-id' | 'legacy-cap' | 'not-decoded';
}

export type AttributeKey =
  | "constitution"
  | "heart"
  | "courage"
  | "stamina"
  | "strength"
  | "skill"
  | "dexterity"
  | "magic";

export interface EquipmentItem {
  recordIndex: number;
  equipIndex: number;
  id: string;
  name: string;
  nameZh?: string | null;
  level: number;
  plus: number;
  rarity: string;
  setOrGrace: string;
  effects?: string[];
  effectsZh?: Array<string | null>;
  effectIds?: string[];
  effectMagnitudes?: Array<string | null>;
  effectValueDetails?: EffectValueDetail[];
  type: string;
}

export interface LoadoutItem extends EquipmentItem {
  slot: string;
}

export interface InventoryItem {
  recordIndex: number;
  id: string;
  name: string;
  nameZh?: string | null;
  type: string;
  quantity: number;
}

export interface ScrollRecord {
  recordIndex: number;
  id: string;
  name: string;
  nameZh?: string | null;
  level: number;
  rarity: string;
  attemptsRemaining: number;
  effects: string[];
  effectsZh?: Array<string | null>;
  effectIds?: string[];
  effectMagnitudes?: Array<string | null>;
  effectValueDetails?: EffectValueDetail[];
}

export interface SaveSnapshot {
  schemaVersion: string;
  parserVersion?: string;
  game: string;
  platform: string;
  snapshotId: string;
  researchLabel?: string;
  sourceLastWriteLocal: string;
  safety: {
    sourceOpenedReadOnly: boolean;
    parsedFromCopy: boolean;
    originalMainSaveSha256: string;
    snapshotCopySha256?: string;
    originalHashUnchangedAfterProcessing: boolean;
  };
  privacy?: {
    redactedForSharing: boolean;
  };
  character: {
    level: number;
    amrita: number;
    gold: number;
    attributes: Record<AttributeKey, number>;
    proficiency: Record<string, number>;
    skillPointCounters?: Record<string, { temporary: number; permanent: number }>;
  };
  currentLoadout: LoadoutItem[];
  characterStatus?: CharacterStatus;
  currentLoadoutName?: string | null;
  savedEquipmentPresetName?: string | null;
  emptyLoadoutSlots?: number[];
  loadoutSource?: "inventory-equipped-marker" | string;
  equipmentInventory?: EquipmentItem[];
  inventoryItems?: InventoryItem[];
  scrolls?: ScrollRecord[];
  inventorySummary: {
    equipmentRecords: number;
    equipmentUnknownIds: number;
    equipmentByType: Record<string, number>;
    stackedItemRecords: number;
    scrollRecordsDetected: number;
  };
  backupComparison?: {
    backupLastWriteLocal: string;
    level: number;
    amrita: number;
    gold: number;
    attributeChangesToCurrent: Record<string, number>;
    binaryChangedBytes?: number;
    binaryChangedRanges?: number;
    loadoutChanged?: boolean;
    inventoryChanged?: boolean;
    inventoryQuantityChanges?: Array<{
      id: string;
      nameZh?: string | null;
      name?: string | null;
      before: number;
      after: number;
      delta: number;
    }>;
    copyHashesUnchangedAfterParsing?: boolean;
  };
  limitations: string[];
}

export type ViewName = "overview" | "builds" | "loadout" | "equipment" | "inventory" | "scrolls" | "history" | "pairing" | "install" | "progress" | "safety";

export interface SnapshotSummary {
  snapshotId: string;
  researchLabel?: string;
  createdAt?: string;
  level?: number;
  parserVersion?: string;
}

export interface AgentStatus {
  status: "ok";
  apiVersion?: string;
  writeBackSupported: false;
  refreshAvailable: boolean;
  lanMode: boolean;
  source?: {
    configured: boolean;
    accountHint: string | null;
    saveSlots: string[];
    latestWriteLocal: string | null;
  };
  backupCopies?: {
    completeCopies: number;
    incompleteCopies: number;
    latestCreatedAtUtc: string | null;
  };
  steamCloud?: {
    detected: boolean;
    state: "synchronized" | "local-newer" | "cloud-newer" | "unknown" | "unavailable";
    lastRemoteWriteLocal: string | null;
    metadataLastWriteLocal: string | null;
    sizeMatches?: boolean;
    contentMatches?: boolean | null;
    localMetadataTime?: string | null;
  };
}

export interface SaveSourceOption {
  id: string;
  accountHint: string | null;
  slot: string;
  latestWriteLocal: string | null;
  active: boolean;
}

export interface DeviceArchiveInfo {
  schemaVersion: "1.0.0";
  importedAt: string;
  exportedAt?: string;
  sourceSnapshotId: string;
  sourceLastWriteLocal: string;
  buildCount: number;
  source: "asset-package" | "legacy-snapshot" | "computer-sync";
}
