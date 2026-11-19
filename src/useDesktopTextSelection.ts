import {useLayoutEffect} from 'react';
import type {RefObject} from 'react';

const nonTextInput=/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/;
function element(node:EventTarget|null):Element|null {
  return node instanceof Element?node:node instanceof Node?node.parentElement:null;
}
/** Return the actual editable/selectable text host, including readonly fields. */
function textHost(node:EventTarget|null):Element|null {
  const target=element(node);
  const control=target?.closest('input,textarea');
  if(control instanceof HTMLTextAreaElement)return control;
  if(control instanceof HTMLInputElement)return nonTextInput.test(control.type)?null:control;
  for(let current=target;current;current=current.parentElement) {
    const value=current.getAttribute('contenteditable')?.toLowerCase();
    if(value===''||value==='true'||value==='plaintext-only')return current;
    if(value==='false')return null;
  }
  return null;
}
function businessSelect(node:EventTarget|null) {
  return !!element(node)?.closest('select,[role="listbox"][aria-multiselectable="true"]');
}
/** Desktop lifetime only: leave clicks, file drags, business keys and copy intact. */
export function useDesktopTextSelection(root:RefObject<HTMLElement|null>) {
  useLayoutEffect(()=>{
    const shell=root.current;if(!shell)return;
    const doc=shell.ownerDocument;
    const inside=(target:EventTarget|null)=>target instanceof Node&&shell.contains(target);
    const clearOrdinarySelection=()=>{
      const selection=doc.getSelection();
      if(!selection||selection.isCollapsed||!selection.rangeCount)return;
      if(!inside(selection.anchorNode)&&!inside(selection.focusNode))return;
      const host=textHost(selection.anchorNode);
      if(host&&host===textHost(selection.focusNode))return;
      selection.removeAllRanges();
    };
    const start=(event:Event)=>{
      if((inside(event.target)||event.target===doc.body||event.target===doc.documentElement)&&!textHost(event.target))event.preventDefault();
    };
    const key=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.isComposing||event.altKey||event.shiftKey||!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='a')return;
      const focus=doc.activeElement;
      if(focus!==doc.body&&focus!==doc.documentElement&&!inside(focus))return;
      if(textHost(focus)||textHost(event.target)||businessSelect(focus)||businessSelect(event.target))return;
      event.preventDefault();clearOrdinarySelection();
    };
    doc.addEventListener('selectstart',start,true);
    doc.addEventListener('keydown',key);
    doc.addEventListener('selectionchange',clearOrdinarySelection);
    clearOrdinarySelection();
    return()=>{
      doc.removeEventListener('selectstart',start,true);
      doc.removeEventListener('keydown',key);
      doc.removeEventListener('selectionchange',clearOrdinarySelection);
    };
  },[root]);
}
