import http from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateMobileFixture } from './private-mobile-fixture.mjs';

export function createPrivatePreviewServer({ root, demo = false, snapshot = demo ? createPrivateMobileFixture() : null, buildDirectory = '.local/mobile-visual-20261011/web' }) {
  if (typeof buildDirectory !== 'string' || !/^\.local\/mobile-visual-20261011\/web(?:-[a-z0-9-]+)?$/.test(buildDirectory)) throw new Error('Preview requires a named private web build');
  const privateRoot = realpathSync(path.join(root, '.local'));
  const dist = realpathSync(path.resolve(root, buildDirectory));
  const insidePrivate = path.relative(privateRoot, dist);
  if (insidePrivate.startsWith('..') || path.isAbsolute(insidePrivate) || !statSync(dist).isDirectory()) throw new Error('Preview build must stay inside the private directory');
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
  return http.createServer((req, res) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host)
      || req.headers.origin && req.headers.origin !== 'http://' + host) {
      res.writeHead(403); res.end('Loopback preview only'); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const url = new URL(req.url, 'http://' + host);
    if (url.pathname.startsWith('/api/')) {
      const currentSnapshot = typeof snapshot === 'function' ? snapshot() : snapshot;
      let data;
      if (!demo || !currentSnapshot) { res.writeHead(404); res.end(); return; }
      if (url.pathname === '/api/snapshots/latest' || url.pathname === '/api/snapshots/' + encodeURIComponent(currentSnapshot.snapshotId)) data = currentSnapshot;
      else if (url.pathname === '/api/snapshots') data = [{ snapshotId: currentSnapshot.snapshotId, level: currentSnapshot.character.level }];
      else if (url.pathname === '/api/health') data = { status: 'ok', apiVersion: '1.4', writeBackSupported: false, refreshAvailable: false, lanMode: false };
      else if (url.pathname === '/api/sources') data = [];
      else { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': mime['.json'], 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data)); return;
    }
    try {
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const target = realpathSync(path.resolve(dist, '.' + relative));
      const inside = path.relative(dist, target);
      if (inside.startsWith('..') || path.isAbsolute(inside) || !statSync(target).isFile()
        || !mime[path.extname(target)]) { res.writeHead(404); res.end(); return; }
      const bytes = readFileSync(target);
      res.writeHead(200, { 'Content-Type': mime[path.extname(target)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(404); res.end(); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const demo = process.argv.includes('--demo');
  const portArg = process.argv.indexOf('--port');
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : demo ? 5175 : 5174;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback preview port');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const buildArg = process.argv.indexOf('--build-dir');
  const buildDirectory = buildArg >= 0 ? process.argv[buildArg + 1] : undefined;
  if (buildArg >= 0 && !buildDirectory) throw new Error('Missing private build directory');
  const server = createPrivatePreviewServer({ root, demo, buildDirectory });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port + ' · ' + (demo ? '合成示例数据，非存档读取' : '私有本机预览，可导入已有档案包')));
}
