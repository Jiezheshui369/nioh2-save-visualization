const SET_AND_GRACE_ZH: Readonly<Record<string, string>> = {
  "Grace of Amaterasu": "天照大神的恩宠",
  "Grace of Susano": "素盏鸣尊的恩宠",
  "Grace of Tsukuyomi": "月读的恩宠",
  "Grace of Takemikazuchi": "建御雷的恩宠",
  "Grace of Kagutsuchi": "迦具土的恩宠",
  "Grace of Shinatsuhiko": "志那都彦的恩宠",
  "Grace of Oyamatsumi": "大山津见的恩宠",
  "Grace of Owatatsumi": "大绵津见的恩宠",
  "Grace of Futsunushi": "经津主的恩宠",
  "Izanagi's Grace": "伊邪那岐的恩宠",
  "Izanami's Grace": "伊邪那美的恩宠",
  "Omoikane's Grace": "思兼神的恩宠",
  "Okuninushi's Grace": "大国主的恩宠",
  "Sakuyahime's Grace": "木花开耶姬的恩宠",
  "Takeminakata's Grace": "建御名方的恩宠",
  "Tajkarao's Grace": "天手力男的恩宠",
  "Sukunahikona's Grace": "少彦名的恩宠",
  "Ninigi's Grace": "琼琼杵的恩宠",
  "Kushinadahime's Grace": "奇稻田姬的恩宠",
  "Ame-no-Uzume's Grace": "天钿女的恩宠",
  "Sarutahiko's Grace": "猿田彦的恩宠",
  "Magatsuhi's Grace": "祸津日的恩宠",
  "Bishamoten's Grace": "毗沙门天的恩宠",
  "Benzaiten's Grace": "弁才天的恩宠",
  "Ebisu's Grace": "惠比寿的恩宠",
  "Jurojin's Grace": "寿老人的恩宠",
  "Daikokuten's Grace": "大黑天的恩宠",
  "Fukuroju's Grace": "福禄寿的恩宠",
  "Hotei's Grace": "布袋尊的恩宠",
  "Inari's Grace": "稻荷神的恩宠",
  "Hachiman's Grace": "八幡神的恩宠",
  "Kuzuryu's Grace": "九头龙的恩宠",
  "Marici's Grace": "摩利支天的恩宠",
  "Acala's Grace": "不动明王的恩宠",
  "Onmyo Austerity": "阴阳严厉",
  "未识别套装": "未识别套装",
};

const PROFICIENCY_ZH: Readonly<Record<string, string>> = {
  sword: "太刀", dualSwords: "双刀", spear: "长枪", axe: "斧", kusarigama: "锁镰",
  odachi: "大太刀", tonfa: "旋棍", hatchets: "手斧", switchglaive: "薙刀镰",
  splitstaff: "机关棍", fists: "手甲", samurai: "武士", ninjutsu: "忍术", onmyo: "阴阳术", shiftling: "半妖",
};

const RARITY_ZH: Readonly<Record<string, string>> = {
  Common: "普通", Uncommon: "优良", Rare: "稀有", Exotic: "最上等", Divine: "神器", Ethereal: "神宝",
};

const ITEM_TYPE_ZH: Readonly<Record<string, string>> = {
  "-": "其他",
  "Accessory": "饰品",
  "Armor - Arm Guards": "臂甲",
  "Armor - Foot Guards": "腿甲",
  "Armor - Head Armor": "头部防具",
  "Armor - Leg Guards": "膝甲",
  "Armor - Torso Armor": "胸甲",
  "Key Items": "贵重物品",
  "Projectiles": "箭弹",
  "Scrolls": "绘卷",
  "Smithing Materials": "锻造材料",
  "Soul Core": "魂核",
  "Stone": "灵石",
  "Tea Set": "茶器",
  "Usable Items": "消耗品",
  "Weapon": "武器",
  "Unknown": "尚未分类",
};

const ITEM_ZH_BY_ID: Readonly<Record<string, string>> = {
  FA97: "土蜘蛛众手甲钩", "0BF4": "魔缘锡杖", "9328": "天狗面",
  "721C": "阴阳武者战甲 胸甲", BB01: "阴阳武者战甲 臂甲",
  A7D6: "阴阳武者战甲 膝甲", "0C39": "阴阳武者战甲 腿甲",
  "4530": "八尺琼勾玉（套装组合效果需求数－1）", "6779": "勾玉（绿／白）",
  "10C3": "与一之弓", A9B7: "崩国大炮",
};

const EFFECT_ZH: Readonly<Record<string, string>> = {
  "Imbue Corruption": "赋予妖属性",
  "Melee Ki Damage": "近距离攻击精力伤害",
  "Attack Bonus (Magic)": "攻击反映（咒）",
  "Mystic Dyad (Fists)": "奥义两立（手甲）",
  "Mystic Dyad (Sword)": "奥义两立（太刀）",
  "Mystic Dyad (Dual Swords)": "奥义两立（双刀）",
  "Mystic Dyad (Spear)": "奥义两立（长枪）",
  "Mystic Dyad (Axe)": "奥义两立（斧）",
  "Mystic Dyad (Kusarigama)": "奥义两立（锁镰）",
  "Mystic Dyad (Odachi)": "奥义两立（大太刀）",
  "Mystic Dyad (Tonfa)": "奥义两立（旋棍）",
  "Mystic Dyad (Hatchets)": "奥义两立（手斧）",
  "Mystic Dyad (Switchglaive)": "奥义两立（薙刀镰）",
  Break: "崩解",
  "Melee Attack Ki Consumption": "近距离攻击精力消耗",
  "Anima Bonus (Inflict Ailment)": "妖力增加量反映（状态异常）",
  "Mystic Dyad (Splitstaff)": "奥义两立（机关棍）",
  "Amrita Guage Charge": "精华量表增加量",
  "Increased Attack (Winded Enemy)": "精力耗尽敌人时赋予攻击力增加",
  "Path of the Avarcious": "通往人道的指引",
  "Path of the Bease": "通往畜生道的指引",
  "Super-Efficient Yokai Abilities (All)": "妖怪技的妖力消耗无效（全部）",
  "Untouched Clay Bell Of Beckoning": "不消耗招猫铃",
  "Ki Recovery (Unscaathed)": "无伤时精力恢复速度",
  "Melee Damage": "近距离伤害",
  "Untouched Onmyo Magic": "不消耗阴阳术",
  "Elemental Damage Taken": "承受的属性伤害",
  "Max Equipment Weight": "装备重量上限",
  "Active Skill Ki Damage": "武技精力伤害",
  "Melee Damage (Unscathed)": "无伤时近距离伤害",
  "Throwing Weapon Damage": "投掷武器伤害",
  "Ki Recovery (Critical)": "危急时精力恢复速度",
  "Faster Winded Recovery": "精力耗尽恢复时间缩短",
  "Damage Taken": "承受的伤害",
  "Dodge Ki Consumption": "闪避动作精力消耗",
  "Dodge Range Up": "闪避移动距离延长",
  "Tenacity (Damage Over Time)": "坚忍度（持续伤害）",
  "Set Bonus Requirements Reduced": "套装组合效果的需求数－1",
  "Defense Bonus (Magic)": "防御反映（咒）",
  "Active Skill Damage": "武技伤害",
  "Melee Damage vs. Zero-Ki Enemy": "对精力耗尽敌人的近距离伤害",
  "Anima Charge": "妖力增加量",
  "Corrupted Accumulation (Enemy)": "妖累积（敌人）",
  "Lucky Drop (Accessory)": "幸运掉落（饰品）",
  "Melee Damage vs. Electrified Enemy": "对陷入雷属性敌人的近距离伤害",
  "Sloth (Ninjutsu Hit)": "忍术命中赋予迟钝",
  "Ailment Affliction Duration": "赋予状态异常的持续时间",
  "Auto-Target Weak Point": "自动瞄准弱点",
  "Item Drop Rate vs. Yokai": "对妖怪的道具掉落率",
  "Untouched Ammo": "不消耗弹药",
  "Movement Speed (Aiming Ranged Weapon)": "瞄准远距离武器时移动速度",
  "Item Drop Rate": "道具掉落率",
  "Bullet & Arrow Damage (Unscathed)": "无伤时箭弹伤害",
  "Item Drop Rate vs. Humans": "对人类的道具掉落率",
  "Damage Bonus (Familiarity)": "伤害反映（爱用度）",
};

const LIMITATION_ZH: Readonly<Record<string, string>> = {
  "Most effect magnitudes still use the legacy community CAP heuristic; explicit unit fixes are versioned separately. Letter grades and passive effects remain omitted. Equipment values are not final character totals.": "多数词条仍使用社区参考上限推测单位，尚待核对；字母档位和非数值效果尚未解码。装备数值不等于人物最终总值。",
  "Effect values retain raw evidence. Conditions and non-numeric effects are not bonuses; unresolved grades and units are omitted. Legacy CAP-based units require verification. Equipment values are not final character totals.": "词条保留原始数据；条件词条与非数值效果不显示为加成，未知档位和单位不猜测。沿用社区参考上限推测的单位仍待复核；装备数值不等于人物最终总值，也不表示效果已生效。",
  "Character name, guardian spirits, skill trees, mission progress, collectibles and clan/faction have not yet been mapped.": "角色名称、守护灵、技能树、任务进度、收集品和武家势力尚未完成映射。",
  "Item and effect names currently come from a community Apache-2.0 English ID table.": "装备与词条名称目前来自采用 Apache-2.0 许可的社区编号表，并由展示层翻译为中文。",
  "Item identifiers come from a community Apache-2.0 table; matched display names come from the local game language packs.": "物品编号来自采用 Apache-2.0 许可的社区表；命中的显示名称取自本机游戏语言包。",
  "Effect magnitude encoding has not yet been validated, so effect magnitudes are intentionally omitted.": "词条数值的编码尚未验证，因此当前有意省略具体数值。",
  "Effect magnitudes are shown only for validated flat-number and percentage encodings; letter grades and passive effects remain omitted.": "仅显示已验证的平面数值与百分比编码；字母等级和被动词条继续留空。",
  "Fixed offsets are research findings and require validation against more save versions.": "固定偏移量属于研究结果，仍需使用更多版本的存档验证。",
  "Skill point counter labels preserve community terminology and are not yet confirmed as spendable balances.": "技能点计数沿用社区研究术语，尚不能确认这些数值等同于当前可用点数。",
  "Equipped slots rely on inventory equipment markers and only change after the game persists those markers to disk.": "当前装备依据存档中的装备槽标记还原；只有游戏把这些标记真正写入磁盘后，刷新才能看到变化。",
};

export function localizeSetOrGrace(name: string): string {
  if (!name) return "未识别套装";
  return SET_AND_GRACE_ZH[name] ?? "未翻译套装";
}

export function localizeProficiency(name: string): string {
  return PROFICIENCY_ZH[name] ?? "未知修行";
}

export function localizeRarity(name: string): string {
  return RARITY_ZH[name] ?? "未知稀有度";
}

export function localizeItemType(name: string): string {
  return ITEM_TYPE_ZH[name] ?? "其他";
}

export function localizeItemName(id: string, officialName?: string | null): string {
  return officialName || ITEM_ZH_BY_ID[id.toUpperCase()] || `未翻译装备（编号 ${id}）`;
}

export function localizeEffect(name: string, officialName?: string | null): string {
  if (officialName) return officialName;
  const unknown = /^Unknown effect ([0-9A-F]+)$/i.exec(name);
  if (unknown) return `未识别词条（${unknown[1].toUpperCase()}）`;
  return SET_AND_GRACE_ZH[name] ?? EFFECT_ZH[name] ?? "未翻译词条";
}

export function localizeLimitation(text: string): string {
  return LIMITATION_ZH[text] ?? "存在尚未完成验证的解析限制。";
}
