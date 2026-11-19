import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RemoteMvpPanel } from './RemoteMvpPanel';
import { cachedSnapshot, remoteMvp, remoteStatus } from './remoteMvp';
vi.mock('./remoteMvp', async original => ({ ...await original<typeof import('./remoteMvp')>(), remoteMvp: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(remoteMvp).mockResolvedValue({ state: 'unconfigured', enabled: false }); });
afterEach(cleanup);
it('default disabled state never initiates enrollment and disables native actions', async () => {
  render(<RemoteMvpPanel platform="android" signedIn />); await act(async () => {});
  expect(screen.getByRole('button', { name: '申请连接这台电脑' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '手动刷新存档' })).toBeDisabled();
  expect(remoteMvp).toHaveBeenCalledExactlyOnceWith('status', 'android');
});
it('projects public fields only and cannot become ready without explicit enablement', () => {
  expect(remoteStatus({ state: 'ready', accessToken: 'secret', account: 'private' })).toEqual({ state: 'unconfigured', enabled: false, hasCache: false, pending: [] });
  expect(() => remoteStatus({ state: 'connected' })).toThrow();
  expect(() => remoteStatus({ state: 'ready', enabled: true, pending: [{ requestId: 'ABCDEFGHIJKLMNOP', phrase: 'ABCD-1234-5678-AAAA-BBBB-CCCC', expiresAt: Date.now() + 60000 }] })).toThrow();
  expect(() => cachedSnapshot({ snapshot: { character: {} } })).toThrow('REMOTE_CACHE_INVALID');
  expect(cachedSnapshot({ snapshot: null })).toBeNull();
});
it('requires exact phrase comparison before approving and prevents duplicate requests', async () => {
  const request = { requestId: 'ABCDEFGHIJKLMNOP', phrase: 'ABCD 1234 5678 AAAA BBBB CCCC', expiresAt: Date.now() + 60000 };
  vi.mocked(remoteMvp).mockResolvedValue({ state: 'ready', enabled: true, pending: [request] });
  render(<RemoteMvpPanel platform="windows" signedIn />); await act(async () => {});
  const approve = screen.getByRole('button', { name: '允许这部手机' }); expect(approve).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox')); expect(approve).toBeEnabled();
  let finish!: (v: unknown) => void;
  vi.mocked(remoteMvp).mockImplementationOnce(() => new Promise(r => { finish = r; }));
  fireEvent.click(approve); fireEvent.click(approve);
  expect(remoteMvp).toHaveBeenCalledTimes(2);
  expect(remoteMvp).toHaveBeenLastCalledWith('approve', 'windows', { requestId: request.requestId, phrase: request.phrase });
  await act(async () => finish({ state: 'ready', enabled: true }));
});
it('a response arriving after signout cannot restore authorized actions', async () => {
  let finish!: (v: unknown) => void;
  vi.mocked(remoteMvp).mockImplementationOnce(() => new Promise(r => { finish = r; }));
  const view = render(<RemoteMvpPanel platform="android" signedIn />);
  view.rerender(<RemoteMvpPanel platform="android" signedIn={false} />);
  await act(async () => {});
  await act(async () => finish({ state: 'ready', configured: true }));
  expect(screen.getByRole('button', { name: '手动刷新存档' })).toBeDisabled();
});
it('native failures are replaced by a fixed safe message', async () => {
  vi.mocked(remoteMvp).mockRejectedValue(new Error('secret-access-token'));
  render(<RemoteMvpPanel platform="android" signedIn />); await act(async () => {});
  expect(document.body).not.toHaveTextContent('secret-access-token');
  expect(screen.getByText('跨网服务尚不可用，请使用新版原生应用。')).toBeInTheDocument();
});
it('clears the displayed remote snapshot on account signout', async () => {
  const onSnapshot = vi.fn();
  const view = render(<RemoteMvpPanel platform="android" signedIn onSnapshot={onSnapshot} />);
  await act(async () => {});
  expect(onSnapshot).not.toHaveBeenCalled();
  view.rerender(<RemoteMvpPanel platform="android" signedIn={false} onSnapshot={onSnapshot} />);
  await act(async () => {});
  expect(onSnapshot).toHaveBeenCalledExactlyOnceWith(null);
});

it('iOS first-join preflight enables explicit request but never initiates it from status', async () => {
  vi.mocked(remoteMvp).mockResolvedValue({ state: 'unregistered', configured: true });
  render(<RemoteMvpPanel platform="ios" signedIn />); await act(async () => {});
  expect(screen.getByRole('button', { name: '申请连接这台电脑' })).toBeEnabled();
  expect(remoteMvp).toHaveBeenCalledExactlyOnceWith('status', 'ios');
  fireEvent.click(screen.getByRole('button', { name: '申请连接这台电脑' }));
  await act(async () => {});
  expect(remoteMvp).toHaveBeenLastCalledWith('requestJoin', 'ios', undefined);
});
it('registered Windows PC can retry connection without claiming connection success', async () => {
  vi.mocked(remoteMvp).mockResolvedValue({ state: 'ready', enabled: true, connected: false });
  render(<RemoteMvpPanel platform="windows" signedIn />); await act(async () => {});
  expect(screen.getByText('电脑已登记，中继尚未连接')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '连接这台电脑' })).toBeEnabled();
  vi.mocked(remoteMvp).mockResolvedValueOnce({ state: 'ready', enabled: true, connected: true });
  fireEvent.click(screen.getByRole('button', { name: '连接这台电脑' }));await act(async () => {});
  expect(remoteMvp).toHaveBeenLastCalledWith('initialize','windows',undefined);
  expect(screen.getByRole('button', { name: '连接这台电脑' })).toBeDisabled();
});
