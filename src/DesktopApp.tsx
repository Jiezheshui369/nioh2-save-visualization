import { desktopContextFromStatus, sameDesktopContext } from './desktopDataContext';
import { DesktopTitles } from './DesktopTitles';
import type { DesktopDataContext } from './desktopDataContext';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { SaveSnapshot, SaveSourceOption, LoadoutItem } from './types';
import { DesktopTypography, DesktopText as T, useDesktopScale } from './DesktopTypography';
import { DesktopMenu } from './DesktopMenu';
import { DesktopDialog } from './DesktopDialog';
import { DesktopHome } from './DesktopHome';
import { DesktopEquipment } from './DesktopEquipment';
import { DesktopGuardians } from './DesktopGuardians';
import { DesktopSkills } from './DesktopSkills';
import { DesktopCharacterInformation } from './DesktopCharacterInformation';
import { DesktopPendingModule, DesktopPreparation } from './DesktopModules';
import { desktopAssets, designImage, imageUrl } from './desktopAssets';
import { useDesktopAccount } from './useDesktopAccount';
import { desktopMenuEntries, desktopNavigation, initialDesktopNavigation } from './desktopNavigation';
import type { DesktopPage, DesktopMenuId } from './desktopNavigation';
import { equipmentRecordKey } from './desktopPresentation';
import './desktopFigma.css';
import {useDesktopTextSelection} from './useDesktopTextSelection';
import './desktopTextSelection.css';
export type DesktopReadState = 'idle' | 'reading' | 'failed' | 'committed' | 'cancelled';
interface Props {
  dataContext: DesktopDataContext | null; onDataContextChange: (context: DesktopDataContext | null) => void;
  sourceNewer?: boolean; snapshot: SaveSnapshot | null; sources: SaveSourceOption[]; loading: boolean; error: string; notice?: string;
  busy: boolean; readState: DesktopReadState; importPanel: ReactNode;
  onReadSource: (sourceId?: string) => Promise<boolean>; onDismissRead: () => void; onRetryLoad: () => void;
}
const desktopFlowTitle=(state:DesktopReadState,busy:boolean)=>state==='reading'?'存档解析中':state==='failed'?'存档解析失败':busy?'解析中':'仁王2 · 暂无存档';
const games = [
  { id: 'nioh1', label: '仁王1' }, { id: 'nioh2', label: '仁王2' }, { id: 'nioh3', label: '仁王3' },
  { id: 'wolong1', label: '卧龙1' }, { id: 'wolong2', label: '卧龙2' },
] as const;
export function DesktopApp({ sourceNewer = false, snapshot: suppliedSnapshot, dataContext, onDataContextChange, sources, loading, error, notice, busy, readState, importPanel, onReadSource, onRetryLoad, onDismissRead }: Props) {
  const selectionRoot=useRef<HTMLDivElement>(null);
  useDesktopTextSelection(selectionRoot);
  const invalidate = useCallback(() => onDataContextChange(null), [onDataContextChange]);
  const account = useDesktopAccount(invalidate);
  const [authCancelled,setAuthCancelled]=useState(false);
  const [authFeedbackDismissed,setAuthFeedbackDismissed]=useState(false);
  useEffect(()=>{setAuthFeedbackDismissed(false);},[account.status?.state,account.status?.errorCode,account.error]);
  const returnToLogin=()=>{setAuthCancelled(false);setAuthFeedbackDismissed(true);};
  const accountAction=(action:'login'|'cancel'|'logout'|'status')=>{if(action!=='status')setAuthFeedbackDismissed(false);if(action==='cancel')setAuthCancelled(true);else if(action!=='status')setAuthCancelled(false);void account.update(action);};
  const activeContext = desktopContextFromStatus(account.status);
  const activeContextRef=useRef(activeContext);activeContextRef.current=activeContext;
  const snapshot = activeContext && sameDesktopContext(activeContext, dataContext) ? suppliedSnapshot : null;
  useLayoutEffect(() => { onDataContextChange(activeContext); },
    [activeContext?.accountScope, activeContext?.sessionId, onDataContextChange]);

  const scale = useDesktopScale();
  const [stage, setStage] = useState<'games' | 'nioh2'>('games');
  const [nav, dispatch] = useReducer(desktopNavigation, initialDesktopNavigation);
  const [switchOpen, setSwitchOpen] = useState(false), [hintOpen, setHintOpen] = useState(false);
  const [pendingSource, setPendingSource] = useState(''), [switchFailed, setSwitchFailed] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const wasCommitted = useRef<string | null>(null);
  const previousSnapshot = useRef(snapshot?.snapshotId ?? null);
  const sourceLock = useRef(false);
  const pageRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    dispatch({ type: 'snapshot', snapshotId: snapshot?.snapshotId ?? null });
    if (snapshot?.snapshotId !== previousSnapshot.current) {
      previousSnapshot.current = snapshot?.snapshotId ?? null;
      setSwitchOpen(false); dispatch({ type: 'navigate', page: 'home' });
    }
    if (readState === 'committed' && snapshot && wasCommitted.current !== snapshot.snapshotId) {
      wasCommitted.current = snapshot.snapshotId;
      let shown = false; try { shown = window.localStorage.getItem('saveasset-desktop-esc-tip-v1') === '1'; } catch { /* storage failure cannot remove a committed save */ }
      if (!shown) setHintOpen(true);
    }
  }, [snapshot?.snapshotId, readState]);
  useEffect(() => {
    if (account.status?.state !== 'signed-in') { setStage('games'); setSwitchOpen(false); setHintOpen(false); dispatch({ type: 'reset' }); }
  }, [account.status?.state]);
  useEffect(() => {
    setStage('games'); setSwitchOpen(false); setHintOpen(false); dispatch({ type: 'reset' });
  }, [activeContext?.accountScope, activeContext?.sessionId]);
  const importOverlay = Boolean(snapshot) && ['reading','failed','cancelled'].includes(readState);
  const allowed = Boolean(activeContext) && sameDesktopContext(activeContext,dataContext) && stage === 'nioh2';
  useEffect(() => {
    const drag = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    const drop = (event: DragEvent) => { if (!allowed && event.dataTransfer?.files.length) event.preventDefault(); };
    window.addEventListener('dragover', drag); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', drag); window.removeEventListener('drop', drop); };
  }, [allowed]);
  const closeHint = () => { setHintOpen(false); try { window.localStorage.setItem('saveasset-desktop-esc-tip-v1','1'); } catch { /* optional tip preference only */ } };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !allowed) return;
      if (importOverlay) { if (readState !== 'reading') onDismissRead(); }
      else if (switchOpen) setSwitchOpen(false);
      else if (hintOpen) closeHint();
      else if (snapshot) dispatch({ type: 'menu', open: !nav.menuOpen });
      event.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [allowed, switchOpen, hintOpen, nav.menuOpen, Boolean(snapshot), importOverlay, readState, onDismissRead]);
  const navigate = (page: DesktopPage) => dispatch({ type: 'navigate', page });
  const openEquipment = (item: LoadoutItem | null) => {
    navigate('equipment');
    if (snapshot && item) dispatch({ type: 'detail', recordKey: equipmentRecordKey(item), snapshotId: snapshot.snapshotId });
  };
  const openSwitch = () => {
    setPendingSource(''); setSwitchFailed(false); setSwitchOpen(true);
  };
  const confirmSource = async () => {
    if (sourceLock.current || busy || !pendingSource) return;
    const capturedContext=activeContext;
    sourceLock.current = true; setSourceBusy(true); setSwitchFailed(false);
    try {
      const accepted = await onReadSource(pendingSource);
      if(!sameDesktopContext(capturedContext,activeContextRef.current))return;
      if (accepted) { setSwitchOpen(false); navigate('home'); } else setSwitchFailed(true);
    } finally { sourceLock.current = false; setSourceBusy(false); }
  };
  const current = nav.location.page;
  useEffect(() => { pageRoot.current?.focus({ preventScroll: true }); }, [current, stage]);
  const activeModule = current === 'home' ? 'settings' : current;
  const moduleTitle = desktopMenuEntries.find(entry => entry.id === current)?.label ?? '主界面 / 设置';
  const css = {
    '--df-scale': scale,
    '--df-panel': 'url("' + designImage('511-2130','img13451600') + '")',
    '--df-row': 'url("' + designImage('511-2130','img1') + '")',
  } as CSSProperties;
  const signedIn = Boolean(activeContext);
  const pendingAuth = account.status?.state === 'signing-in';
  const authFailure=account.error || account.status?.state==='error' || account.status?.state==='signed-in' && !activeContext;
  const authFeedback=pendingAuth || !authFeedbackDismissed && (authCancelled || !!authFailure || account.status?.errorCode==='AUTH_CANCELLED');
  const authHeading=pendingAuth?'正在等待浏览器登录':authFailure?(account.status?.state==='signed-in'?'登录未完成':'登录失败'):authCancelled || account.status?.errorCode==='AUTH_CANCELLED'?'登录已取消':'登录方式';
  const accountDisabled = account.busy || !account.status || !!account.status.browserPending;
  return <DesktopTypography><div ref={selectionRoot} className="df-shell" data-desktop-text-selection="ordinary-disabled" data-desktop-figma="0104" style={css}>
    <img className="df-background" src={designImage('511-2130','img')} alt="" /><div className="df-shade" />
    {!signedIn ? <main className={"df-account-screen"+(authFeedback?" df-account-feedback":"")} aria-label="桌面登录">
      <div className="df-brand"><h1><T>存档资产</T></h1><p><T>只读副本 · 自动解析 · 不写回游戏</T></p></div>
      {authFeedback ? <h1 className="df-flow-title"><T>{authHeading}</T></h1> : null}
      <section className="df-panel df-account-panel">
        {!authFeedback ? <h2><T>登录方式</T></h2> : null}
        <p><T>{pendingAuth ? '请在系统浏览器完成登录后返回应用' : account.error ? '暂时无法确认账号状态' : !authFeedback ? '系统浏览器登录' : authCancelled || account.status?.errorCode==='AUTH_CANCELLED' ? '本次登录已取消，可重新登录' : authFailure ? '登录失败，请重试' : '系统浏览器登录'}</T></p>
        {pendingAuth ? <button className="df-button" disabled={account.busy} onClick={() => accountAction('cancel')}><T>取消账号操作</T></button>
          : <button className="df-button" disabled={accountDisabled} onClick={() => accountAction('login')}><T>{authFeedback ? '重新登录' : '使用Google账号登录'}</T></button>}
        {account.status?.browserPending ? <p className="df-muted"><T>浏览器中的账号操作尚未结束</T></p> : null}
        <button className="df-account-retry" disabled={account.busy} onClick={() => accountAction('status')}><T>刷新账号状态</T></button>
      </section>
      {authFeedback && !pendingAuth ? <button className="df-auth-return" disabled={account.busy} onClick={returnToLogin}><T>返回登录</T></button> : null}
    </main> : stage === 'games' ? <main className="df-games-screen" aria-label="选择游戏">
      <header><h1><T>选择游戏</T></h1><p><T>已登录</T></p></header>
      <div className="df-game-cards">{games.map(game => <button key={game.id} className={'df-game-card' + (game.id === 'nioh2' ? ' df-game-supported' : '')}
        disabled={game.id !== 'nioh2'} aria-label={game.label + (game.id === 'nioh2' ? ' 进入' : ' 等待施工')}
        onClick={() => { if (game.id === 'nioh2') setStage('nioh2'); }}>
        <img src={imageUrl(desktopAssets.logos[game.id])} alt={game.label} />
        <span><T>{game.label}</T></span><small><T>{game.id === 'nioh2' ? '进入' : '等待施工'}</T></small>
      </button>)}</div>
      <p className="df-games-note"><T>只读存档 · 不写回游戏</T></p>
      <button className="df-game-logout" disabled={account.busy} onClick={() => accountAction('logout')}><T>退出账号</T></button>
    </main> : <>
      <main ref={pageRoot} tabIndex={-1} className={"df-content"+(!snapshot?" df-first-flow":"")+(current==='titles'?' dt-host':'')} inert={nav.menuOpen || switchOpen || hintOpen || importOverlay} aria-label={moduleTitle}>
        {!snapshot ? <>
          <header><h1><T>{desktopFlowTitle(readState,busy)}</T></h1></header>
          {loading ? <section className="df-panel df-empty"><p role="status"><T>正在读取本地资料</T></p></section> : <section className="df-panel df-first-import">{importPanel}</section>}
          {error ? <p className="df-status-message" role="alert"><T>{error}</T><button onClick={onRetryLoad}><T>重试读取</T></button></p> : null}
          <div className="df-footer">{sources.length ? <button disabled={busy} onClick={openSwitch}><T>切换存档</T></button> : null}<button disabled={busy} onClick={() => setStage('games')}><T>返回游戏选择</T></button><span><T>原始存档只读</T></span></div>
        </> : <>
          {current === 'home' ? <DesktopHome snapshot={snapshot} onEquipment={openEquipment} onNavigate={navigate}
            sourceNewer={sourceNewer} onGames={() => setStage('games')} onSwitch={openSwitch} onLogout={() => accountAction('logout')} busy={busy || account.busy} /> : null}
          {current === 'equipment' ? <DesktopEquipment snapshot={snapshot} selected={nav.location.recordKey}
            onSelect={recordKey => dispatch({ type: 'detail', recordKey, snapshotId: snapshot.snapshotId })} onClose={() => dispatch({ type: 'back' })} /> : null}
          {current === 'guardians' ? <DesktopGuardians key={snapshot.snapshotId} snapshot={snapshot} /> : null}
          {current === 'skills' ? <DesktopSkills key={snapshot.snapshotId} snapshot={snapshot} onMenu={() => dispatch({ type: 'menu', open: true })} /> : null}
          {current === 'character-details' ? <DesktopCharacterInformation snapshot={snapshot} /> : null}
          {current === 'titles' ? <DesktopTitles key={snapshot.snapshotId} snapshot={snapshot} onMenu={() => dispatch({type:'menu',open:true})} onBack={() => dispatch({type:'back'})} /> : null}
          {current==='warehouse'||current==='equipment-skills'||current==='underworld'?<DesktopPendingModule page={current}/>:null}
          {current==='preparation'?<DesktopPreparation key={snapshot.snapshotId} snapshot={snapshot}/>:null}
          {!['skills','titles'].includes(current) ? <div className="df-footer"><button onClick={() => dispatch({ type: 'menu', open: true })}><T>呼出菜单</T></button>
            {current !== 'home' ? <button onClick={() => dispatch({ type: 'back' })}><T>{nav.location.recordKey ? '返回装备' : '返回'}</T></button> : null}</div> : null}
          {error ? <p role="alert" className="df-status-message df-recoverable-error"><T>{error}</T></p> : null}
          {notice && current === 'home' && readState === 'committed' ? <p role="status" className="df-status-message df-muted df-commit-notice"><T>解析结果已保存到本机</T></p> : null}
        </>}
      </main>
      {snapshot ? <DesktopDialog label="存档解析" open={importOverlay} onClose={() => { if (readState !== 'reading') onDismissRead(); }}><h1 className="df-flow-title"><T>{desktopFlowTitle(readState,busy)}</T></h1>{importPanel}</DesktopDialog> : null}
      <DesktopMenu open={nav.menuOpen} page={current} onClose={() => dispatch({ type: 'menu', open: false })} onNavigate={page => navigate(page)} />
      {switchOpen ? <DesktopDialog label="切换存档" onClose={() => { if (!sourceBusy) setSwitchOpen(false); }}>
        <h1 className="df-flow-title"><T>选择存档</T></h1><h2><T>切换存档</T></h2>
        <div className="df-source-options">{sources.map(source => <button className="df-button" key={source.id} aria-pressed={pendingSource === source.id} disabled={sourceBusy}
          onClick={() => setPendingSource(source.id)}><T>{source.slot + (source.accountHint ? ' · ' + source.accountHint : '') + (source.active ? ' · 当前' : '')}</T></button>)}</div>
        {!sources.length ? <p><T>尚未发现可切换存档</T></p> : null}
        {switchFailed ? <p role="alert"><T>读取失败；当前存档保持不变</T></p> : null}
        <div className="df-dialog-actions"><button className="df-button" disabled={sourceBusy || busy || !pendingSource} onClick={() => void confirmSource()}><T>{sourceBusy ? '读取中' : '确认选择'}</T></button>
        <button className="df-button" disabled={sourceBusy} onClick={() => setSwitchOpen(false)}><T>取消</T></button></div>
      </DesktopDialog> : null}
      {hintOpen ? <DesktopDialog label="Esc菜单提示" onClose={closeHint}><h2><T>按Esc呼出菜单</T></h2><p><T>原始存档只读；解析结果自动保存在本机</T></p><div className="df-dialog-actions"><button className="df-button" onClick={closeHint}><T>知道了</T></button></div></DesktopDialog> : null}
    </>}
    <span className="df-current-module" hidden data-module={activeModule} />
  </div></DesktopTypography>;
}
