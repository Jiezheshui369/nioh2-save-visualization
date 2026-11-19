import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Portable delivery excludes extracted game artwork and all public demo/player data.
// Other build modes retain their existing assets and layout.
export function windowsPortableAssetsPlugin(mode, root) {
  if (mode !== 'windows-portable') return null;
  return {
    name: 'windows-portable-assets', enforce: 'pre',
    load(id) {
      if (process.env.SAVE_ASSET_PRIVATE_UI_BUNDLE !== '1' && id.replaceAll('\\', '/').includes('/design-assets/nioh2-') && /\.png(?:\?.*)?$/.test(id)) {
        return 'export default "";';
      }
    },
    async writeBundle(options) {
      const output = resolve(root, options.dir);
      await Promise.all(['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.webmanifest', 'sw.js']
        .map(name => copyFile(resolve(root, 'public', name), resolve(output, name))));
    },
  };
}
