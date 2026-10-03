import type { InventoryItem, LoadoutItem, SaveSnapshot } from "./types";

export interface NumericChange {
  key: string;
  before: number;
  after: number;
  delta: number;
}

export interface InventoryChange extends NumericChange {
  id: string;
  nameZh?: string | null;
}

export interface LoadoutChange {
  equipIndex: number;
  before?: LoadoutItem;
  after?: LoadoutItem;
}

function numericChange(key: string, before: number, after: number): NumericChange {
  return { key, before, after, delta: after - before };
}

function inventoryTotals(items: InventoryItem[]): Map<string, { quantity: number; nameZh?: string | null }> {
  const totals = new Map<string, { quantity: number; nameZh?: string | null }>();
  for (const item of items) {
    const current = totals.get(item.id);
    totals.set(item.id, { quantity: (current?.quantity ?? 0) + item.quantity, nameZh: item.nameZh ?? current?.nameZh });
  }
  return totals;
}

export function diffSnapshots(current: SaveSnapshot, previous: SaveSnapshot) {
  const resources = [
    numericChange("level", previous.character.level, current.character.level),
    numericChange("amrita", previous.character.amrita, current.character.amrita),
    numericChange("gold", previous.character.gold, current.character.gold),
  ];
  const attributeKeys = new Set([...Object.keys(previous.character.attributes), ...Object.keys(current.character.attributes)]);
  const attributes = [...attributeKeys]
    .map((key) => numericChange(key, previous.character.attributes[key as keyof typeof previous.character.attributes] ?? 0, current.character.attributes[key as keyof typeof current.character.attributes] ?? 0))
    .filter((item) => item.delta !== 0);

  const inventoryComparable = Array.isArray(current.inventoryItems) && Array.isArray(previous.inventoryItems);
  const inventory: InventoryChange[] = [];
  if (inventoryComparable) {
    const before = inventoryTotals(previous.inventoryItems ?? []);
    const after = inventoryTotals(current.inventoryItems ?? []);
    const ids = new Set([...before.keys(), ...after.keys()]);
    for (const id of ids) {
      const oldItem = before.get(id);
      const newItem = after.get(id);
      const change = numericChange(id, oldItem?.quantity ?? 0, newItem?.quantity ?? 0);
      if (change.delta !== 0) inventory.push({ ...change, id, nameZh: newItem?.nameZh ?? oldItem?.nameZh });
    }
    inventory.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.id.localeCompare(b.id));
  }

  const beforeLoadout = new Map(previous.currentLoadout.map((item) => [item.equipIndex, item]));
  const afterLoadout = new Map(current.currentLoadout.map((item) => [item.equipIndex, item]));
  const equipIndexes = new Set([...beforeLoadout.keys(), ...afterLoadout.keys()]);
  const loadout: LoadoutChange[] = [];
  for (const equipIndex of equipIndexes) {
    const before = beforeLoadout.get(equipIndex);
    const after = afterLoadout.get(equipIndex);
    if (!before || !after || before.id !== after.id || before.plus !== after.plus || before.setOrGrace !== after.setOrGrace) {
      loadout.push({ equipIndex, before, after });
    }
  }
  loadout.sort((a, b) => a.equipIndex - b.equipIndex);

  return {
    resources,
    attributes,
    inventory,
    inventoryComparable,
    loadout,
    scrollDelta: (current.scrolls?.length ?? current.inventorySummary.scrollRecordsDetected) - (previous.scrolls?.length ?? previous.inventorySummary.scrollRecordsDetected),
  };
}
