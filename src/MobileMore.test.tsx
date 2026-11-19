import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileMore, MobileLoadingScreen } from './MobileMore';
import type { DeviceArchiveInfo, SaveSnapshot } from './types';

vi.mock('./NativeAccountPanel', () => ({ NativeAccountPanel: () => <section aria-label="存档资产账号"><h2>存档资产账号</h2><p>跨网连接未启用</p></section> }));
vi.mock('./SyncPanel', () => ({ MobileReceivePanel: ({ active }: { active: boolean }) => <button data-active={active}>扫描电脑二维码</button> }));
const snapshot: SaveSnapshot = { schemaVersion: '1.0.0', game: 'Nioh 2', platform: 'Steam', snapshotId: 'more-test', parserVersion: 'test-parser', sourceLastWriteLocal: '2026-10-11T01:00:00Z', safety: { sourceOpenedReadOnly: true, parsedFromCopy: true, originalMainSaveSha256: 'private', originalHashUnchangedAfterProcessing: true }, character: { level: 200, amrita: 0, gold: 0, attributes: { constitution: 10, heart: 10, courage: 10, stamina: 10, strength: 10, skill: 10, dexterity: 10, magic: 10 }, proficiency: {} }, currentLoadout: [], inventorySummary: { equipmentRecords: 0, equipmentUnknownIds: 0, equipmentByType: {}, stackedItemRecords: 0, scrollRecordsDetected: 0 }, limitations: [] };
const info: DeviceArchiveInfo = { schemaVersion: '1.0.0', source: 'computer-sync', sourceSnapshotId: snapshot.snapshotId, sourceLastWriteLocal: snapshot.sourceLastWriteLocal, importedAt: '2026-10-11T02:00:00Z', buildCount: 0 };
function show(value: SaveSnapshot | null = snapshot, metadata: DeviceArchiveInfo | null = info, importing = false) {
  const onBackup = vi.fn(), onExport = vi.fn(), onPageChange = vi.fn();
  const result = render(<MobileMore snapshot={value} archiveInfo={metadata} active importing={importing} onArchive={async () => true} onBackup={onBackup} onExport={onExport} onPageChange={onPageChange} />);
  return { ...result, onBackup, onExport, onPageChange };
}
afterEach(cleanup);
describe('reachable mobile more pages', () => {
  it('opens real backup actions and returns to the paired screen', () => {
    const props = show();
    fireEvent.click(screen.getByRole('button', { name: /档案管理与设置/ }));
    expect(screen.queryByRole('button', { name: '扫描电脑二维码' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '导入我的档案包' }));
    fireEvent.click(screen.getByRole('button', { name: '导出备份档案包' }));
    expect(props.onBackup).toHaveBeenCalledOnce(); expect(props.onExport).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '‹ 返回更多' }));
    expect(screen.queryByRole('button', { name: '扫描电脑二维码' })).not.toBeInTheDocument();
    expect(screen.queryByText('旧版局域网同步（可选）')).not.toBeInTheDocument();
    expect(props.onPageChange).toHaveBeenCalledTimes(2);
  });
  it('does not attribute another snapshot metadata or screenshot to the current character', () => {
    show(snapshot, { ...info, sourceSnapshotId: 'different' });
    expect(screen.queryByText('电脑安全同步')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /数据来源说明/ }));
    expect(screen.getByText('本机记录 · 导入来源未记录')).toBeVisible();
    expect(screen.getByText('test-parser')).toBeVisible();
    expect(screen.getByText(/没有匹配此快照的截图观察/)).toBeVisible();
    expect(screen.getByText(/不证明 Steam 云端已经更新/)).toBeVisible();
    expect(screen.queryByText('private')).not.toBeInTheDocument();
  });
  it('disables exporting an empty archive and blocks backup mutations while saving', () => {
    const view = show(null, null);
    fireEvent.click(screen.getByRole('button', { name: /档案管理与设置/ }));
    expect(screen.getByRole('button', { name: '导出备份档案包' })).toBeDisabled();
    view.unmount(); show(snapshot, info, true);
    fireEvent.click(screen.getByRole('button', { name: /档案管理与设置/ }));
    expect(screen.getByRole('button', { name: '正在保存档案…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导出备份档案包' })).toBeDisabled();
  });
  it('keeps synthetic evidence visible on source and about pages without claiming a cloud connection', () => {
    show({ ...snapshot, snapshotId: 'synthetic-more-test' });
    fireEvent.click(screen.getByRole('button', { name: /数据来源说明/ }));
    expect(screen.getByText('示例数据 · 非存档读取 / 模拟预览')).toBeVisible();
    expect(screen.getByText(/不是从你的存档读取的结果/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '‹ 返回更多' }));
    fireEvent.click(screen.getByRole('button', { name: /关于存档资产/ }));
    expect(screen.getByText(/登录不代表已发送或接收档案/)).toBeVisible();
  });
  it('renders honest loading state without a made-up completion percentage', () => {
    const result = render(<MobileLoadingScreen />);
    expect(screen.getByRole('heading', { name: '正在读取本机档案' })).toBeVisible();
    expect(result.container.querySelector('[aria-busy=true]')).not.toBeNull();
    expect(result.container.textContent).not.toContain('%');
  });
  it('distinguishes matching synthetic status from actual screenshot observations', () => {
    const matching = (snapshotId: string): SaveSnapshot => ({ ...snapshot, snapshotId, characterStatus: {
      version: 1, source: 'game-screenshots', recordedOn: '2001-02-03', captureTime: null,
      referenceSnapshotId: snapshotId, screenshotCount: 1,
      groups: [{ title: '示例', entries: [{ label: '体力', value: '70111', pages: [1] }] }], effects: [],
    } });
    const synthetic = show(matching('synthetic-matching-status'), null);
    fireEvent.click(screen.getByRole('button', { name: /数据来源说明/ }));
    expect(screen.getByText('合成示例，用于展示完整属性结构；不是从截图或存档读取。')).toBeVisible();
    expect(screen.queryByText(/附有匹配此快照的截图观察记录/)).not.toBeInTheDocument();
    synthetic.unmount();
    show(matching('actual-matching-status'), null);
    fireEvent.click(screen.getByRole('button', { name: /数据来源说明/ }));
    expect(screen.getByText(/附有匹配此快照的截图观察记录/)).toBeVisible();
    expect(screen.queryByText(/合成示例，用于展示完整属性结构/)).not.toBeInTheDocument();
  });
});

 it('places account first without QR or LAN requirements', () => {
  const view = show(null, null);
  const account = screen.getByRole('region', { name: '存档资产账号' });
  const empty = screen.getByRole('heading', { name: '本机还没有存档资料' });
  expect(account.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('跨网连接未启用')).toBeVisible();
  expect(screen.queryByRole('button', { name: '扫描电脑二维码' })).not.toBeInTheDocument();
  expect(view.container.querySelector('.asset-legacy-options')).toBeNull();
  expect(view.container.textContent).not.toMatch(/Wi-Fi|二维码|扫码/);
});
