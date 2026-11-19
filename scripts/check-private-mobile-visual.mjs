import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createPrivatePreviewServer } from './private-mobile-preview.mjs';
import { createPrivateMobileFixture } from './private-mobile-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(root, process.env.NIOH_QA_OUTPUT_DIR || '.local/mobile-visual-20261011/browser-qa');
const privateRelative = path.relative(path.join(root, '.local'), out);
if (privateRelative.startsWith('..') || path.isAbsolute(privateRelative)) throw new Error('QA output must remain private');
fs.mkdirSync(out, { recursive: true });
const snapshot = createPrivateMobileFixture();
let empty = false;
const server = createPrivatePreviewServer({ root, demo: true, snapshot: () => empty ? null : snapshot, buildDirectory: process.env.NIOH_QA_BUILD_DIR });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nioh-mobile-visual-qa-'));
const chrome = spawn(process.env.NIOH_QA_CHROME || process.env.SAVE_ASSET_REVIEW_BROWSER,
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-default-apps', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws; const exceptions = []; const requests = []; const screens = []; const checks = []; const pausedRequests = []; let largeWarehouse = null; const regressions = {};
try {
  let port;
  for (let i = 0; i < 150; i++) {
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break; } catch {}
    await sleep(100);
  }
  assert.ok(port, 'Installed Chrome did not start with an isolated temporary profile');
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = tabs.find(tab => tab.type === 'page'); assert.ok(page);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0; const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const current = pending.get(message.id); pending.delete(message.id);
      message.error ? current.reject(message.error) : current.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    else if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    else if (message.method === 'Fetch.requestPaused') pausedRequests.push(message.params.requestId);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const click = async (selector, text) => {
    assert.ok(await evaluate('(() => {const n=Array.from(document.querySelectorAll(' + JSON.stringify(selector) + ')).find(n=>n.textContent.trim()===' + JSON.stringify(text) + ');if(!n)return false;n.click();return true;})()'), 'Missing interactive control: ' + text);
    await sleep(80);
  };
  const nav = text => click('.nm-bottom-nav button', text);
  const morePage = async title => {
    assert.ok(await evaluate('(() => {const b=Array.from(document.querySelectorAll(".nm-more-menu button")).find(b=>b.textContent.startsWith(' + JSON.stringify(title) + '));if(!b)return false;b.click();return true;})()'));
    await sleep(80);
  };
  const capture = async (name, width, preserveScroll = false) => {
    if (!preserveScroll) await evaluate('document.querySelector(".nm-scroll").scrollTo(0,0)');
    await sleep(100);
    const geometry = await evaluate('(() => {const visible=n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0};return {viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,brokenImages:Array.from(document.images).filter(visible).filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src),smallButtons:Array.from(document.querySelectorAll(".nm-shell button")).filter(visible).filter(n=>n.getBoundingClientRect().height<43.5).map(n=>n.textContent),images:Array.from(document.images).filter(visible).map(i=>({src:i.src.startsWith("data:")?"embedded-svg":i.src,width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight})),colorPresentation:document.querySelector(".nm-shell").classList.contains("nm-color-scenes"),backgroundDeferred:document.querySelector(".nm-shell").matches(".nm-color-scenes.nm-loading-shell"),background: getComputedStyle(document.querySelector(".nm-shell"),"::before").backgroundImage};})()');
    assert.equal(geometry.overflow, false, name + ' horizontal page overflow at ' + width);
    assert.deepEqual(geometry.brokenImages, [], name + ' missing images');
    assert.deepEqual(geometry.smallButtons, [], name + ' undersized button height');
    if (geometry.backgroundDeferred) { assert.equal(name,'loading'); assert.equal(geometry.background,'none'); }
    else assert.ok(geometry.background.includes('/assets/'), name + ' missing original scene background');
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const filename = width + '-' + name + '.png';
    fs.writeFileSync(path.join(out, filename), Buffer.from(shot.data, 'base64'));
    screens.push(filename); checks.push({ name, width, geometry });
    if (geometry.colorPresentation && name==='character' && !regressions.initialColorSceneRequests) {
      regressions.initialColorSceneRequests=requests.filter(value=>/2601_Loading_bg_s721_01|1724_torii_2DBG|3476_kyoten_yashiro_2DBG_Twilight/.test(value));
      assert.equal(regressions.initialColorSceneRequests.length,1);
      assert.ok(regressions.initialColorSceneRequests[0].includes('2601_Loading_bg_s721_01'));
    }
    if (process.argv.includes('--contrast')) {
      const texts = await evaluate(`(() => {
        const shell = document.querySelector('.nm-shell'); const result = [];
        const walker = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT);
        while(walker.nextNode()) {
          const node = walker.currentNode, parent = node.parentElement;
          if(!node.textContent.trim() || !parent || parent.closest('[disabled],script,style')) continue;
          const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
          if(style.visibility === 'hidden' || bounds.width < 2 || bounds.height < 2) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          for(const box of range.getClientRects()) {
            if(box.width < 2 || box.height < 2 || box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) continue;
            const scroller=parent.closest('.nm-scroll');const clip=scroller?.getBoundingClientRect();
            const left=Math.max(0,box.left,clip?.left??0),top=Math.max(0,box.top,clip?.top??0);
            const right=Math.min(innerWidth,box.right,clip?.right??innerWidth),bottom=Math.min(innerHeight,box.bottom,clip?.bottom??innerHeight);
            if(right-left<2 || bottom-top<2)continue;
            result.push({text:node.textContent.trim(),className:parent.className,color:style.color,fontSize:parseFloat(style.fontSize),fontWeight:parseInt(style.fontWeight)||400,box:{x:left,y:top,width:right-left,height:bottom-top}});
          }
        }
        for(const input of shell.querySelectorAll('input[placeholder],textarea[placeholder]')) {
          if(input.value || input.disabled)continue; const box=input.getBoundingClientRect();
          if(box.width<2 || box.height<2 || box.top>=innerHeight || box.bottom<=0)continue;
          const normal=getComputedStyle(input),style=getComputedStyle(input,'::placeholder'),clip=input.closest('.nm-scroll')?.getBoundingClientRect();
          const left=Math.max(0,box.left+parseFloat(normal.paddingLeft)+2,clip?.left??0),top=Math.max(0,box.top+parseFloat(normal.paddingTop)+2,clip?.top??0);
          const right=Math.min(innerWidth,box.right-parseFloat(normal.paddingRight)-2,clip?.right??innerWidth),bottom=Math.min(innerHeight,box.bottom-parseFloat(normal.paddingBottom)-2,clip?.bottom??innerHeight);
          if(right-left<2||bottom-top<2)continue;
          result.push({text:input.placeholder,className:input.className+'::placeholder',color:style.color,fontSize:parseFloat(style.fontSize),fontWeight:parseInt(style.fontWeight)||400,box:{x:left,y:top,width:right-left,height:bottom-top}});
        }
        return result;
      })()`);
      fs.writeFileSync(path.join(out, width+'-'+name+'.text.json'), JSON.stringify(texts,null,2));
      await evaluate(`(() => {const style=document.createElement('style');style.id='qa-hide-text';style.textContent='.nm-shell,.nm-shell * { -webkit-text-fill-color:transparent !important; text-shadow:none !important; caret-color:transparent !important; }';document.head.appendChild(style);})()`);
      const background = await call('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
      fs.writeFileSync(path.join(out,width+'-'+name+'.text-background.png'),Buffer.from(background.data,'base64'));
      await evaluate("document.getElementById('qa-hide-text').remove()");
    }
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  const widths = process.argv.includes('--final') ? [320, 375, 412, 430, 600, 768, 932] : [320, 375, 412, 430];
  for (const width of widths) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 915, deviceScaleFactor: 1, mobile: true });
    await call('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 100; i++) { ready = await evaluate('document.querySelector(".nm-attributes")!==null'); if (ready) break; await sleep(100); }
    assert.ok(ready, 'Synthetic validated snapshot did not load');
    assert.ok(await evaluate('document.body.textContent.includes("示例数据 · 非存档读取")'));
    assert.equal(await evaluate('document.body.textContent.includes("实验引用的绘卷 · 候选")'), false);
    await capture('character', width);
    await nav('配装'); await capture('loadout', width);
    await evaluate('document.querySelector(".nm-loadout-list .nm-equipment-row").click()'); await sleep(80);
    assert.ok(await evaluate('document.querySelector(".nm-detail").textContent.includes("数值未解析")'));
    await capture('equipment-detail', width);
    await click('.nm-detail-actions button', '返回配装');
    await nav('仓库'); await capture('equipment-warehouse', width);
    await click('.nm-filter-bar button', '类别：全部');
    await capture('filters', width);
    await click('.nm-filter-grid:first-of-type button', '大炮');
    await click('.nm-filter .nm-two-buttons button', '应用筛选');
    assert.ok(await evaluate('document.querySelector(".nm-warehouse-list").textContent.includes("示例大炮")'));
    await evaluate('document.querySelector(".nm-warehouse-list .nm-equipment-row").click()'); await sleep(80);
    await click('.nm-detail-actions button', '返回仓库');
    assert.ok(await evaluate('document.querySelector(".nm-filter-bar").textContent.includes("类别：大炮")'));
    await click('.nm-warehouse [role="tab"]', '物品');
    await capture('item-warehouse', width);
    assert.ok(await evaluate('Array.from(document.querySelectorAll(".nm-inventory-row img")).some(i=>i.src.includes("SHINGIKU"))'));
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".nm-inventory-row")).find(n=>n.textContent.includes("仙药")).querySelector("img")===null'), true);
    await nav('配装');
    await evaluate('Array.from(document.querySelectorAll(".nm-loadout-list button")).find(n=>n.textContent.includes("装备中的绘卷尚未识别")).click()'); await sleep(80);
    await evaluate('document.querySelector(".nm-warehouse-list .nm-equipment-row").click()'); await sleep(80);
    assert.ok(await evaluate('document.querySelector(".nm-detail").textContent.includes("不代表已装备")'));
    await capture('scroll-detail', width);
    await nav('更多'); await capture('import-sync', width);
    assert.ok(await evaluate('document.body.textContent.includes("扫描电脑二维码")'));
    if (process.argv.includes('--more')) {
      await morePage('档案管理与设置'); await capture('settings', width);
      assert.equal(await evaluate('document.querySelector(".sync-panel")===null'), true);
      await click('.nm-more-pages button', '‹ 返回更多');
      await morePage('数据来源说明'); await capture('data-source', width);
      assert.ok(await evaluate('document.querySelector(".nm-more-pages").textContent.includes("不是从你的存档读取的结果")'));
      await click('.nm-more-pages button', '‹ 返回更多');
      await morePage('关于 Nioh'); await capture('about', width);
      assert.ok(await evaluate('document.querySelector(".nm-more-pages").textContent.includes("账号服务器同步尚未接入")'));
      await click('.nm-more-pages button', '‹ 返回更多');
    }
  }
  if (process.argv.includes('--final')) {
    const originalAttributes = snapshot.character.attributes;
    snapshot.character.attributes = Object.fromEntries(Object.keys(originalAttributes).map(key => [key, 4294967295]));
    await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 915, deviceScaleFactor: 1, mobile: true });
    await call('Storage.clearDataForOrigin', { origin: url, storageTypes: 'indexeddb,local_storage,cache_storage' });
    await call('Page.navigate', { url });
    for (let i = 0; i < 100 && !await evaluate('document.querySelector(".nm-attributes")!==null'); i++) await sleep(50);
    regressions.uint32 = await evaluate('(() => {const nodes=[...document.querySelectorAll(".nm-attribute strong")];return {values:nodes.map(n=>n.textContent),overflow:nodes.filter(n=>n.scrollWidth>n.clientWidth+1||n.getBoundingClientRect().right>innerWidth).length}})()');
    assert.equal(regressions.uint32.values.length, 8); assert.ok(regressions.uint32.values.every(value => value === '4294967295')); assert.equal(regressions.uint32.overflow, 0);
    await capture('uint32-character', 320);
    await nav('配装');
    await evaluate('document.querySelector(' + JSON.stringify('.nm-topbar [aria-label="搜索仓库"]') + ').click()'); await sleep(80);
    assert.equal(await evaluate('document.activeElement===document.querySelector(".nm-warehouse input")'), true);
    await nav('仓库'); await click('.nm-filter-bar button', '类别：全部');
    const closeSize = await evaluate('(() => {const r=document.querySelector(".nm-filter .nm-back").getBoundingClientRect();return {width:r.width,height:r.height,focused:document.activeElement===document.querySelector(".nm-filter .nm-back")}})()');
    assert.ok(closeSize.width >= 44 && closeSize.height >= 44 && closeSize.focused);
    await nav('仓库'); assert.equal(await evaluate('document.querySelector(".nm-filter")===null && document.querySelector(".nm-topbar strong").textContent==="Nioh · 仓库"'), true);
    await click('.nm-filter-bar button', '稀有度：全部');
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(80);
    assert.equal(await evaluate('document.activeElement.textContent'), '稀有度：全部');
    await evaluate('document.querySelector("[role=tab]").focus()');
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await sleep(80);
    assert.equal(await evaluate('document.activeElement.textContent'), '物品');
    regressions.filters = { closeSize, repeatedWarehouseResets: true, escapeRestoresFocus: true, keyboardTabs: true };
    await call('Emulation.setDeviceMetricsOverride', { width: 600, height: 915, deviceScaleFactor: 1, mobile: true });
    await nav('配装');
    await click('.nm-shell button', '我的配装册');
    await sleep(150);
    await click('.build-capture-form button', '收藏当前配装'); await sleep(200);
    const library = await evaluate('(() => {const article=document.querySelector(".saved-build-detail");const h=article.querySelector("h2");const style=getComputedStyle(h);return {foreground:style.color,background:getComputedStyle(article).backgroundColor,overflow:[...document.querySelectorAll(".nm-legacy-builds *")].filter(n=>n.getBoundingClientRect().width&&n.getBoundingClientRect().right>innerWidth+1).map(n=>n.className),actions:[...article.querySelectorAll(".saved-build-actions button")].map(n=>({text:n.textContent,height:n.getBoundingClientRect().height})),attributeOverflow:[...article.querySelectorAll(".saved-build-stats strong")].some(n=>n.scrollWidth>n.clientWidth+1)}})()');
    const luminance = rgb => {const components=rgb.match(/[\d.]+/g).slice(0,3).map(value=>{const c=Number(value)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4});return components[0]*.2126+components[1]*.7152+components[2]*.0722};
    const l1=luminance(library.foreground),l2=luminance(library.background);library.contrast=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
    assert.ok(library.contrast >= 4.5); assert.deepEqual(library.overflow, []); assert.ok(library.actions.every(action=>action.height>=44)); assert.equal(library.attributeOverflow, false);
    regressions.savedBuild = library;
    await capture('build-library-600', 600);
    await evaluate('document.querySelector(".saved-build-detail h2").scrollIntoView({block:"center"})'); await sleep(80);
    const titleShot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'600-saved-build-title.png'),Buffer.from(titleShot.data,'base64'));screens.push('600-saved-build-title.png');
    await evaluate('document.querySelector(".nm-scroll").scrollTop=document.querySelector(".nm-scroll").scrollHeight'); await sleep(80);
    const shot = await call('Page.captureScreenshot', { format: 'png' }); const filename='600-build-actions.png';fs.writeFileSync(path.join(out,filename),Buffer.from(shot.data,'base64'));screens.push(filename);
    if (process.argv.includes('--contrast')) {
      const inputSelector='input[aria-label="配装名称"]';
      await evaluate(`(() => {const input=document.querySelector(${JSON.stringify(inputSelector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'合成列表对比度回归');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(100);
      await evaluate('document.querySelector(".build-capture-form button").click()');await sleep(1100);
      regressions.buildList=[];
      for(const size of [{width:375,height:667},{width:768,height:1024},{width:932,height:430}]) {
        await call('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:true});await sleep(1100);
        await evaluate('document.querySelector(".build-card-list > header").scrollIntoView({block:"start"})');await sleep(150);
        const point=await evaluate('(()=>{const b=document.querySelector(".build-card-list > button:not(.active)")??document.querySelector(".build-card-list > button.active");const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
        await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await sleep(150);
        const styles=await evaluate('(()=>{const list=document.querySelector(".build-card-list"),header=list.querySelector("header"),active=list.querySelector("button.active"),hovered=list.querySelector("button:hover");return {lightAll:!!document.querySelector(".nm-light-all"),pane:getComputedStyle(list).backgroundColor,header:getComputedStyle(header).backgroundColor,active:getComputedStyle(active).backgroundColor,small:getComputedStyle(active.querySelector("small")).color,hovered:hovered?getComputedStyle(hovered).backgroundColor:null,hoveredActive:hovered?.classList.contains("active")??false,pageStackOpacity:getComputedStyle(document.querySelector(".page-stack")).opacity}})()');
        if(styles.lightAll){
          assert.equal(styles.pane,'rgba(44, 32, 33, 0.78)');assert.equal(styles.header,'rgba(0, 0, 0, 0)');assert.equal(styles.active,'rgba(239, 129, 94, 0.12)');assert.equal(styles.small,'rgb(241, 227, 201)');if(styles.hovered)assert.equal(styles.hovered,styles.hoveredActive?styles.active:'rgba(0, 0, 0, 0)');
        }else{assert.equal(styles.header,'rgba(44, 32, 33, 0.94)');assert.equal(styles.active,styles.header);if(styles.hovered)assert.equal(styles.hovered,styles.header);}
        assert.equal(styles.pageStackOpacity,'1');
        await capture('build-list-selected',size.width,true);regressions.buildList.push({...size,styles});
      }
      await call('Emulation.setDeviceMetricsOverride',{width:600,height:915,deviceScaleFactor:1,mobile:true});
    }

    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    regressions.reducedMotionRequested = true;
    snapshot.character.attributes = originalAttributes;
    await call('Emulation.setDeviceMetricsOverride', { width: 430, height: 915, deviceScaleFactor: 1, mobile: true });
  }
  if (process.argv.includes('--more')) {
    const example = snapshot.equipmentInventory[0];
    snapshot.equipmentInventory = Array.from({ length: 10000 }, (_, i) => ({ ...example, recordIndex: i + 10000, id: 'synthetic-stress-' + i, nameZh: '压力测试装备' + i }));
    snapshot.currentLoadout = []; snapshot.scrolls = [];
    snapshot.inventorySummary.equipmentRecords = 10000;
    await call('Storage.clearDataForOrigin', { origin: url, storageTypes: 'indexeddb,local_storage,cache_storage' });
    await call('Page.navigate', { url });
    for (let i = 0; i < 100 && !await evaluate('document.querySelector(".nm-attributes")!==null'); i++) await sleep(50);
    await nav('仓库');
    assert.equal(await evaluate('document.querySelectorAll(".nm-warehouse-list .nm-equipment-row").length'), 60);
    const before = await call('Memory.getDOMCounters');
    const timing = await evaluate('(async () => {const start=performance.now(); const n=document.querySelector(".nm-scroll"); for(let i=0;i<12;i++){n.scrollTop=i*150;await new Promise(requestAnimationFrame)}return performance.now()-start})()');
    const savedScroll = await evaluate('document.querySelector(".nm-scroll").scrollTop');
    await evaluate('document.querySelector(".nm-warehouse-list .nm-equipment-row").click()'); await sleep(80);
    await click('.nm-detail-actions button', '返回仓库');
    assert.equal(await evaluate('document.querySelector(".nm-scroll").scrollTop'), savedScroll);
    const queryStart = Date.now();
    await evaluate('(() => {const n=document.querySelector(".nm-warehouse input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(n,"压力测试装备9999");n.dispatchEvent(new Event("input",{bubbles:true}));})()');
    for (let i = 0; i < 50 && !await evaluate('document.querySelectorAll(".nm-warehouse-list .nm-equipment-row").length===1'); i++) await sleep(20);
    assert.equal(await evaluate('document.querySelectorAll(".nm-warehouse-list .nm-equipment-row").length'), 1);
    largeWarehouse = { records: 10000, initialRenderedRows: 60, domCounters: before, twelveAnimationFramesMs: timing, queryObservedMs: Date.now() - queryStart, detailRestoresScroll: true, headlessSyntheticOnly: true };
    await capture('large-warehouse-search', 430);
  }
  // Clear only this isolated browser's synthetic cache; inspect the empty first-run page.
  await evaluate('localStorage.clear(); sessionStorage.clear();');
  await call('Storage.clearDataForOrigin', { origin: url, storageTypes: 'indexeddb,local_storage,cache_storage' });
  snapshot.currentLoadout = []; snapshot.equipmentInventory = []; snapshot.inventoryItems = []; snapshot.scrolls = [];
  snapshot.characterStatus = undefined;
  await call('Page.navigate', { url }); await sleep(500);
  await nav('仓库');
  assert.ok(await evaluate('document.body.textContent.includes("没有符合条件的记录")'));
  await capture('empty-warehouse', 430);
  if (process.argv.includes('--more')) {
    await nav('配装'); await capture('empty-loadout', 430);
    await nav('更多');
    const invalidFile = path.join(out, 'invalid-archive.json'); fs.writeFileSync(invalidFile, '{"not":"a-character-archive"}');
    const doc = await call('DOM.getDocument');
    const input = await call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [invalidFile] }); await sleep(200);
    assert.ok(await evaluate('document.querySelector(".nm-alert").textContent.includes("导入失败")'));
    await capture('invalid-import-error', 430);
  }
  empty = true;
  await call('Storage.clearDataForOrigin', { origin: url, storageTypes: 'indexeddb,local_storage,cache_storage' });
  await call('Page.navigate', { url }); await sleep(500);
  assert.ok(await evaluate('document.querySelector(".nm-import-intro")!==null && document.querySelector(".nm-attributes")===null'));
  assert.equal(await evaluate('document.querySelector(".nm-bottom-nav button").disabled'), true);
  await capture('first-import-empty', 430);
  if (process.argv.includes('--more')) {
    empty = false;
    await call('Storage.clearDataForOrigin', { origin: url, storageTypes: 'indexeddb,local_storage,cache_storage' });
    await call('Fetch.enable', { patterns: [{ urlPattern: '*/api/snapshots/latest', requestStage: 'Request' }] });
    await call('Page.navigate', { url });
    for (let i = 0; i < 50 && !pausedRequests.length; i++) await sleep(50);
    assert.ok(pausedRequests.length, 'Missing paused synthetic API for loading state');
    assert.ok(await evaluate('document.querySelector(".nm-loading-page")!==null'));
    await capture('loading', 430);
    if (process.argv.includes('--final')) assert.equal(await evaluate('getComputedStyle(document.querySelector(".nm-loading-line")).animationName'), 'none');
    for (const requestId of pausedRequests) await call('Fetch.continueRequest', { requestId });
    await call('Fetch.disable'); await sleep(300);
  }
  assert.equal((await fetch(url + '/api/snapshots/latest', { method: 'POST' })).status, 405);
  assert.equal((await fetch(url + '/runtime-assets.json')).status, 404);
  assert.equal((await fetch(url + '/', { headers: { Origin: 'https://example.invalid' } })).status, 403);
  fs.writeFileSync(path.join(out, 'diagnostics.json'), JSON.stringify({ exceptions, requests, checks }, null, 2));
  assert.equal(exceptions.length, 0, 'Browser runtime exceptions: ' + JSON.stringify(exceptions));
  const external = requests.filter(value => /^https?:/.test(value) && !value.startsWith(url + '/'));
  assert.deepEqual(external, [], 'Preview fetched an external network resource');
  const report = { browser: 'installed Chrome headless; fresh temporary profile', syntheticOnly: true, realSaveOrCloudOrNativeDeviceTest: false,
    widths, screens, checks, runtimeExceptions: exceptions, externalNetworkRequests: external, largeWarehouse,
    filtersAndDetailReturn: true, missingItemMappingsRemainBlank: true, sampleLabels: true, experimentalCandidateNotPromoted: true, regressions };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, screenshots: screens.length, widths: report.widths, report: path.join(out, 'report.json') }));
  await call('Browser.close').catch(() => {});
} catch (error) { console.error(error); process.exitCode = 1; }
finally { ws?.close(); chrome.kill(); server.close(); }
