import manifest from './desktopAssetManifest.json';
const images = import.meta.glob('./desktopAssets/[0-9a-f]*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const desktopAssets = manifest;
export function imageUrl(asset: { file: string } | undefined): string | undefined {
  return asset ? images['./desktopAssets/' + asset.file] : undefined;
}
export function designImage(node: keyof typeof manifest.contexts, variable: string): string | undefined {
  return imageUrl((manifest.contexts[node] as Record<string, { file: string }>)[variable]);
}
