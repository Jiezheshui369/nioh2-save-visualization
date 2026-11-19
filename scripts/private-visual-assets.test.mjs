import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { privateVisualAssetsPlugin, readPrivateVisualAssets } from './private-visual-assets.mjs';

function fixture(images = { scene: '.local/assets/scene.svg' }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nioh-private-visual-test-'));
  mkdirSync(path.join(root, '.local/mobile-visual-20261011'), { recursive: true });
  mkdirSync(path.join(root, '.local/assets'));
  writeFileSync(path.join(root, '.local/assets/scene.svg'), '<svg width="1" height="1" xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(path.join(root, '.local/mobile-visual-20261011/runtime-assets.json'), JSON.stringify({ schema: 1, images }));
  return root;
}
test('ordinary and native builds never read private files or import game materials', () => {
  for (const mode of ['production', 'android', 'test', 'development']) {
    const plugin = privateVisualAssetsPlugin(mode, path.join(os.tmpdir(), 'nonexistent-nioh-private-assets'));
    assert.equal(plugin.load(plugin.resolveId('virtual:nioh-private-visual-assets')), 'export default null;');
    assert.equal(plugin.resolveId('other-module'), undefined);
  }
});
test('explicit private mode resolves existing files inside the ignored directory', () => {
  const root = fixture();
  assert.equal(readPrivateVisualAssets(root)[0][0], 'scene');
  const plugin = privateVisualAssetsPlugin('private-visual', root);
  const code = plugin.load(plugin.resolveId('virtual:nioh-private-visual-assets'));
  assert.match(code, /privatePreview:true/);
  assert.match(code, /"scene":image0/);
  assert.doesNotMatch(code, /https?:/);
});
test('color comparison reads its own fixed private manifest and leaves classic assets selected in classic mode', () => {
  const root = fixture();
  mkdirSync(path.join(root, '.local/mobile-color-20261012'));
  writeFileSync(path.join(root, '.local/assets/color.svg'), '<svg width="1" height="1" xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(path.join(root, '.local/mobile-color-20261012/runtime-assets.json'), JSON.stringify({ schema: 1, images: { scene: '.local/assets/color.svg' } }));
  const color = privateVisualAssetsPlugin('private-color', root);
  const classic = privateVisualAssetsPlugin('private-visual', root);
  const colorCode = color.load(color.resolveId('virtual:nioh-private-visual-assets'));
  const classicCode = classic.load(classic.resolveId('virtual:nioh-private-visual-assets'));
  assert.match(colorCode, /color\.svg/);
  assert.match(colorCode, /presentation:"color-scenes"/);
  assert.doesNotMatch(classicCode, /color\.svg/);
  assert.match(classicCode, /presentation:"classic"/);
});
test('rejects arbitrary manifest configuration rather than reading another private file', () => {
  assert.throws(() => readPrivateVisualAssets(fixture(), '.local/player-save.json'), /Unknown private visual manifest/);
});
test('game frame revision uses a separate fixed manifest and private presentation flag', () => {
  const root = fixture();
  mkdirSync(path.join(root, '.local/mobile-name-layout-20261012'));
  writeFileSync(path.join(root, '.local/mobile-name-layout-20261012/runtime-assets.json'), JSON.stringify({ schema: 1, images: { frameMajor: '.local/assets/scene.svg' } }));
  const plugin = privateVisualAssetsPlugin('private-layout', root);
  const code = plugin.load(plugin.resolveId('virtual:nioh-private-visual-assets'));
  assert.match(code, /gameFrames:true/);
  assert.match(code, /presentation:"color-scenes"/);
  assert.match(code, /"frameMajor":image0/);
  const classic = privateVisualAssetsPlugin('private-visual', root);
  assert.match(classic.load(classic.resolveId('virtual:nioh-private-visual-assets')), /gameFrames:false/);
});
test('role-only comparison has its own fixed manifest and does not activate in earlier modes', () => {
  const root = fixture();
  mkdirSync(path.join(root, '.local/mobile-role-light-20261012'));
  writeFileSync(path.join(root, '.local/mobile-role-light-20261012/runtime-assets.json'), JSON.stringify({ schema: 1, images: { frameMajor: '.local/assets/scene.svg' } }));
  const role = privateVisualAssetsPlugin('private-role', root);
  const code = role.load(role.resolveId('virtual:nioh-private-visual-assets'));
  assert.match(code, /roleLight:true/);
  assert.match(code, /gameFrames:true/);
  assert.match(code, /presentation:"color-scenes"/);
  const classic = privateVisualAssetsPlugin('private-visual', root);
  assert.match(classic.load(classic.resolveId('virtual:nioh-private-visual-assets')), /roleLight:false/);
});
test('all-page light preview is explicit and does not activate in the role-only mode', () => {
  const root = fixture();
  mkdirSync(path.join(root, '.local/mobile-light-all-20261012'));
  mkdirSync(path.join(root, '.local/mobile-role-light-20261012'));
  const body = JSON.stringify({ schema: 1, images: { frameMajor: '.local/assets/scene.svg' } });
  writeFileSync(path.join(root, '.local/mobile-light-all-20261012/runtime-assets.json'), body);
  writeFileSync(path.join(root, '.local/mobile-role-light-20261012/runtime-assets.json'), body);
  const all = privateVisualAssetsPlugin('private-light', root);
  assert.match(all.load(all.resolveId('virtual:nioh-private-visual-assets')), /lightAll:true/);
  const role = privateVisualAssetsPlugin('private-role', root);
  assert.match(role.load(role.resolveId('virtual:nioh-private-visual-assets')), /lightAll:false/);
});
for (const [label, images] of [
  ['absolute path', { scene: 'C:/outside/scene.png' }],
  ['parent traversal', { scene: '.local/../outside/scene.png' }],
  ['backslash path', { scene: '.local\\assets\\scene.svg' }],
  ['invalid key', { 'scene");alert(1)//': '.local/assets/scene.svg' }],
  ['missing image', { scene: '.local/assets/missing.png' }],
  ['empty manifest', {}],
]) {
  test('rejects ' + label, () => assert.throws(() => readPrivateVisualAssets(fixture(images))));
}
test('rejects empty asset files instead of silently creating a blank visual', () => {
  const root = fixture();
  writeFileSync(path.join(root, '.local/assets/scene.svg'), '');
  assert.throws(() => readPrivateVisualAssets(root), /Missing or oversized/);
});
test('rejects Windows junctions or directory links escaping the private asset root', () => {
  const root = fixture({ scene: '.local/link/scene.svg' });
  const outside = path.join(root, 'outside');
  mkdirSync(outside); writeFileSync(path.join(outside, 'scene.svg'), '<svg/>');
  symlinkSync(outside, path.join(root, '.local/link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readPrivateVisualAssets(root), /escaped/);
});
