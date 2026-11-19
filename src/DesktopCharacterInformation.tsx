import type { SaveSnapshot } from './types';
import { CHARACTER_PANEL_CATALOG, CHARACTER_EFFECT_CATALOG } from './characterStatusCatalog';
import { matchingResearchStatus } from './researchStatus';
import { desktopIntegerDisplay } from './desktopPresentation';
import { DesktopText as T } from './DesktopTypography';
const basics = [
  ['等级',(s:SaveSnapshot) => s.character.level],['体',(s:SaveSnapshot) => s.character.attributes.constitution],
  ['心',(s:SaveSnapshot) => s.character.attributes.heart],['勇',(s:SaveSnapshot) => s.character.attributes.courage],
  ['刚',(s:SaveSnapshot) => s.character.attributes.stamina],['武',(s:SaveSnapshot) => s.character.attributes.strength],
  ['技',(s:SaveSnapshot) => s.character.attributes.skill],['忍',(s:SaveSnapshot) => s.character.attributes.dexterity],
  ['咒',(s:SaveSnapshot) => s.character.attributes.magic],
] as const;
export function DesktopCharacterInformation({ snapshot }: { snapshot: SaveSnapshot }) {
  const research = matchingResearchStatus(snapshot);
  let panelIndex = 0;
  return <>
    <header><h1><T>人物详细信息</T></h1></header>
    <div className="dm-character-columns">
    <section className="dm-paper df-character-basics" role="region" aria-label="基本能力" tabIndex={0}>
      <h2><T>基本能力</T></h2><dl className="df-data-list">
        {basics.map(([label,value],i) => <div className="df-value-row" key={label} data-detail-row={'basic-' + i} data-value-source="snapshot-basic"><dt><T wrap>{label}</T></dt><dd><T>{desktopIntegerDisplay(value(snapshot))}</T></dd></div>)}
      </dl>
    </section>
    <section className="dm-paper df-character-scroll" role="region" aria-label="人物详细信息记录" tabIndex={0}>
      <h2><T>详细属性</T></h2>
      {CHARACTER_PANEL_CATALOG.map((group,gi) => <section key={gi} data-detail-kind="panel"><h2><T>{group.title}</T></h2><dl className="df-data-list">
        {group.entries.map((field,ri) => {
          const index = ++panelIndex;
          const entry = research?.panel.find(p => p.index === index);
          const source = entry?.state === 'ordinary' ? 'ordinary-projection' : entry?.state === 'scene-default' ? 'user-scene-default' : 'unparsed';
          return <div className="df-value-row" key={ri} data-detail-row={'panel-' + gi + '-' + ri} data-value-source={source}>
            <dt><T wrap>{field.label}</T>{entry?.state === 'scene-default' ? <small><T>场景默认</T></small> : null}</dt><dd><T>{entry?.display ?? '—'}</T></dd>
          </div>;
        })}
      </dl></section>)}
      {CHARACTER_EFFECT_CATALOG.map((group,gi) => <section key={gi} data-detail-kind="effect"><h2><T>{group.title}</T></h2><dl className="df-data-list">
        {group.entries.map((field,ri) => {
          const id = 'effect-' + gi + '-' + ri;
          const entry = research?.effects.find(e => e.id === id);
          return <div className="df-value-row" key={ri} data-detail-row={id} data-value-source={entry?.state === 'ordinary' ? 'ordinary-projection' : 'unparsed'}>
            <dt><T wrap>{field.label}</T></dt><dd><T>{entry?.display ?? '—'}</T></dd>
          </div>;
        })}
      </dl></section>)}
    </section></div>
  </>;
}
