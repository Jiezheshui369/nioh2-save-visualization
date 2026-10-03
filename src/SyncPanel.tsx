import { useEffect, useMemo, useRef, useState } from "react";
import { createAssetPackage } from "./assetPackage";
import type { CharacterAssetPackage } from "./assetPackage";
import { BUILD_LIBRARY_UPDATED_EVENT, loadSavedBuilds } from "./buildLibrary";
import type { SaveSnapshot } from "./types";
import { desktopSync, LocalSync, validateSyncResponse } from "./mobileSync";
import type { SyncStatus } from "./mobileSync";
import { parsePairingQr } from "./pairing";
import { SNAPSHOT_CACHE_UPDATED_EVENT } from "./snapshotCache";
import { createShareSnapshot } from './privacy';

export function DesktopSyncPanel({ snapshot, disabled = false }: { snapshot: SaveSnapshot; disabled?: boolean }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [buildEpoch, setBuildEpoch] = useState(0);
  const [publishedBuildEpoch, setPublishedBuildEpoch] = useState<number | null>(null);
  const [publishedRevision, setPublishedRevision] = useState<string>();
  const [publishedCharacter, setPublishedCharacter] = useState<{ revision?: string; content: string } | null>(null);
  // Snapshot IDs can be retained when annotations/decoded fields are updated.
  // Compare the share contract, not private diagnostics or object identity.
  const characterContent = useMemo(() => JSON.stringify(createShareSnapshot(snapshot)), [snapshot]);
  const buildEpochRef = useRef(0);
  const [selected, setSelected] = useState(0);
  const [qr, setQr] = useState("");
  const actionLock = useRef(false);
  const statusPending = useRef(false);
  const statusEpoch = useRef(0);
  const url = statusError ? "" : status?.urls[selected] || status?.urls[0] || "";
  const pendingCharacter = Boolean(status?.publishedSnapshotId && status.publishedSnapshotId !== snapshot.snapshotId)
    || Boolean(publishedCharacter?.revision && publishedCharacter.revision === status?.revision && publishedCharacter.content !== characterContent);
  const pendingBuilds = publishedBuildEpoch !== null && buildEpoch !== publishedBuildEpoch;
  const buildsUnconfirmed = publishedBuildEpoch === null || !publishedRevision || publishedRevision !== status?.revision;
  useEffect(() => {
    const changed = () => { buildEpochRef.current++; setBuildEpoch(buildEpochRef.current); };
    window.addEventListener(BUILD_LIBRARY_UPDATED_EVENT, changed);
    return () => window.removeEventListener(BUILD_LIBRARY_UPDATED_EVENT, changed);
  }, []);
  useEffect(() => {
    let active = true;
    const read = () => {
      if (actionLock.current || statusPending.current) return;
      statusPending.current = true;
      const epoch = statusEpoch.current;
      void desktopSync("status").then(s => {
        if (active && epoch === statusEpoch.current && !actionLock.current) { setStatus(s); setStatusError(""); }
      }).catch(() => {
        if (active && epoch === statusEpoch.current && !actionLock.current) setStatusError("暂时无法确认电脑同步状态，旧二维码已隐藏。请确认电脑程序仍在运行，稍后会自动重试。");
      }).finally(() => { statusPending.current = false; });
    };
    read(); const timer = window.setInterval(read, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let active = true; setQr("");
    if (url) void import("qrcode").then(q => q.toDataURL(url, { width: 320, margin: 2 })).then(q => { if (active) setQr(q); }).catch(() => { if (active) setError("二维码生成失败，可使用下方配对信息，或刷新页面重试。"); });
    return () => { active = false; };
  }, [url]);
  async function publish(newInvite = false) {
    if (actionLock.current || disabled) return;
    actionLock.current = true; statusEpoch.current++;
    setBusy(true); setError("");
    const buildsAtStart = buildEpochRef.current;
    try {
      const capturedCharacter = createShareSnapshot(snapshot);
      const capturedContent = JSON.stringify(capturedCharacter);
      const result = await desktopSync("publish", createAssetPackage(capturedCharacter, await loadSavedBuilds()), newInvite);
      setStatus(result); setPublishedRevision(result.revision);
      setPublishedCharacter({ revision: result.revision, content: capturedContent });
      setPublishedBuildEpoch(buildsAtStart); setStatusError("");
    }
    catch (e) { setStatusError("发布结果尚未确认，请等待同步状态更新。"); setError(e instanceof Error ? e.message : "同步开启失败。"); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function stop() {
    if (actionLock.current) return;
    actionLock.current = true; statusEpoch.current++; setBusy(true); setError("");
    try { setStatus(await desktopSync("stop")); setStatusError(""); }
    catch { setStatusError("关闭结果尚未确认，旧二维码已隐藏。"); setError("关闭失败，请关闭电脑程序停止同步。"); }
    finally { actionLock.current = false; setBusy(false); }
  }
  return <section className="sync-panel" aria-label="电脑同步到手机">
    <p className="eyebrow">电脑分析 · 手机随身展示</p><h1>同步到手机</h1>
    <p>电脑先读取存档，再发布当前角色与配装。手机扫码接收，不需要传文件；同步后可以断网、关闭电脑查看。</p>
    <p>仅在可信的同一家庭 Wi-Fi 使用。传输采用证书指纹验证的 TLS；原始存档不会发送。开启后本机临时监听局域网端口，最长 8 小时，关闭即撤销全部配对。</p>
    <p>Windows 防火墙询问时，只允许“专用网络”，不要关闭防火墙。</p>
    <button disabled={busy || disabled} onClick={() => void publish()}>{busy ? "正在准备…" : status?.enabled ? "发布当前角色到手机" : "开启同步并生成二维码"}</button>
    {status?.enabled ? <>
      {pendingCharacter || pendingBuilds ? <p className="nm-alert" role="status">{pendingCharacter ? "当前展示的角色还未发布。" : ""}{pendingBuilds ? "配装册有未发布的变更。" : ""}请点击“发布当前角色到手机”，然后在手机接收。</p> : null}
      {!status.publishedSnapshotId ? <p className="nm-note">此电脑服务未提供发布版本信息，无法确认手机可接收的是否为当前角色；请主动发布后核对。</p> : null}
      {buildsUnconfirmed && !pendingBuilds ? <p className="nm-note">尚未核对本机配装册与当前角色是否和已发布内容一致；修改资料后请重新发布。重新进入此页面不会自动发送变更。</p> : null}
      <p role="status">已配对 {status.devices} 台设备。{statusError ? "连接状态待确认。" : status.lastSent ? `手机最近请求读取已发布版本：${new Date(status.lastSent).toLocaleTimeString()}` : "当前发布版本等待手机接收。"} 请求读取不等于手机已保存，请核对手机成功提示。</p>
      {status.urls.length > 1 ? <label>电脑网卡地址<select value={selected} onChange={e => setSelected(Number(e.target.value))}>{status.urls.map((u, i) => <option key={u} value={i}>地址 {i + 1} · {new URLSearchParams(u.split("#")[1]).get("host")}</option>)}</select></label> : null}
      {url && qr ? <img className="sync-qr" src={qr} alt="手机应用配对二维码" /> : !statusError ? <p>二维码已使用或过期，需要新设备配对时重新生成。</p> : null}
      <p>在手机 App 内点击“扫描电脑二维码”。二维码十分钟有效、仅能使用一次，不要公开分享。</p>
      {url ? <details><summary>相机不可用？复制配对信息</summary><textarea readOnly aria-label="电脑配对信息" value={url} /></details> : null}
      <button disabled={busy || disabled} onClick={() => void publish(true)}>重新生成二维码</button>
      <button disabled={busy} onClick={() => void stop()}>关闭同步并撤销配对</button>
    </> : null}
    {error || statusError ? <p role="alert">{error || statusError}</p> : null}
  </section>;
}

export type ArchiveReceipt = boolean | { warning: string };

export function MobileReceivePanel({ onArchive, active = true }: { onArchive: (archive: CharacterAssetPackage) => Promise<ArchiveReceipt>; active?: boolean }) {
  const [paired, setPaired] = useState(false);
  const [host, setHost] = useState("");
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const revision = useRef("");
  const statusEpoch = useRef(0);
  const mounted = useRef(true);
  const receiveRef = useRef<(code?: string) => Promise<void>>(async () => {});
  useEffect(() => {
    mounted.current = true;
    // Restoring another archive invalidates the last received revision. Otherwise
    // an unchanged server reply could claim that the wrong local character is saved.
    const invalidate = () => { revision.current = ""; setMessage(""); };
    window.addEventListener(SNAPSHOT_CACHE_UPDATED_EVENT, invalidate);
    return () => { mounted.current = false; window.removeEventListener(SNAPSHOT_CACHE_UPDATED_EVENT, invalidate); };
  }, []);
  async function receive(code?: string, forceSave = false) {
    if (lock.current) return;
    lock.current = true; statusEpoch.current++; setBusy(true); setError(""); setMessage("");
    try {
      const endpoint = code ? parsePairingQr(code.trim()) : null;
      const result = await LocalSync.receive(code ? { qr: code.trim() } : {});
      if (!mounted.current) return;
      // Native receive has saved pairing credentials before returning. Even if
      // archive storage fails, allow a pull retry; the QR invite was consumed.
      setPaired(true); if (endpoint) setHost(endpoint.host); setQr("");
      const archive = validateSyncResponse(result);
      if (forceSave || result.revision !== revision.current) {
        const saved = await onArchive(archive);
        if (!mounted.current) return;
        if (!saved) throw new Error("手机保存失败，旧档案仍保留，请检查存储空间后重试。");
        if (saved !== true) {
          setError(saved.warning);
          return; // A partial commit is not a fully saved revision; allow retry.
        }
        revision.current = result.revision;
      }
      setMessage(`已同步并保存在手机 · ${new Date().toLocaleTimeString()} · 等级 ${archive.character.character.level}`);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "同步失败，旧档案仍保留。"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => { receiveRef.current = receive; });
  useEffect(() => {
    let active = true;
    const epoch = statusEpoch.current;
    void LocalSync.status().then(s => {
      if (active && epoch === statusEpoch.current) { setPaired(s.paired); setHost(s.host); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!paired || !active) return;
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void receiveRef.current(); }, 15000);
    return () => window.clearInterval(timer);
  }, [paired, active]);
  async function scan() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try { const result = await LocalSync.scan(); if (mounted.current && result.value) setQr(result.value); }
    catch { if (mounted.current) setError("无法打开相机。请允许相机权限，或使用下方配对信息输入框。"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function forget() {
    if (lock.current || !window.confirm("断开电脑配对？手机已保存的角色不会删除。")) return;
    lock.current = true; statusEpoch.current++; setBusy(true); setError(""); setMessage("");
    try {
      await LocalSync.forget();
      if (!mounted.current) return;
      revision.current = "";
      setPaired(false); setHost(""); setQr(""); setMessage("已断开配对，离线角色仍保留。");
    } catch { if (mounted.current) setError("断开配对失败，请重试；手机已保存的角色仍保留。"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="sync-panel" aria-label="连接电脑同步">
    <h2>{paired ? "电脑已配对" : "连接电脑，带走你的角色"}</h2>
    <p>{paired ? `已保存 ${host} 的配对信息，不代表电脑当前在线。此页面前台每 15 秒尝试接收新结果，离线时仍保留上次档案。` : "电脑读取存档后打开“更多 → 同步到手机”（旧版为“手机连接”）。手机与电脑连接同一 Wi-Fi，然后扫描二维码。"}</p>
    <button disabled={busy} onClick={() => void scan()}>扫描电脑二维码</button>
    {paired ? <button disabled={busy} onClick={() => void receive(undefined, true)}>接收最新角色</button> : null}
    <details open={Boolean(qr)}><summary>配对信息 / 手动输入</summary>
      <label>电脑显示的配对信息<textarea aria-label="手机配对信息" value={qr} onChange={e => setQr(e.target.value)} placeholder="niohcompanion://pair#…" autoComplete="off" spellCheck={false} /></label>
      <p>仅连接你自己的电脑。确认后会验证二维码中的电脑证书，并接收角色资料。</p>
      <button disabled={busy || !qr.trim()} onClick={() => void receive(qr, true)}>确认配对并同步</button>
    </details>
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert">{error}</p> : null}
    {busy ? <p role="status">正在处理，请稍候…</p> : null}
    {paired ? <button disabled={busy} onClick={() => void forget()}>断开配对</button> : null}
  </section>;
}
