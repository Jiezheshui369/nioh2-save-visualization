import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSavedBuildShareCardData, buildShareCardData, createShareCardBlobFromData, fitShareText } from "./shareCard";
import type { SavedBuild } from "./buildLibrary";
import type { SaveSnapshot } from "./types";
afterEach(() => vi.restoreAllMocks());

describe("buildShareCardData", () => {
  it('measures long text and avoids splitting surrogate pairs', () => {
    const context = { measureText: (value: string) => ({ width: Array.from(value).length * 10 } as TextMetrics) };
    expect(fitShareText(context, '短', 20)).toBe('短');
    expect(fitShareText(context, '🙂🙂🙂🙂', 30)).toBe('🙂🙂…');
    expect(fitShareText(context, '长名字', 5)).toBe('');
  });
  it('renders Nioh branding, all records and bounded columns without claiming activation', async () => {
    const draw = vi.fn();
    const context = { fillRect: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      fillText: draw, measureText: (value: string) => ({ width: Array.from(value).length * 25 }),
      createRadialGradient: () => ({ addColorStop: vi.fn() }) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function(this: HTMLCanvasElement, callback) {
      expect(this.height).toBeGreaterThan(1350);
      callback(new Blob(['test'], { type: 'image/png' }));
    });
    const rows = Array.from({ length: 12 }, (_, i) => ({ slot: '主武器', name: `装备${i}${'长'.repeat(30)}`, plus: 120, grace: '月读的恩宠' }));
    await createShareCardBlobFromData({ title: '长标题'.repeat(20), level: 99999, attributes: [], graces: [{ name: '月读的恩宠', count: 12 }], equipment: rows });
    const texts = draw.mock.calls.map(call => call[0] as string);
    expect(texts).toContain('Nioh'); expect(texts).not.toContain('仁');
    expect(texts.filter(text => text.startsWith('装备') && !text.startsWith('装备构成') && !text.startsWith('装备摘要'))).toHaveLength(12);
    expect(texts).toContain('装备构成 · 件数不代表套装触发档位');
    expect(texts).toContain('装备摘要 · 完整词条请分享文字资料');
    for (const call of draw.mock.calls.filter(call => call[1] === 182)) expect(context.measureText(call[0] as string).width).toBeLessThanOrEqual(438);
    for (const call of draw.mock.calls.filter(call => call[1] === 900)) expect(context.measureText(call[0] as string).width).toBeLessThanOrEqual(250);
  });
  it("creates a Chinese, fingerprint-free build summary", () => {
    const snapshot = {
      snapshotId: "test",
      currentLoadoutName: "阴阳妖怪技",
      character: {
        level: 689,
        attributes: { constitution: 150, heart: 50, courage: 150, stamina: 150, strength: 26, skill: 12, dexterity: 30, magic: 163 },
      },
      currentLoadout: [
        { slot: "melee1", id: "FA97", name: "Tsuchigumo Clawed Fists", nameZh: "土蜘蛛众手甲钩", plus: 120, setOrGrace: "Grace of Tsukuyomi" },
        { slot: "head", id: "9328", name: "Tengu Mask", nameZh: "天狗面", plus: 120, setOrGrace: "Grace of Tsukuyomi" },
      ],
      safety: { originalMainSaveSha256: "secret-fingerprint" },
    } as unknown as SaveSnapshot;

    const card = buildShareCardData(snapshot);
    expect(card.title).toBe("阴阳妖怪技");
    expect(card.attributes).toContainEqual({ name: "咒", value: 163 });
    expect(card.graces).toContainEqual({ name: "月读的恩宠", count: 2 });
    expect(card.equipment[0]).toMatchObject({ slot: "主武器", name: "土蜘蛛众手甲钩" });
    expect(JSON.stringify(card)).not.toContain("secret-fingerprint");
  });

  it("creates the same share-card model for a saved build", () => {
    const build = {
      title: "深层大山阴阳",
      level: 689,
      attributes: { constitution: 150, heart: 50, courage: 150, stamina: 150, strength: 26, skill: 12, dexterity: 30, magic: 163 },
      equipment: [{ slot: "melee1", id: "FA97", name: "Tsuchigumo Clawed Fists", nameZh: "土蜘蛛众手甲钩", plus: 120, setOrGrace: "Grace of Tsukuyomi" }],
    } as SavedBuild;
    const card = buildSavedBuildShareCardData(build);
    expect(card.title).toBe("深层大山阴阳");
    expect(card.graces).toEqual([{ name: "月读的恩宠", count: 1 }]);
    expect(card.equipment[0].name).toBe("土蜘蛛众手甲钩");
  });
});
