import { useId, useState } from "react";
import { deduplicateEntries, formatPanelValue, isCharacterStatus } from "./characterStatus";
import type { StatusEntry } from "./characterStatus";
import type { SaveSnapshot } from "./types";

function Values({ entries, panel = false }: { entries: StatusEntry[]; panel?: boolean }) {
  return <dl className="status-values">{entries.map((entry) => <div key={JSON.stringify([entry.label, entry.value])}>
    <dt>{entry.label}<small>图 {entry.pages.join("、")}</small></dt>
    <dd>{(panel ? formatPanelValue(entry) : entry.value) ?? <span className="status-enabled">已生效</span>}</dd>
  </div>)}</dl>;
}

export function CharacterStatusPanel({ snapshot }: { snapshot: SaveSnapshot }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const searchId = useId();
  const categoryId = useId();
  const status = snapshot.characterStatus;
  const valid = isCharacterStatus(status);
  const matching = valid && status.referenceSnapshotId === snapshot.snapshotId;
  if (!matching) return <section className="character-status status-empty" aria-label="人物详细属性">
    <div className="section-heading"><div><span>02</span><h2>人物详细属性</h2></div></div>
    <p>{valid ? "这份截图记录属于另一份档案，未应用到当前角色。" : "当前档案尚未包含详细面板记录。"}</p>
    <dl className="status-placeholders">{["体力 / 精力", "装备负重 / 敏捷", "攻击力 / 防御力", "忍术 / 阴阳术", "装备品掉落率", "妖怪化持续时间"].map((name) => <div key={name}><dt>{name}</dt><dd>未解析</dd></div>)}</dl>
    <p className="status-note">这些最终数值尚未完成自动解析。导入带截图记录的新版档案后可查看；未解析不代表数值为零。</p>
  </section>;

  const effects = deduplicateEntries(status.effects.flatMap((group) => group.entries));
  const needle = query.trim();
  const shown = status.effects.filter((group) => category === "全部" || group.title === category)
    .map((group) => ({ ...group, entries: deduplicateEntries(group.entries).filter((entry) => !needle || `${entry.label} ${entry.value ?? "已生效"}`.includes(needle)) }))
    .filter((group) => group.entries.length > 0);
  const shownCount = shown.reduce((sum, group) => sum + group.entries.length, 0);
  return <section className="character-status" aria-label="人物详细属性">
    <div className="section-heading"><div><span>02</span><h2>人物详细属性</h2></div><span className="status-source">截图记录 · 非自动解析</span></div>
    <p className="status-note">整理于 {status.recordedOn} · {status.screenshotCount} 张状态截图 · {status.captureTime ? `拍摄于 ${status.captureTime}` : "拍摄时间未提供"}。仅代表截图当时的状态，不随换装更新。</p>
    <p className="status-note">基础能力与资源可用于核对角色，但不能证明截图与此存档的配装完全相同。下列加成不再次叠加到面板数值。</p>
    <p className="status-note">体力、精力、妖力仅显示上限。</p>
    <div className="status-group-grid">{status.groups.map((group) => <section className="status-group" key={group.title}><h3>{group.title}</h3><Values entries={deduplicateEntries(group.entries)} panel /></section>)}</div>
    <div className="status-effects-heading"><h3>特殊效果</h3><span>{effects.length} 条截图可见记录</span></div>
    <p className="status-note">只收录截图可见条目，重复行已合并；无数值的效果显示“已生效”，不推算百分比。</p>
    <div className="status-filters">
      <label htmlFor={searchId}>搜索效果<input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：近距离、掉落、妖怪化" /></label>
      <label htmlFor={categoryId}>效果分类<select id={categoryId} value={category} onChange={(event) => setCategory(event.target.value)}><option>全部</option>{status.effects.map((group) => <option key={group.title}>{group.title}</option>)}</select></label>
    </div>
    <p className="status-note" role="status">显示 {shownCount} 条效果{shownCount === 0 ? "，请尝试其他关键词或分类。" : "，点击分类标题展开。"}</p>
    {shown.map((group) => <details className="status-effect-group" key={`${group.title}:${needle ? "search" : "browse"}`} open={needle ? true : undefined}>
      <summary>{group.title}<span>{group.entries.length} 条</span></summary><Values entries={group.entries} />
    </details>)}
  </section>;
}
