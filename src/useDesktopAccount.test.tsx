import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeAccount } from './nativeAccount';
import type { NativeAccountStatus } from './nativeAccount';
import { useDesktopAccount } from './useDesktopAccount';
vi.mock('./nativeAccount', () => ({ nativeAccount: vi.fn() }));
const api = vi.mocked(nativeAccount);
beforeEach(() => { api.mockReset(); });
afterEach(cleanup);
describe('desktop account state boundary', () => {
  it('uses only status during mount and never launches a provider automatically', async () => {
    api.mockResolvedValue({ state: 'signed-out' });
    const { result } = renderHook(useDesktopAccount);
    await waitFor(() => expect(result.current.status?.state).toBe('signed-out'));
    expect(api.mock.calls).toEqual([['status','windows']]);
  });
  it('handles React StrictMode remount without accepting the stale first status', async () => {
    let old!: (v:NativeAccountStatus) => void;
    api.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }));
    api.mockResolvedValue({ state: 'signed-out' });
    const { result } = renderHook(useDesktopAccount, { wrapper: StrictMode });
    await waitFor(() => expect(result.current.status?.state).toBe('signed-out'));
    await act(async () => old({ state: 'signed-in' }));
    expect(result.current.status?.state).toBe('signed-out');
  });
  it('ignores a late status after an explicit logout and blocks repeated account mutations', async () => {
    let old!: (v:NativeAccountStatus) => void, logout!: (v:NativeAccountStatus) => void;
    api.mockImplementation(action => new Promise(resolve => { if (action==='status') old=resolve; else logout=resolve; }));
    const { result } = renderHook(useDesktopAccount);
    act(() => { void result.current.update('logout'); void result.current.update('login'); });
    expect(api.mock.calls.map(c=>c[0])).toEqual(['status','logout']);
    await act(async () => logout({ state: 'signed-out' }));
    await act(async () => old({ state: 'signed-in' }));
    expect(result.current.status?.state).toBe('signed-out');
    expect(result.current.busy).toBe(false);
  });
  it('clears stale signed-in state when a current status request fails', async () => {
    api.mockResolvedValueOnce({ state: 'signed-in' }).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(useDesktopAccount);
    await waitFor(() => expect(result.current.status?.state).toBe('signed-in'));
    await act(async () => result.current.update('status'));
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBe(true);
  });
});
