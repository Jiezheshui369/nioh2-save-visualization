import { useEffect, useState } from "react";
import { effectText } from "./effectValues";
import { localizeItemName, localizeRarity } from "./localization";
import { resolveExperimentalScroll } from "./experimentalScrollSelection";
import type { SaveSnapshot } from "./types";
export function ExperimentalScrollPanel({ snapshot }: { snapshot: SaveSnapshot }) {
  const identity = snapshot.snapshotId + ":" + (snapshot.safety.snapshotCopySha256 ?? "");
  const [enabledFor, setEnabledFor] = useState<string | null>(null);
  useEffect(() => { setEnabledFor(null); }, [identity]);
  const enabled = enabledFor === identity;
  const selected = enabled ? resolveExperimentalScroll(snapshot) : null;
  return <section className="skill-point-panel experimental-scroll-panel" aria-label="实验绘卷识别">
    <header><div><span>本地研究 · 默认关闭</span><h2>实验绘卷识别</h2></div>
      <label><input type="checkbox" checked={enabled} onChange={event => setEnabledFor(event.target.checked ? identity : null)} />开启实验绘卷识别</label>
    </header>
    {enabled ? <div role="status">
      <p>来源：所选快照的解密副本 · {snapshot.sourceLastWriteLocal} · 解析器 {snapshot.parserVersion ?? "未知"}</p>
      <p>验证范围：一个 Steam / Windows 存档布局的切换及只查看对照；游戏构建号未知，其他版本、角色、排序和未装备状态尚未验证。此结果不计入正式装备或效果汇总。</p>
      {selected ? <article className="experimental-scroll-candidate">
        <strong>实验引用的绘卷 · 候选</strong>
        <h3>{localizeItemName(selected.id, selected.nameZh)}</h3>
        <p>库内槽位 {selected.recordIndex + 1} · 等级 {selected.level} · {localizeRarity(selected.rarity)} · 剩余挑战 {selected.attemptsRemaining} 次</p>
        {selected.effects.map((effect, index) => <p key={effect + ":" + index}>{effectText(selected, index)}</p>)}
      </article> : <p>未获得可关联的实验绘卷记录，保持未知。旧快照可能未包含该研究字段；请使用已有解密副本生成实验快照后，通过高级备份入口导入。</p>}
      <p>研究元数据仅供本地查看，公开分享与档案导出会排除它。开启查看不会读取游戏存档。</p>
    </div> : <p>手动开启后查看所选快照的实验候选；不改变正式配装。</p>}
  </section>;
}
