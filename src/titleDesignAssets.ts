import manifest from './desktopAssets/titles/manifest.json';
import metrics from './desktopAssets/titles/title-native-font.json';
import atlasUrl from './desktopAssets/titles/title-native-font.png';
import agyoMotif from './desktopAssets/titles/agyo-motif.png';
const local = import.meta.glob('./desktopAssets/titles/*.{png,svg}',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
export function titleDesignAsset(key: keyof typeof manifest): string {
  const file=manifest[key].file;
  const url=local['./desktopAssets/titles/'+file];
  if(!url)throw new Error('Missing bundled title design asset: '+key);
  return url;
}
export const titleDesignManifest=manifest;
export const titleNativeFont={...metrics,runtimeBindingProven:false as const,atlasUrl};
export const titleAgyoMotif=agyoMotif;
