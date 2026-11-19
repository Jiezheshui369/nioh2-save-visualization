import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { privateVisualAssetsPlugin } from './private-visual-assets.mjs';
const args=process.argv.slice(2);
if(args.length!==2 || args[0]!=="--python") throw new Error("Usage: node scripts/check-scroll-selection-contract.mjs --python PATH");
const root=fileURLToPath(new URL("../",import.meta.url));
const payload=JSON.parse(execFileSync(args[1],["-B","-m","agent.tools.synthetic_scroll_selection_contract"],{
 cwd:root,encoding:"utf8",maxBuffer:4*1024*1024,env:{...process.env,PYTHONIOENCODING:"utf-8"},
}));
assert.equal(payload.synthetic,true);
const vite=await createServer({root,configFile:false,logLevel:"error",
 plugins:[privateVisualAssetsPlugin('test',root)],
 server:{middlewareMode:true,watch:null,ws:false},appType:"custom"});
try{
 const {isSupportedSnapshot}=await vite.ssrLoadModule("/src/snapshotValidation.ts");
 const {resolveExperimentalScroll}=await vite.ssrLoadModule("/src/experimentalScrollSelection.ts");
 const {createShareSnapshot}=await vite.ssrLoadModule("/src/privacy.ts");
 const {createAssetPackage}=await vite.ssrLoadModule("/src/assetPackage.ts");
 for(const snapshot of Object.values(payload.snapshots)) {
   assert.ok(isSupportedSnapshot(snapshot));
   const shared=createShareSnapshot(snapshot);
   assert.equal(shared.experimentalScrollSelection,undefined);
   assert.ok(!JSON.stringify(createAssetPackage(snapshot,[])).includes("experimentalScrollSelection"));
 }
 assert.equal(payload.snapshots.default.experimentalScrollSelection,undefined);
 assert.equal(resolveExperimentalScroll(payload.snapshots.A).recordIndex,39);
 assert.equal(resolveExperimentalScroll(payload.snapshots.B).recordIndex,36);
 assert.equal(resolveExperimentalScroll(payload.snapshots.unknown),null);
 const forged=structuredClone(payload.snapshots.A);
 forged.experimentalScrollSelection.selectionVerified=true;
 assert.equal(isSupportedSnapshot(forged),false);
 console.log("Python -> TypeScript -> UI reference -> public export contract passed (synthetic only)");
}finally{await vite.close();}
