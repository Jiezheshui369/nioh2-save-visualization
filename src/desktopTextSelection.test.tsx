import {useRef} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useDesktopTextSelection} from './useDesktopTextSelection';
import {DesktopMenu} from './DesktopMenu';

afterEach(()=>{cleanup();window.getSelection()?.removeAllRanges();});
function Fixture({copy=()=>{},navigate=()=>{}}:{copy?:()=>void;navigate?:(page:string)=>void}) {
  const root=useRef<HTMLDivElement>(null);useDesktopTextSelection(root);
  return <div ref={root} className="df-shell" data-desktop-text-selection="ordinary-disabled">
    <p data-testid="ordinary">普通展示文字</p>
    <input aria-label="测试搜索" defaultValue="abcdef"/>
    <input aria-label="测试只读" readOnly defaultValue="readonly"/>
    <textarea aria-label="测试备注" defaultValue="notes"/>
    <div contentEditable suppressContentEditableWarning data-testid="editor"><span data-testid="editor-child">可编辑内容</span></div>
    <div contentEditable="plaintext-only" data-testid="plaintext">纯文本编辑</div>
    <div contentEditable={false} data-testid="noneditor">普通非编辑内容</div>
    <select multiple aria-label="测试多选"><option>档案一</option><option>档案二</option></select>
    <button onClick={copy}>复制记录</button>
    <DesktopMenu open page="equipment" onNavigate={navigate} onClose={()=>{}}/>
  </div>;
}
function selectStart(target:Element) {const event=new Event('selectstart',{bubbles:true,cancelable:true});target.dispatchEvent(event);return event;}
function key(target:Element,key='a',extra={}) {const event=new KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true,...extra});target.dispatchEvent(event);return event;}
it('blocks ordinary selectstart and body/noneditable Ctrl+A without hiding accessible text',()=>{
  render(<Fixture/>);const p=screen.getByTestId('ordinary');
  expect(selectStart(p).defaultPrevented).toBe(true);
  expect(key(document.body).defaultPrevented).toBe(true);
  expect(key(p,'A').defaultPrevented).toBe(true);
  expect(key(p,'a',{ctrlKey:false,metaKey:true}).defaultPrevented).toBe(true);
  expect(p).toHaveTextContent('普通展示文字');
});
it('preserves input, readonly, textarea and editable descendant selection',()=>{
  render(<Fixture/>);
  for(const label of ['测试搜索','测试只读','测试备注']) {
    const input=screen.getByLabelText(label) as HTMLInputElement;input.focus();input.setSelectionRange(1,4);
    expect(selectStart(input).defaultPrevented).toBe(false);
    expect(key(input).defaultPrevented).toBe(false);
    expect(input.selectionStart).toBe(1);expect(input.selectionEnd).toBe(4);
  }
  for(const id of ['editor','editor-child','plaintext']) {
    const editor=screen.getByTestId(id);
    expect(selectStart(editor).defaultPrevented).toBe(false);expect(key(editor).defaultPrevented).toBe(false);
  }
});
it('does not exempt ordinary text merely because a text input still has focus',()=>{
  render(<Fixture/>);screen.getByLabelText('测试搜索').focus();
  expect(selectStart(screen.getByTestId('ordinary')).defaultPrevented).toBe(true);
  expect(selectStart(screen.getByTestId('noneditor')).defaultPrevented).toBe(true);
});
it('clears forbidden existing selections, retaining selections within an editor',()=>{
  const app=render(<Fixture/>);const selection=window.getSelection()!;
  selection.selectAllChildren(screen.getByTestId('ordinary'));fireEvent(document,new Event('selectionchange'));
  expect(selection.isCollapsed).toBe(true);
  selection.selectAllChildren(screen.getByTestId('editor'));fireEvent(document,new Event('selectionchange'));
  expect(selection.toString()).toBe('可编辑内容');
  app.unmount();expect(key(document.body).defaultPrevented).toBe(false);
});
it('keeps business menu clicks, native multiselect, copy and other keys usable',()=>{
  const copy=vi.fn(),navigate=vi.fn();render(<Fixture copy={copy} navigate={navigate}/>);
  fireEvent.click(screen.getByRole('button',{name:'仓库'}));expect(navigate).toHaveBeenCalledWith('warehouse');
  fireEvent.click(screen.getByRole('button',{name:'复制记录'}));expect(copy).toHaveBeenCalledOnce();
  const select=screen.getByLabelText('测试多选');select.focus();expect(key(select).defaultPrevented).toBe(false);
  for(const value of ['c','Tab','Enter','Escape','ArrowDown'])expect(key(screen.getByTestId('ordinary'),value).defaultPrevented).toBe(false);
});
it('does not intercept selection or shortcuts in a sibling mobile/editor surface',()=>{
  render(<><Fixture/><div data-testid="outside">外部网页内容</div><input aria-label="外部输入"/></>);
  const outside=screen.getByTestId('outside');outside.tabIndex=0;outside.focus();
  expect(selectStart(outside).defaultPrevented).toBe(false);expect(key(outside).defaultPrevented).toBe(false);
});
