import type { SaveSnapshot, LoadoutItem } from './types';
import { desktopAssets, designImage, imageUrl } from './desktopAssets';
import { DesktopText as T } from './DesktopTypography';
import { desktopIntegerDisplay, basicDesktopStatus, equippedSlots, equipmentName, firstPersistedGuardianKey, persistedGuardian } from './desktopPresentation';
import type { DesktopPage } from './desktopNavigation';
const attributes = [['constitution','体'],['heart','心'],['courage','勇'],['stamina','刚'],['strength','武'],['skill','技'],['dexterity','忍'],['magic','咒']] as const;
export function CoreRows({ snapshot, guardianKey, onCore }: {
  snapshot: SaveSnapshot; guardianKey: number | undefined; onCore?: (index: number) => void;
}) {
  const data = guardianKey === undefined ? undefined : persistedGuardian(snapshot, guardianKey);
  return <>{[0,1,2].map(index => {
    const record = data?.coreInstances[index];
    return <button className="df-core-row" key={index} disabled={!record || !onCore} aria-label={'魂核记录' + (index + 1)}
      onClick={() => record && onCore?.(index)}>
      <img className="df-core-plate" src={designImage('414-1160','img2')} alt="" />
      <span className="df-core-icon" aria-hidden="true"><T>—</T></span>
      <span className="df-core-copy"><T>{record ? '魂核记录' + (index + 1) : '凭附状态 —'}</T><small><T>{record ? '名称 / 等级 / 类型 —' : '未知不等于空位'}</T></small></span>
    </button>;
  })}</>;
}
export function DesktopHome({ snapshot, onEquipment, onNavigate, onGames, onSwitch, onLogout, busy, sourceNewer = false }: {
  sourceNewer?: boolean; snapshot: SaveSnapshot; onEquipment: (item: LoadoutItem | null) => void; onNavigate: (page: DesktopPage) => void;
  onGames: () => void; onSwitch: () => void; onLogout: () => void; busy: boolean;
}) {
  const key = firstPersistedGuardianKey(snapshot);
  const guardian = desktopAssets.guardians.find(g => g.key === key);
  const selectedSource = snapshot.researchLabel || snapshot.sourceLastWriteLocal;
  return <>
    <header className="df-home-header"><div><h1><T>主界面 / 设置</T></h1><p><T>{'当前存档：' + selectedSource}</T></p></div>
      <dl className="df-home-resources" aria-label="精华与持有金钱">
        {(['amrita','gold'] as const).map(field => {
          const value = desktopIntegerDisplay(snapshot.character[field]);
          return <div key={field} data-resource-field={field} data-value-source={value === '—' ? 'unparsed' : 'snapshot-basic'}>
            <dt><T>{field === 'amrita' ? '精华' : '持有金钱'}</T></dt><dd><T fit>{value}</T></dd>
          </div>;
        })}
      </dl>
      {sourceNewer ? <button className="df-newer-source" disabled={busy} onClick={onSwitch}><T>检测到较新存档；选择读取</T></button> : null}</header>
    <div className="df-home-grid">
      <section className="df-panel"><h2><T>装备摘要</T></h2><div className="df-home-equipment">
        {equippedSlots(snapshot).map(({ slot,label,item }) => <button key={slot} className="df-equipment-row" aria-label={label}
          onClick={() => onEquipment(item)}><span className="df-equipment-label"><T wrap>{equipmentName(item)}</T></span></button>)}
      </div><p className="df-muted df-status-message"><T>点击可查看装备详情</T></p></section>
      <section className="df-panel df-home-guardian"><h2><T>守护灵与魂核</T></h2>
        {guardian ? <img className="df-guardian-portrait" src={imageUrl(guardian)} alt={guardian.name} /> : <div className="df-guardian-portrait df-empty-portrait"><T>—</T></div>}
        <button className="df-guardian-name" onClick={() => onNavigate('guardians')}><T>{guardian?.name ?? '—'}</T></button>
        <CoreRows snapshot={snapshot} guardianKey={key} onCore={() => onNavigate('guardians')} />
        <p className="df-muted"><T>活动槽 / 主副身份 —</T></p>
      </section>
      <section className="df-panel df-home-status"><h2><T>加点记录</T></h2><div className="df-basic-attributes">
        {attributes.map(([key,label]) => <div key={key}><span><T>{label}</T></span><span><T>{snapshot.character.attributes[key]}</T></span></div>)}
      </div><h2><T>基础状态</T></h2><dl className="df-data-list df-home-basics">
        {basicDesktopStatus(snapshot).map(row => <div className="df-value-row" key={row.label} data-status-source={row.state}><dt><T wrap>{row.label}</T></dt><dd><T>{row.value}</T></dd></div>)}
      </dl><p className="df-muted"><T>妖力当前值为指定场景默认</T></p></section>
    </div>
    <section className="df-panel df-settings-bar" aria-label="设置与账号">
      <div><h2><T>设置与账号</T></h2><p className="df-muted"><T>只读副本 · 自动解析 · 不写回游戏</T></p></div>
      <button className="df-button" disabled={busy} onClick={onGames}><T>返回游戏选择</T></button>
      <span className="df-muted"><T>已登录</T></span>
      <button className="df-button" disabled={busy} onClick={onSwitch}><T>切换存档</T></button>
      <button className="df-button" disabled={busy} onClick={onLogout}><T>退出账号</T></button>
    </section>
  </>;
}
