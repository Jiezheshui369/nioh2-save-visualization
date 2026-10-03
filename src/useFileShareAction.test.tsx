import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFileShareAction } from './useFileShareAction';
import { shareOrDownloadFile } from './fileSharing';
vi.mock('./fileSharing', async original => ({ ...await original<typeof import('./fileSharing')>(), shareOrDownloadFile: vi.fn() }));
const blob = new Blob(['synthetic']);
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });

describe('generated image sharing', () => {
  it('locks before generation and does not let an older reset timer erase a new result', async () => {
    vi.useFakeTimers();
    let resolve!: (blob: Blob) => void;
    const create = vi.fn(() => new Promise<Blob>(done => { resolve = done; }));
    vi.mocked(shareOrDownloadFile).mockResolvedValue('shared');
    const { result } = renderHook(() => useFileShareAction('one'));
    let pending!: Promise<void>;
    act(() => { pending = result.current.run(create, 'one.png', 'One'); void result.current.run(create, 'two.png', 'Two'); });
    expect(create).toHaveBeenCalledOnce(); expect(result.current.busy).toBe(true);
    await act(async () => { resolve(blob); await pending; });
    expect(result.current.state).toBe('shared');
    act(() => { vi.advanceTimersByTime(2000); });
    vi.mocked(shareOrDownloadFile).mockResolvedValue('saved');
    await act(async () => result.current.run(async () => blob, 'one.png', 'One'));
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.state).toBe('saved');
    act(() => { vi.advanceTimersByTime(1900); });
    expect(result.current.state).toBe('idle');
  });
  it.each(['switch', 'unmount'])('does not open a share sheet after a delayed generation and %s', async mode => {
    let resolve!: (blob: Blob) => void;
    const { result, rerender, unmount } = renderHook(({ id }) => useFileShareAction(id), { initialProps: { id: 'one' } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.run(() => new Promise(done => { resolve = done; }), 'one.png', 'One'); });
    if (mode === 'switch') rerender({ id: 'two' }); else unmount();
    await act(async () => { resolve(blob); await pending; });
    expect(shareOrDownloadFile).not.toHaveBeenCalled();
    if (mode === 'switch') expect(result.current.state).toBe('idle');
  });
  it('does not attach an earlier record success to the newly selected build', async () => {
    let finish!: (state: 'shared') => void;
    vi.mocked(shareOrDownloadFile).mockReturnValue(new Promise(done => { finish = done; }));
    const { result, rerender } = renderHook(({ id }) => useFileShareAction(id), { initialProps: { id: 'one' } });
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.run(async () => blob, 'one.png', 'One'); });
    rerender({ id: 'two' });
    await act(async () => { finish('shared'); await pending; });
    expect(result.current.state).toBe('idle');
  });
  it('treats cancellation as neutral and lets a failed generation retry', async () => {
    const { result } = renderHook(() => useFileShareAction('one'));
    await act(async () => result.current.run(async () => { throw new Error('canvas failed'); }, 'one.png', 'One'));
    expect(result.current.state).toBe('failed'); expect(shareOrDownloadFile).not.toHaveBeenCalled();
    vi.mocked(shareOrDownloadFile).mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    await act(async () => result.current.run(async () => blob, 'one.png', 'One'));
    expect(result.current.state).toBe('idle'); expect(result.current.busy).toBe(false);
  });
});
