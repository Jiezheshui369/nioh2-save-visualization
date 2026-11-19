import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPrivatePreviewServer } from './private-mobile-preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, '.local/mobile-color-20261012/desktop-qa');
fs.mkdirSync(out, { recursive: true });
const builds = ['web-stable', 'web-color'];
const servers = builds.map(build => createPrivatePreviewServer({ root, demo: true, buildDirectory: '.local/mobile-visual-20261011/' + build }));
for (const server of servers) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const urls = servers.map(server => 'http://127.0.0.1:' + server.address().port);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nioh-desktop-parity-'));
const chrome = spawn(process.env.SAVE_ASSET_REVIEW_BROWSER, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws; const errors = [], requests = [], states = [];
try {
  let port;
  for (let i=0;i<150;i++) {try {port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{}await sleep(100);}
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {ws.onopen=resolve;ws.onerror=reject;});
  let next=0;const pending=new Map();
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);else if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  for(let index=0;index<urls.length;index++) {
    await call('Page.navigate',{url:urls[index]+'/?layout=desktop'});
    for(let i=0;i<100&&!await evaluate('document.querySelector(".nd-shell .nm-attributes")!==null');i++)await sleep(50);
    assert.ok(await evaluate('document.querySelector(".nd-shell .nm-attributes")!==null'));
    const views=[];
    for(const [name,label] of [['character','角色'],['loadout','配装'],['warehouse','仓库'],['more','更多']]) {
      await evaluate('[...document.querySelectorAll(".nd-nav button")].find(n=>n.textContent.includes('+JSON.stringify(label)+')).click()');await sleep(300);
      for(let i=0;i<100&&!await evaluate('[...document.images].every(i=>i.complete)');i++)await sleep(50);
      const state=await evaluate(`(()=>{const shell=document.querySelector('.nd-shell');return {colorClassApplied:shell.classList.contains('nm-color-scenes'),elements:[shell,...shell.querySelectorAll('*')].filter(n=>{const b=n.getBoundingClientRect();return b.width>0&&b.height>0&&b.top<innerHeight&&b.bottom>0}).map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {tag:n.tagName,className:n.className,color:s.color,background:s.backgroundColor,font:s.fontFamily,fontSize:s.fontSize,border:s.borderColor,x:r.x,y:r.y,width:r.width,height:r.height}})}})()`);
      assert.equal(state.colorClassApplied,false);
      const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,builds[index]+'-'+name+'.png'),Buffer.from(shot.data,'base64'));
      views.push({name,...state});
    }
    states.push({build:builds[index],views});
  }
  fs.writeFileSync(path.join(out,'DOM_PARITY_REPORT.json'),JSON.stringify({syntheticOnly:true,states,runtimeExceptions:errors,externalRequests:requests.filter(u=>/^https?:/.test(u)&&!urls.some(origin=>u.startsWith(origin+'/'))),newSceneRequests:requests.filter(u=>/2601_Loading|1724_torii|3476_kyoten/.test(u))},null,2));
  for(let i=0;i<states[0].views.length;i++)assert.deepEqual(states[0].views[i],states[1].views[i],'Desktop changed: '+states[0].views[i].name);
  assert.deepEqual(errors,[]);assert.equal(requests.filter(u=>/2601_Loading|1724_torii|3476_kyoten/.test(u)).length,0);
  console.log(JSON.stringify({passed:true,desktopViews:4,computedStyleAndGeometryIdentical:true,newScenesRequested:false}));
  await call('Browser.close').catch(()=>{});
}catch(error){console.error(error);process.exitCode=1;}
finally{ws?.close();chrome.kill();for(const server of servers)server.close();}
