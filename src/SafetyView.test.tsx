import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SafetyView } from './App';
import { clearCachedSnapshot, loadCachedSnapshotIndex } from './snapshotCache';
import { cacheRecentSnapshots } from './api';
import type { SaveSnapshot, AgentStatus } from './types';
import fixture from '../public/data/demo-snapshot.json';

vi.mock('./snapshotCache', async original => ({ ...await original<typeof import('./snapshotCache')>(),
  clearCachedSnapshot: vi.fn(), loadCachedSnapshotIndex: vi.fn() }));
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), cacheRecentSnapshots: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  vi.mocked(loadCachedSnapshotIndex).mockResolvedValue([{ snapshotId: 'kept', level: 123 }]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const show = () => render(<SafetyView snapshot={fixture as unknown as SaveSnapshot} agentStatus={{ status: 'ok' } as AgentStatus} sources={[]} refreshing={false} onReadSource={vi.fn()} />);

describe('explicit cache actions', () => {
  it('does not mistake disconnected metadata for an old service or allow stale source reads', async () => {
    render(<SafetyView snapshot={fixture as unknown as SaveSnapshot} agentStatus={null}
      sources={[{ id: 'old-source', accountHint: null, slot: 'SAVEDATA00', latestWriteLocal: null, active: true }]}
      refreshing={false} onReadSource={vi.fn()} />);
    await screen.findByText('1 份已保存');
    expect(screen.getByRole('button', { name: '读取所选槽位' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存最近 20 份' })).toBeDisabled();
    expect(screen.queryByText('升级 Agent 后显示')).not.toBeInTheDocument();
    expect(screen.queryByText('旧版服务未提供')).not.toBeInTheDocument();
    expect(screen.queryByText('未配置')).not.toBeInTheDocument();
    expect(screen.getAllByText('当前不可用').length).toBeGreaterThan(1);
    expect(screen.getByText('02 · 当前显示档案')).toBeVisible();
  });
  it('does not present Steam as the mobile sync transport or PC time as a phone receipt', async () => {
    show(); await screen.findByText('1 份已保存');
    expect(screen.getByRole('heading', { name: '本机存档、当前档案与 Steam 元数据' })).toBeVisible();
    expect(screen.getByText(/不是手机同步的中转站/)).toBeVisible();
    expect(screen.getByText('02 · 当前显示档案')).toBeVisible();
    expect(screen.queryByText('03 · 手机当前快照')).not.toBeInTheDocument();
  });
  it('does not report cleared data after a failed deletion', async () => {
    vi.mocked(clearCachedSnapshot).mockRejectedValue(new Error('blocked'));
    show(); await screen.findByText('1 份已保存');
    fireEvent.click(screen.getByRole('button', { name: '清除离线副本' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未能清除');
    expect(screen.getByText('1 份已保存')).toBeVisible();
    expect(screen.queryByText('离线副本已清除')).not.toBeInTheDocument();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('不清除独立配装册'));
  });

  it('prevents another write while clearing and only reports success after completion', async () => {
    let resolve!: () => void;
    vi.mocked(clearCachedSnapshot).mockReturnValue(new Promise(done => { resolve = done; }));
    show(); await screen.findByText('1 份已保存');
    fireEvent.click(screen.getByRole('button', { name: '清除离线副本' }));
    expect(screen.getByRole('button', { name: '正在清除…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存最近 20 份' })).toBeDisabled();
    expect(screen.queryByText('离线副本已清除')).not.toBeInTheDocument();
    await act(async () => resolve());
    expect(screen.getByRole('button', { name: '离线副本已清除' })).toBeEnabled();
    expect(screen.getByText('尚无已保存快照')).toBeVisible();
  });

  it('retains the count and explains incomplete history downloads', async () => {
    vi.mocked(cacheRecentSnapshots).mockRejectedValue(new Error('full'));
    show(); await screen.findByText('1 份已保存');
    fireEvent.click(screen.getByRole('button', { name: '保存最近 20 份' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('历史档案未全部保存');
    expect(screen.queryByText('最近快照已保存')).not.toBeInTheDocument();
    expect(screen.getByText('1 份已保存')).toBeVisible();
  });
});
