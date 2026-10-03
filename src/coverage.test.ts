import { describe, expect, it } from "vitest";
import { calculateCoverage } from "./coverage";
import type { SaveSnapshot } from "./types";

describe("calculateCoverage", () => {
  it('counts verified grade pairs but not neighboring raw values or old labels', () => {
    const snapshot = { currentLoadout: [], equipmentInventory: [{
      effects: ['one', 'two', 'three', 'four'], effectIds: ['3961', '3961', '24E8', 'C0C9'],
      effectMagnitudes: ['AA', 'AA', 'B+', 'AA'], effectValueDetails: [
        { rawValue: 13, kind: 'grade', encoding: 'verified-id' },
        { rawValue: 12, kind: 'grade', encoding: 'verified-id' },
        { rawValue: 8, kind: 'grade', encoding: 'verified-id' },
        { rawValue: 13, kind: 'unresolved-grade', encoding: 'not-decoded' },
      ],
    }] } as unknown as SaveSnapshot;
    expect(calculateCoverage(snapshot).find(row => row.key === 'effectMagnitudes'))
      .toEqual({ key: 'effectMagnitudes', verified: 2, total: 4, percent: 50 });
  });
  it("counts only explicitly translated names and effects", () => {
    const snapshot = {
      currentLoadout: [],
      equipmentInventory: [
        { nameZh: "牛头鬼", effects: ["A", "B"], effectsZh: ["甲", null], effectMagnitudes: ["10%", null] },
        { nameZh: null, effects: ["C"], effectsZh: ["丙"], effectMagnitudes: ["24"] },
      ],
      inventoryItems: [{ nameZh: "神篱碎片" }, { nameZh: null }],
      scrolls: [{ effects: ["D", "E"], effectsZh: [null, "戊"] }],
    } as unknown as SaveSnapshot;

    expect(calculateCoverage(snapshot)).toEqual([
      { key: "equipmentNames", verified: 1, total: 2, percent: 50 },
      { key: "inventoryNames", verified: 1, total: 2, percent: 50 },
      { key: "effects", verified: 3, total: 5, percent: 60 },
      { key: "effectMagnitudes", verified: 0, total: 5, percent: 0 },
    ]);
  });
});
