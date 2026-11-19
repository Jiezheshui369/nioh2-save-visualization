import { useEffect, useRef, useState } from 'react';
import type { AccountPlatform } from './nativeAccount';
import { cachedSnapshot, remoteMvp, remoteStatus } from './remoteMvp';
import type { RemoteAction, RemoteMvpStatus } from './remoteMvp';
import type { SaveSnapshot } from './types';

export function RemoteMvpPanel({ platform, signedIn, onSnapshot }: { platform: AccountPlatform; signedIn: boolean; onSnapshot?: (snapshot: SaveSnapshot | null) => void }) {
  const [status, setStatus] = useState<RemoteMvpStatus | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [matched, setMatched] = useState(false);
  const generation = useRef(0), lock = useRef(false);
  const snapshotCallback = useRef(onSnapshot); snapshotCallback.current = onSnapshot;
  useEffect(() => {
    const epoch = ++generation.current;
    setStatus(null); setMatched(false); setBusy(false); setError(''); lock.current = false;
    if (!signedIn) snapshotCallback.current?.(null);
    void remoteMvp('status', platform).then(v => { if (epoch === generation.current) setStatus(remoteStatus(v)); })
      .catch(() => { if (epoch === generation.current) setError('跨网服务尚不可用，请使用新版原生应用。'); });
    return () => { generation.current++; };
  }, [platform, signedIn]);
  async function run(action: RemoteAction, options?: object) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const epoch = ++generation.current;
    try {
      const value = await remoteMvp(action, platform, options);
      if (epoch !== generation.current) return;
      if (action === 'readCache') {
        const snapshot = cachedSnapshot(value);
        if (!snapshot) setError('尚无已验证的离线缓存。');
        else if (onSnapshot) onSnapshot(snapshot);
        else setError('缓存已验证；角色页面加载入口尚未接通。');
      } else {
        const next = remoteStatus(value); setStatus(next); setMatched(false);
        if (next.state === 'signed-out') snapshotCallback.current?.(null);
        if (action === 'refresh' && next.state === 'ready' && next.hasCache) {
          const snapshot = cachedSnapshot(await remoteMvp('readCache', platform));
          if (epoch === generation.current && snapshot) snapshotCallback.current?.(snapshot);
        }
      }
    } catch { if (epoch === generation.current) setError('操作未完成，请刷新连接状态后重试。'); }
    finally { if (epoch === generation.current) { lock.current = false; setBusy(false); } }
  }
  const ready = signedIn && status?.enabled === true;
  const request = status?.pending[0];
  const expired = request ? request.expiresAt <= Date.now() : true;
  return <section aria-label="跨网存档" className="asset-connection-unavailable">
    <h3>跨网存档</h3>
    <p role="status">{!status || !status.enabled ? '跨网连接未启用' : !signedIn ? '请先登录同一账号' : status.state === 'ready' ? platform === 'windows' && status.connected === false ? '电脑已登记，中继尚未连接' : '设备已授权，可手动读取电脑数据' : status.state === 'awaiting-approval' ? '等待电脑确认，请比对两端核对短语' : status.state === 'unregistered' ? '首次使用需要授权此设备' : status.state === 'refreshing' ? '正在读取电脑数据' : '连接状态尚未确认'}</p>
    {!status?.enabled ? <p>登录只确认账号身份。服务尚未启用，当前无法登记设备或读取远程存档。</p> : null}
    {status?.phrase ? <p>核对短语：<code>{status.phrase}</code></p> : null}
    {platform === 'windows' ? <>
      <button disabled={busy || !ready || !(status?.state === 'unregistered' || status?.state === 'ready' && status.connected === false)} onClick={() => void run('initialize')}>{status?.state === 'ready' ? '连接这台电脑' : '初始化这台电脑'}</button>
      <button disabled={busy || !ready || status?.state !== 'ready'} onClick={() => void run('pending')}>查看手机申请</button>
      {request ? <div><p>手机申请核对短语：<code>{request.phrase}</code></p><label><input type="checkbox" checked={matched} onChange={e => setMatched(e.target.checked)} />已与手机显示的短语逐字比对</label>
        <button disabled={busy || !ready || expired || !matched} onClick={() => void run('approve', { requestId: request.requestId, phrase: request.phrase })}>允许这部手机</button>
        <button disabled={busy || !ready || expired} onClick={() => void run('reject', { requestId: request.requestId, phrase: request.phrase })}>拒绝申请</button>{expired ? <p>申请已过期，请在手机重新申请。</p> : null}</div> : null}
    </> : <>
      <button disabled={busy || !ready || status?.state !== 'unregistered'} onClick={() => void run('requestJoin')}>申请连接这台电脑</button>
      <button disabled={busy || !ready || status?.state !== 'ready'} onClick={() => void run('refresh')}>手动刷新存档</button>
      <button disabled={busy || !signedIn || !status?.hasCache} onClick={() => void run('readCache')}>查看离线缓存</button>
    </>}
    <button disabled={busy} onClick={() => void run('status')}>刷新连接状态</button>
    {platform !== 'windows' ? <p>离线缓存仅在当前账号会话有效时可查看。应用重启或登录过期后，需联网重新登录；退出账号会清除远程展示。</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
