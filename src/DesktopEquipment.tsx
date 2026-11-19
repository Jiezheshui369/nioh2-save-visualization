import { useLayoutEffect, useRef } from 'react';
import type { SaveSnapshot } from './types';
import { DesktopText as T } from './DesktopTypography';
import { equippedSlots, equipmentName, equipmentRecordKey, equipmentEffects } from './desktopPresentation';
import { localizeRarity } from './localization';
const basicUnknowns = ['爱用度','重量','防御性能','坚韧度','抗物理','抗火','抗水','抗雷','抗毒','抗麻痹','所需体','所需武'];
export function DesktopEquipment({ snapshot, selected, onSelect, onClose }: {
  snapshot: SaveSnapshot; selected: string | null; onSelect: (key: string) => void; onClose: () => void;
}) {
  const list = useRef<HTMLElement>(null), previous = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (previous.current && !selected) list.current?.querySelector<HTMLButtonElement>('[data-record-key="' + CSS.escape(previous.current) + '"]')?.focus();
    previous.current = selected;
  }, [selected]);
  const item = snapshot.currentLoadout.find(row => equipmentRecordKey(row) === selected);
  return <>
    <header><h1><T>装备</T></h1></header>
    <div className={'df-detail-layout' + (item ? ' df-detail-layout-open' : '')}>
      <section ref={list} className="df-panel df-equipment-panel" aria-label="当前装备">
        <h2><T>当前装备</T></h2>
        <div className="df-equipment-list">
          {equippedSlots(snapshot).map(({slot,label,item:row}) => <button key={slot} className="df-equipment-row"
            data-record-key={row ? equipmentRecordKey(row) : undefined} aria-label={label + ' ' + equipmentName(row)} aria-pressed={!!row && equipmentRecordKey(row) === selected}
            disabled={!row} onClick={() => row && onSelect(equipmentRecordKey(row))}>
            <span className="df-equipment-slot" aria-hidden="true"><T>—</T></span><span className="df-equipment-label"><T wrap>{equipmentName(row)}</T></span>
          </button>)}
        </div>
        <p className="df-muted"><T>选中装备以查看属性</T></p>
        <p className="df-muted"><T>实例外观未解析时保持空位</T></p>
      </section>
      {item ? <section className="df-panel df-equipment-panel df-equipment-properties" aria-label="装备属性">
        <div className="df-detail-topline"><h2><T fit>{equipmentName(item)}</T></h2><button className="df-detail-close" onClick={onClose}><T>关闭详情</T></button></div>
        <div className="df-equipment-subtitle"><T>{'LV ' + item.level + '(+' + item.plus + ')'}</T><T>{localizeRarity(item.rarity)}</T></div>
        <p className="df-muted"><T>实例外观 —</T></p>
        <h3><T>特殊效果</T></h3>
        <dl className="df-data-list">{equipmentEffects(item).map((effect,index) => <div className="df-value-row" key={index}><dt><T wrap>{effect.label}</T></dt><dd><T>{effect.value}</T></dd></div>)}</dl>
        <dl className="df-data-list df-equipment-basic">{basicUnknowns.map(label => <div className="df-value-row" key={label}><dt><T>{label}</T></dt><dd><T>—</T></dd></div>)}</dl>
      </section> : null}
    </div>
  </>;
}
