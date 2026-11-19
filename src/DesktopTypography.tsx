import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BundledBitmapFontProvider, GameBitmapText, planBitmapText } from './GameBitmapText';
import metrics from './desktopAssets/g1n-desktop-1696.json';
import atlas from './desktopAssets/g1n-desktop-1696.png';
// Original atlas ink lies at y25..58 in its 63-unit source box. Remove the
// unused leading so flex centering aligns visible ink; keep all glyph pixels.
const font = { ...metrics, ascent:43, runtimeBindingProven: false as const, atlasUrl: atlas };
/** Dedicated desktop layout keeps original40px glyphs in a centered44-unit box. */
export function DesktopTypography({ children }: { children: ReactNode }) {
  const scale = useDesktopScale();
  // A resize can commit the desktop CSS scale after the renderer's resize callback.
  // Refresh the desktop provider identity so every unchanged run redraws at the committed size.
  const responsiveFont = useMemo(() => ({ ...font }), [scale]);
  return <BundledBitmapFontProvider font={responsiveFont}>{children}</BundledBitmapFontProvider>;
}
/** Wrap whole native bitmap runs using their actual ink bounds and advance. */
export function wrapDesktopText(text: string, maxUnits: number): string[] {
  if (!(maxUnits > 0)) return [text];
  const lines: string[] = []; let line = '';
  for (const character of text) {
    if (character === '\n') { lines.push(line); line = ''; continue; }
    if (line && planBitmapText(line + character, font).width > maxUnits) { lines.push(line); line = character; }
    else line += character;
  }
  lines.push(line); return lines;
}
export function DesktopText({ children, wrap = false, fit = false }: { children: string | number; wrap?: boolean; fit?: boolean }) {
  const text = String(children), host = useRef<HTMLSpanElement>(null);
  const bitmapText = text.replace(/\u3000/g, ' ');
  const missing = [...bitmapText].filter(c => !/\s/u.test(c) && !Object.hasOwn(font.glyphs, String(c.codePointAt(0))));
  const value = missing.length ? '—' : bitmapText;
  const [units, setUnits] = useState(0);
  const [fittedSize, setFittedSize] = useState<number>();
  useLayoutEffect(() => {
    if (!fit || !host.current?.parentElement) return;
    const parent = host.current.parentElement;
    const measure = () => {
      const baseSize = parseFloat(getComputedStyle(parent).fontSize);
      const nativeWidth = planBitmapText(value, font).width;
      if (baseSize > 0 && parent.clientWidth > 0 && nativeWidth > 0)
        setFittedSize(Math.min(baseSize, parent.clientWidth * font.nominalBitmapHeight / nativeWidth));
    };
    measure(); const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(parent); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [fit, value]);
  useLayoutEffect(() => {
    if (!wrap || !host.current) return;
    const element = host.current;
    const measure = () => {
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size > 0) setUnits(element.clientWidth * font.nominalBitmapHeight / size);
    };
    measure(); const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [wrap]);
  return <span ref={host} className={'df-text' + (fit ? ' df-text-fit' : wrap ? ' df-text-wrap' : '')}
    style={fit && fittedSize !== undefined ? {fontSize:fittedSize} : undefined}
    data-native-missing={missing.length ? missing.map(c => c.codePointAt(0)?.toString(16)).join(',') : undefined}
    aria-label={text} title={missing.length ? '字形尚未提取' : undefined}>
    {wrap && !fit ? wrapDesktopText(value, units).map((line, index) => <span className="df-text-line" key={index}><GameBitmapText>{line || ' '}</GameBitmapText></span>) : <GameBitmapText key={fit ? fittedSize : undefined}>{value}</GameBitmapText>}
  </span>;
}
export function useDesktopScale() {
  const [scale, setScale] = useState(() => Math.min(1, window.innerWidth / 1920, window.innerHeight / 1080));
  useEffect(() => {
    const resized = () => setScale(Math.min(1, window.innerWidth / 1920, window.innerHeight / 1080));
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);
  return scale;
}
