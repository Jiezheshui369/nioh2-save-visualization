import { afterEach, describe, expect, it, vi } from "vitest";
import { shareOrDownloadFile, shareText, safeShareFilename } from "./fileSharing";
import { isNativeApp } from "./runtime";
import { Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

vi.mock("./runtime", () => ({ isNativeApp: vi.fn(() => true) }));
vi.mock("@capacitor/filesystem", () => ({ Filesystem: { writeFile: vi.fn(async () => ({ uri: "file:///private/cache/shares/test.json" })) }, Directory: { Cache: "CACHE" } }));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn(async () => ({})) } }));
afterEach(() => { vi.clearAllMocks(); vi.mocked(isNativeApp).mockReturnValue(true); });

describe("native sharing", () => {
  it.each(['..', '.', '  ', '...', '////'])('never leaves a special relative filename: %s', name => {
    const result = safeShareFilename(name);
    expect(result.length).toBeGreaterThan(0); expect(result).not.toMatch(/[\\/]/);
    expect(['.', '..']).not.toContain(result);
  });
  it('preserves the extension for long titles and avoids Windows device basenames', () => {
    const filename = safeShareFilename('配装'.repeat(160) + '.png');
    expect(filename.length).toBeLessThanOrEqual(160); expect(filename).toMatch(/\.png$/);
    expect(safeShareFilename('CON.txt')).toBe('_CON.txt');
    expect(safeShareFilename('LPT1.png')).toBe('_LPT1.png');
  });
  it('normalizes native cancellation without a second share or download', async () => {
    vi.mocked(Share.share).mockRejectedValueOnce(new Error('Share canceled'));
    await expect(shareText('配装', '资料')).rejects.toMatchObject({ name: 'AbortError' });
    expect(Share.share).toHaveBeenCalledOnce(); expect(Filesystem.writeFile).not.toHaveBeenCalled();
  });
  it('preserves native share failures rather than disguising them as cancellation', async () => {
    vi.mocked(Share.share).mockRejectedValueOnce(new Error('Permission denied'));
    await expect(shareText('配装', '资料')).rejects.toThrow('Permission denied');
  });
  it("falls back to an explicit text download when desktop Web Share is absent", async () => {
    vi.mocked(isNativeApp).mockReturnValue(false);
    const original = Object.getOwnPropertyDescriptor(navigator, 'share');
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:test');
      static revokeObjectURL = vi.fn();
    });
    try {
      await shareText('配装', '已验证属性');
      expect(click).toHaveBeenCalledOnce();
      expect(Share.share).not.toHaveBeenCalled();
    } finally {
      click.mockRestore(); vi.unstubAllGlobals();
      if (original) Object.defineProperty(navigator, 'share', original);
      else Reflect.deleteProperty(navigator, 'share');
    }
  });
  it("shares only an explicitly generated file through the private cache", async () => {
    await expect(shareOrDownloadFile(new Blob(["{}"], { type: "application/json" }), "player/name.json", "档案包")).resolves.toBe("shared");
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: expect.stringMatching(/^shares\/[a-f0-9-]+\/player_name\.json$/), data: "e30=", directory: "CACHE", recursive: true,
    });
    expect(Share.share).toHaveBeenCalledWith({ title: "档案包", files: ["file:///private/cache/shares/test.json"], dialogTitle: "分享角色档案" });
  });

  it("does not report success when the native file write fails", async () => {
    vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(new Error("storage full"));
    await expect(shareOrDownloadFile(new Blob(["{}"]), "test.json", "档案包")).rejects.toThrow("storage full");
    expect(Share.share).not.toHaveBeenCalled();
  });

  it("uses the native share sheet for build summaries", async () => {
    await shareText("配装", "已验证属性");
    expect(Share.share).toHaveBeenCalledWith({ title: "配装", text: "已验证属性", dialogTitle: "分享配装" });
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
  });
});
