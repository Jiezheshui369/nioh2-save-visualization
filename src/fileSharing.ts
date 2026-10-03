import { isNativeApp } from "./runtime";

export function isShareCancelled(reason: unknown): boolean {
  return (reason instanceof DOMException || reason instanceof Error) && reason.name === 'AbortError';
}

async function nativeShare(options: { title: string; text?: string; files?: string[]; dialogTitle: string }): Promise<void> {
  const { Share } = await import('@capacitor/share');
  try { await Share.share(options); }
  catch (reason) {
    // The installed Capacitor 8 Android/iOS implementations use this exact rejection.
    if (reason && typeof reason === 'object' && 'message' in reason && reason.message === 'Share canceled') {
      throw new DOMException('已取消分享。', 'AbortError');
    }
    throw reason;
  }
}

export function safeShareFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/^\.+|[. ]+$/g, '');
  const extension = /\.[a-z0-9]{1,10}$/i.exec(cleaned)?.[0] ?? '';
  const stem = extension ? cleaned.slice(0, -extension.length) : cleaned;
  const bounded = stem.slice(0, 160 - extension.length).replace(/[. ]+$/g, '') || 'Nioh-share';
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(bounded) ? '_' : ''}${bounded}${extension}`;
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function shareText(title: string, text: string): Promise<void> {
  if (isNativeApp()) {
    await nativeShare({ title, text, dialogTitle: "分享配装" });
    return;
  }
  if (typeof navigator.share === "function") {
    await navigator.share({ title, text });
    return;
  }
  // WebView2 does not always implement Web Share. Explicit user action saves
  // a readable text file instead; never auto-upload or copy to the clipboard.
  await shareOrDownloadFile(new Blob([text], { type: "text/plain;charset=utf-8" }), `${title}.txt`, title);
}

export async function shareOrDownloadFile(blob: Blob, name: string, title: string): Promise<"shared" | "saved"> {
  const safeName = safeShareFilename(name);
  if (isNativeApp()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    // App-private cache + FileProvider: no shared-storage permissions or original saves.
    const path = `shares/${crypto.randomUUID()}/${safeName}`;
    const file = await Filesystem.writeFile({ path, data: await blobBase64(blob), directory: Directory.Cache, recursive: true });
    await nativeShare({ title, files: [file.uri], dialogTitle: "分享角色档案" });
    // Do not delete immediately: the receiving app may still be reading the URI.
    return "shared";
  }
  const file = new File([blob], safeName, { type: blob.type });
  if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title, files: [file] });
    return "shared";
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "saved";
}
