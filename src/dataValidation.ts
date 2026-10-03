// Structural validation, not anti-cheat: do not cap player levels or build stats.
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const text = (value: unknown, max = 1024): value is string => typeof value === 'string' && value.length <= max;
export const optional = (value: unknown, check: (v: unknown) => boolean) => value === undefined || check(value);
export const list = (value: unknown, max: number, check: (v: unknown) => boolean): boolean => Array.isArray(value) && value.length <= max && value.every(item => check(item));
const nullableText = (value: unknown) => value === null || text(value);
const ATTRIBUTES = ['constitution', 'heart', 'courage', 'stamina', 'strength', 'skill', 'dexterity', 'magic'];
export const attributes = (value: unknown): boolean => record(value) && ATTRIBUTES.every(key => finite(value[key]));

function effectValueDetail(value: unknown): boolean {
  if (!record(value) || !finite(value.rawValue) || !Number.isInteger(value.rawValue) || value.rawValue < 0 || value.rawValue > 0xFFFFFFFF) return false;
  if (value.kind === 'numeric') return value.encoding === 'verified-id' || value.encoding === 'legacy-cap';
  if (value.kind === 'grade') return value.encoding === 'verified-id';
  return typeof value.kind === 'string' && ['condition', 'non-numeric', 'unresolved-grade', 'unverified-unit', 'unknown'].includes(value.kind)
    && value.encoding === 'not-decoded';
}

function effects(value: Record<string, unknown>): boolean {
  return optional(value.effects, v => list(v, 64, text))
    && optional(value.effectsZh, v => list(v, 64, nullableText))
    && optional(value.effectIds, v => list(v, 64, text))
    && optional(value.effectMagnitudes, v => list(v, 64, nullableText))
    && optional(value.effectValueDetails, v => list(v, 64, effectValueDetail)
      && Array.isArray(value.effects) && Array.isArray(v) && v.length === value.effects.length
      && Array.isArray(value.effectIds) && value.effectIds.length === v.length
      && Array.isArray(value.effectMagnitudes) && value.effectMagnitudes.length === v.length);
}
export function equipment(value: unknown): boolean {
  return record(value) && finite(value.recordIndex) && finite(value.equipIndex)
    && text(value.id) && text(value.name) && optional(value.nameZh, nullableText)
    && text(value.type) && finite(value.level) && finite(value.plus)
    && text(value.rarity) && text(value.setOrGrace) && effects(value);
}
export const loadout = (value: unknown): boolean => equipment(value) && record(value) && text(value.slot, 80);
export function scroll(value: unknown): boolean {
  return record(value) && finite(value.recordIndex) && text(value.id) && text(value.name)
    && optional(value.nameZh, nullableText) && finite(value.level) && text(value.rarity)
    && finite(value.attemptsRemaining) && Array.isArray(value.effects) && effects(value);
}
export function inventoryItem(value: unknown): boolean {
  return record(value) && finite(value.recordIndex) && text(value.id) && text(value.name)
    && optional(value.nameZh, nullableText) && text(value.type) && finite(value.quantity);
}
export function snapshotDetails(value: Record<string, unknown>): boolean {
  return list(value.currentLoadout, 64, loadout)
    && optional(value.equipmentInventory, v => list(v, 10000, equipment))
    && optional(value.scrolls, v => list(v, 10000, scroll))
    && optional(value.inventoryItems, v => list(v, 10000, inventoryItem))
    && list(value.limitations, 256, v => text(v, 4096))
    && optional(value.currentLoadoutName, nullableText)
    && optional(value.savedEquipmentPresetName, nullableText)
    && optional(value.emptyLoadoutSlots, v => list(v, 64, finite));
}

export function numericMap(value: unknown, maximum = 256): boolean {
  return record(value) && Object.keys(value).length <= maximum
    && Object.entries(value).every(([key, item]) => text(key, 160) && finite(item));
}

export function backupComparison(value: unknown): boolean {
  return record(value) && text(value.backupLastWriteLocal, 80)
    && finite(value.level) && finite(value.amrita) && finite(value.gold) && numericMap(value.attributeChangesToCurrent)
    && optional(value.binaryChangedBytes, finite) && optional(value.binaryChangedRanges, finite)
    && ['loadoutChanged', 'inventoryChanged', 'copyHashesUnchangedAfterParsing'].every(key => optional(value[key], v => typeof v === 'boolean'))
    && optional(value.inventoryQuantityChanges, v => list(v, 10000, item => record(item)
      && text(item.id) && optional(item.nameZh, nullableText) && optional(item.name, nullableText)
      && finite(item.before) && finite(item.after) && finite(item.delta)));
}
