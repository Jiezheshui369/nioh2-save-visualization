import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPrivatePreviewServer } from './private-mobile-preview.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'nioh-preview-boundaries-'));
const build = path.join(root, '.local/mobile-visual-20261011/web-stage2');
mkdirSync(path.join(build, 'assets'), { recursive: true });
writeFileSync(path.join(build, 'index.html'), '<title>Preview</title>');
writeFileSync(path.join(build, 'assets/a.css'), 'body{}');
writeFileSync(path.join(build, 'assets/texture.webp'), Buffer.from('RIFFprivateWebP'));
writeFileSync(path.join(root, '.local/mobile-visual-20261011/runtime-assets.json'), '{"private":"must not be served"}');
const server = createPrivatePreviewServer({ root, buildDirectory: '.local/mobile-visual-20261011/web-stage2' });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
after(() => new Promise(resolve => server.close(resolve)));
test('serves only the selected web build, not sibling private records or a synthetic API by default', async () => {
  assert.equal(await (await fetch(url)).text(), '<title>Preview</title>');
  assert.equal((await fetch(url + '/assets/a.css')).status, 200);
  assert.equal((await fetch(url + '/..%2fruntime-assets.json')).status, 404);
  assert.equal((await fetch(url + '/api/snapshots/latest')).status, 404);
  assert.equal(await (await fetch(url, { method: 'HEAD' })).text(), '');
});
test('rejects writes and requests with foreign origins', async () => {
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(url, { headers: { Origin: 'https://example.invalid' } })).status, 403);
});
test('rejects arbitrary private folders and absolute build directories', () => {
  for (const buildDirectory of ['.local', '.local/visual-assets-research-20261011', '../web', build]) {
    assert.throws(() => createPrivatePreviewServer({ root, buildDirectory }), /named private web build/);
  }
});
test('serves an optimized image with WebP MIME while preserving read-only private boundaries', async () => {
  const response = await fetch(url + '/assets/texture.webp');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(await response.text(), 'RIFFprivateWebP');
  assert.equal((await fetch(url + '/assets/texture.webp', { method: 'PUT' })).status, 405);
});
