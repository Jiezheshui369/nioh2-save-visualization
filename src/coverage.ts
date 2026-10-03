import type { SaveSnapshot } from "./types";
import { hasVerifiedEffectValue } from './effectValues';

export interface CoverageMetric {
  key: "equipmentNames" | "inventoryNames" | "effects" | "effectMagnitudes";
  verified: number;
  total: number;
  percent: number;
}

function metric(key: CoverageMetric["key"], verified: number, total: number): CoverageMetric {
  return { key, verified, total, percent: total > 0 ? Math.round((verified / total) * 100) : 0 };
}

export function calculateCoverage(snapshot: SaveSnapshot): CoverageMetric[] {
  const equipment = snapshot.equipmentInventory ?? snapshot.currentLoadout;
  const inventory = snapshot.inventoryItems ?? [];
  const effectRecords = [
    ...equipment.map((item) => ({ ...item, effects: item.effects ?? [], translated: item.effectsZh ?? [] })),
    ...(snapshot.scrolls ?? []).map((item) => ({ ...item, translated: item.effectsZh ?? [] })),
  ];
  const totalEffects = effectRecords.reduce((sum, item) => sum + item.effects.length, 0);
  const translatedEffects = effectRecords.reduce(
    (sum, item) => sum + item.effects.filter((_, index) => Boolean(item.translated[index])).length,
    0,
  );
  const decodedMagnitudes = effectRecords.reduce(
    (sum, item) => sum + item.effects.filter((_, index) => hasVerifiedEffectValue(item, index)).length,
    0,
  );
  return [
    metric("equipmentNames", equipment.filter((item) => Boolean(item.nameZh)).length, equipment.length),
    metric("inventoryNames", inventory.filter((item) => Boolean(item.nameZh)).length, inventory.length),
    metric("effects", translatedEffects, totalEffects),
    metric("effectMagnitudes", decodedMagnitudes, totalEffects),
  ];
}
