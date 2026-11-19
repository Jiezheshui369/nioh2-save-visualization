/** Label catalogue only, transcribed and independently audited from historical screenshots.
 * No observed numbers, player identity or reference snapshot is embedded here.
 * Labels do not assert that a final BIN field is decoded. */
export interface StatusFieldCatalogGroup { title:string; entries:{label:string; pages:number[]}[] }
export const CHARACTER_PANEL_CATALOG: StatusFieldCatalogGroup[] = [
  {
    "title": "基础状态",
    "entries": [
      {
        "label": "体力",
        "pages": [
          1
        ]
      },
      {
        "label": "精力",
        "pages": [
          1
        ]
      },
      {
        "label": "精力恢复速度",
        "pages": [
          1
        ]
      },
      {
        "label": "妖力",
        "pages": [
          1
        ]
      },
      {
        "label": "装备重量",
        "pages": [
          1
        ]
      },
      {
        "label": "装备重量占比",
        "pages": [
          1
        ]
      },
      {
        "label": "敏捷",
        "pages": [
          1
        ]
      }
    ]
  },
  {
    "title": "战斗能力",
    "entries": [
      {
        "label": "近战武器1 · 攻击力",
        "pages": [
          1
        ]
      },
      {
        "label": "近战武器1 · 崩解",
        "pages": [
          1
        ]
      },
      {
        "label": "近战武器1 · 接招",
        "pages": [
          1
        ]
      },
      {
        "label": "近战武器2 · 攻击力",
        "pages": [
          1
        ]
      },
      {
        "label": "近战武器2 · 崩解",
        "pages": [
          1
        ]
      },
      {
        "label": "近战武器2 · 接招",
        "pages": [
          1
        ]
      },
      {
        "label": "远距离武器1 · 攻击力",
        "pages": [
          1
        ]
      },
      {
        "label": "远距离武器1 · 崩解",
        "pages": [
          1
        ]
      },
      {
        "label": "远距离武器2 · 攻击力",
        "pages": [
          1
        ]
      },
      {
        "label": "远距离武器2 · 崩解",
        "pages": [
          1
        ]
      },
      {
        "label": "防御力",
        "pages": [
          1
        ]
      },
      {
        "label": "坚忍度",
        "pages": [
          1
        ]
      }
    ]
  },
  {
    "title": "抗性",
    "entries": [
      {
        "label": "抗物理",
        "pages": [
          1
        ]
      },
      {
        "label": "抗火",
        "pages": [
          1
        ]
      },
      {
        "label": "抗水",
        "pages": [
          1
        ]
      },
      {
        "label": "抗雷",
        "pages": [
          1
        ]
      },
      {
        "label": "抗毒",
        "pages": [
          1
        ]
      },
      {
        "label": "抗麻痹",
        "pages": [
          1
        ]
      },
      {
        "label": "抗忍术",
        "pages": [
          2
        ]
      },
      {
        "label": "抗阴阳术",
        "pages": [
          2
        ]
      },
      {
        "label": "抗妖",
        "pages": [
          2
        ]
      },
      {
        "label": "抗净",
        "pages": [
          2
        ]
      }
    ]
  },
  {
    "title": "术与附属能力",
    "entries": [
      {
        "label": "忍术 术力",
        "pages": [
          2
        ]
      },
      {
        "label": "忍术 术容量",
        "pages": [
          2
        ]
      },
      {
        "label": "阴阳术 术力",
        "pages": [
          2
        ]
      },
      {
        "label": "阴阳术 术容量",
        "pages": [
          2
        ]
      },
      {
        "label": "幸运",
        "pages": [
          2
        ]
      },
      {
        "label": "残心初始量",
        "pages": [
          2
        ]
      },
      {
        "label": "跌落伤害减轻率",
        "pages": [
          2
        ]
      },
      {
        "label": "虚空智",
        "pages": [
          2
        ]
      }
    ]
  }
];
export const CHARACTER_EFFECT_CATALOG: StatusFieldCatalogGroup[] = [
  {
    "title": "攻击与伤害",
    "entries": [
      {
        "label": "武技伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "近距离攻击伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "近距离攻击伤害（绝境）",
        "pages": [
          3
        ]
      },
      {
        "label": "弓伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "火枪伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "大炮伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "对火敌人的妖怪技伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "近身刺击伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "背后攻击伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "空手攻击伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "近距离攻击伤害（无伤）",
        "pages": [
          3
        ]
      },
      {
        "label": "对陷入雷敌人的近距离伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "伤害反映（装备重量）",
        "pages": [
          3
        ]
      },
      {
        "label": "伤害反映（阴阳术术力）",
        "pages": [
          3
        ]
      },
      {
        "label": "武技的伤害（破突）",
        "pages": [
          3
        ]
      },
      {
        "label": "守护灵技的伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "近距离攻击精力伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "武技精力伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "妖怪技精力上限伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "投掷武器伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "敌人的持续伤害",
        "pages": [
          3
        ]
      },
      {
        "label": "敌人的妖累积",
        "pages": [
          3
        ]
      },
      {
        "label": "火药弹、焙烙弹的伤害",
        "pages": [
          4
        ]
      },
      {
        "label": "对精力归零敌人的近距离伤害",
        "pages": [
          4
        ]
      },
      {
        "label": "自动瞄准要害",
        "pages": [
          4
        ]
      },
      {
        "label": "赋予妖属性",
        "pages": [
          4
        ]
      }
    ]
  },
  {
    "title": "防御与抗性",
    "entries": [
      {
        "label": "持续伤害降低",
        "pages": [
          4
        ]
      },
      {
        "label": "承受的伤害减半（无伤状态）",
        "pages": [
          4
        ]
      },
      {
        "label": "持续性伤害不会导致死亡",
        "pages": [
          4
        ]
      },
      {
        "label": "来自妖怪的伤害降低",
        "pages": [
          4
        ]
      },
      {
        "label": "承受的属性攻击伤害降低",
        "pages": [
          4
        ]
      },
      {
        "label": "抗火",
        "pages": [
          4
        ]
      },
      {
        "label": "抗水",
        "pages": [
          4
        ]
      },
      {
        "label": "抗雷",
        "pages": [
          4
        ]
      },
      {
        "label": "抗毒",
        "pages": [
          4
        ]
      },
      {
        "label": "被攻击时承受的伤害降低（绝境）",
        "pages": [
          4
        ]
      },
      {
        "label": "被攻击时承受的伤害降低",
        "pages": [
          4
        ]
      },
      {
        "label": "抗麻痹",
        "pages": [
          4
        ]
      },
      {
        "label": "负面效果持续时间缩短",
        "pages": [
          6
        ]
      },
      {
        "label": "抗常世·常暗",
        "pages": [
          6
        ]
      },
      {
        "label": "混沌无效",
        "pages": [
          7
        ]
      }
    ]
  },
  {
    "title": "精力与恢复",
    "entries": [
      {
        "label": "近距离攻击的精力消耗降低",
        "pages": [
          3
        ]
      },
      {
        "label": "防御精力消耗降低",
        "pages": [
          4
        ]
      },
      {
        "label": "闪避动作精力消耗降低",
        "pages": [
          4
        ]
      },
      {
        "label": "奔跑速度提升",
        "pages": [
          5
        ]
      },
      {
        "label": "冲刺精力消耗降低",
        "pages": [
          5
        ]
      },
      {
        "label": "防御时精力恢复速度",
        "pages": [
          5
        ]
      },
      {
        "label": "拿起远距离武器时的移动速度",
        "pages": [
          5
        ]
      },
      {
        "label": "药物恢复体力效果",
        "pages": [
          5
        ]
      },
      {
        "label": "精力恢复速度",
        "pages": [
          5
        ]
      },
      {
        "label": "精力恢复速度上升（无伤）",
        "pages": [
          6
        ]
      },
      {
        "label": "精力恢复反映（精华量表）",
        "pages": [
          6
        ]
      },
      {
        "label": "体力恢复量（常暗内）",
        "pages": [
          6
        ]
      },
      {
        "label": "精力恢复速度（绝境）",
        "pages": [
          6
        ]
      },
      {
        "label": "特技成功时恢复精力",
        "pages": [
          6
        ]
      },
      {
        "label": "特技成功时赋予精力恢复速度上升",
        "pages": [
          6
        ]
      },
      {
        "label": "精力耗尽的恢复时间缩短",
        "pages": [
          6
        ]
      }
    ]
  },
  {
    "title": "掉落与资源",
    "entries": [
      {
        "label": "获得金钱",
        "pages": [
          4
        ]
      },
      {
        "label": "获得精华（妖怪化时）",
        "pages": [
          4
        ]
      },
      {
        "label": "魂核掉落率",
        "pages": [
          5
        ]
      },
      {
        "label": "道具掉落率（妖怪化时）",
        "pages": [
          5
        ]
      },
      {
        "label": "茶器掉落率",
        "pages": [
          5
        ]
      },
      {
        "label": "道具掉落率（常暗内）",
        "pages": [
          5
        ]
      },
      {
        "label": "获得精华（常暗内）",
        "pages": [
          5
        ]
      },
      {
        "label": "幸运（常暗内）",
        "pages": [
          5
        ]
      },
      {
        "label": "获得精华",
        "pages": [
          5
        ]
      },
      {
        "label": "道具掉落率",
        "pages": [
          5
        ]
      },
      {
        "label": "装备品掉落率",
        "pages": [
          5
        ]
      },
      {
        "label": "来自妖怪的道具掉落率",
        "pages": [
          5
        ]
      },
      {
        "label": "幸运",
        "pages": [
          5
        ]
      },
      {
        "label": "仙药持有数量上限",
        "pages": [
          6
        ]
      },
      {
        "label": "箭矢持有数量上限",
        "pages": [
          6
        ]
      },
      {
        "label": "枪弹持有数量上限",
        "pages": [
          6
        ]
      },
      {
        "label": "炮弹持有数量上限",
        "pages": [
          6
        ]
      },
      {
        "label": "不消耗箭弹",
        "pages": [
          6
        ]
      },
      {
        "label": "优先掉落（配件）",
        "pages": [
          7
        ]
      }
    ]
  },
  {
    "title": "妖力与妖怪化",
    "entries": [
      {
        "label": "妖怪化期间攻击的精力",
        "pages": [
          3
        ]
      },
      {
        "label": "妖怪化期间承受伤害",
        "pages": [
          4
        ]
      },
      {
        "label": "妖怪化期间防御的精力",
        "pages": [
          4
        ]
      },
      {
        "label": "妖怪化期间闪避动作的精力",
        "pages": [
          4
        ]
      },
      {
        "label": "使用妖怪技时回收妖力",
        "pages": [
          5
        ]
      },
      {
        "label": "武技的妖力增加量",
        "pages": [
          5
        ]
      },
      {
        "label": "妖力",
        "pages": [
          5
        ]
      },
      {
        "label": "攻击陷入混沌的敌人增加妖力",
        "pages": [
          5
        ]
      },
      {
        "label": "妖力增加量",
        "pages": [
          5
        ]
      },
      {
        "label": "阴阳术命中增加妖力",
        "pages": [
          5
        ]
      },
      {
        "label": "妖力增加量反映（累积伤害）",
        "pages": [
          5
        ]
      },
      {
        "label": "妖怪化近身刺击成功时恢复体力",
        "pages": [
          6
        ]
      },
      {
        "label": "妖怪化持续时间",
        "pages": [
          6,
          7
        ]
      },
      {
        "label": "特技成功时赋予妖怪技集中",
        "pages": [
          7
        ]
      },
      {
        "label": "持续妖怪化（常暗内）",
        "pages": [
          7
        ]
      },
      {
        "label": "妖念量表增加量",
        "pages": [
          7
        ]
      },
      {
        "label": "妖念发动时的精力伤害",
        "pages": [
          7
        ]
      }
    ]
  },
  {
    "title": "术、深奥与其他",
    "entries": [
      {
        "label": "装备重量上限",
        "pages": [
          4
        ]
      },
      {
        "label": "不消耗阴阳术道具",
        "pages": [
          6
        ]
      },
      {
        "label": "组合效果的所需装备数",
        "pages": [
          6
        ]
      },
      {
        "label": "对体力的反映（刚）",
        "pages": [
          6
        ]
      },
      {
        "label": "体力",
        "pages": [
          6
        ]
      },
      {
        "label": "精力",
        "pages": [
          6
        ]
      },
      {
        "label": "阴阳术 术力",
        "pages": [
          6,
          7
        ]
      },
      {
        "label": "阴阳术命中赋予攻击力降低",
        "pages": [
          6,
          7
        ]
      },
      {
        "label": "阴阳术命中赋予防御力降低",
        "pages": [
          6,
          7
        ]
      },
      {
        "label": "忍术命中赋予动作速度降低",
        "pages": [
          7
        ]
      },
      {
        "label": "善擦的同行时间",
        "pages": [
          7
        ]
      },
      {
        "label": "不消耗召唤土铃",
        "pages": [
          7
        ]
      },
      {
        "label": "奥义两立（手甲）",
        "pages": [
          7
        ]
      },
      {
        "label": "体之深奥",
        "pages": [
          7
        ]
      },
      {
        "label": "勇之深奥",
        "pages": [
          7
        ]
      },
      {
        "label": "刚之深奥",
        "pages": [
          7
        ]
      },
      {
        "label": "咒之深奥",
        "pages": [
          7
        ]
      },
      {
        "label": "发扬阴阳术",
        "pages": [
          7
        ]
      },
      {
        "label": "对妖战术",
        "pages": [
          7
        ]
      },
      {
        "label": "闪避行动移动距离延长",
        "pages": [
          7
        ]
      },
      {
        "label": "让敌人陷入雷状态时的精华量表增加量",
        "pages": [
          7
        ]
      },
      {
        "label": "通往畜生道的指引",
        "pages": [
          7
        ]
      },
      {
        "label": "体力",
        "pages": [
          7
        ]
      }
    ]
  }
];
