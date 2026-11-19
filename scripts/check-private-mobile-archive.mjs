import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createPrivatePreviewServer } from './private-mobile-preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshotArg = process.argv.indexOf('--snapshot');
const sourceRelative = snapshotArg >= 0 ? process.argv[snapshotArg + 1] : process.env.NIOH_A1_SNAPSHOT;
assert.ok(typeof sourceRelative === 'string' && sourceRelative.startsWith('.local/') && !sourceRelative.includes('\\') && !sourceRelative.split('/').includes('..'), 'Supply --snapshot with an existing private .local/relative.json copy');
const source = fs.realpathSync(path.join(root, sourceRelative));
const sourceWithinPrivate = path.relative(fs.realpathSync(path.join(root, '.local')), source);
assert.ok(!sourceWithinPrivate.startsWith('..') && !path.isAbsolute(sourceWithinPrivate), 'Input must stay inside the private directory');
const sourceBytes = fs.readFileSync(source);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const beforeHash = sha256(sourceBytes);
const input = JSON.parse(sourceBytes);
const buildDirectory = process.env.NIOH_A1_BUILD_DIR || '.local/mobile-visual-20261011/web-final';
const sceneTokens = (process.env.NIOH_A1_SCENES || '3d564510|81cb1362').split('|');
const minimumScenes = Number(process.env.NIOH_A1_MIN_SCENES || 2);
assert.ok(Number.isInteger(minimumScenes) && minimumScenes > 0);
const neutralHeadings = process.env.NIOH_A1_NEUTRAL_HEADINGS === '1';
const out = path.resolve(root, process.env.NIOH_A1_OUTPUT_DIR || '.local/mobile-visual-20261011/browser-qa-A1');
const inside = path.relative(path.join(root, '.local'), out);
assert.ok(!inside.startsWith('..') && !path.isAbsolute(inside), 'Private QA output only');
fs.mkdirSync(out, { recursive: true });
const server = createPrivatePreviewServer({ root, buildDirectory }); // No API, real-time source or synthetic fixture.
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nioh-A1-archive-qa-'));
const chrome = spawn(process.env.SAVE_ASSET_REVIEW_BROWSER,
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exceptions = [], requests = [], transfers = [], screenshots = [], geometry = [];
let ws;
try {
  let port;
  for (let i=0;i<150;i++) { try { port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break; } catch {} await sleep(100); }
  assert.ok(port);
  const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  ws=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let next=0;const pending=new Map();
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);else if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);else if(m.method==='Network.loadingFinished')transfers.push(m.params);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const click=async(selector,text)=>{assert.ok(await evaluate('(()=>{const n=[...document.querySelectorAll('+JSON.stringify(selector)+')].find(n=>n.textContent.trim()==='+JSON.stringify(text)+');if(!n)return false;n.click();return true;})()'),'Missing control: '+text);await sleep(100);};
  const nav=text=>click('.nm-bottom-nav button',text);
  const waitFor=async expression=>{for(let i=0;i<400;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail('Timed out: '+expression);};
  const importFile=async file=>{const value=JSON.parse(fs.readFileSync(file,'utf8'));const expected=(value.character?.snapshotId?value.character:value).snapshotId;const doc=await call('DOM.getDocument');const node=await call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file][accept="application/json,.json"]'});assert.ok(node.nodeId);await call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[file]});await waitFor('(async()=> (await window.__qaCurrentSnapshot())?.snapshotId === '+JSON.stringify(expected)+')()');await sleep(250);assert.equal(await evaluate('document.querySelector(".nm-alert")?.textContent.includes("导入失败")||false'),false);};
  const capture=async(name,width,reset=true)=>{
    if(reset)await evaluate('document.querySelector(".nm-scroll").scrollTop=0');await sleep(150);
    const checks=await evaluate('(()=>{const nodes=[...document.querySelectorAll(".nm-scroll *")];const visible=n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0};return {viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,escaped:nodes.filter(visible).filter(n=>n.getBoundingClientRect().right>innerWidth+1).map(n=>n.className),brokenImages:[...document.images].filter(visible).filter(n=>!n.complete||!n.naturalWidth).map(n=>n.src),unknownFields:document.querySelector(".nm-scroll").textContent.match(/未解析|未知|尚未识别/g)?.length||0}})()');
    assert.equal(checks.overflow,false);assert.deepEqual(checks.escaped,[]);assert.deepEqual(checks.brokenImages,[]);
    geometry.push({name,width,...checks});const shot=await call('Page.captureScreenshot',{format:'png'});const filename=width+'-'+name+'.png';fs.writeFileSync(path.join(out,filename),Buffer.from(shot.data,'base64'));screenshots.push(filename);
  };
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  // Headless Windows cannot open an OS share sheet. Exercise the existing file
  // download fallback explicitly; do not claim native/system sharing was tested.
  await call('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"share",{configurable:true,value:undefined});Object.defineProperty(navigator,"canShare",{configurable:true,value:undefined});'});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.__qaCurrentSnapshot=()=>new Promise(resolve=>{const req=indexedDB.open("nioh2-save-companion");req.onerror=()=>resolve(null);req.onsuccess=()=>{const db=req.result;try{const tx=db.transaction("snapshots","readonly");const r=tx.objectStore("snapshots").get("latest");r.onsuccess=()=>{resolve(r.result);db.close()};r.onerror=()=>{resolve(null);db.close()}}catch{resolve(null);db.close()}}})'});
  await call('Network.setCacheDisabled',{cacheDisabled:true});
  const throttled = process.env.NIOH_A1_THROTTLE === '1';
  if(throttled)await call('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:64000});
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out});
  await call('Page.navigate',{url});await waitFor('document.querySelector(".nm-import-intro")!==null');
  assert.equal((await fetch(url+'/api/snapshots/latest')).status,404);
  const sceneFilter = 'r=>' + JSON.stringify(sceneTokens) + '.some(token=>r.name.includes(token))';
  await waitFor('performance.getEntriesByType("resource").filter(' + sceneFilter + ').length>=' + minimumScenes);
  const coldAssets = await evaluate('(()=>{const scenes=performance.getEntriesByType("resource").filter(' + sceneFilter + ');return {completeAtMs:Math.max(...scenes.map(r=>r.responseEnd)),textureEncodedBytes:scenes.reduce((sum,r)=>sum+r.encodedBodySize,0)}})()');
  if(throttled)await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await importFile(source);await nav('角色');
  assert.equal(await evaluate('(async()=> (await window.__qaCurrentSnapshot()).experimentalScrollSelection.rawSelector)()'),39);
  const counts={equipment:input.equipmentInventory.length,items:input.inventoryItems.length,scrolls:input.scrolls.length,loadout:input.currentLoadout.length};
  const firstLoad = await evaluate('({resources:performance.getEntriesByType("resource").map(r=>({name:r.name.startsWith(location.origin)?r.name.slice(location.origin.length):r.name,duration:r.duration,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize,decodedBodySize:r.decodedBodySize})),navigation:performance.getEntriesByType("navigation")[0].toJSON()})');
  for(const width of [320,375,412,430,600]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:true});
    await nav('角色');assert.equal(await evaluate('document.querySelector(".nm-level strong").textContent'),String(input.character.level));
    if(neutralHeadings){
      assert.equal(await evaluate('document.querySelector(".nm-scroll h1").textContent'),'角色资料');
      assert.equal(await evaluate('document.querySelector(".nm-level span").textContent'),'等级');
      assert.equal(await evaluate('document.querySelector(".nm-level").getBoundingClientRect().height<44'),true);
      assert.equal(await evaluate('document.querySelector(".nm-scroll").textContent.includes("无名武士")'),false);
    }
    assert.equal(await evaluate('[...document.querySelectorAll(".nm-attribute strong")].map(n=>n.textContent).join(",")'),Object.values(input.character.attributes).join(','));
    await capture('character',width);
    await nav('配装');assert.equal(await evaluate('document.querySelectorAll(".nm-loadout-list .nm-equipment-row").length'),counts.loadout+1); // Includes the honest unknown equipped-scroll link.
    if(neutralHeadings){
      assert.equal(await evaluate('document.querySelector(".nm-scroll h1").textContent'),'当前配装');
      assert.equal(await evaluate('document.querySelector(".nm-scroll").textContent.includes("深处 · 妖念手甲")'),false);
    }
    assert.ok(await evaluate('document.body.textContent.includes("装备中的绘卷尚未识别")'));
    assert.equal(await evaluate('document.querySelector(".experimental-scroll-candidate")!==null'),false);
    await capture('loadout',width);
    await evaluate('document.querySelector(".nm-loadout-list .nm-equipment-row").click()');await sleep(100);await capture('equipment-detail',width);
    await nav('仓库');assert.equal(await evaluate('document.querySelectorAll(".nm-warehouse-list .nm-equipment-row").length'),60);await capture('equipment-warehouse',width);
    await click('.nm-warehouse [role=tab]','物品');await capture('item-warehouse',width);
    await nav('配装');await click('.nm-loadout-list button','装备中的绘卷尚未识别查看绘卷库 · '+counts.scrolls+' 张›');
    assert.equal(await evaluate('document.querySelectorAll(".nm-warehouse-list .nm-equipment-row").length'),counts.scrolls);await capture('scroll-warehouse',width);
    await evaluate('document.querySelector(".nm-warehouse-list .nm-equipment-row").click()');await sleep(100);
    assert.ok(await evaluate('document.querySelector(".nm-detail").textContent.includes("不代表已装备")'));await capture('scroll-detail',width);
  }
  await nav('更多');
  await evaluate('document.querySelector(".nm-backup-options").open=true');const exportStarted=Date.now();await click('.nm-backup-options button','导出备份档案包');
  let exported, exportedName;
  for(let i=0;i<100;i++){const name=fs.readdirSync(out).find(name=>name.startsWith('nioh2-assets-')&&name.endsWith('.json')&&fs.statSync(path.join(out,name)).mtimeMs>=exportStarted);if(name){exportedName=name;exported=JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));break;}await sleep(50);}
  if(!exported){const state=await evaluate('({alert:document.querySelector(".nm-alert")?.textContent,share:typeof navigator.share,canShare:typeof navigator.canShare,text:document.body.textContent})');fs.writeFileSync(path.join(out,'export-failure.json'),JSON.stringify(state,null,2));await capture('export-failure',430);}
  assert.ok(exported,'Archive did not download; private export-failure.json contains UI diagnostics');
  assert.equal(exported.format,'nioh2-character-assets');assert.equal(exported.character.experimentalScrollSelection,undefined);
  const exportedText=JSON.stringify(exported);assert.equal(exportedText.includes('0x294070'),false);assert.equal(exportedText.includes('encodingHypothesis'),false);
  assert.equal(exported.character.equipmentInventory.length,counts.equipment);assert.equal(exported.character.inventoryItems.length,counts.items);assert.equal(exported.character.scrolls.length,counts.scrolls);
  await call('Page.navigate',{url});await waitFor('document.querySelector(".nm-attributes")!==null');await nav('配装');await capture('offline-restored-loadout',430);
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:url+'/?layout=desktop'});await waitFor('document.querySelector(".nd-shell")!==null');
  await click('.nd-nav button','04更多');await evaluate('document.querySelector(".nd-advanced").open=true');await click('button','旅途进度');
  await waitFor('document.querySelector(".experimental-scroll-panel")!==null');
  assert.equal(await evaluate('document.querySelector(".experimental-scroll-panel input").checked'),false);
  await evaluate('document.querySelector(".experimental-scroll-panel input").click()');await sleep(100);
  assert.equal(input.experimentalScrollSelection.rawSelector,39);assert.equal(input.experimentalScrollSelection.selectionVerified,false);assert.equal(input.experimentalScrollSelection.generalizationVerified,false);
  const candidateText=await evaluate('document.querySelector(".experimental-scroll-panel").textContent');
  assert.ok(candidateText.includes('实验引用的绘卷 · 候选'));assert.ok(candidateText.includes('库内槽位 40'));assert.ok(candidateText.includes('游戏构建号未知'));assert.ok(candidateText.includes('其他版本、角色、排序和未装备状态尚未验证'));
  await evaluate('document.querySelector(".experimental-scroll-panel").scrollIntoView({block:"start"})');await capture('experimental-candidate-39',1280,false);
  // This is a renamed copy solely to exercise identity changes; it is not a second real sample.
  const switched=structuredClone(input);switched.snapshotId+='-qa-identity-switch';switched.experimentalScrollSelection={...switched.experimentalScrollSelection,status:'unknown',reason:'qa-identity-only',rawSelector:null,candidateRecord:null};
  const switchedPath=path.join(out,'identity-switch-copy.json');fs.writeFileSync(switchedPath,JSON.stringify(switched));
  await importFile(switchedPath);await click('.nd-nav button','04更多');await evaluate('document.querySelector(".nd-advanced").open=true');await click('button','旅途进度');
  assert.equal(await evaluate('document.querySelector(".experimental-scroll-panel input").checked'),false);
  assert.equal(await evaluate('document.querySelector(".experimental-scroll-candidate")!==null'),false);
  await importFile(source);await click('.nd-nav button','04更多');await evaluate('document.querySelector(".nd-advanced").open=true');await click('button','旅途进度');
  assert.equal(await evaluate('document.querySelector(".experimental-scroll-panel input").checked'),false);
  await call('Page.navigate',{url});await waitFor('document.querySelector(".nm-attributes")!==null');
  await call('Emulation.setDeviceMetricsOverride',{width:430,height:915,deviceScaleFactor:1,mobile:true});
  const exportedPath=path.join(out,exportedName);
  await nav('更多');await importFile(exportedPath);await nav('角色');await capture('reimport-exported-archive',430);
  assert.equal(await evaluate('document.querySelector(".nm-level strong").textContent'),String(input.character.level));
  assert.equal(sha256(fs.readFileSync(source)),beforeHash,'Authorized input changed');
  assert.deepEqual(exceptions,[]);const external=requests.filter(u=>/^https?:/.test(u)&&!u.startsWith(url+'/'));assert.deepEqual(external,[]);
  const report={existingPrivateCopyOnly:true,newParsingOrCloudFetch:false,realTimeSourceRead:false,temporaryProfile:true,privatePort:server.address().port,buildDirectory,sourceSha256:beforeHash,sourceUnchanged:true,counts,rawSnapshotImport:true,exportedArchiveReimport:true,browserFileDownloadFallbackExplicit:true,nativeSystemShareValidated:false,offlineRestore:true,experimental:{rawSelector:39,recordIndex:39,displayedOneBasedSlot:40,selectionVerified:false,generalizationVerified:false,defaultOff:true,identitySwitchResets:true,mobileOfficialEquippedScrollRemainsUnknown:true,desktopResearchPanelOnly:true,exportedMetadataExcluded:true},geometry,screenshots,firstLoad,coldAssets,networkEmulation:throttled?{latencyMs:150,downloadBytesPerSecond:200000,realPhoneBenchmark:false}:null,transfers,runtimeExceptions:exceptions,externalNetworkRequests:external};
  if(neutralHeadings)report.mobileNeutralHeadings={character:true,loadout:true,compactActualLevel:true,widths:[320,375,412,430,600]};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,screenshots:screenshots.length,counts,report:path.join(out,'report.json')}));
  await call('Browser.close').catch(()=>{});
}catch(error){console.error(error);process.exitCode=1;}
finally{ws?.close();chrome.kill();server.close();assert.equal(sha256(fs.readFileSync(source)),beforeHash);}
