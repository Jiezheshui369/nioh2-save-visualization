import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import App from './App';
import {nativeAccount} from './nativeAccount';
import type {NativeAccountStatus} from './nativeAccount';
import {loadLatestSnapshot,loadSaveSources,refreshSnapshot} from './api';
import {loadDesktopCachedSnapshot,saveDesktopSnapshot} from './desktopSnapshotCache';
import {loadCachedSnapshot,saveCachedSnapshot} from './snapshotCache';
import type {SaveSnapshot} from './types';
import fixture from '../public/data/demo-snapshot.json';
vi.mock('./nativeAccount',async original=>({...await original<typeof import('./nativeAccount')>(),nativeAccount:vi.fn()}));
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),loadLatestSnapshot:vi.fn(),loadSaveSources:vi.fn(),refreshSnapshot:vi.fn(),
 loadAgentStatus:vi.fn(async()=>({status:'ok',refreshAvailable:true,writeBackSupported:false}))}));
const a={accountScope:'a'.repeat(64),sessionId:'1'.repeat(64)}, b={accountScope:'b'.repeat(64),sessionId:'2'.repeat(64)};
const newA={...a,sessionId:'3'.repeat(64)};
const snapshotA={...structuredClone(fixture),snapshotId:'account-a-real-shape-test'} as SaveSnapshot;
const snapshotB={...structuredClone(fixture),snapshotId:'account-b-real-shape-test',character:{...fixture.character,level:123}} as SaveSnapshot;
const signed=(c:typeof a):NativeAccountStatus=>({state:'signed-in',localDataScope:c.accountScope,localDataSessionId:c.sessionId});
let status:NativeAccountStatus;
let logout:()=>Promise<NativeAccountStatus>;
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
async function enter(){await screen.findByRole('main',{name:'选择游戏'});fireEvent.click(screen.getByRole('button',{name:'仁王2 进入'}));await screen.findByRole('heading',{name:'仁王2 · 暂无存档'});}
async function selectSource(){fireEvent.click(await screen.findByRole('button',{name:'切换存档'}));const d=screen.getByRole('dialog',{name:'切换存档'});expect(within(d).getByRole('button',{name:'确认选择'})).toBeDisabled();fireEvent.click(within(d).getByRole('button',{name:/^SAVEDATA00/}));fireEvent.click(within(d).getByRole('button',{name:'确认选择'}));}
async function loaded(){await screen.findByRole('heading',{name:'主界面 / 设置'});await waitFor(()=>expect(screen.getByRole('button',{name:'切换存档'})).toBeEnabled());}
async function updateAccount(next:NativeAccountStatus){status=next;fireEvent.focus(window);await act(async()=>{});}
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('indexedDB',new IDBFactory());status=signed(a);logout=async()=>{status={state:'signed-out'};return status;};
 vi.mocked(nativeAccount).mockImplementation(async action=>action==='logout'?logout():status);
 vi.mocked(loadSaveSources).mockResolvedValue([{id:'source-1',slot:'SAVEDATA00',active:true,accountHint:'test',latestWriteLocal:'2026-10-27'}]);
 vi.mocked(refreshSnapshot).mockResolvedValue(snapshotA);window.localStorage.setItem('saveasset-desktop-esc-tip-v1','1');});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();window.localStorage.clear();});
describe('desktop logout and account data boundary',()=>{
 it('does not adopt server latest, old session cache or the legacy mobile cache after login',async()=>{
  await saveCachedSnapshot(snapshotB);await saveDesktopSnapshot(a,snapshotA);render(<App/>);await enter();
  expect(loadLatestSnapshot).not.toHaveBeenCalled();expect(refreshSnapshot).not.toHaveBeenCalled();
  expect(await loadCachedSnapshot()).toMatchObject({snapshotId:snapshotB.snapshotId});
  expect(await loadDesktopCachedSnapshot(a)).toMatchObject({snapshotId:snapshotA.snapshotId});
  await selectSource();await loaded();expect(refreshSnapshot).toHaveBeenCalledWith('source-1',undefined,a);
 });
 it('hides data at logout intent before the native response and never restores it on a new session',async()=>{
  const exit=deferred<NativeAccountStatus>();logout=()=>exit.promise;const app=render(<App/>);await enter();await selectSource();await loaded();
  fireEvent.click(screen.getByRole('button',{name:'退出账号'}));
  expect(screen.queryByRole('heading',{name:'主界面 / 设置'})).toBeNull();expect(app.container.querySelector('.df-basic-attributes')).toBeNull();
  expect(await loadDesktopCachedSnapshot(a)).toMatchObject({snapshotId:snapshotA.snapshotId});
  status={state:'signed-out'};await act(async()=>exit.resolve(status));await screen.findByRole('main',{name:'桌面登录'});
  await updateAccount(signed(newA));await enter();
  expect(await loadDesktopCachedSnapshot(newA)).toBeNull();expect(refreshSnapshot).toHaveBeenCalledTimes(1);expect(loadLatestSnapshot).not.toHaveBeenCalled();
 });
 it('isolates account B and preserves account A history and existing mobile data',async()=>{
  await saveCachedSnapshot(snapshotA);render(<App/>);await enter();await selectSource();await loaded();
  fireEvent.click(screen.getByRole('button',{name:'退出账号'}));await screen.findByRole('main',{name:'桌面登录'});
  await updateAccount(signed(b));await enter();expect(await loadDesktopCachedSnapshot(b)).toBeNull();
  vi.mocked(refreshSnapshot).mockResolvedValue(snapshotB);await selectSource();await loaded();
  expect(await loadDesktopCachedSnapshot(b)).toMatchObject({snapshotId:snapshotB.snapshotId});
  expect(await loadDesktopCachedSnapshot(a)).toMatchObject({snapshotId:snapshotA.snapshotId});
  expect(await loadCachedSnapshot()).toMatchObject({snapshotId:snapshotA.snapshotId});
  expect(refreshSnapshot).toHaveBeenLastCalledWith('source-1',undefined,b);
 });
 it('discards late account A refresh responses after the verified account changes',async()=>{
  const held=deferred<SaveSnapshot>();vi.mocked(refreshSnapshot).mockReturnValueOnce(held.promise);
  render(<App/>);await enter();await selectSource();await updateAccount(signed(b));
  await screen.findByRole('main',{name:'选择游戏'});
  await act(async()=>held.resolve(snapshotA));await enter();
  expect(await loadDesktopCachedSnapshot(a)).toBeNull();expect(await loadDesktopCachedSnapshot(b)).toBeNull();
  expect(screen.queryByRole('heading',{name:'主界面 / 设置'})).toBeNull();
  vi.mocked(refreshSnapshot).mockResolvedValue(snapshotB);await selectSource();await loaded();
  expect(await loadDesktopCachedSnapshot(b)).toMatchObject({snapshotId:snapshotB.snapshotId});
 });
 it('ignores old source metadata after account replacement',async()=>{
  const held=deferred<Awaited<ReturnType<typeof loadSaveSources>>>();vi.mocked(loadSaveSources).mockReturnValueOnce(held.promise).mockResolvedValue([]);
  render(<App/>);await screen.findByRole('main',{name:'选择游戏'});await updateAccount(signed(b));
  await act(async()=>held.resolve([{id:'old-a',slot:'PRIVATE-A',active:true,accountHint:'a',latestWriteLocal:'2026-10-27'}]));
  await enter();expect(screen.queryByRole('button',{name:'切换存档'})).toBeNull();expect(loadLatestSnapshot).not.toHaveBeenCalled();
 });
 it('fails closed when a signed-in status has no usable local context',async()=>{
  status={state:'signed-in'};render(<App/>);await screen.findByRole('main',{name:'桌面登录'});
  expect(screen.getByRole('heading',{name:'登录未完成'})).toBeInTheDocument();expect(loadSaveSources).not.toHaveBeenCalled();expect(loadLatestSnapshot).not.toHaveBeenCalled();
 });
 it('keeps visible state empty after failed logout even if status later reports the old session',async()=>{
  render(<App/>);await enter();await selectSource();await loaded();logout=async()=>{throw new Error('native unavailable');};
  fireEvent.click(screen.getByRole('button',{name:'退出账号'}));await screen.findByText('暂时无法确认账号状态');
  await updateAccount(signed(a));await enter();expect(refreshSnapshot).toHaveBeenCalledTimes(1);
  expect(await loadDesktopCachedSnapshot(a)).toMatchObject({snapshotId:snapshotA.snapshotId});
 });
});

describe('candidate9 failed source error readability',()=>{
 it('shows the full native error after cancelling failed B and preserves A cache through pending-page navigation',async()=>{
  vi.mocked(loadSaveSources).mockResolvedValue([{id:'source-1',slot:'SAVEDATA00',active:true,accountHint:'test',latestWriteLocal:'2026-10-27'},{id:'bad-b',slot:'SAVEDATA01',active:false,accountHint:'test',latestWriteLocal:'2026-10-27'}]);
  const app=render(<App/>);await enter();await selectSource();await loaded();const before=await loadDesktopCachedSnapshot(a);
  const message='无法唯一确定主存档副本：找到 0 个候选';vi.mocked(refreshSnapshot).mockRejectedValueOnce(new Error(message));
  fireEvent.click(screen.getByRole('button',{name:'切换存档'}));const dialog=screen.getByRole('dialog',{name:'切换存档'});
  fireEvent.click(within(dialog).getByRole('button',{name:/^SAVEDATA01/}));fireEvent.click(within(dialog).getByRole('button',{name:'确认选择'}));
  await screen.findByText('读取失败；当前存档保持不变');fireEvent.click(screen.getByRole('button',{name:'取消'}));
  const alert=screen.getByRole('alert');expect(alert).toHaveTextContent(message);expect(alert.querySelector('[data-native-missing]')).toBeNull();
  expect(await loadDesktopCachedSnapshot(a)).toEqual(before);expect(refreshSnapshot).toHaveBeenLastCalledWith('bad-b',undefined,a);
  fireEvent.keyDown(window,{key:'Escape'});fireEvent.click(within(screen.getByRole('dialog',{name:'呼出菜单'})).getByRole('button',{name:'技能'}));fireEvent.click(screen.getByRole('button',{name:'斧'}));
  expect(screen.getByRole('alert')).toHaveTextContent(message);expect(app.container.querySelectorAll('[data-native-missing]')).toHaveLength(0);expect(await loadDesktopCachedSnapshot(a)).toEqual(before);
 });
});
