import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPrivatePreviewServer } from './private-mobile-preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sceneTokens = (process.env.NIOH_FAILURE_SCENES ?? '3d564510|81cb1362').split('|');
const scenePattern = new RegExp(sceneTokens.join('|'));
const expectedFallback = process.env.NIOH_FAILURE_FALLBACK_RGB ?? 'rgb(8, 9, 9)';
const minimumHeld = Number(process.env.NIOH_FAILURE_MIN_HELD ?? 2);
assert.ok(Number.isInteger(minimumHeld) && minimumHeld >= 1);
const out = path.join(root, process.env.NIOH_FAILURE_OUTPUT_DIR ?? '.local/mobile-visual-20261011/browser-qa-failures-stable');
fs.mkdirSync(out, { recursive: true });
const server = createPrivatePreviewServer({ root, demo: true, buildDirectory: process.env.NIOH_FAILURE_BUILD_DIR ?? '.local/mobile-visual-20261011/web-stable' });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nioh-background-qa-'));
const chrome = spawn(process.env.SAVE_ASSET_REVIEW_BROWSER,
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
let failAllImages = false;
const failedImages = [];
const paused = new Map(), exceptions = [], requests = [], screenshots = [], states = [];
try {
  let port;
  for(let i=0;i<150;i++){try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{}await sleep(100);}
  assert.ok(port);
  const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});let next=0;const pending=new Map();
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Fetch.requestPaused'){if(failAllImages){failedImages.push(m.params.request.url.slice(url.length));call('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'Failed'}).catch(error=>exceptions.push(String(error)));}else paused.set(m.params.requestId,m.params.request.url);}else if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);else if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const click=async(selector,text)=>{assert.ok(await evaluate('(()=>{const n=[...document.querySelectorAll('+JSON.stringify(selector)+')].find(n=>n.textContent.trim()==='+JSON.stringify(text)+');if(!n)return false;n.click();return true;})()'));await sleep(100);};
  const capture=async name=>{
    await evaluate('document.querySelector(".nm-scroll").scrollTop=0');await sleep(120);
    const state=await evaluate('(()=>{const shell=document.querySelector(".nm-shell");const heading=document.querySelector(".nm-scroll h1,.nm-scroll h2");return {shellColor:getComputedStyle(shell).backgroundColor,textColor:getComputedStyle(heading).color,contentVisible:!!heading&&heading.getBoundingClientRect().height>0,overflow:document.documentElement.scrollWidth>innerWidth,brokenContentImages:[...document.images].filter(n=>n.getBoundingClientRect().height>0).filter(n=>!n.complete||!n.naturalWidth).length,textureCompleted:performance.getEntriesByType("resource").filter(r=>new RegExp(' + JSON.stringify(scenePattern.source) + ').test(r.name)).length}})()');
    assert.equal(state.shellColor,expectedFallback);assert.equal(state.contentVisible,true);assert.equal(state.overflow,false);assert.equal(state.brokenContentImages,0);
    const luminance=rgb=>{const c=rgb.match(/[\d.]+/g).slice(0,3).map(x=>{const v=Number(x)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722};
    state.fallbackHeadingContrast=(luminance(state.textColor)+.05)/(luminance(state.shellColor)+.05);assert.ok(state.fallbackHeadingContrast>=4.5);
    const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));screenshots.push(name+'.png');states.push({name,...state});
  };
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
  await call('Emulation.setDeviceMetricsOverride',{width:375,height:915,deviceScaleFactor:1,mobile:true});
  await call('Fetch.enable',{patterns:[...sceneTokens.map(token=>({urlPattern:'*'+token+'*',requestStage:'Request'})),{urlPattern:'*36b1dbd5*',requestStage:'Request'},{urlPattern:'*561c29ce*',requestStage:'Request'}]});
  await call('Page.navigate',{url});
  for(let i=0;i<100&&!await evaluate('document.querySelector(".nm-attributes")!==null');i++)await sleep(50);
  assert.ok(await evaluate('document.querySelector(".nm-attributes")!==null'));
  assert.ok(paused.size>=minimumHeld,'Backgrounds were not independently held');
  const contentReadyAtMs=await evaluate('performance.now()');
  await capture('character-backgrounds-delayed');
  assert.equal(states[0].textureCompleted,0);
  await click('.nm-bottom-nav button','配装');await capture('loadout-backgrounds-delayed');
  await evaluate('document.querySelector(".nm-loadout-list .nm-equipment-row").click()');await sleep(100);await capture('detail-backgrounds-delayed');
  await click('.nm-bottom-nav button','仓库');await capture('warehouse-backgrounds-delayed');
  if(process.argv.includes('--scroll-failure')) {
    await click('.nm-bottom-nav button','配装');
    await evaluate('[...document.querySelectorAll(".nm-loadout-list button")].find(n=>n.textContent.includes("装备中的绘卷尚未识别")).click()'); await sleep(100);
    await evaluate('document.querySelector(".nm-warehouse-list .nm-equipment-row").click()');await sleep(100);await capture('scroll-backgrounds-delayed');
  }
  const failed=[];
  for(const [requestId,requestUrl] of paused){await call('Fetch.failRequest',{requestId,errorReason:'Failed'});failed.push(requestUrl.slice(url.length));}
  await call('Fetch.disable');await sleep(250);
  await click('.nm-bottom-nav button','角色');await capture('character-backgrounds-failed');
  if(process.argv.includes('--scroll-failure')) {
    await click('.nm-bottom-nav button','配装');
    await evaluate('[...document.querySelectorAll(".nm-loadout-list button")].find(n=>n.textContent.includes("装备中的绘卷尚未识别")).click()');await sleep(100);
    await evaluate('document.querySelector(".nm-warehouse-list .nm-equipment-row").click()');await sleep(100);await capture('scroll-backgrounds-failed');
  }
  await click('.nm-bottom-nav button','仓库');await click('.nm-filter-bar button','类别：全部');await capture('filters-backgrounds-failed');
  assert.equal(await evaluate('document.querySelector(".nm-filter .nm-back").getBoundingClientRect().width>=44'),true);
  await click('.nm-filter .nm-back','关闭 ×');assert.equal(await evaluate('document.querySelector(".nm-warehouse input")!==null'),true);
  failAllImages = true;
  await call('Storage.clearDataForOrigin', {origin:url,storageTypes:'all'});
  await call('Fetch.enable', {patterns:[{urlPattern:'*',resourceType:'Image',requestStage:'Request'}]});
  await call('Page.navigate', {url});
  for(let i=0;i<100&&!await evaluate('document.querySelector(".nm-attributes")!==null');i++)await sleep(50);
  await sleep(500); await capture('character-all-images-failed');
  if(process.argv.includes('--frame-failure')) {
    assert.ok(await evaluate('document.querySelector(".nm-game-frames")!==null'));
    await evaluate('(()=>{const s=document.createElement("style");s.textContent=".nm-game-frames{--nm-frameMajor:url(/__qa-missing-frame-major.webp)!important;--nm-frameMinor:url(/__qa-missing-frame-minor.webp)!important}";document.head.append(s)})()');
    await sleep(250);await capture('character-frame-images-failed');
    const borders=await evaluate('[".nm-attributes",".nm-resources > div",".nm-character-identity"].map(selector=>{const s=getComputedStyle(document.querySelector(selector));return {selector,style:s.borderTopStyle,width:s.borderTopWidth,color:s.borderTopColor,source:s.borderImageSource,slice:s.borderImageSlice}})');
    fs.writeFileSync(path.join(out,'frame-fallback-styles.json'),JSON.stringify(borders,null,2));
    assert.ok(borders.every(s=>s.style==='solid'&&s.width==='1px'&&s.source.includes('__qa-missing-frame-')));
    assert.deepEqual(borders.map(s=>s.slice),['32','16','16']);
    states[states.length-1].frameFallback=borders;
  }
  await click('.nm-bottom-nav button','配装');await sleep(300);await capture('loadout-all-images-failed');
  assert.ok(await evaluate('document.querySelectorAll(".nm-loadout-list .nm-icon-text").length>0'));
  await evaluate('document.querySelector(".nm-loadout-list .nm-equipment-row").click()');await sleep(150);await capture('detail-all-images-failed');
  await click('.nm-bottom-nav button','仓库');await sleep(300);await capture('warehouse-all-images-failed');
  await click('.nm-filter-bar button','类别：全部');await sleep(300);await capture('filters-all-images-failed');
  await click('.nm-filter-grid button','手甲');await click('.nm-filter button','应用筛选');
  assert.ok(await evaluate('document.querySelectorAll(".nm-warehouse-list .nm-equipment-row").length>0'));
  await click('.nm-bottom-nav button','仓库');await click('.nm-warehouse [role=tab]','物品');await sleep(300);await capture('items-all-images-failed');
  assert.ok(failedImages.length>5);
  await call('Fetch.disable');
  assert.deepEqual(exceptions,[]);assert.deepEqual(requests.filter(u=>/^https?:/.test(u)&&!u.startsWith(url+'/')),[]);
  const report={syntheticOnly:true,isolatedTemporaryProfile:true,privatePort:server.address().port,contentReadyAtMs,backgroundsHeldUntilAfterNavigation:true,simulatedFailedTextureRequests:failed,simulatedFailedImageRequests:failedImages,allImageFailuresPreserveActions:true,contentNavigationSurvivesFailure:true,states,screenshots,runtimeExceptions:exceptions,externalRequests:[],realPhonePerformanceTest:false};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,screenshots:screenshots.length,contentReadyAtMs,report:path.join(out,'report.json')}));
  await call('Browser.close').catch(()=>{});
}catch(error){console.error(error);process.exitCode=1;}
finally{ws?.close();chrome.kill();server.close();}
