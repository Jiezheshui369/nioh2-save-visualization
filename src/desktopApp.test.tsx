import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import App from './App';
import { loadCachedSnapshot } from './snapshotCache';
import type { SaveSnapshot } from './types';
import fixture from '../public/data/demo-snapshot.json';

const original = fixture as unknown as SaveSnapshot;
const imported: SaveSnapshot = { ...original, snapshotId: 'desktop-import-test', character: { ...original.character, level: 321 } };
const file = new File([new Uint8Array(1_000_000)], 'SAVEDATA.BIN');
const result = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value }) as Response;
const readSave = vi.fn<() => Promise<Response>>();
const refresh = vi.fn<() => Promise<Response>>();
const history = vi.fn<() => Promise<Response>>();
const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
  switch (String(url)) {
    case '/api/snapshots/latest': return result(original);
    case '/api/snapshots': return result([{ snapshotId: original.snapshotId, level: original.character.level, sourceLastWriteLocal: original.sourceLastWriteLocal }]);
    case '/api/health': return result({ status: 'ok', writeBackSupported: false });
    case '/api/sources': return result([]);
    case '/api/mobile-sync/status': return result({ enabled: false, devices: 0, urls: [] });
    case '/api/import-save': return readSave();
    case '/api/refresh': return refresh();
    default: if (String(url).startsWith('/api/snapshots/')) return history();
  }
  throw new Error('Unexpected URL: ' + String(url));
});
function choose() { fireEvent.change(screen.getByLabelText('选择 SAVEDATA.BIN'), { target: { files: [file] } }); }
async function start() {
  render(<App />);
  await screen.findByText(String(original.character.level));
  fireEvent.click(screen.getByRole('button', { name: /04 更多/ }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('fetch', fetchMock);
  readSave.mockResolvedValue(result(imported));
  refresh.mockResolvedValue(result(original));
  history.mockResolvedValue(result(original));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe('desktop import integration', () => {
  it('persists a PC import and explicitly says mobile still needs reception', async () => {
    await start(); choose();
    await screen.findByText(/尚未自动发送到手机/);
    expect((await loadCachedSnapshot())?.snapshotId).toBe(imported.snapshotId);
    fireEvent.click(screen.getByRole('button', { name: /01 角色/ }));
    expect(screen.getByText('321')).toBeVisible();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/mobile-sync/publish')).toHaveLength(0);
  });

  it('blocks refresh and history selection until the imported copy is committed', async () => {
    let finish!: (value: Response) => void;
    readSave.mockReturnValue(new Promise(done => { finish = done; }));
    await start(); choose();
    expect(screen.getByRole('button', { name: '读取存档' })).toBeDisabled();
    const picker = screen.getByLabelText('历史快照');
    expect(picker).toBeDisabled();
    fireEvent.change(picker, { target: { value: original.snapshotId } });
    fireEvent.click(screen.getByRole('button', { name: '读取存档' }));
    expect(refresh).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled();
    await act(async () => finish(result(imported)));
    await screen.findByText(/尚未自动发送到手机/);
    expect(screen.getByRole('button', { name: '读取存档' })).toBeEnabled();
  });

  it('blocks drop while refresh is running and unlocks after refresh failure', async () => {
    let fail!: (reason: Error) => void;
    refresh.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    await start();
    fireEvent.click(screen.getByRole('button', { name: '读取存档' }));
    expect(screen.getByRole('button', { name: '选择游戏存档' })).toBeDisabled();
    fireEvent.drop(screen.getByLabelText('电脑导入游戏存档'), { dataTransfer: { files: [file] } });
    expect(readSave).not.toHaveBeenCalled();
    await act(async () => fail(new Error('offline')));
    expect(screen.getByRole('button', { name: '选择游戏存档' })).toBeEnabled();
    choose(); await screen.findByText(/尚未自动发送到手机/);
    expect(readSave).toHaveBeenCalledTimes(1);
  });

  it('does not replace displayed or cached character when persistence fails, then retries', async () => {
    await start();
    await waitFor(async () => expect((await loadCachedSnapshot())?.snapshotId).toBe(original.snapshotId));
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    choose();
    expect(await screen.findByRole('alert')).toHaveTextContent('电脑分析已完成，但本页面保存或显示失败');
    expect((await loadCachedSnapshot())?.snapshotId).toBe(original.snapshotId);
    fireEvent.click(screen.getByRole('button', { name: /01 角色/ }));
    expect(screen.getByText(String(original.character.level))).toBeVisible();
    expect(screen.queryByText('321')).not.toBeInTheDocument();
    put.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: /04 更多/ }));
    choose(); await screen.findByText(/尚未自动发送到手机/);
    expect((await loadCachedSnapshot())?.snapshotId).toBe(imported.snapshotId);
  });
});
