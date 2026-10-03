import { describe, expect, it } from "vitest";
import {
  localizeEffect,
  localizeItemName,
  localizeLimitation,
  localizeProficiency,
  localizeRarity,
  localizeSetOrGrace,
} from "./localization";

describe("set and grace localization", () => {
  it("translates current build names without exposing unknown English values", () => {
    expect(localizeSetOrGrace("Grace of Oyamatsumi")).toBe("大山津见的恩宠");
    expect(localizeSetOrGrace("Grace of Tsukuyomi")).toBe("月读的恩宠");
    expect(localizeSetOrGrace("Onmyo Austerity")).toBe("阴阳严厉");
    expect(localizeSetOrGrace("Community Test Set")).toBe("未翻译套装");
  });

  it("translates the currently parsed character and loadout fields", () => {
    expect(localizeProficiency("splitstaff")).toBe("机关棍");
    expect(localizeRarity("Ethereal")).toBe("神宝");
    expect(localizeItemName("721c")).toBe("阴阳武者战甲 胸甲");
    expect(localizeItemName("721c", "阴阳武者战甲　胸甲")).toBe("阴阳武者战甲　胸甲");
    expect(localizeEffect("Active Skill Ki Damage")).toBe("武技精力伤害");
    expect(localizeEffect("Attack Bonus (Magic)", "对攻击力的反映（咒）")).toBe("对攻击力的反映（咒）");
    expect(localizeEffect("Unknown effect E580")).toBe("未识别词条（E580）");
    expect(localizeEffect("Mystic Dyad (Sword)")).toBe("奥义两立（太刀）");
    expect(localizeEffect("Path of the Avarcious")).toBe("通往人道的指引");
  });

  it("keeps unmapped content Chinese-only", () => {
    expect(localizeProficiency("newSkill")).toBe("未知修行");
    expect(localizeRarity("Mythic")).toBe("未知稀有度");
    expect(localizeItemName("FFFF")).toBe("未翻译装备（编号 FFFF）");
    expect(localizeEffect("Unmapped English Effect")).toBe("未翻译词条");
    expect(localizeLimitation("Unmapped limitation")).toBe("存在尚未完成验证的解析限制。");
  });
});
