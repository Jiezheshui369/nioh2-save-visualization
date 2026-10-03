import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentStatus } from './useAgentStatus';
import { loadAgentStatus } from './api';
import type { AgentStatus } from './types';

vi.mock('./api', () => ({ loadAgentStatus: vi.fn() }));
const status: AgentStatus = { status: 'ok', writeBackSupported: false, refreshAvailable: true, lanMode: false, apiVersion: 'latest' };
function Harness({ native = false }: { native?: boolean }) {
  const { agentStatus, refreshAgentStatus } = useAgentStatus(native);
  return <><p>{agentStatus?.apiVersion ?? 'unavailable'}</p><button onClick={() => void refreshAgentStatus()}>refresh</button></>;
}
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); vi.mocked(loadAgentStatus).mockResolvedValue(status); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('transient PC connection status', () => {
  it('clears stale connected state on failure and recovers after the next successful read', async () => {
    render(<Harness />); await act(async () => {});
    expect(screen.getByText('latest')).toBeVisible();
    vi.mocked(loadAgentStatus).mockRejectedValueOnce(new Error('offline'));
    await act(async () => vi.advanceTimersByTimeAsync(20000));
    expect(screen.getByText('unavailable')).toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(20000));
    expect(screen.getByText('latest')).toBeVisible();
  });
  it('aborts the earlier poll and ignores a late result after explicit refresh', async () => {
    let finish!: (v: AgentStatus) => void;
    vi.mocked(loadAgentStatus).mockReturnValueOnce(new Promise(done => { finish = done; }));
    render(<Harness />); await act(async () => {});
    const oldSignal = vi.mocked(loadAgentStatus).mock.calls[0][0]!;
    fireEvent.click(screen.getByRole('button'));
    await act(async () => {});
    expect(oldSignal.aborted).toBe(true);
    await act(async () => finish({ ...status, apiVersion: 'stale' }));
    expect(screen.getByText('latest')).toBeVisible();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
  });
  it('times out a stalled read and releases polling for recovery', async () => {
    vi.mocked(loadAgentStatus).mockImplementationOnce(signal => new Promise((_, reject) => signal!.addEventListener('abort', () => reject(signal!.reason))));
    render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(screen.getByText('unavailable')).toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(loadAgentStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText('latest')).toBeVisible();
  });
  it('does not request PC status in native mode and cancels requests/timers when leaving', async () => {
    const native = render(<Harness native />);
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(loadAgentStatus).not.toHaveBeenCalled(); native.unmount();
    vi.mocked(loadAgentStatus).mockImplementationOnce(signal => new Promise((_, reject) => signal!.addEventListener('abort', () => reject(signal!.reason))));
    const desktop = render(<Harness />); await act(async () => {});
    const signal = vi.mocked(loadAgentStatus).mock.calls[0][0]!;
    desktop.unmount(); await act(async () => {});
    expect(signal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(loadAgentStatus).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
