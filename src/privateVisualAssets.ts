import type { CSSProperties } from 'react';
import assets from 'virtual:nioh-private-visual-assets';

export const bundledPrivateUi = assets?.bundledUi === true;
export const privateVisualPreview = assets?.privatePreview === true;
export const privateColorPreview = assets?.presentation === 'color-scenes';
export const privateGameFramesPreview = assets?.gameFrames === true;
export const privateRoleLightPreview = assets?.roleLight === true;
export const privateLightAllPreview = assets?.lightAll === true;
export const privateImage = (key: string): string | undefined => assets?.images[key];

// URLs originate in Vite's asset imports, never from a save, Figma URL or remote manifest.
export function privateVisualStyle(): CSSProperties | undefined {
  if (!assets) return undefined;
  const images = assets.images;
  return Object.fromEntries(['scene', 'ink', 'plate', 'scrollPlate', 'sceneScroll', 'sceneOther', 'frameMajor', 'frameMinor'].map(key =>
    ['--nm-' + key, images[key] ? 'url("' + images[key] + '")' : 'none'])) as CSSProperties;
}

export function privateMobilePresentation(): boolean {
  return (bundledPrivateUi && import.meta.env.MODE === 'android') || (privateVisualPreview && new URLSearchParams(window.location.search).get('layout') !== 'desktop');
}
