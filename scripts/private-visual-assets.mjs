import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const PRIVATE_VISUAL_MODE = 'private-visual';
export const PRIVATE_COLOR_MODE = 'private-color';
export const PRIVATE_LAYOUT_MODE = 'private-layout';
export const PRIVATE_ROLE_MODE = 'private-role';
export const PRIVATE_LIGHT_MODE = 'private-light';
const MODULE_ID = 'virtual:nioh-private-visual-assets';
const RESOLVED_ID = '\0' + MODULE_ID;
const MANIFEST = '.local/mobile-visual-20261011/runtime-assets.json';
const COLOR_MANIFEST = '.local/mobile-color-20261012/runtime-assets.json';
const LAYOUT_MANIFEST = '.local/mobile-name-layout-20261012/runtime-assets.json';
const ROLE_MANIFEST = '.local/mobile-role-light-20261012/runtime-assets.json';
const LIGHT_MANIFEST = '.local/mobile-light-all-20261012/runtime-assets.json';

// Only an explicit private build may even read the ignored asset manifest.
export function readPrivateVisualAssets(root, manifest = MANIFEST) {
  if (![MANIFEST, COLOR_MANIFEST, LAYOUT_MANIFEST, ROLE_MANIFEST, LIGHT_MANIFEST].includes(manifest)) throw new Error('Unknown private visual manifest');
  const privateRoot = realpathSync(path.join(root, '.local'));
  const data = JSON.parse(readFileSync(path.join(root, manifest), 'utf8'));
  if (data.schema !== 1 || !data.images || Array.isArray(data.images)
    || typeof data.images !== 'object') throw new Error('Invalid private visual asset manifest');
  const images = Object.entries(data.images);
  if (!images.length || images.length > 80) throw new Error('Unexpected private visual asset count');
  return images.map(([key, relative]) => {
    if (typeof relative !== 'string' || !relative.startsWith('.local/')
      || relative.includes('\\') || relative.split('/').includes('..')
      || !/^[\w:\u3400-\u9fff -]{1,90}$/.test(key)) {
      throw new Error('Private visual assets require local manifest paths and known keys');
    }
    const target = realpathSync(path.resolve(root, relative));
    const within = path.relative(privateRoot, target);
    if (within.startsWith('..') || path.isAbsolute(within)
      || !['.png', '.svg', '.webp'].includes(path.extname(target).toLowerCase())) {
      throw new Error('Private visual asset escaped the ignored asset directory');
    }
    const size = statSync(target);
    if (!size.isFile() || size.size <= 0 || size.size > 10 * 1024 * 1024) {
      throw new Error('Missing or oversized private visual asset');
    }
    return [key, target];
  });
}

export function privateVisualAssetsPlugin(mode, root) {
  const bundled = process.env.SAVE_ASSET_PRIVATE_UI_BUNDLE === '1' && ['android','windows-portable'].includes(mode);
  return {
    name: 'nioh-private-visual-assets',
    resolveId(id) { return id === MODULE_ID ? RESOLVED_ID : undefined; },
    load(id) {
      if (id !== RESOLVED_ID) return;
      if (!bundled && ![PRIVATE_VISUAL_MODE, PRIVATE_COLOR_MODE, PRIVATE_LAYOUT_MODE, PRIVATE_ROLE_MODE, PRIVATE_LIGHT_MODE].includes(mode)) return 'export default null;';
      const assets = readPrivateVisualAssets(root, (bundled || mode === PRIVATE_LIGHT_MODE) ? LIGHT_MANIFEST : mode === PRIVATE_ROLE_MODE ? ROLE_MANIFEST : mode === PRIVATE_LAYOUT_MODE ? LAYOUT_MANIFEST : mode === PRIVATE_COLOR_MODE ? COLOR_MANIFEST : MANIFEST);
      const imports = assets.map(([, file], i) =>
        'import image' + i + ' from ' + JSON.stringify(file.split(path.sep).join('/')) + ';').join('\n');
      const values = assets.map(([key], i) => JSON.stringify(key) + ':image' + i).join(',');
      return imports + '\nexport default {privatePreview:' + !bundled + ',bundledUi:' + bundled + ',gameFrames:' + (bundled || [PRIVATE_LAYOUT_MODE, PRIVATE_ROLE_MODE, PRIVATE_LIGHT_MODE].includes(mode)) + ',roleLight:' + (bundled || [PRIVATE_ROLE_MODE, PRIVATE_LIGHT_MODE].includes(mode)) + ',lightAll:' + (bundled || mode === PRIVATE_LIGHT_MODE) + ',presentation:' + JSON.stringify(mode === PRIVATE_VISUAL_MODE ? 'classic' : 'color-scenes') + ',images:{' + values + '}};';
    },
  };
}
