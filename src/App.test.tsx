import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import App, { BuildsView, EmptyLibrary } from './App';
import type { SaveSnapshot } from './types';
import fixture from '../public/data/demo-snapshot.json';
import { nativeAccount } from './nativeAccount';
import { refreshSnapshot } from './api';
vi.mock('./nativeAccount', async original => ({
  ...await original<typeof import('./nativeAccount')>(), nativeAccount: vi.fn(),
}));
vi.mock('./api', async original => {
  const real = await original<typeof import('./api')>();
  return { ...real, getLastLoadSource: () => 'api', cacheRecentSnapshots: () => Promise.resolve(20),
    loadLatestSnapshot: vi.fn(() => Promise.resolve(fixture)),
    loadSnapshotIndex: () => Promise.resolve([]),
    loadSaveSources: () => Promise.resolve([{ id: 'source-1', accountHint: '1843', slot: 'SAVEDATA00', latestWriteLocal: '2026-01-01', active: true }]),
    loadAgentStatus: () => Promise.resolve({ status: 'ok', apiVersion: '1.4', writeBackSupported: false, refreshAvailable: true, lanMode: false,
      source: { configured: true, accountHint: '1843', saveSlots: ['SAVEDATA00'], latestWriteLocal: '2026-10-28' },
      backupCopies: { completeCopies: 4, incompleteCopies: 0, latestCreatedAtUtc: '2026-01-02' },
      steamCloud: { detected: true, state: 'synchronized' } }),
    refreshSnapshot: vi.fn(),
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.mocked(nativeAccount).mockImplementation(async action => action === 'logout' ? {state:'signed-out'} : {state:'signed-in',localDataScope:'a'.repeat(64),localDataSessionId:'1'.repeat(64)});
  vi.mocked(refreshSnapshot).mockResolvedValue(structuredClone(fixture) as SaveSnapshot);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });
async function enter() {
  const app = render(<App />);
  await screen.findByRole('main', { name: '选择游戏' });
  fireEvent.click(screen.getByRole('button', { name: '仁王2 进入' }));
  await readCurrentSource();
  vi.mocked(refreshSnapshot).mockClear();
  return app;
}
async function readCurrentSource() {
  fireEvent.click(await screen.findByRole('button', {name:'切换存档'}));
  const dialog=screen.getByRole('dialog',{name:'切换存档'});
  fireEvent.click(within(dialog).getByRole('button',{name:/^SAVEDATA00/}));
  fireEvent.click(within(dialog).getByRole('button',{name:'确认选择'}));
  await screen.findByRole('heading',{name:'主界面 / 设置'});
  await waitFor(()=>expect(screen.getByRole('button',{name:'切换存档'})).toBeEnabled());
}
function menu() {
  fireEvent.keyDown(window, { key: 'Escape' });
  return screen.getByRole('dialog', { name: '呼出菜单' });
}
describe('Windows Figma desktop integration', () => {
  it('keeps the legacy empty-library callback honest', () => {
    const onImport = vi.fn();
    render(<EmptyLibrary onImport={onImport} />);
    fireEvent.click(screen.getByRole('button', { name: '导入我的档案包' }));
    expect(onImport).toHaveBeenCalledOnce();
  });
  it('isolates five games and only lets Nioh2 enter actual loaded data', async () => {
    render(<App />);
    await screen.findByRole('main', { name: '选择游戏' });
    for (const game of ['仁王1','仁王3','卧龙1','卧龙2']) {
      const button = screen.getByRole('button', { name: game + ' 等待施工' });
      expect(button).toBeDisabled(); fireEvent.click(button);
      expect(screen.queryByRole('heading', { name: '主界面 / 设置' })).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: '仁王2 进入' }));
    expect(await screen.findByRole('heading', { name: '仁王2 · 暂无存档' })).toBeInTheDocument();
    expect(refreshSnapshot).not.toHaveBeenCalled();
  });
  it('renders the eight stored attributes without reusing the mobile sidebar', async () => {
    const app = await enter();
    expect(app.container.querySelectorAll('.df-basic-attributes > div')).toHaveLength(8);
    expect(app.container.querySelector('.nd-sidebar')).toBeNull();
    expect(screen.queryByRole('navigation', { name: '手机主要功能' })).not.toBeInTheDocument();
  });
  it('opens exactly ten menu choices with Esc and closes without clearing the current page', async () => {
    await enter(); const dialog = menu();
    const names = within(dialog).getAllByRole('button').slice(0, 10).map(b => b.getAttribute('aria-label'));
    expect(names).toEqual(['装备','仓库','守护灵','技能','装备技能','战斗准备','奈洛狱','设置','称号','人物详细信息']);
    fireEvent.click(within(dialog).getByRole('button', { name: '设置' }));
    expect(screen.queryByRole('dialog', { name: '呼出菜单' })).toBeNull();
    expect(screen.getByRole('heading', { name: '主界面 / 设置' })).toBeInTheDocument();
  });
  it('renders eleven stored slots plus an unresolved scroll without equipping a candidate', async () => {
    await enter(); fireEvent.click(within(menu()).getByRole('button', { name: '装备' }));
    const region = screen.getByRole('region', { name: '当前装备' });
    expect(within(region).getAllByRole('button')).toHaveLength(12);
    expect(within(region).getByRole('button', { name: '绘卷 —' })).toBeDisabled();
    const item = within(region).getAllByRole('button').find(button => !button.hasAttribute('disabled'))!;
    fireEvent.click(item);
    expect(screen.getAllByRole('region', { name: '装备属性' })).toHaveLength(1);
    expect(screen.queryByText('D6A7静态目录图')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
    expect(screen.queryByRole('region', { name: '装备属性' })).toBeNull();
  });
  it('keeps current data when save switching is cancelled and retains it across game selection', async () => {
    const app = await enter();
    const before = app.container.querySelector('.df-basic-attributes')!.textContent;
    fireEvent.click(screen.getByRole('button', { name: '切换存档' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: '切换存档' }), { key: 'Escape' });
    expect(refreshSnapshot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回游戏选择' }));
    fireEvent.click(screen.getByRole('button', { name: '仁王2 进入' }));
    expect(app.container.querySelector('.df-basic-attributes')!.textContent).toBe(before);
  });
  it('does not turn historical screenshot observations into current final values', async () => {
    const app = await enter(); fireEvent.click(within(menu()).getByRole('button', { name: '人物详细信息' }));
    expect(app.container.querySelectorAll('[data-detail-row]')).toHaveLength(162);
    const attacks = Array.from(app.container.querySelectorAll('[data-detail-kind=panel] [data-detail-row]')).filter((_,i) => [7,10,13,15].includes(i));
    expect(attacks.map(row => row.querySelector('dd')?.textContent)).toEqual(['—','—','—','—']);
    expect(app.container.querySelector('[data-detail-row=basic-0] dd')?.textContent).toBe(String(fixture.character.level));
  });
  it('opens the titles page with an explicit legacy snapshot state', async () => {
    await enter(); fireEvent.click(within(menu()).getByRole('button', { name: '称号' }));
    expect(screen.getByRole('heading', { name: '此快照尚未解析称号' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '此桌面模块待实现' })).not.toBeInTheDocument();
  });
  it.each(['仓库','装备技能','战斗准备','奈洛狱'])('keeps %s as an honest pending module', async label => {
    await enter(); fireEvent.click(within(menu()).getByRole('button', { name: label }));
    expect(screen.getByRole('heading', { name: label, level:1 })).toBeInTheDocument();
    if (label === '仓库') expect(screen.getByText('仓库记录待读取')).toBeInTheDocument();
    if (label === '装备技能') { expect(screen.getByRole('heading',{name:'武技自定义'})).toBeInTheDocument(); expect(screen.getByRole('heading',{name:'技能装配'})).toBeInTheDocument(); }
    if (label === '奈洛狱') expect(screen.getByRole('region',{name:'层数与进度'})).toHaveTextContent('当前层数—');
    if (label === '战斗准备') expect(screen.getAllByText('预设状态：未知')).toHaveLength(3);
  });
  it('logs out through the existing native API and returns to login', async () => {
    await enter(); fireEvent.click(screen.getByRole('button', { name: '退出账号' }));
    expect(await screen.findByRole('main', { name: '桌面登录' })).toBeInTheDocument();
    expect(nativeAccount).toHaveBeenCalledWith('logout', 'windows');
    expect(screen.queryByRole('heading', { name: '主界面 / 设置' })).toBeNull();
  });
  it('retains the independent named-build persistence component without exposing a fake new module', async () => {
    render(<BuildsView snapshot={structuredClone(fixture) as SaveSnapshot} />);
    fireEvent.change(screen.getByRole('textbox', { name: '配装名称' }), { target: { value: 'independent-build-test' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '收藏当前配装' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '收藏当前配装' }));
    expect(await screen.findByText('已收藏配装')).toBeInTheDocument();
  });

  it('preserves equipment selection through both Esc closure and current-module menu selection', async () => {
    const app = await enter();
    fireEvent.click(within(menu()).getByRole('button', { name: '装备' }));
    const region = screen.getByRole('region', { name: '当前装备' });
    const selectable = within(region).getAllByRole('button').filter(b => !b.hasAttribute('disabled'));
    const selected = selectable[0];
    fireEvent.click(selected);
    const title = app.container.querySelector('.df-equipment-properties h2')!.textContent;
    menu(); fireEvent.keyDown(screen.getByRole('dialog', { name: '呼出菜单' }), { key: 'Escape' });
    expect(app.container.querySelector('.df-equipment-properties h2')!.textContent).toBe(title);
    fireEvent.click(within(menu()).getByRole('button', { name: '装备' }));
    expect(app.container.querySelector('.df-equipment-properties h2')!.textContent).toBe(title);
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
    expect(selected).toHaveFocus();
  });
  it('keeps all 37 native guardian catalogue entries separate from acquired or active status', async () => {
    const app = await enter();
    fireEvent.click(within(menu()).getByRole('button', { name: '守护灵' }));
    const catalogue = screen.getByRole('region', { name: '守护灵目录' });
    const rows = within(catalogue).getAllByRole('button');
    expect(rows).toHaveLength(37);
    catalogue.scrollTop = 600;
    fireEvent.click(rows[20]);
    expect(rows[20]).toHaveAttribute('aria-pressed', 'true');
    expect(catalogue.scrollTop).toBe(600);
    expect(app.container.querySelectorAll('.df-core-row:not(:disabled)')).toHaveLength(0);
    fireEvent.click(within(menu()).getByRole('button', { name: '守护灵' }));
    expect(rows[20]).toHaveAttribute('aria-pressed', 'true');
    expect(catalogue.scrollTop).toBe(600);
  });
  it('maps 15 skill hot spots and keeps the eight ninjutsu records unknown rather than learned', async () => {
    const app = await enter();
    fireEvent.click(within(menu()).getByRole('button', { name: '技能' }));
    const catalogue = screen.getByRole('region', { name: '技能类别' });
    expect(within(catalogue).getAllByRole('button').filter(b => b.classList.contains('df-skill-hotspot'))).toHaveLength(15);
    fireEvent.click(within(catalogue).getByRole('button', { name: '忍术' }));
    const rows = Array.from(app.container.querySelectorAll<HTMLButtonElement>('[data-learning-state]'));
    expect(rows).toHaveLength(8);
    expect(rows.every(r => r.dataset.learningState === 'unknown')).toBe(true);
    fireEvent.click(rows[0]);
    expect(screen.getByRole('region', { name: '技能详情' }).querySelectorAll('dd')).toHaveLength(4);
    const values=[...screen.getByRole('region', { name: '技能详情' }).querySelectorAll('dd')];
    expect(values[0]).toHaveTextContent('未知');
    expect(values.slice(1).every(e => e.textContent === '—')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
    expect(rows[0]).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '返回技能类别' }));
    fireEvent.click(screen.getByRole('button', { name: '刀' }));
    expect(screen.getByText('当前解析接口尚未提供此类别记录')).toBeInTheDocument();
    expect(app.container.querySelectorAll('[data-learning-state]')).toHaveLength(0);
  });
});

// Direct evidence:544:4654/4691/4728; controlled native states, never real OAuth.
describe('candidate8 confirmed transition and pending layouts',()=>{
  it('shows centered pending and cancellation feedback without altering the native account API',async()=>{
    vi.mocked(nativeAccount).mockImplementation(async action=>action==='login'?{state:'signing-in'}:{state:'signed-out'});
    const app=render(<App/>);await screen.findByRole('main',{name:'桌面登录'});
    fireEvent.click(await screen.findByRole('button',{name:'使用Google账号登录'}));
    await screen.findByRole('heading',{name:'正在等待浏览器登录'});
    expect(app.container.querySelector('.df-account-feedback')).not.toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'取消账号操作'}));
    await screen.findByRole('heading',{name:'登录已取消'});
    expect(screen.getByRole('button',{name:'重新登录'})).toBeEnabled();
    expect(nativeAccount).toHaveBeenCalledWith('cancel','windows');
    expect(screen.queryByRole('main',{name:'选择游戏'})).toBeNull();
  });
  it('shows failed native status in the centered feedback composition and retains retry',async()=>{
    vi.mocked(nativeAccount).mockResolvedValue({state:'error'});
    const app=render(<App/>);await screen.findByRole('heading',{name:'登录失败'});
    expect(app.container.querySelector('.df-account-feedback')).not.toBeNull();
    expect(screen.getByRole('button',{name:'重新登录'})).toBeEnabled();
  });
  it.each(['斧','薙刀镰'])('retains the verified star background and selected native circle for pending %s',async category=>{
    const app=await enter();fireEvent.click(within(menu()).getByRole('button',{name:'技能'}));
    const background=app.container.querySelector('.df-skills-background')!.getAttribute('src');
    fireEvent.click(screen.getByRole('button',{name:category}));
    expect(screen.getByRole('region',{name:category+' · 技能记录待读取'})).toBeInTheDocument();
    expect(app.container.querySelector('.df-skills-background')!.getAttribute('src')).toBe(background);
    expect(screen.getByLabelText('已选择类别 '+category).querySelector('.df-skill-base')).not.toBeNull();
    expect(app.container.querySelector('.df-skill-pending-card')).not.toBeNull();
    expect(app.container.querySelectorAll('[data-learning-state]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button',{name:'返回技能类别'}));
    expect(screen.getByRole('region',{name:'技能类别'})).toBeInTheDocument();
  });
});

// UIQA-AUTH-RETURN-007: local feedback navigation must never start OAuth.
describe('candidate9 authentication feedback return',()=>{
  it('returns from cancellation to initial login without a native action and stays there on status refresh',async()=>{
    vi.mocked(nativeAccount).mockImplementation(async action=>action==='login'?{state:'signing-in'}:{state:'signed-out'});
    render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'使用Google账号登录'}));
    await screen.findByRole('heading',{name:'正在等待浏览器登录'});fireEvent.click(screen.getByRole('button',{name:'取消账号操作'}));
    await screen.findByRole('heading',{name:'登录已取消'});await waitFor(()=>expect(screen.getByRole('button',{name:'返回登录'})).toBeEnabled());
    const calls=vi.mocked(nativeAccount).mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'返回登录'}));
    expect(screen.getByRole('heading',{name:'登录方式'})).toBeInTheDocument();expect(nativeAccount).toHaveBeenCalledTimes(calls);
    fireEvent.click(screen.getByRole('button',{name:'刷新账号状态'}));await waitFor(()=>expect(nativeAccount).toHaveBeenCalledTimes(calls+1));
    expect(screen.getByRole('heading',{name:'登录方式'})).toBeInTheDocument();expect(screen.queryByRole('main',{name:'选择游戏'})).toBeNull();
  });
  it('dismisses a stable native error locally, preserves it internally and still permits a fresh explicit retry',async()=>{
    vi.mocked(nativeAccount).mockResolvedValue({state:'error',errorCode:'AUTH_FAILED'});render(<App/>);
    await screen.findByRole('heading',{name:'登录失败'});const calls=vi.mocked(nativeAccount).mock.calls.length;
    fireEvent.click(screen.getByRole('button',{name:'返回登录'}));expect(screen.getByRole('heading',{name:'登录方式'})).toBeInTheDocument();expect(nativeAccount).toHaveBeenCalledTimes(calls);
    fireEvent.click(screen.getByRole('button',{name:'刷新账号状态'}));await waitFor(()=>expect(nativeAccount).toHaveBeenCalledTimes(calls+1));
    expect(screen.getByRole('heading',{name:'登录方式'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'使用Google账号登录'}));
    await screen.findByRole('heading',{name:'登录失败'});expect(nativeAccount).toHaveBeenLastCalledWith('login','windows');
    expect(screen.queryByRole('main',{name:'选择游戏'})).toBeNull();
  });
  it('returns from a native cancellation status without changing that status into authenticated state',async()=>{
    vi.mocked(nativeAccount).mockResolvedValue({state:'signed-out',errorCode:'AUTH_CANCELLED'});render(<App/>);
    await screen.findByRole('heading',{name:'登录已取消'});fireEvent.click(screen.getByRole('button',{name:'返回登录'}));
    expect(screen.getByRole('heading',{name:'登录方式'})).toBeInTheDocument();expect(screen.queryByRole('main',{name:'选择游戏'})).toBeNull();
    expect(nativeAccount).toHaveBeenCalledTimes(1);
  });
});
