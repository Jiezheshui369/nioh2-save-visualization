import type { SaveSnapshot } from './types';
import { RemoteMvpPanel } from './RemoteMvpPanel';
import { useEffect, useRef, useState } from 'react';
import { nativeAccount } from './nativeAccount';
import type { AccountAction, AccountPlatform, NativeAccountStatus } from './nativeAccount';

export function NativeAccountPanel({ platform, onSnapshot }: { platform: AccountPlatform; onSnapshot?: (snapshot: SaveSnapshot | null) => void }) {
  const [status, setStatus] = useState<NativeAccountStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const lock = useRef(false);
  useEffect(() => {
    let mounted = true;
    const epoch = ++generation.current;
    void nativeAccount('status', platform).then(value => {
      if (mounted && epoch === generation.current) setStatus(value);
    }).catch(() => { if (mounted && epoch === generation.current) setError('账号功能暂不可用，请使用新版原生应用。'); });
    return () => { mounted = false; generation.current++; };
  }, [platform]);
  useEffect(() => {
    let mounted = true;
    let pending = false;
    const refresh = () => {
      if (pending || lock.current) return;
      if (document.visibilityState === 'hidden') return;
      pending = true;
      const epoch = ++generation.current;
      void nativeAccount('status', platform).then(value => {
        if (mounted && epoch === generation.current) { setStatus(value); setError(''); }
      }).catch(() => { if (mounted && epoch === generation.current) setError('登录状态暂未确认，请重试或取消。'); })
        .finally(() => { pending = false; });
    };
    const foreground = () => { if (document.visibilityState !== 'hidden') refresh(); };
    const interval = status?.state === 'signing-in' || status?.browserPending ? 1200 : status?.state === 'signed-in' ? 30000 : null;
    const timer = interval === null ? undefined : window.setInterval(refresh, interval);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      mounted = false;
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [platform, status?.state, status?.browserPending]);
  async function run(action: AccountAction) {
    if (lock.current) return;
    lock.current = true;
    const epoch = ++generation.current;
    setBusy(true); setError('');
    try {
      const value = await nativeAccount(action, platform);
      if (epoch === generation.current) setStatus(value);
    } catch { if (epoch === generation.current) setError('账号操作未确认，请重试；登录不会自动开始。'); }
    finally { lock.current = false; if (epoch === generation.current) setBusy(false); }
  }
  const signing = status?.state === 'signing-in';
  return <section className="native-account nm-state-card" aria-label="存档资产账号">
    <h2>存档资产账号</h2>
    <p role="status">{!status ? '正在确认本机账号状态' : signing ? '请在系统浏览器完成操作，然后返回应用。' : status.state === 'signed-in' ? '已登录' : status.errorCode === 'AUTH_CANCELLED' ? '已取消登录' : status.state === 'error' ? '登录未完成，请重试。' : '尚未登录'}</p>
    <RemoteMvpPanel platform={platform} signedIn={status?.state === 'signed-in'} onSnapshot={onSnapshot} />
    {status?.state === 'signed-in' ? <>
      <p>{status.serviceAuthenticationEvidence === false ? '账号已登录，服务端近期认证配置尚未就绪，暂时不能登记或批准设备。' : status.serviceAuthenticationRecent === false ? '登记或批准设备前，请重新认证。' : status.serviceAuthenticationRecent === true ? '本机已验证近期认证凭据；设备登记仍以中转响应为准。' : '近期认证状态尚未确认。'}</p>
      <button disabled={busy || status.browserPending} onClick={() => void run('login')}>重新认证以管理设备</button>
    </> : null}
    {status?.browserPending ? <p role="status">系统浏览器中的账号操作尚未结束。取消后请返回浏览器按返回键，再回到应用；确认结束前不能重新登录。</p> : null}
    {signing ? <button disabled={busy} onClick={() => void run('cancel')}>取消账号操作</button>
      : status?.state === 'signed-in' ? <button disabled={busy || status.browserPending} onClick={() => void run('logout')}>退出账号</button>
      : <button disabled={busy || !status || status.browserPending} onClick={() => void run('login')}>使用系统浏览器登录</button>}
    <button disabled={busy} onClick={() => void run('status')}>刷新账号状态</button>
    {error ? <p role={status ? 'alert' : undefined}>{error}</p> : null}
  </section>;
}
