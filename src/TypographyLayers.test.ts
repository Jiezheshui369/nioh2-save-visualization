import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {TypographyLayers} from './TypographyLayers';

let layers:TypographyLayers;
const context={setTransform:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),drawImage:vi.fn(),globalAlpha:1};
const pixels=document.createElement('canvas');
function host(position='static'){
  const el=document.createElement('p');el.textContent='保留原文字';el.style.position=position;
  el.getBoundingClientRect=()=>({left:20,top:30,right:220,bottom:100,width:200,height:70,x:20,y:30,toJSON(){}});
  document.body.append(el);return el;
}
function paint(el:HTMLElement){layers.draw(el,pixels,{left:25,top:40,width:80,height:20},{left:0,top:0,right:500,bottom:500},1,2)}
beforeEach(()=>{vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);layers=new TypographyLayers();});
afterEach(()=>{layers.dispose();document.body.replaceChildren();vi.restoreAllMocks();});
describe('scroll-owned bitmap text layers',()=>{
  it('keeps text and positions its noninteractive pixels inside the same scroll ancestry',()=>{
    const scroller=document.createElement('section');scroller.style.overflow='auto';document.body.append(scroller);const el=host();scroller.append(el);
    layers.begin();paint(el);layers.end();const canvas=el.querySelector('canvas')!;
    expect(el.firstChild?.textContent).toBe('保留原文字');expect(scroller.contains(canvas)).toBe(true);
    expect(canvas.getAttribute('aria-hidden')).toBe('true');expect(canvas.style.left).toBe('5px');expect(canvas.style.top).toBe('10px');
    expect(el.style.position).toBe('relative');
  });
  it('does not replace fixed or sticky positioning',()=>{
    for(const position of ['fixed','sticky','relative']){const el=host(position);layers.begin();paint(el);layers.end();expect(el.style.position).toBe(position);}
  });
  it('removes obsolete lines and restores only its own temporary positioning',()=>{
    const el=host();layers.begin();paint(el);paint(el);layers.end();expect(el.querySelectorAll('canvas')).toHaveLength(2);
    layers.begin();paint(el);layers.end();expect(el.querySelectorAll('canvas')).toHaveLength(1);
    layers.begin();layers.end();expect(el.querySelectorAll('canvas')).toHaveLength(0);expect(el.style.position).toBe('static');
  });
  it('preserves positioning changed by the application before cleanup',()=>{
    const el=host();layers.begin();paint(el);layers.end();el.style.position='sticky';layers.dispose();expect(el.style.position).toBe('sticky');
  });
  it('recovers a line removed by a React text update without replacing native text',()=>{
    const el=host();layers.begin();paint(el);layers.end();el.textContent='更新';layers.begin();paint(el);layers.end();expect(el.firstChild?.textContent).toBe('更新');expect(el.querySelectorAll('canvas')).toHaveLength(1);
  });
  it('does not allocate invisible lines and clips partial lines before drawing',()=>{
    const el=host();layers.begin();layers.draw(el,pixels,{left:25,top:40,width:80,height:20},{left:200,top:200,right:300,bottom:300},1,2);layers.end();expect(el.querySelector('canvas')).toBeNull();
    layers.begin();layers.draw(el,pixels,{left:25,top:40,width:80,height:20},{left:30,top:45,right:90,bottom:55},.5,2);layers.end();const c=el.querySelector('canvas')!;expect(c.width).toBe(120);expect(c.height).toBe(20);expect(context.globalAlpha).toBe(.5);expect(context.clip).toHaveBeenCalled();
  });
});
