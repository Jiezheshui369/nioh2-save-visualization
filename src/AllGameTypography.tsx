import { useLayoutEffect } from 'react';
import './allGameTypography.css';
import { TypographyLayers } from './TypographyLayers';

export interface AppGlyph { x:number;y:number;width:number;height:number;xoffset:number;baseline:number;xadvance:number;source:string;nominalBitmapHeight:number }
export interface AppGameFont { source:string;runtimeBindingProven:false;glyphs:Record<string,AppGlyph>;atlasUrl:string;nativeFontUrl:string;atlasSha256:string;metricsSha256:string }
interface Ink { left:number;top:number;right:number;bottom:number }
interface Bounds { left:number;top:number;right:number;bottom:number }
interface GlyphPlacement { glyph:AppGlyph;x:number;scale:number;ink:Ink }
interface Line { owner:HTMLElement;placements:GlyphPlacement[];left:number;right:number;center:number;clip:Bounds;color:string;opacity:number;fontSize:number;align:string }
export interface TypographyAudit { status:string;source:string;runtimeBindingProven:false;sourceGlyphs:number;visibleTextNodes:number;paintedLines:number;nativeControls:number;missingCodepoints:string[];observedMissingCodepoints:string[];frames:number;maxFrameMs:number;overlayPointerEvents:string;alphaPreserved:true;equipmentInk?:{role:string;top:number;bottom:number;left:number;height:number}[] }
declare global { interface Window { __niohTypography?:TypographyAudit } }

const intersect=(a:Bounds,b:Bounds):Bounds=>({left:Math.max(a.left,b.left),right:Math.min(a.right,b.right),top:Math.max(a.top,b.top),bottom:Math.min(a.bottom,b.bottom)});
const nonempty=(b:Bounds)=>b.right>b.left&&b.bottom>b.top;
const cpLabel=(cp:number)=>'U+'+cp.toString(16).toUpperCase().padStart(4,'0');

/** Visible pixels are drawn from the checked game atlas. DOM text remains untouched:
 * selection, accessibility, inputs, handlers, React reconciliation and business state stay native. */
export function AllGameTypography({ font }: { font:AppGameFont|null }) {
  useLayoutEffect(()=>font?installGameTypography(document.getElementById('root')!,font):undefined,[font]);
  return null;
}

export function installGameTypography(root:HTMLElement,font:AppGameFont) {
  let disposed=false,raf=0,ready=false;
  const layers=new TypographyLayers();
  const alert=document.createElement('div');alert.className='g1n-font-accessible-status';alert.setAttribute('role','status');alert.setAttribute('aria-live','polite');
  document.body.append(alert);root.classList.add('g1n-font-loading');
  const scratch=document.createElement('canvas'),scratchContext=scratch.getContext('2d')!;
  const observedMissing=new Set<number>(),ink=new Map<string,Ink>();
  const audit:TypographyAudit={status:'loading',source:font.source,runtimeBindingProven:false,sourceGlyphs:Object.keys(font.glyphs).length,visibleTextNodes:0,paintedLines:0,nativeControls:0,missingCodepoints:[],observedMissingCodepoints:[],frames:0,maxFrameMs:0,overlayPointerEvents:'none',alphaPreserved:true};
  window.__niohTypography=audit;
  const image=new Image();
  // This exact-pixel derivative is used for original advances, caret positioning and
  // browser-owned option/file controls. Its provenance records every original alpha layer.
  const face=new FontFace('SaveAssetG1NPixel',`url(${font.nativeFontUrl})`,{weight:'100 900',ascentOverride:'86.6667%',descentOverride:'13.3333%',lineGapOverride:'20%'});
  const owners=new WeakMap<HTMLElement,number>();let nextOwner=0;
  const schedule=()=>{if(!disposed&&ready&&!raf)raf=requestAnimationFrame(paint);};
  const observer=new MutationObserver(schedule);
  const observe=()=>observer.observe(root,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','open','disabled','aria-expanded','value','placeholder']});observe();
  const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);resize?.observe(root);
  const events=['input','change','compositionstart','compositionupdate','compositionend','selectionchange','focusin','focusout','pointerover','pointerout','keydown','keyup','transitionend'];
  // Ordinary content scroll is handled by the browser's compositor, not a JS repaint.
  // Native editable controls have their own internal scrolling surface.
  const controlScroll=(event:Event)=>{if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)schedule();};
  events.forEach(e=>document.addEventListener(e,schedule,true));window.addEventListener('scroll',controlScroll,{capture:true,passive:true});window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
  Promise.all([face.load(),new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('G1N atlas could not load'));image.src=font.atlasUrl;})]).then(()=>{
    if(disposed)return;
    if(image.naturalWidth!==592||image.naturalHeight!==4620)throw new Error('G1N source atlas has wrong dimensions');
    const a=document.createElement('canvas');a.width=image.naturalWidth;a.height=image.naturalHeight;const c=a.getContext('2d')!;c.drawImage(image,0,0);const bytes=c.getImageData(0,0,a.width,a.height).data;
    for(const [cp,g]of Object.entries(font.glyphs)){let left=g.width,top=g.height,right=0,bottom=0;for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++)if(bytes[((g.y+y)*a.width+g.x+x)*4+3]!==0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}ink.set(cp,{left,top,right,bottom});}
    document.fonts.add(face);root.classList.add('g1n-all-font');root.classList.remove('g1n-font-loading');ready=true;audit.status='ready';schedule();
  }).catch(error=>{if(!disposed){audit.status='font-error';root.classList.remove('g1n-font-loading');alert.classList.add('g1n-font-error');alert.textContent='Font asset unavailable';console.error(String(error));}});

  function styleState(el:HTMLElement,host:HTMLElement) {
    // Outside clips/opacity are now inherited by the DOM canvas. Apply only
    // effects between an inline text source and its containing layer host.
    let clip:Bounds={left:-1e7,top:-1e7,right:1e7,bottom:1e7},opacity=1,inside=true;
    for(let e:HTMLElement|null=el;e;e=e.parentElement){const st=getComputedStyle(e);if(st.display==='none'||st.visibility==='hidden'||e.hidden)return null;
      if(e===host)inside=false;
      if(inside){opacity*=Number(st.opacity);if(e!==el&&/(hidden|clip|scroll|auto)/.test(st.overflowX+' '+st.overflowY)){const r=e.getBoundingClientRect();clip=intersect(clip,{left:r.left+e.clientLeft,right:r.left+e.clientLeft+e.clientWidth,top:r.top+e.clientTop,bottom:r.top+e.clientTop+e.clientHeight});}}
      if(Number(st.opacity)===0)return null;
      if(e===root)break;
    }
    return {clip,opacity};
  }
  function ownerFor(el:HTMLElement):HTMLElement {let e=el;while(e.parentElement&&e!==root&&getComputedStyle(e).display==='inline')e=e.parentElement;return e;}
  function contentBounds(el:HTMLElement):Bounds {const r=el.getBoundingClientRect(),st=getComputedStyle(el);return {left:r.left+(parseFloat(st.borderLeftWidth)||0)+(parseFloat(st.paddingLeft)||0),right:r.right-(parseFloat(st.borderRightWidth)||0)-(parseFloat(st.paddingRight)||0),top:r.top+(parseFloat(st.borderTopWidth)||0)+(parseFloat(st.paddingTop)||0),bottom:r.bottom-(parseFloat(st.borderBottomWidth)||0)-(parseFloat(st.paddingBottom)||0)};}

  function paint() {
    raf=0;if(disposed||!ready)return;const started=performance.now(),dpr=Math.max(1,devicePixelRatio||1);
    // Ignore our own paint DOM mutations. React/app mutations resume observation
    // before returning; the text nodes and React-owned structure stay untouched.
    observer.disconnect();layers.begin();
    const lines=new Map<string,Line>(),missing=new Set<number>();let textNodes=0,controls=0;
    const glyphFor=(character:string)=>{const cp=character.codePointAt(0)!;if(/\s/u.test(character))return {cp:32,glyph:font.glyphs['32']};let glyph=font.glyphs[String(cp)];if(!glyph){missing.add(cp);observedMissing.add(cp);glyph=font.glyphs['63'];return {cp:63,glyph};}return {cp,glyph};};
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode as Text,el=node.parentElement;if(!el||!node.data.trim()||el.closest('script,style,svg,canvas,option,textarea,input,.game-bitmap-text[data-bitmap-state="bitmap"]'))continue;
      const whole=document.createRange();whole.selectNodeContents(node);const rect=whole.getBoundingClientRect();if(!nonempty(rect))continue;const owner=ownerFor(el),state=styleState(el,owner);if(!state)continue;
      const style=getComputedStyle(el),size=parseFloat(style.fontSize),box=contentBounds(owner);if(!size||!nonempty(box))continue;
      if(!owners.has(owner))owners.set(owner,++nextOwner);textNodes++;
      let offset=0;
      for(const char of node.data){const range=document.createRange();range.setStart(node,offset);offset+=char.length;range.setEnd(node,offset);const rs=Array.from(range.getClientRects()).filter(r=>r.width>0&&r.height>0);if(!rs.length)continue;const r=rs[0],center=(r.top+r.bottom)/2,key=[owners.get(owner),Math.round(center*4)/4,size,style.color,state.opacity].join('|');let line=lines.get(key);if(!line){line={owner,placements:[],left:r.left,right:r.right,center,clip:intersect(state.clip,{...box,top:state.clip.top,bottom:state.clip.bottom}),color:style.color,opacity:state.opacity,fontSize:size,align:style.textAlign};lines.set(key,line);}line.left=Math.min(line.left,r.left);line.right=Math.max(line.right,r.right);const chosen=glyphFor(char);line.placements.push({glyph:chosen.glyph,x:r.left,scale:size/30,ink:ink.get(String(chosen.cp))!});}
    }
    for(const el of root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select')){
      if(el instanceof HTMLInputElement&&['hidden','file','checkbox','radio','range','color','button','submit','reset'].includes(el.type))continue;
      const state=styleState(el,el.parentElement!),box=contentBounds(el);if(el instanceof HTMLSelectElement)box.right-=18;if(!state||!nonempty(box))continue;
      const style=getComputedStyle(el),size=parseFloat(style.fontSize),isSelect=el instanceof HTMLSelectElement;let text=isSelect?el.selectedOptions[0]?.textContent??'':el.value;
      const placeholder=!text&&!isSelect;if(placeholder)text=(el as HTMLInputElement).placeholder??'';if(!text)continue;
      if(el instanceof HTMLInputElement&&el.type==='password')text='*'.repeat(Array.from(text).length);
      controls++;const scale=size/30,lineHeight=parseFloat(style.lineHeight)||size*1.2,align=style.textAlign,color=placeholder?getComputedStyle(el,'::placeholder').color:style.color;let x=box.left-(isSelect?0:el.scrollLeft),y=el instanceof HTMLTextAreaElement?box.top+lineHeight/2-el.scrollTop:(box.top+box.bottom)/2;
      const wrap=el instanceof HTMLTextAreaElement,contentClip=intersect(state.clip,box);let current:Line={owner:el,placements:[],left:x,right:x,center:y,clip:contentClip,color,opacity:state.opacity,fontSize:size,align};
      const finish=()=>{if(current.placements.length)lines.set('control-'+lines.size,current);};
      for(const char of text){const chosen=glyphFor(char),advance=chosen.glyph.xadvance*scale;if(char==='\n'||wrap&&x+advance>box.right&&current.placements.length){finish();x=box.left-el.scrollLeft;y+=lineHeight;current={...current,placements:[],left:x,right:x,center:y};if(char==='\n')continue;}current.placements.push({glyph:chosen.glyph,x,scale,ink:ink.get(String(chosen.cp))!});x+=advance;current.right=x;}finish();
    }
    let painted=0;const equipmentInk:NonNullable<TypographyAudit['equipmentInk']>=[];
    for(const line of lines.values()){
      if(!line.placements.length||!nonempty(line.clip))continue;const lineWidth=line.right-line.left,available=line.clip.right-line.clip.left;
      // Native advances determine wrapping. A clipped single line shrinks equally in X/Y.
      const editable=line.owner instanceof HTMLInputElement||line.owner instanceof HTMLTextAreaElement;
      let opticalRole='';const equipmentRow=line.owner.closest<HTMLElement>('.nd-shell .nm-equipment-row');
      if(equipmentRow&&!line.owner.closest('.nm-badge')){if(line.owner.closest('.nm-item-name')||line.owner.matches('.nm-item-copy > b'))opticalRole='name';else if(line.owner.closest('.nm-item-meta')||line.owner.matches('.nm-item-copy > small'))opticalRole='meta';}
      const desktopLine=Boolean(line.owner.closest('.nd-shell'));
      const factor=desktopLine||editable?1:Math.min(1,available/Math.max(1,lineWidth));let left=line.left;
      if(factor<1)left=line.align==='center'?(line.clip.left+line.clip.right-lineWidth*factor)/2:line.align==='right'||line.align==='end'?line.clip.right-lineWidth*factor:line.clip.left;
      let min=Infinity,max=-Infinity;for(const p of line.placements){if(p.ink.right<=p.ink.left)continue;min=Math.min(min,(-p.glyph.baseline+p.ink.top)*p.scale*factor);max=Math.max(max,(-p.glyph.baseline+p.ink.bottom)*p.scale*factor);}if(!Number.isFinite(min)||max<=min)continue;
      const inkHeight=max-min;let center=line.center;
      if(equipmentRow&&opticalRole){const ownerBox=contentBounds(line.owner),lineHeight=parseFloat(getComputedStyle(line.owner).lineHeight)||line.fontSize*1.4;const index=Math.max(0,Math.round((center-ownerBox.top-lineHeight/2)/lineHeight));center=ownerBox.top+(index+.5)*lineHeight;const row=equipmentRow.getBoundingClientRect();equipmentInk.push({role:opticalRole,top:center-inkHeight/2-row.top,bottom:center+inkHeight/2-row.top,left:left-row.left,height:inkHeight});}
      const pad=2,sw=Math.max(1,Math.ceil((lineWidth*factor+pad*2+4)*dpr)),sh=Math.max(1,Math.ceil((inkHeight+pad*2)*dpr));scratch.width=sw;scratch.height=sh;scratchContext.setTransform(dpr,0,0,dpr,0,0);scratchContext.imageSmoothingEnabled=true;scratchContext.imageSmoothingQuality='high';
      for(const p of line.placements){const g=p.glyph,scale=p.scale*factor;scratchContext.drawImage(image,g.x,g.y,g.width,g.height,pad+(p.x-line.left)*factor+g.xoffset*scale,pad-min-g.baseline*scale,g.width*scale,g.height*scale);}
      scratchContext.globalCompositeOperation='source-in';scratchContext.fillStyle=line.color;scratchContext.fillRect(0,0,sw/dpr,sh/dpr);scratchContext.globalCompositeOperation='source-over';
      const host=line.owner.matches('input,textarea,select')?line.owner.parentElement!:line.owner;
      layers.draw(host,scratch,{left:left-pad,top:center-inkHeight/2-pad,width:sw/dpr,height:sh/dpr},line.clip,line.opacity,dpr);painted++;
    }
    layers.end();observe();
    const codes=[...missing].sort((a,b)=>a-b).map(cpLabel);alert.classList.toggle('g1n-font-error',codes.length>0);alert.textContent=codes.length?'Glyph unavailable: '+codes.join(', '):'';
    audit.visibleTextNodes=textNodes;audit.nativeControls=controls;audit.paintedLines=painted;audit.missingCodepoints=codes;audit.observedMissingCodepoints=[...observedMissing].sort((a,b)=>a-b).map(cpLabel);audit.equipmentInk=equipmentInk;audit.frames++;audit.maxFrameMs=Math.max(audit.maxFrameMs,performance.now()-started);
  }
  let densityQuery:MediaQueryList|null=null;
  const densityChanged=()=>{ schedule(); watchDensity(); };
  function watchDensity(){densityQuery?.removeEventListener('change',densityChanged);densityQuery=matchMedia(`(resolution: ${devicePixelRatio}dppx)`);densityQuery.addEventListener('change',densityChanged);}
  watchDensity();
  let lastDensity=devicePixelRatio,densityRaf=0;
  const checkDensity=()=>{if(lastDensity!==devicePixelRatio){lastDensity=devicePixelRatio;densityChanged();}densityRaf=requestAnimationFrame(checkDensity);};
  densityRaf=requestAnimationFrame(checkDensity);
  return ()=>{cancelAnimationFrame(densityRaf);densityQuery?.removeEventListener('change',densityChanged);disposed=true;cancelAnimationFrame(raf);observer.disconnect();resize?.disconnect();events.forEach(e=>document.removeEventListener(e,schedule,true));window.removeEventListener('scroll',controlScroll,true);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);document.fonts.delete(face);root.classList.remove('g1n-font-loading','g1n-all-font');layers.dispose();alert.remove();};
}
