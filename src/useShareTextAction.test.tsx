import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useShareTextAction } from './useShareTextAction';
import { shareText } from './fileSharing';
vi.mock('./fileSharing', async original => ({ ...await original<typeof import('./fileSharing')>(), shareText: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('share-sheet lifecycle', () => {
  it('ignores repeated taps while a sheet is active and allows another share after closing', async () => {
    let resolve!: () => void;
    vi.mocked(shareText).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { result } = renderHook(useShareTextAction);
    let pending!: Promise<void>;
    act(() => { pending = result.current.run('first', 'body'); void result.current.run('second', 'body'); });
    expect(result.current.busy).toBe(true); expect(shareText).toHaveBeenCalledOnce();
    await act(async () => { resolve(); await pending; });
    expect(result.current.busy).toBe(false);
    await act(async () => result.current.run('retry', 'body'));
    expect(shareText).toHaveBeenCalledTimes(2);
  });
  it('clears old errors before retry and treats user cancellation as neutral', async () => {
    vi.mocked(shareText).mockRejectedValueOnce(new Error('failed')).mockRejectedValueOnce(new DOMException('cancel', 'AbortError'));
    const { result } = renderHook(useShareTextAction);
    await act(async () => result.current.run('a', 'b'));
    expect(result.current.error).toContain('分享未完成');
    await act(async () => result.current.run('a', 'b'));
    expect(result.current.error).toBe(''); expect(result.current.busy).toBe(false);
  });
  it('does not start another share through an unmounted action', async () => {
    let reject!: (reason: unknown) => void;
    vi.mocked(shareText).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const { result, unmount } = renderHook(useShareTextAction);
    const run = result.current.run;
    let pending!: Promise<void>;
    act(() => { pending = run('a', 'b'); }); unmount();
    await act(async () => { reject(new Error('late')); await pending; await run('later', 'b'); });
    expect(shareText).toHaveBeenCalledOnce();
  });
});
