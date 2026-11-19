import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import App from './App';
import { loadDesktopCachedSnapshot } from './desktopSnapshotCache';
const context={accountScope:'a'.repeat(64),sessionId:'1'.repeat(64)};
const loadCachedSnapshot=()=>loadDesktopCachedSnapshot(context);
import type { SaveSnapshot } from './types';
import fixture from '../public/data/demo-snapshot.json';
vi.mock('./nativeAccount', async original => ({
  ...await original<typeof import('./nativeAccount')>(), nativeAccount: vi.fn(async () => ({ state: 'signed-in', localDataScope:'a'.repeat(64),localDataSessionId:'1'.repeat(64) })),
}));
const original = fixture as unknown as SaveSnapshot;
const imported: SaveSnapshot = { ...original, snapshotId: 'desktop-import-test', character: { ...original.character, level: 321 } };
const file = new File([new Uint8Array(1_000_000)], 'SAVEDATA.BIN');
const result = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value }) as Response;
const readSave = vi.fn<() => Promise<Response>>();
const refresh = vi.fn<() => Promise<Response>>();
const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
  switch (String(url)) {
    case '/api/snapshots/latest': return result(original);
    case '/api/snapshots': return result([{ snapshotId: original.snapshotId, level: original.character.level, sourceLastWriteLocal: original.sourceLastWriteLocal }]);
    case '/api/health': return result({ status: 'ok', writeBackSupported: false, refreshAvailable: true });
    case '/api/sources': return result([{ id: 'source-1', slot: 'SAVEDATA00', accountHint: '1843', latestWriteLocal: '2026-10-26', active: true }]);
    case '/api/mobile-sync/status': return result({ enabled: false, devices: 0, urls: [] });
    case '/api/import-save': return readSave();
    case '/api/refresh': return refresh();
  }
  throw new Error('Unexpected URL: ' + String(url));
});
function choose() { fireEvent.change(screen.getByLabelText('选择 SAVEDATA.BIN'), { target: { files: [file] } }); }
async function start() {
  refresh.mockResolvedValueOnce(result(original));
  const app = render(<App />);
  await screen.findByRole('main', { name: '选择游戏' });
  fireEvent.click(screen.getByRole('button', { name: '仁王2 进入' }));
  fireEvent.click(await screen.findByRole('button',{name:'切换存档'}));
  const dialog=screen.getByRole('dialog',{name:'切换存档'});
  fireEvent.click(within(dialog).getByRole('button',{name:/^SAVEDATA00/}));
  fireEvent.click(within(dialog).getByRole('button',{name:'确认选择'}));
  await screen.findByRole('heading', { name: '主界面 / 设置' });
  await waitFor(()=>expect(screen.getByRole('button',{name:'切换存档'})).toBeEnabled());
  refresh.mockClear();
  return app;
}
function details() {
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(within(screen.getByRole('dialog', { name: '呼出菜单' })).getByRole('button', { name: '人物详细信息' }));
}
function switchSource() {
  fireEvent.click(screen.getByRole('button', { name: '切换存档' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '切换存档' })).getByRole('button', { name: /^SAVEDATA00/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '切换存档' })).getByRole('button', { name: '确认选择' }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.setItem('saveasset-desktop-esc-tip-v1', '1');
  readSave.mockResolvedValue(result(imported));
  refresh.mockResolvedValue(result(original));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });
describe('desktop import integration through the new native desktop flow', () => {
  it('commits the actual PC import into IndexedDB and never publishes it to mobile implicitly', async () => {
    const app = await start(); choose();
    await waitFor(async () => expect((await loadCachedSnapshot())?.snapshotId).toBe(imported.snapshotId));
    details();
    expect(app.container.querySelector('[data-detail-row=basic-0] dd')).toHaveTextContent('321');
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/mobile-sync/publish')).toHaveLength(0);
  });
  it('blocks source replacement and a second drop until the imported copy is committed', async () => {
    let finish!: (value: Response) => void;
    readSave.mockReturnValue(new Promise(done => { finish = done; }));
    await start(); choose();
    expect(screen.getByRole('button', { name: '切换存档' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '切换存档' }));
    expect(screen.queryByRole('dialog', { name: '切换存档' })).toBeNull();
    fireEvent.drop(window, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(refresh).not.toHaveBeenCalled(); expect(readSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('progressbar',{name:'正在解析存档'})).not.toHaveAttribute('value');
    await act(async () => finish(result(imported)));
    await waitFor(async () => expect((await loadCachedSnapshot())?.snapshotId).toBe(imported.snapshotId));
    await waitFor(()=>expect(screen.getByRole('button', { name: '切换存档' })).toBeEnabled());
  });
  it('blocks dropped files while source refresh is running and unlocks after failure', async () => {
    let fail!: (reason: Error) => void;
    refresh.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    await start(); switchSource();
    expect(screen.getByRole('button', { name: '读取中' })).toBeDisabled();
    fireEvent.drop(window, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(readSave).not.toHaveBeenCalled();
    await act(async () => fail(new Error('offline')));
    expect(await screen.findByText('读取失败；当前存档保持不变')).toBeInTheDocument();
    expect((await loadCachedSnapshot())?.snapshotId).toBe(original.snapshotId);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    choose();
    await waitFor(async () => expect((await loadCachedSnapshot())?.snapshotId).toBe(imported.snapshotId));
    expect(readSave).toHaveBeenCalledTimes(1);
  });
  it('preserves displayed and cached identity on persistence failure, then retries successfully', async () => {
    const app = await start();
    await waitFor(async () => expect((await loadCachedSnapshot())?.snapshotId).toBe(original.snapshotId));
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    choose();
    await waitFor(() => expect(screen.getByLabelText('电脑导入游戏存档').querySelector('[role=alert]')).toHaveTextContent('电脑分析已完成，但本页面保存或显示失败'));
    expect(screen.getByRole('dialog', { name: '存档解析' })).toBeVisible();
    expect((await loadCachedSnapshot())?.snapshotId).toBe(original.snapshotId);
    fireEvent.click(screen.getByRole('button', { name: '返回当前存档' }));
    details();
    expect(app.container.querySelector('[data-detail-row=basic-0] dd')).toHaveTextContent(String(original.character.level));
    expect(app.container.querySelector('[data-detail-row=basic-0] dd')).not.toHaveTextContent('321');
    put.mockRestore(); choose();
    await waitFor(async () => expect((await loadCachedSnapshot())?.snapshotId).toBe(imported.snapshotId));
    details();
    expect(app.container.querySelector('[data-detail-row=basic-0] dd')).toHaveTextContent('321');
  });
});
