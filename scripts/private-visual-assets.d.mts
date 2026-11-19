import type { Plugin } from 'vite';
export const PRIVATE_VISUAL_MODE: 'private-visual';
export const PRIVATE_COLOR_MODE: 'private-color';
export const PRIVATE_LAYOUT_MODE: 'private-layout';
export const PRIVATE_ROLE_MODE: 'private-role';
export const PRIVATE_LIGHT_MODE: 'private-light';
export function readPrivateVisualAssets(root: string, manifest?: string): Array<[string, string]>;
export function privateVisualAssetsPlugin(mode: string, root: string): Plugin;
