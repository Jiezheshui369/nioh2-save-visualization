import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopSyncPanel, MobileReceivePanel } from './SyncPanel';
import { desktopSync, LocalSync } from './mobileSync';
import type { SyncStatus } from './mobileSync';
import { createAssetPackage } from './assetPackage';
import { BUILD_LIBRARY_UPDATED_EVENT, loadSavedBuilds } from './buildLibrary';
import type { SaveSnapshot } from './types';
import fixture from '../public/data/demo-snapshot.json';
import { SNAPSHOT_CACHE_UPDATED_EVENT } from './snapshotCache';
import cases from '../scripts/ios-tests/pairing-cases.json';

vi.mock('./mobileSync', async original => ({ ...await original<typeof import('./mobileSync')>(),
  desktopSync: vi.fn(), LocalSync: { status: vi.fn(), receive: vi.fn(), scan: vi.fn(), forget: vi.fn() } }));
vi.mock('./buildLibrary', async original => ({ ...await original<typeof import('./buildLibrary')>(), loadSavedBuilds: vi.fn().mockResolvedValue([]) }));
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,AA==') }));

const snapshot = fixture as unknown as SaveSnapshot;
const archive = createAssetPackage(snapshot, []);
const qr = cases.find(row => row.valid)!.qr;
const received = { archive, revision: 'a'.repeat(64) };
const enabled: SyncStatus = { enabled: true, devices: 0, urls: [qr] };
const disabled: SyncStatus = { enabled: false, devices: 0, urls: [] };
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function pair() {
  fireEvent.change(screen.getByLabelText('手机配对信息'), { target: { value: qr } });
  fireEvent.click(screen.getByRole('button', { name: '确认配对并同步' }));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadSavedBuilds).mockResolvedValue([]);
  vi.mocked(LocalSync.status).mockResolvedValue({ paired: false, host: '' });
  vi.mocked(LocalSync.receive).mockResolvedValue(received);
  vi.mocked(LocalSync.forget).mockResolvedValue(undefined);
  vi.mocked(desktopSync).mockResolvedValue(disabled);
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('mobile sync state safety', () => {
  it('reapplies the published revision after local archive replacement, but skips its own committed writes', async () => {
    vi.useFakeTimers();
    vi.mocked(LocalSync.status).mockResolvedValue({ paired: true, host: '192.168.20.1' });
    const save = vi.fn(async () => { window.dispatchEvent(new Event(SNAPSHOT_CACHE_UPDATED_EVENT)); return true; });
    render(<MobileReceivePanel onArchive={save} />);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(save).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new Event(SNAPSHOT_CACHE_UPDATED_EVENT)));
    expect(screen.queryByText(/已同步并保存在手机/)).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not apply a response arriving after the receiver is unmounted', async () => {
    const late = pending<typeof received>();
    vi.mocked(LocalSync.receive).mockReturnValue(late.promise);
    const save = vi.fn();
    const panel = render(<MobileReceivePanel onArchive={save} />);
    pair(); panel.unmount();
    await act(async () => late.resolve(received));
    expect(save).not.toHaveBeenCalled();
  });

  it('does not mark a partially saved archive as complete and automatically retries it', async () => {
    vi.useFakeTimers();
    vi.mocked(LocalSync.status).mockResolvedValue({ paired: true, host: '192.168.20.1' });
    const save = vi.fn().mockResolvedValueOnce({ warning: '角色已保存，配装册未保存' }).mockResolvedValue(true);
    render(<MobileReceivePanel onArchive={save} />);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(screen.getByRole('alert')).toHaveTextContent('配装册未保存');
    expect(screen.queryByText(/已同步并保存在手机/)).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/已同步并保存在手机/)).toBeVisible();
  });

  it('pauses periodic reception when the page is not active', async () => {
    vi.useFakeTimers();
    vi.mocked(LocalSync.status).mockResolvedValue({ paired: true, host: '192.168.20.1' });
    const save = vi.fn().mockResolvedValue(true);
    const panel = render(<MobileReceivePanel onArchive={save} active={false} />);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(45000));
    expect(LocalSync.receive).not.toHaveBeenCalled();
    panel.rerender(<MobileReceivePanel onArchive={save} active />);
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(LocalSync.receive).toHaveBeenCalledTimes(1);
    panel.rerender(<MobileReceivePanel onArchive={save} active={false} />);
    await act(async () => vi.advanceTimersByTimeAsync(45000));
    expect(LocalSync.receive).toHaveBeenCalledTimes(1);
  });

  it('reapplies the same revision on explicit retry while automatic polling stays deduplicated', async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<MobileReceivePanel onArchive={save} />);
    pair(); await screen.findByText(/已同步并保存在手机/);
    fireEvent.click(screen.getByRole('button', { name: '接收最新角色' }));
    await screen.findByText(/已同步并保存在手机/);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('can retry a failed save without reusing the consumed QR invitation', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<MobileReceivePanel onArchive={save} />);
    pair();
    expect(await screen.findByRole('alert')).toHaveTextContent('手机保存失败');
    expect(screen.queryByText(/已同步并保存在手机/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('手机配对信息')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '接收最新角色' }));
    await screen.findByText(/已同步并保存在手机/);
    expect(save).toHaveBeenCalledTimes(2);
    expect(LocalSync.receive).toHaveBeenLastCalledWith({});
  });

  it('clears an earlier success message when the next request fails', async () => {
    render(<MobileReceivePanel onArchive={vi.fn().mockResolvedValue(true)} />);
    pair(); await screen.findByText(/已同步并保存在手机/);
    vi.mocked(LocalSync.receive).mockRejectedValueOnce(new Error('电脑已离线，旧档案仍保留。'));
    fireEvent.click(screen.getByRole('button', { name: '接收最新角色' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('电脑已离线');
    expect(screen.queryByText(/已同步并保存在手机/)).not.toBeInTheDocument();
  });

  it('does not let late initial status undo a completed pairing or disconnect', async () => {
    const oldStatus = pending<{ paired: boolean; host: string }>();
    vi.mocked(LocalSync.status).mockReturnValue(oldStatus.promise);
    render(<MobileReceivePanel onArchive={vi.fn().mockResolvedValue(true)} />);
    pair(); await screen.findByText(/已同步并保存在手机/);
    fireEvent.click(screen.getByRole('button', { name: '断开配对' }));
    await screen.findByText('已断开配对，离线角色仍保留。');
    await act(async () => oldStatus.resolve({ paired: true, host: '192.168.20.1' }));
    expect(screen.queryByRole('button', { name: '接收最新角色' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '连接电脑，带走你的角色' })).toBeVisible();
  });

  it('locks scanning and requires explicit confirmation before any network call', async () => {
    const scan = pending<{ value: string }>();
    vi.mocked(LocalSync.scan).mockReturnValue(scan.promise);
    render(<MobileReceivePanel onArchive={vi.fn().mockResolvedValue(true)} />);
    const button = screen.getByRole('button', { name: '扫描电脑二维码' });
    fireEvent.click(button); fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(LocalSync.scan).toHaveBeenCalledTimes(1);
    await act(async () => scan.resolve({ value: qr }));
    expect(screen.getByLabelText('手机配对信息')).toHaveValue(qr);
    expect(LocalSync.receive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认配对并同步' }));
    await screen.findByText(/已同步并保存在手机/);
    expect(LocalSync.receive).toHaveBeenCalledTimes(1);
  });

  it('does not overlap background receives or save the same revision twice', async () => {
    vi.useFakeTimers();
    const response = pending<typeof received>();
    const save = vi.fn().mockResolvedValue(true);
    vi.mocked(LocalSync.status).mockResolvedValue({ paired: true, host: '192.168.20.1' });
    vi.mocked(LocalSync.receive).mockReturnValueOnce(response.promise).mockResolvedValue(received);
    render(<MobileReceivePanel onArchive={save} />);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(45000));
    expect(LocalSync.receive).toHaveBeenCalledTimes(1);
    await act(async () => response.resolve(received));
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(LocalSync.receive).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps pairing and shows only failure when disconnect fails', async () => {
    render(<MobileReceivePanel onArchive={vi.fn().mockResolvedValue(true)} />);
    pair(); await screen.findByText(/已同步并保存在手机/);
    vi.mocked(LocalSync.forget).mockRejectedValueOnce(new Error('storage'));
    fireEvent.click(screen.getByRole('button', { name: '断开配对' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('断开配对失败');
    expect(screen.queryByText(/已同步并保存在手机/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '接收最新角色' })).toBeEnabled();
  });
});

describe('desktop sync polling order', () => {
  it('detects changed fields under the same snapshot ID but not an equivalent new object', async () => {
    const published = { ...enabled, publishedSnapshotId: snapshot.snapshotId, revision: 'a'.repeat(64) };
    vi.mocked(desktopSync).mockResolvedValue(published);
    const panel = render(<DesktopSyncPanel snapshot={snapshot} />);
    await screen.findByRole('button', { name: '发布当前角色到手机' });
    fireEvent.click(screen.getByRole('button', { name: '发布当前角色到手机' }));
    await act(async () => {});
    panel.rerender(<DesktopSyncPanel snapshot={structuredClone(snapshot)} />);
    expect(screen.queryByText(/当前展示的角色还未发布/)).not.toBeInTheDocument();
    panel.rerender(<DesktopSyncPanel snapshot={{ ...snapshot, character: { ...snapshot.character, level: 4321 } }} />);
    expect(screen.getByText(/当前展示的角色还未发布/)).toBeVisible();
    expect(vi.mocked(desktopSync).mock.calls.filter(call => call[0] === 'publish')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '发布当前角色到手机' }));
    await act(async () => {});
    expect(screen.queryByText(/当前展示的角色还未发布/)).not.toBeInTheDocument();
  });
  it('captures the explicitly published character before awaiting the build library', async () => {
    const builds = pending<[]>();
    vi.mocked(loadSavedBuilds).mockReturnValue(builds.promise);
    vi.mocked(desktopSync).mockResolvedValue({ ...enabled, publishedSnapshotId: snapshot.snapshotId, revision: 'a'.repeat(64) });
    const source = structuredClone(snapshot);
    const panel = render(<DesktopSyncPanel snapshot={source} />);
    await screen.findByRole('button', { name: '发布当前角色到手机' });
    fireEvent.click(screen.getByRole('button', { name: '发布当前角色到手机' }));
    source.character.level = 4321;
    panel.rerender(<DesktopSyncPanel snapshot={structuredClone(source)} />);
    await act(async () => builds.resolve([]));
    const sent = vi.mocked(desktopSync).mock.calls.find(call => call[0] === 'publish')![1]!;
    expect(sent.character.character.level).toBe(snapshot.character.level);
    expect(screen.getByText(/当前展示的角色还未发布/)).toBeVisible();
  });
  it('does not assume builds are current after remount or another publication', async () => {
    vi.useFakeTimers();
    const published = { ...enabled, publishedSnapshotId: snapshot.snapshotId, revision: 'a'.repeat(64) };
    vi.mocked(desktopSync).mockResolvedValue(published);
    const panel = render(<DesktopSyncPanel snapshot={snapshot} />);
    await act(async () => {});
    expect(screen.getByText(/尚未核对本机配装册/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '发布当前角色到手机' }));
    await act(async () => {});
    expect(screen.queryByText(/尚未核对本机配装册/)).not.toBeInTheDocument();
    vi.mocked(desktopSync).mockResolvedValue({ ...published, revision: 'b'.repeat(64) });
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByText(/尚未核对本机配装册/)).toBeVisible();
    panel.unmount();
    render(<DesktopSyncPanel snapshot={snapshot} />);
    await act(async () => {});
    expect(screen.getByText(/尚未核对本机配装册/)).toBeVisible();
    expect(vi.mocked(desktopSync).mock.calls.filter(call => call[0] === 'publish')).toHaveLength(1);
  });
  it('shows that a different current character still needs publication', async () => {
    vi.mocked(desktopSync).mockResolvedValue({ ...enabled, publishedSnapshotId: 'previous-character' });
    render(<DesktopSyncPanel snapshot={snapshot} />);
    expect(await screen.findByText(/当前展示的角色还未发布/)).toBeVisible();
    expect(desktopSync).toHaveBeenCalledTimes(1);
    expect(desktopSync).toHaveBeenCalledWith('status');
  });

  it('tracks build edits made during publication without silently clearing them', async () => {
    const publishResult = pending<SyncStatus>();
    vi.mocked(desktopSync).mockImplementation(action => action === 'publish' ? publishResult.promise : Promise.resolve({ ...enabled, publishedSnapshotId: snapshot.snapshotId }));
    render(<DesktopSyncPanel snapshot={snapshot} />);
    await screen.findByRole('button', { name: '发布当前角色到手机' });
    fireEvent.click(screen.getByRole('button', { name: '发布当前角色到手机' }));
    await act(async () => {});
    act(() => window.dispatchEvent(new Event(BUILD_LIBRARY_UPDATED_EVENT)));
    await act(async () => publishResult.resolve({ ...enabled, publishedSnapshotId: snapshot.snapshotId }));
    expect(screen.getByText(/配装册有未发布的变更/)).toBeVisible();
    vi.mocked(desktopSync).mockResolvedValue({ ...enabled, publishedSnapshotId: snapshot.snapshotId });
    fireEvent.click(screen.getByRole('button', { name: '发布当前角色到手机' }));
    await act(async () => {});
    expect(screen.queryByText(/配装册有未发布的变更/)).not.toBeInTheDocument();
  });

  it('hides stale QR after polling failure, recovers it after a successful poll, and permits revocation while import is busy', async () => {
    vi.useFakeTimers();
    vi.mocked(desktopSync).mockResolvedValueOnce(enabled).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(enabled);
    const panel = render(<DesktopSyncPanel snapshot={snapshot} disabled />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: '发布当前角色到手机' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '关闭同步并撤销配对' })).toBeEnabled();
    expect(screen.getByAltText('手机应用配对二维码')).toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByRole('alert')).toHaveTextContent('旧二维码已隐藏');
    expect(screen.queryByAltText('手机应用配对二维码')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('电脑配对信息')).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByAltText('手机应用配对二维码')).toBeVisible();
    panel.unmount();
  });

  it('ignores status requested before a completed publish', async () => {
    const oldStatus = pending<SyncStatus>();
    vi.mocked(desktopSync).mockImplementation(action => action === 'status' ? oldStatus.promise : Promise.resolve(enabled));
    render(<DesktopSyncPanel snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: '开启同步并生成二维码' }));
    await screen.findByRole('button', { name: '关闭同步并撤销配对' });
    await act(async () => oldStatus.resolve(disabled));
    expect(screen.getByRole('button', { name: '关闭同步并撤销配对' })).toBeVisible();
  });

  it('never resurrects a stopped listener from an older poll', async () => {
    vi.useFakeTimers();
    const oldStatus = pending<SyncStatus>();
    vi.mocked(desktopSync).mockResolvedValueOnce(enabled).mockReturnValueOnce(oldStatus.promise).mockResolvedValue(disabled);
    render(<DesktopSyncPanel snapshot={snapshot} />);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    fireEvent.click(screen.getByRole('button', { name: '关闭同步并撤销配对' }));
    await act(async () => {});
    await act(async () => oldStatus.resolve(enabled));
    expect(screen.queryByRole('button', { name: '关闭同步并撤销配对' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开启同步并生成二维码' })).toBeEnabled();
  });

  it('does not accumulate overlapping status polls', async () => {
    vi.useFakeTimers();
    const status = pending<SyncStatus>();
    vi.mocked(desktopSync).mockReturnValue(status.promise);
    render(<DesktopSyncPanel snapshot={snapshot} />);
    await act(async () => vi.advanceTimersByTimeAsync(20000));
    expect(desktopSync).toHaveBeenCalledTimes(1);
    await act(async () => status.resolve(disabled));
  });
});
