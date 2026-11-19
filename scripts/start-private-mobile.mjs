import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createPrivatePreviewServer } from './private-mobile-preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = '.local/mobile-visual-20261011/web-stable';
const indexFile = path.join(root, buildDirectory, 'index.html');
const demo = !process.argv.includes('--no-demo');
const port = demo ? 5183 : 5184;
const url = 'http://127.0.0.1:' + port;

function openPreview() {
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' });
    child.on('error', error => console.error('Cannot open browser: ' + error.message));
    child.unref();
  }
}

async function runLocalTool(relative, args) {
  const executable = path.join(root, relative);
  if (!existsSync(executable)) throw new Error('Existing project dependencies are missing: ' + relative + '. This launcher does not install dependencies.');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...args], { cwd: root, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(relative + ' exited with ' + code)));
  });
}

try {
  // Check the fixed loopback port before any build; never replace an active QA build.
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(1500) }); }
  catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw new Error('Preview port is unavailable; leave the existing process intact.'); }
  if (response) {
    const html = await response.text();
    const sameBuild = response.ok && existsSync(indexFile) && html === readFileSync(indexFile, 'utf8');
    const api = await fetch(url + '/api/snapshots/latest', { signal: AbortSignal.timeout(1500) });
    const sameMode = demo ? api.ok && (await api.json()).snapshotId?.startsWith('synthetic-mobile-') : api.status === 404;
    if (!sameBuild || !sameMode) throw new Error('Port ' + port + ' belongs to another preview. No process was stopped or replaced.');
    if (process.argv.includes('--rebuild')) throw new Error('Stop the final preview with Ctrl+C before rebuilding it. Existing QA checkpoints were preserved.');
    console.log(url + ' · existing verified preview · ' + (demo ? 'SYNTHETIC DATA ONLY' : 'private archive import'));
    if (!process.argv.includes('--check')) openPreview();
  } else {
    if (process.argv.includes('--check')) {
      if (!existsSync(indexFile)) throw new Error('Final private build is missing. Run this launcher without --check to build it from existing dependencies.');
      const server = createPrivatePreviewServer({ root, demo, buildDirectory }); server.close();
      console.log('Final private build is ready; loopback port ' + port + ' is free.');
    } else {
      if (!existsSync(indexFile) || process.argv.includes('--rebuild')) {
        await runLocalTool('node_modules/typescript/bin/tsc', ['-b']);
        await runLocalTool('node_modules/vite/bin/vite.js', ['build', '--mode', 'private-visual', '--outDir', buildDirectory]);
      }
      const server = createPrivatePreviewServer({ root, demo, buildDirectory });
      server.on('error', error => { console.error(error.message); process.exitCode = 1; });
      server.listen(port, '127.0.0.1', () => {
        console.log(url + ' · ' + (demo ? 'SYNTHETIC DATA ONLY / 非存档读取' : '私有档案导入，无合成 API'));
        console.log('Ctrl+C stops this preview. No install, upload, game write, or existing browser cache deletion.');
        openPreview();
      });
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
