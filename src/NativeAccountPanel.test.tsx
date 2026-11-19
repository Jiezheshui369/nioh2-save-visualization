import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeAccountPanel } from './NativeAccountPanel';
import { accountStatus, nativeAccount } from './nativeAccount';

vi.mock('./nativeAccount', async original => ({ ...await original<typeof import('./nativeAccount')>(), nativeAccount: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(nativeAccount).mockResolvedValue({ state: 'signed-out' }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('reads status without starting login and starts only by a user action', async () => {
  render(<NativeAccountPanel platform="windows" />);
  await act(async () => {});
  expect(nativeAccount).toHaveBeenCalledExactlyOnceWith('status', 'windows');
  vi.mocked(nativeAccount).mockResolvedValue({ state: 'signing-in' });
  fireEvent.click(screen.getByRole('button', { name: '使用系统浏览器登录' }));
  await act(async () => {});
  expect(nativeAccount).toHaveBeenLastCalledWith('login', 'windows');
  expect(screen.getByRole('button', { name: '取消账号操作' })).toBeEnabled();
});

it('polls safe native state and exposes logout only after native confirmation', async () => {
  vi.useFakeTimers();
  vi.mocked(nativeAccount).mockResolvedValueOnce({ state: 'signing-in' }).mockResolvedValue({ state: 'signed-in' });
  render(<NativeAccountPanel platform="android" />);
  await act(async () => {});
  await act(async () => vi.advanceTimersByTimeAsync(1200));
  expect(screen.getByRole('button', { name: '退出账号' })).toBeEnabled();
  vi.mocked(nativeAccount).mockResolvedValue({ state: 'signed-out' });
  fireEvent.click(screen.getByRole('button', { name: '退出账号' }));
  await act(async () => {});
  expect(nativeAccount).toHaveBeenLastCalledWith('logout', 'android');
});

it('never renders raw native failures', async () => {
  vi.mocked(nativeAccount).mockRejectedValue(new Error('secret-access-token'));
  render(<NativeAccountPanel platform="windows" />);
  await act(async () => {});
  expect(screen.getByText('账号功能暂不可用，请使用新版原生应用。')).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('secret-access-token');
});

it('projects only fixed status fields and rejects unknown state', () => {
  expect(accountStatus({ state: 'signed-in', accessToken: 'private', errorCode: 'private-token' })).toEqual({ state: 'signed-in' });
  expect(() => accountStatus({ state: 'arbitrary' })).toThrow('AUTH_STATUS_INVALID');
});

it('cancellation prevents a stale poll from restoring signed-in state', async () => {
  vi.useFakeTimers();
  let finish!: (value: { state: 'signed-in' }) => void;
  vi.mocked(nativeAccount).mockResolvedValueOnce({ state: 'signing-in' })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ state: 'signed-out', errorCode: 'AUTH_CANCELLED' });
  render(<NativeAccountPanel platform="windows" />);
  await act(async () => {});
  await act(async () => vi.advanceTimersByTimeAsync(1200));
  fireEvent.click(screen.getByRole('button', { name: '取消账号操作' }));
  await act(async () => {});
  await act(async () => finish({ state: 'signed-in' }));
  expect(screen.queryByRole('button', { name: '退出账号' })).not.toBeInTheDocument();
  expect(screen.getByText('已取消登录')).toBeInTheDocument();
});

it('refreshes signed-in native validity every thirty seconds without starting login', async () => {
  vi.useFakeTimers();
  vi.mocked(nativeAccount).mockResolvedValueOnce({ state: 'signed-in' }).mockResolvedValue({ state: 'signed-out' });
  render(<NativeAccountPanel platform="windows" />);
  await act(async () => {});
  await act(async () => vi.advanceTimersByTimeAsync(29999));
  expect(nativeAccount).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.queryByRole('button', { name: '退出账号' })).not.toBeInTheDocument();
  expect(nativeAccount).toHaveBeenLastCalledWith('status', 'windows');
});

it('refreshes on focus and visible return while rejecting an older native reply', async () => {
  let finish!: (value: { state: 'signed-in' }) => void;
  vi.mocked(nativeAccount).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ state: 'signed-out' });
  render(<NativeAccountPanel platform="android" />);
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await act(async () => finish({ state: 'signed-in' }));
  expect(screen.queryByRole('button', { name: '退出账号' })).not.toBeInTheDocument();
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(nativeAccount).toHaveBeenCalledTimes(3);
  expect(nativeAccount).toHaveBeenLastCalledWith('status', 'android');
});

it('keeps new login disabled after cancellation until the native browser transaction ends', async () => {
  vi.useFakeTimers();
  vi.mocked(nativeAccount).mockResolvedValueOnce({ state: 'signing-in', browserPending: true })
    .mockResolvedValueOnce({ state: 'signed-out', errorCode: 'AUTH_CANCELLED', browserPending: true })
    .mockResolvedValue({ state: 'signed-out', browserPending: false });
  render(<NativeAccountPanel platform="android" />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '取消账号操作' }));
  await act(async () => {});
  expect(screen.getByRole('button', { name: '使用系统浏览器登录' })).toBeDisabled();
  expect(screen.getByText(/取消后请返回浏览器按返回键/)).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(1200));
  expect(screen.getByRole('button', { name: '使用系统浏览器登录' })).toBeEnabled();
  expect(nativeAccount).not.toHaveBeenCalledWith('login', 'android');
});

it('allowlists only a boolean browser transaction flag', () => {
  expect(accountStatus({ state: 'signed-out', browserPending: true, accessToken: 'private' }))
    .toEqual({ state: 'signed-out', browserPending: true });
  expect(accountStatus({ state: 'signed-out', browserPending: 'private' })).toEqual({ state: 'signed-out' });
});

it('exposes only boolean authentication diagnostics and requests reauthentication by user action', async () => {
 expect(accountStatus({state:'signed-in',serviceAuthenticationEvidence:false,serviceAuthenticationRecent:'secret',idAuthenticationRecent:true,auth_time:123,accessToken:'secret'}))
   .toEqual({state:'signed-in',serviceAuthenticationEvidence:false,idAuthenticationRecent:true});
 vi.mocked(nativeAccount).mockResolvedValue({state:'signed-in',serviceAuthenticationEvidence:false});
 render(<NativeAccountPanel platform="windows" />);await act(async()=>{});
 expect(screen.getByText(/服务端近期认证配置尚未就绪/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'重新认证以管理设备'}));await act(async()=>{});
 expect(nativeAccount).toHaveBeenLastCalledWith('login','windows');
});


it('does not turn a confirmed account login into a remote connection', async () => {
 vi.mocked(nativeAccount).mockResolvedValue({ state: 'signed-in' });
 render(<NativeAccountPanel platform="android" />); await act(async () => {});
 expect(screen.getByText('跨网连接未启用')).toBeVisible();
 expect(screen.queryByText('已连接电脑')).not.toBeInTheDocument();
 expect(nativeAccount).not.toHaveBeenCalledWith('login', 'android');
});
