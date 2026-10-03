import type { EquipmentItem, LoadoutItem, SaveSnapshot, ScrollRecord } from "./types";
import type { SavedBuild } from "./buildLibrary";
import type { StatusGroup } from "./characterStatus";
import { isSupportedSnapshot } from "./snapshotValidation";

/** Export a defined contract, never arbitrary future diagnostics from an import. */
function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) if (Object.hasOwn(value, key)) result[key] = value[key];
  return result;
}
const attributeKeys = ["constitution", "heart", "courage", "stamina", "strength", "skill", "dexterity", "magic"] as const;
function effects(item: EquipmentItem | ScrollRecord) {
  return {
    effects: item.effects?.slice(), effectsZh: item.effectsZh?.slice(), effectIds: item.effectIds?.slice(),
    effectMagnitudes: item.effectMagnitudes?.slice(),
    effectValueDetails: item.effectValueDetails?.map(value => pick(value, ["rawValue", "kind", "encoding"])),
  };
}
function equipment(item: EquipmentItem): EquipmentItem {
  return { ...pick(item, ["recordIndex", "equipIndex", "id", "name", "nameZh", "level", "plus", "rarity", "setOrGrace", "type"]), ...effects(item) };
}
function loadout(item: LoadoutItem): LoadoutItem { return { ...equipment(item), slot: item.slot }; }
function groups(values: StatusGroup[]): StatusGroup[] {
  return values.map(group => ({ title: group.title, entries: group.entries.map(entry => ({ label: entry.label, value: entry.value, pages: entry.pages.slice() })) }));
}

export function createShareBuild(build: SavedBuild): SavedBuild {
  return {
    ...pick(build, ["schemaVersion", "id", "title", "note", "createdAt", "updatedAt", "sourceSnapshotId", "sourceLastWriteLocal", "level"]),
    attributes: pick(build.attributes, attributeKeys), equipment: build.equipment.map(loadout),
  };
}

export function createShareSnapshot(snapshot: SaveSnapshot): SaveSnapshot {
  if (!isSupportedSnapshot(snapshot)) throw new Error("角色档案结构不完整，未生成分享副本。");
  const status = snapshot.characterStatus;
  const backup = snapshot.backupComparison;
  return {
    ...pick(snapshot, ["schemaVersion", "parserVersion", "game", "platform", "snapshotId", "researchLabel", "sourceLastWriteLocal", "currentLoadoutName", "savedEquipmentPresetName", "loadoutSource"]),
    safety: {
      ...pick(snapshot.safety, ["sourceOpenedReadOnly", "parsedFromCopy", "originalHashUnchangedAfterProcessing"]),
      originalMainSaveSha256: "已隐藏",
    },
    privacy: { redactedForSharing: true },
    character: {
      ...pick(snapshot.character, ["level", "amrita", "gold"]),
      attributes: pick(snapshot.character.attributes, attributeKeys),
      proficiency: { ...snapshot.character.proficiency },
      skillPointCounters: snapshot.character.skillPointCounters === undefined ? undefined
        : Object.fromEntries(Object.entries(snapshot.character.skillPointCounters).map(([key, value]) => [key, pick(value, ["temporary", "permanent"])])),
    },
    currentLoadout: snapshot.currentLoadout.map(loadout),
    emptyLoadoutSlots: snapshot.emptyLoadoutSlots?.slice(),
    equipmentInventory: snapshot.equipmentInventory?.map(equipment),
    inventoryItems: snapshot.inventoryItems?.map(item => pick(item, ["recordIndex", "id", "name", "nameZh", "type", "quantity"])),
    scrolls: snapshot.scrolls?.map(item => ({ ...pick(item, ["recordIndex", "id", "name", "nameZh", "level", "rarity", "attemptsRemaining"]),
      ...effects(item), effects: item.effects.slice() })),
    inventorySummary: { ...pick(snapshot.inventorySummary, ["equipmentRecords", "equipmentUnknownIds", "stackedItemRecords", "scrollRecordsDetected"]),
      equipmentByType: { ...snapshot.inventorySummary.equipmentByType } },
    characterStatus: status === undefined ? undefined : {
      ...pick(status, ["version", "source", "recordedOn", "captureTime", "referenceSnapshotId", "screenshotCount"]),
      groups: groups(status.groups), effects: groups(status.effects),
    },
    backupComparison: backup === undefined ? undefined : {
      ...pick(backup, ["backupLastWriteLocal", "level", "amrita", "gold", "binaryChangedBytes", "binaryChangedRanges", "loadoutChanged", "inventoryChanged", "copyHashesUnchangedAfterParsing"]),
      attributeChangesToCurrent: { ...backup.attributeChangesToCurrent },
      inventoryQuantityChanges: backup.inventoryQuantityChanges?.map(item => pick(item, ["id", "nameZh", "name", "before", "after", "delta"])),
    },
    limitations: snapshot.limitations.slice(),
  };
}
