import { useEffect, useRef, useState } from "react";
import { isSupportedSnapshot } from "./api";
import type { SaveSnapshot } from "./types";

interface Props {
  onSnapshot: (snapshot: SaveSnapshot) => Promise<void>;
  disabled?: boolean;
  onBegin?: () => boolean;
  onEnd?: () => void;
}

export function DesktopImport({ onSnapshot, disabled = false, onBegin, onEnd }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function read(file?: File) {
    if (!file || lock.current || disabled) return;
    if (file.name.toUpperCase() !== "SAVEDATA.BIN" || file.size < 1_000_000 || file.size > 8 * 1024 * 1024) {
      setError("请拖入 1–8 MB 的 SAVEDATA.BIN 存档文件，不是 JSON 或备份压缩包。"); return;
    }
    if (onBegin && !onBegin()) return;
    lock.current = true; setBusy(true); setError("");
    const controller = new AbortController();
    request.current = controller;
    let timedOut = false;
    let parsed = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 240000);
    try {
      const r = await fetch("/api/import-save", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Nioh2-Desktop-Sync": "1", "X-Nioh2-Modified": String(file.lastModified) }, body: file, signal: controller.signal });
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
      await onSnapshot(value);
    } catch (e) {
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
  return <section className="sync-panel" aria-label="电脑导入游戏存档" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void read(e.dataTransfer.files[0]); }}>
    <h2>把 SAVEDATA.BIN 拖到这里</h2><p>仅在电脑读取文件并解析独立副本，不改动游戏原存档。分析完成后，在“更多”下方开启手机同步。</p>
    <button disabled={busy || disabled} onClick={() => input.current?.click()}>{busy ? "正在复制并分析，请稍候…" : "选择游戏存档"}</button>
    <input ref={input} type="file" accept=".bin" aria-label="选择 SAVEDATA.BIN" hidden onChange={e => { void read(e.target.files?.[0]); e.currentTarget.value = ""; }} />
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
