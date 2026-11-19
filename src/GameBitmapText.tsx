import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './gameBitmapText.css';

export interface BitmapGlyph {
  x: number; y: number; width: number; height: number;
  xoffset: number; baseline: number; xadvance: number;
}
export interface PrivateBitmapFont {
  source: string;
  runtimeBindingProven: false;
  nominalBitmapHeight: number;
  ascent: number; descent: number;
  glyphs: Record<string, BitmapGlyph>;
  atlasUrl: string;
}
const BitmapContext = createContext<PrivateBitmapFont | null>(null);

/** Desktop uses the full atlas size/30 layout. Mobile keeps its approved renderer. */
export function DesktopBitmapTextLayout({ enabled, children }: { enabled:boolean; children:ReactNode }) {
  const inherited=useContext(BitmapContext);
  return <BitmapContext.Provider value={enabled?null:inherited}>{children}</BitmapContext.Provider>;
}

/** The explicit loopback dev preview is the only entry that supplies private pixels.
 * The separate bundled provider is enabled only by the authorized native build. */
export function PrivateBitmapFontProvider({ font, children }: { font: PrivateBitmapFont; children: ReactNode }) {
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const sameOrigin = new URL(font.atlasUrl, window.location.href).origin === window.location.origin;
  return <BitmapContext.Provider value={import.meta.env.DEV && loopback && sameOrigin ? font : null}>{children}</BitmapContext.Provider>;
}

/** Only the explicitly authorized native build supplies this checked minimal subset. */
export function BundledBitmapFontProvider({ font, children }: { font: PrivateBitmapFont | null; children: ReactNode }) {
  const sameOrigin = font !== null && new URL(font.atlasUrl, window.location.href).origin === window.location.origin;
  return <BitmapContext.Provider value={sameOrigin ? font : null}>{children}</BitmapContext.Provider>;
}

export function planBitmapText(text: string, font: PrivateBitmapFont) {
  let pen = 0, left = 0, right = 0;
  const placements: { glyph: BitmapGlyph; x: number; y: number }[] = [];
  const missing = new Set<number>();
  for (const character of text) {
    const cp = character.codePointAt(0)!;
    const glyph = font.glyphs[String(cp)];
    if (!glyph) { missing.add(cp); continue; }
    const x = pen + glyph.xoffset;
    left = Math.min(left, x); right = Math.max(right, x + glyph.width);
    placements.push({ glyph, x, y: font.ascent - glyph.baseline });
    pen += glyph.xadvance;
  }
  return { placements, missing: [...missing], left, width: Math.max(pen, right) - left,
    height: font.ascent + font.descent };
}

const images = new Map<string, Promise<HTMLImageElement>>();
function imageFor(url: string) {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Private bitmap unavailable'));
      image.src = url;
    });
    images.set(url, pending);
  }
  return pending;
}

/** Actual Unicode text stays in the accessibility tree and remains selectable.
 * Missing codepoints fall back as a whole run, with a visible private-review marker. */
export function GameBitmapText({ children }: { children: string | number }) {
  const font = useContext(BitmapContext);
  if (!font) return <>{children}</>;
  return <BitmapRun text={String(children)} font={font} />;
}

function BitmapRun({ text, font }: { text: string; font: PrivateBitmapFont }) {
  const host = useRef<HTMLSpanElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'bitmap' | 'fallback-missing' | 'fallback-image'>('loading');
  const plan = planBitmapText(text, font);
  const missingLabel = plan.missing.map(cp => 'U+' + cp.toString(16).toUpperCase()).join(', ');
  useLayoutEffect(() => {
    let cancelled = false, frame = 0, image: HTMLImageElement | undefined;
    setState('loading');
    if (host.current) { host.current.style.removeProperty('width'); host.current.style.removeProperty('height'); }
    const draw = () => {
      const element = host.current, target = canvas.current;
      if (cancelled || !element || !target || !image) return;
      const style = getComputedStyle(element), pixels = parseFloat(style.fontSize);
      const scale = pixels / font.nominalBitmapHeight, dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, plan.width * scale), height = Math.max(1, plan.height * scale);
      element.style.width = width + 'px'; element.style.height = height + 'px';
      target.style.width = width + 'px'; target.style.height = height + 'px';
      target.width = Math.ceil(width * dpr); target.height = Math.ceil(height * dpr);
      const context = target.getContext('2d');
      if (!context) { setState('fallback-image'); return; }
      context.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      context.imageSmoothingEnabled = Math.abs(scale * dpr - Math.round(scale * dpr)) > 1e-6;
      context.imageSmoothingQuality = 'high';
      for (const { glyph: g, x, y } of plan.placements)
        context.drawImage(image, g.x, g.y, g.width, g.height, x - plan.left, y, g.width, g.height);
      // Preview tint preserves the original bitmap alpha, bearings and advances.
      context.globalCompositeOperation = 'source-in'; context.fillStyle = style.color;
      context.fillRect(0, 0, plan.width, plan.height);
      target.dataset.dpr = String(dpr); target.dataset.bitmapScale = String(scale);
      setState('bitmap');
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
    if (plan.missing.length) setState('fallback-missing');
    else imageFor(font.atlasUrl).then(value => { image = value; schedule(); }).catch(() => { if (!cancelled) setState('fallback-image'); });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (host.current?.parentElement) observer?.observe(host.current.parentElement);
    window.addEventListener('resize', schedule);
    return () => { cancelled = true; cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', schedule); };
  }, [text, font]);
  const fallback = state.startsWith('fallback');
  return <span ref={host} className="game-bitmap-text" data-bitmap-state={state} data-bitmap-source={font.source}
    data-missing-codepoints={missingLabel || undefined}
    title={fallback ? (state === 'fallback-missing' ? `位图缺字 ${missingLabel}，此段使用系统字体` : '私用位图未加载，此段使用系统字体') : undefined}>
    <span className="game-bitmap-readable">{text}</span>
    <canvas ref={canvas} aria-hidden="true" />
    {fallback ? <sup className="game-bitmap-fallback" aria-hidden="true">替</sup> : null}
  </span>;
}
