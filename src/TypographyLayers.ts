interface Bounds { left:number;top:number;right:number;bottom:number }
interface PaintBox { left:number;top:number;width:number;height:number }
interface Host { canvases:HTMLCanvasElement[];used:number;position:string;priority:string;positioned:boolean }

/** Small line canvases belong to their text's layout owner. Scrolling, clipping,
 * sticky/fixed positioning and ancestor opacity then use the same compositor
 * ancestry as the content. No viewport transform is updated on scroll. */
export class TypographyLayers {
  private hosts=new Map<HTMLElement,Host>();
  begin(){for(const entry of this.hosts.values())entry.used=0;}
  draw(host:HTMLElement,pixels:HTMLCanvasElement,box:PaintBox,clip:Bounds,opacity:number,dpr:number){
    const left=Math.max(box.left,clip.left),top=Math.max(box.top,clip.top);
    const right=Math.min(box.left+box.width,clip.right),bottom=Math.min(box.top+box.height,clip.bottom);
    if(right<=left||bottom<=top)return;
    let entry=this.hosts.get(host);
    if(!entry){
      const positioned=getComputedStyle(host).position==='static';
      entry={canvases:[],used:0,position:host.style.getPropertyValue('position'),priority:host.style.getPropertyPriority('position'),positioned};
      if(positioned)host.style.setProperty('position','relative');
      this.hosts.set(host,entry);
    }
    let canvas=entry.canvases[entry.used++];
    if(!canvas){canvas=document.createElement('canvas');canvas.className='g1n-content-text';canvas.setAttribute('aria-hidden','true');entry.canvases.push(canvas);}
    if(canvas.parentElement!==host)host.append(canvas);
    const bounds=host.getBoundingClientRect();
    const originX=Math.floor(left*dpr)/dpr,originY=Math.floor(top*dpr)/dpr;
    // The containing block starts inside the border. Include the owner's own
    // scroll offset for directly-owned text; ancestor scrolling needs no work.
    canvas.style.left=(originX-bounds.left-host.clientLeft+host.scrollLeft)+'px';
    canvas.style.top=(originY-bounds.top-host.clientTop+host.scrollTop)+'px';
    canvas.width=Math.max(1,Math.ceil((right-originX)*dpr));canvas.height=Math.max(1,Math.ceil((bottom-originY)*dpr));
    canvas.style.width=(canvas.width/dpr)+'px';canvas.style.height=(canvas.height/dpr)+'px';
    const context=canvas.getContext('2d')!;
    context.setTransform(dpr,0,0,dpr,0,0);context.globalAlpha=opacity;
    context.beginPath();context.rect(left-originX,top-originY,right-left,bottom-top);context.clip();
    context.drawImage(pixels,box.left-originX,box.top-originY,box.width,box.height);
  }
  end(){
    for(const [host,entry] of this.hosts){
      for(const canvas of entry.canvases.splice(entry.used))canvas.remove();
      if(!entry.used||!host.isConnected){this.restore(host,entry);this.hosts.delete(host);}
    }
  }
  private restore(host:HTMLElement,entry:Host){
    entry.canvases.forEach(canvas=>canvas.remove());
    // Do not overwrite a position value subsequently authored by the app.
    if(entry.positioned&&host.style.getPropertyValue('position')==='relative'&&!host.style.getPropertyPriority('position')){
      if(entry.position)host.style.setProperty('position',entry.position,entry.priority);else host.style.removeProperty('position');
    }
  }
  dispose(){for(const [host,entry] of this.hosts)this.restore(host,entry);this.hosts.clear();}
}
