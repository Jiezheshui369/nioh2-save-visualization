// Run the actual Python parser and the actual TypeScript consumers on synthetic
// records. No private save inputs, network listener, browser or native device.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { privateVisualAssetsPlugin } from './private-visual-assets.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--python' || !args[1]) {
  throw new Error('Usage: node scripts/check-effect-contract.mjs --python PATH_TO_PYTHON');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const payload = JSON.parse(execFileSync(args[1], ['-m', 'agent.tools.synthetic_effect_contract'], {
  cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
}));
assert.equal(payload.synthetic, true);
const vite = await createServer({ root, configFile: false, logLevel: 'error',
  plugins: [privateVisualAssetsPlugin('test', root)],
  optimizeDeps: { noDiscovery: true, include: [], entries: [] },
  server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
try {
  const { isSupportedSnapshot } = await vite.ssrLoadModule('/src/snapshotValidation.ts');
  const { createAssetPackage, isAssetPackage } = await vite.ssrLoadModule('/src/assetPackage.ts');
  const { effectValueText, hasVerifiedEffectValue } = await vite.ssrLoadModule('/src/effectValues.ts');
  const { calculateCoverage } = await vite.ssrLoadModule('/src/coverage.ts');
  const snapshot = payload.snapshot;
  assert.equal(isSupportedSnapshot(snapshot), true, 'Python snapshot rejected by TypeScript');
  const archive = JSON.parse(JSON.stringify(createAssetPackage(snapshot, [], '2026-01-01T00:00:00Z')));
  assert.equal(isAssetPackage(archive), true, 'Exported archive rejected on read');
  for (const value of [snapshot, archive.character]) {
    for (const test of payload.cases) {
      const item = value.equipmentInventory[test.index];
      assert.deepEqual(item.effectIds, [test.effectId]);
      assert.equal(item.effectValueDetails[0].rawValue, test.rawValue);
      assert.equal(effectValueText(item, 0), test.expectedDisplay, `Display mismatch for ${test.effectId}/${test.rawValue}`);
      assert.equal(hasVerifiedEffectValue(item, 0), test.verified);
    }
    const coverage = calculateCoverage(value).find(row => row.key === 'effectMagnitudes');
    assert.equal(coverage.total, payload.cases.length);
    assert.equal(coverage.verified, payload.cases.filter(test => test.verified).length);
  }
  assert.notEqual(archive.character.equipmentInventory, snapshot.equipmentInventory);
  archive.character.equipmentInventory[0].effectValueDetails[0].rawValue = 999;
  assert.equal(snapshot.equipmentInventory[0].effectValueDetails[0].rawValue, payload.cases[0].rawValue);
  console.log(`${payload.cases.length} Python -> TypeScript -> archive effect cases passed; synthetic data only, not a device test.`);
} finally {
  await vite.close();
}
