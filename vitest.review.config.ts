import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

// Explicit review adapter: dimensions/URLs only, no game pixels or font data.
export default defineConfig({
  cacheDir:'.local/review-cache',
  plugins:[react()],
  resolve:{alias:{'./titleDesignAssets':fileURLToPath(new URL('./src/test/review-title-assets.ts',import.meta.url))}},
  test:{environment:'jsdom',setupFiles:['./src/test/setup.ts'],include:['src/desktopTextSelection.test.tsx'],coverage:{enabled:false}},
});
