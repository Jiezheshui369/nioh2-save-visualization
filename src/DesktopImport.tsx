import { useEffect, useRef, useState } from "react";
import { isSupportedSnapshot } from "./api";
import type { SaveSnapshot } from "./types";
import type { DesktopReadState } from "./DesktopApp";
import { DesktopText as T } from "./DesktopTypography";

interface Props {
  presentation?: "legacy" | "figma";
  hasCurrentSnapshot?: boolean;
  requestHeaders?: Record<string,string>;
  onReadState?: (state: DesktopReadState) => void;
  onSnapshot: (snapshot: SaveSnapshot) => Promise<void>;
  disabled?: boolean;
  onBegin?: () => boolean;
  onEnd?: () => void;
}

export function DesktopImport({ onSnapshot, disabled = false, onBegin, onEnd, presentation = "legacy", onReadState, hasCurrentSnapshot = false, requestHeaders = {} }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const epoch = useRef(0);
  const lastFile = useRef<File | undefined>(undefined);
  const [cancelled, setCancelled] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { epoch.current++; request.current?.abort(); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const reader = useRef<(file?: File) => Promise<void>>(async () => {});
  useEffect(() => {
    const drag = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    const drop = (event: DragEvent) => {
      if (event.defaultPrevented || !event.dataTransfer?.files.length) return;
      event.preventDefault(); void reader.current(event.dataTransfer.files[0]);
    };
    window.addEventListener('dragover', drag); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', drag); window.removeEventListener('drop', drop); };
  }, []);
  async function read(file?: File) {
    if (!file || lock.current || disabled) return;
    if (file.name.toUpperCase() !== "SAVEDATA.BIN" || file.size < 1_000_000 || file.size > 8 * 1024 * 1024) {
      setError("请拖入 1–8 MB 的 SAVEDATA.BIN 存档文件，不是 JSON 或备份压缩包。"); onReadState?.("failed"); return;
    }
    if (onBegin && !onBegin()) return;
    lastFile.current = file; const ticket = ++epoch.current; setCancelled(false); onReadState?.("reading");
    lock.current = true; setBusy(true); setError(""); setSuccess("");
    const controller = new AbortController();
    request.current = controller;
    let timedOut = false;
    let parsed = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 240000);
    try {
      const r = await fetch("/api/import-save", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Nioh2-Desktop-Sync": "1", "X-Nioh2-Modified": String(file.lastModified), ...requestHeaders }, body: file, signal: controller.signal });
      let value: unknown;
      try { value = await r.json(); }
      catch { throw new Error(`电脑服务没有返回有效的分析结果（HTTP ${r.status}），请确认电脑程序正在运行后重试。`); }
      if (controller.signal.aborted) {
        if (timedOut) throw new Error("timeout");
        return;
      }
      if (!r.ok) {
        const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "电脑解析失败，请重试。";
        throw new Error(message);
      }
      if (!isSupportedSnapshot(value)) throw new Error("解析结果不完整，本页面未切换角色，请重试。");
      // Response received: local persistence is not a network timeout.
      window.clearTimeout(timer);
      parsed = true;
      if (controller.signal.aborted || ticket !== epoch.current) return;
      await onSnapshot(value);
      onReadState?.("committed");
      setSuccess(value.localPublication?.remotePublication?.status === 'not-ready'
        ? '本地已解析并保存规范快照；整数超出远程数字契约范围，暂不可远程发布，未发送到手机。'
        : value.localPublication
        ? `已解析并保存规范快照，已准备本机同步记录 #${value.localPublication.publicationVersion}；尚未发送到手机。`
        : '已解析并保存规范快照；当前服务未返回同步发布记录，尚未发送到手机。');
    } catch (e) {
      if (!controller.signal.aborted || timedOut) onReadState?.("failed");
      if (timedOut) setError("等待分析结果超时，电脑可能仍在解析。请稍后重试；这不代表解析已取消。");
      else if (!controller.signal.aborted) setError(parsed
        ? `电脑分析已完成，但本页面保存或显示失败。${e instanceof Error ? e.message : "请重试。"}`
        : e instanceof TypeError ? "无法连接电脑服务，请确认电脑程序仍在运行后重试。"
        : e instanceof Error ? e.message : "读取失败，请重试。");
    } finally {
      window.clearTimeout(timer);
      lock.current = false;
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted || timedOut) setBusy(false);
      onEnd?.();
    }
  }
  reader.current = read;
  if (presentation === "figma") {
    const cancelWaiting = () => {
      epoch.current++; request.current?.abort(); setBusy(false); setError(""); setCancelled(true); onReadState?.("cancelled");
    };
    const clearFailure = () => { setError(""); setCancelled(false); onReadState?.("idle"); };
    return <section className="df-import-control" aria-label="电脑导入游戏存档" onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); void read(event.dataTransfer.files[0]); }}>
      <h2><T>{busy ? '解析中' : error ? '解析失败' : '将SAVEDATA.BIN拖入窗口'}</T></h2>
      {busy ? <><p role="status"><T>正在读取独立副本并解析</T></p><progress className="df-parse-progress" aria-label="正在解析存档" /><button className="df-button" onClick={cancelWaiting}><T>取消等待</T></button></>
        : error ? <><p role="alert"><T>{error}</T></p><div className="df-dialog-actions">
          <button className="df-button" disabled={disabled || !lastFile.current} onClick={() => void read(lastFile.current)}><T>重试解析</T></button>
          <button className="df-button" disabled={disabled} onClick={clearFailure}><T>{hasCurrentSnapshot ? '返回当前存档' : '返回空档'}</T></button></div></>
        : <><p><T>只读副本 · 自动解析 · 不写回游戏</T></p><button className="df-button" disabled={disabled} onClick={() => input.current?.click()}><T>选择游戏存档</T></button></>}
      {cancelled ? <><p role="status" className="df-muted"><T>已停止等待；后台解析可能继续，原存档保持只读</T></p><button className="df-button" onClick={clearFailure}><T>{hasCurrentSnapshot ? '返回当前存档' : '返回空档'}</T></button></> : null}
      <input ref={input} type="file" accept=".bin" aria-label="选择 SAVEDATA.BIN" hidden onChange={event => { void read(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    </section>;
  }

  return <section className="sync-panel" aria-label="电脑导入游戏存档" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void read(e.dataTransfer.files[0]); }}>
    <h2>把 SAVEDATA.BIN 拖入应用窗口</h2><p>电脑软件读取独立副本并自动解析，规范快照保存在本机。手机连接服务尚未接通时，不会假报同步成功；无需手动导入中间JSON。</p>
    <button disabled={busy || disabled} onClick={() => input.current?.click()}>{busy ? "正在复制并分析，请稍候…" : "选择游戏存档"}</button>
    <input ref={input} type="file" accept=".bin" aria-label="选择 SAVEDATA.BIN" hidden onChange={e => { void read(e.target.files?.[0]); e.currentTarget.value = ""; }} />
    {error ? <p role="alert">{error}</p> : null}
    {success ? <p role="status">{success}</p> : null}
  </section>;
}
