"""Explicit native signed-out window probe. No account or parser simulation."""
from __future__ import annotations
import json,time,threading
from pathlib import Path
PROBE="""({desktop:!!document.querySelector('.df-shell'),login:!!document.querySelector('[aria-label="桌面登录"]'),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},missing:Array.from(document.querySelectorAll('[data-native-missing],[data-bitmap-state^=fallback]')).map(e=>e.getAttribute('aria-label'))})"""
SELECTION_PROBE=r"""(async()=>{
  const root=document.querySelector('.df-shell');
  const ordinary=root.querySelector('.game-bitmap-readable');
  const previous=document.activeElement;
  const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const selection=getSelection();
  const test=document.createElement('section');
  test.dataset.nativeSelectionTest='fixture-only';
  test.innerHTML='<input aria-label="QA text" value="abcdef"><input aria-label="QA readonly" readonly value="readonly"><textarea aria-label="QA notes">notes</textarea><div contenteditable="true">editable text</div><button type="button">QA copy</button>';
  const report={testFixtureOnly:true,productionVisibleTextInputs:root.querySelectorAll('input:not([type=file]):not([type=hidden]),textarea,[contenteditable]').length};
  try {
    report.boundary=root.dataset.desktopTextSelection;
    report.ordinaryUserSelect=getComputedStyle(ordinary).userSelect;
    const event=new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true,cancelable:true});
    document.body.dispatchEvent(event);report.ctrlADefaultPrevented=event.defaultPrevented;
    ordinary.dispatchEvent(new Event('selectstart',{bubbles:true,cancelable:true}));
    selection.selectAllChildren(ordinary);await frame();
    report.ordinaryRangeCleared=selection.toString()==='';
    document.execCommand('selectAll');await frame();
    report.browserSelectAllEmpty=selection.toString()==='';
    root.append(test);
    report.editors=[];
    for(const input of test.querySelectorAll('input,textarea')) {
      input.focus();input.select();await frame();
      const key=new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true,cancelable:true});input.dispatchEvent(key);
      const copy=new ClipboardEvent('copy',{bubbles:true,cancelable:true});input.dispatchEvent(copy);
      report.editors.push({select:getComputedStyle(input).userSelect,range:input.selectionStart===0&&input.selectionEnd===input.value.length,keyAllowed:!key.defaultPrevented,copyAllowed:!copy.defaultPrevented});
    }
    const editor=test.querySelector('[contenteditable]');editor.focus();selection.selectAllChildren(editor);await frame();
    report.contentEditableRetained=selection.toString()==='editable text';
    let copied=false;test.querySelector('button').onclick=()=>{copied=true;};test.querySelector('button').click();report.copyButtonCallback=copied;
    report.pass=report.boundary==='ordinary-disabled'&&report.ordinaryUserSelect==='none'&&report.ctrlADefaultPrevented&&report.ordinaryRangeCleared&&report.browserSelectAllEmpty&&report.editors.every(r=>r.select==='text'&&r.range&&r.keyAllowed&&r.copyAllowed)&&report.contentEditableRetained&&report.copyButtonCallback;
    return report;
  } finally {test.remove();selection.removeAllRanges();if(previous instanceof HTMLElement)previous.focus();}
})()"""
def promise(window, js):
    done=threading.Event(); output=[]
    window.evaluate_js(js,callback=lambda value:(output.append(value),done.set()))
    if not done.wait(30) or not output:raise RuntimeError('Native asynchronous probe did not complete')
    return output[0]

def wait(window, js, timeout=30):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        value=window.evaluate_js(js)
        if value:return value
        time.sleep(.1)
    raise RuntimeError('Native state timed out: '+js[:180])

def capture(window,path):
    """Capture actual WebView2 pixels, not a DOM reconstruction."""
    promise(window,"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))")
    wait(window,'document.querySelectorAll("[data-bitmap-state=loading]").length===0')
    audit=window.evaluate_js('({missing:Array.from(document.querySelectorAll("[data-native-missing],[data-bitmap-state^=fallback]")).map(e=>({label:e.getAttribute("aria-label"),text:e.textContent,missing:e.dataset.nativeMissing||e.dataset.missingCodepoints}))})')
    with (path.parent/'pixel-audit.jsonl').open('a',encoding='utf8') as output:output.write(json.dumps({'file':path.name,**audit},ensure_ascii=False)+'\n')
    from System import Action
    from System.IO import FileStream,FileMode,FileAccess
    from Microsoft.Web.WebView2.Core import CoreWebView2CapturePreviewImageFormat
    stream=FileStream(str(path),FileMode.Create,FileAccess.Write)
    task=[]
    window.native.Invoke(Action(lambda:task.append(window.native.webview.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,stream))))
    try:
        deadline=time.monotonic()+15
        while not task[0].IsCompleted and time.monotonic()<deadline:time.sleep(.05)
        if not task[0].IsCompleted:raise RuntimeError('Native pixel capture timed out')
        task[0].GetAwaiter().GetResult();stream.Flush()
    finally:stream.Dispose()
    if path.stat().st_size<1000:raise RuntimeError('Native capture was empty')

def geometry(window):
    import ctypes
    from ctypes import wintypes
    class MI(ctypes.Structure):
        _fields_=[('cbSize',wintypes.DWORD),('rcMonitor',wintypes.RECT),('rcWork',wintypes.RECT),('dwFlags',wintypes.DWORD)]
    user=ctypes.WinDLL('user32');user.MonitorFromWindow.restype=wintypes.HANDLE
    user.MonitorFromWindow.argtypes=[wintypes.HWND,ctypes.c_uint];user.GetMonitorInfoW.argtypes=[wintypes.HANDLE,ctypes.POINTER(MI)]
    handle=int(window.native.Handle.ToInt64());bounds=wintypes.RECT();user.GetWindowRect(handle,ctypes.byref(bounds))
    info=MI();info.cbSize=ctypes.sizeof(info);user.GetMonitorInfoW(user.MonitorFromWindow(handle,2),ctypes.byref(info))
    return {'bounds':[bounds.left,bounds.top,bounds.right,bounds.bottom],'workArea':[info.rcWork.left,info.rcWork.top,info.rcWork.right,info.rcWork.bottom],'dpi':user.GetDpiForWindow(handle),'iconBound':window.native.Icon is not None,'fitsWorkArea':bounds.left>=info.rcWork.left and bounds.top>=info.rcWork.top and bounds.right<=info.rcWork.right and bounds.bottom<=info.rcWork.bottom}

def verify_window(window,data_root:Path,save:Path|None):
    if save is not None:
        raise RuntimeError('Save UI verification requires an actual signed-in session; production self-test never simulates account state. Use the separate isolated QA harness for explicit test-only simulations.')
    deadline=time.monotonic()+60
    while time.monotonic()<deadline:
        result=window.evaluate_js(PROBE)
        if result and result.get('desktop') and result.get('login'):break
        time.sleep(.1)
    else:raise RuntimeError('Native desktop login screen did not render')
    done=threading.Event();values=[]
    window.evaluate_js("fetch('/api/native-auth/status',{headers:{'X-Nioh2-Desktop-Sync':'1'},cache:'no-store'}).then(r=>r.json()).then(v=>({state:v.state,errorCode:v.errorCode}))",callback=lambda v:(values.append(v),done.set()))
    if not done.wait(20) or not values:raise RuntimeError('Native account status probe did not finish')
    capture(window,data_root/'native-login-real-signed-out.png')
    result['textSelection']=promise(window,SELECTION_PROBE)
    if not result['textSelection'].get('pass'):raise RuntimeError('Native text selection check failed: '+json.dumps(result['textSelection']))
    result['nativeGeometry']=geometry(window)
    result.update(actualNativeAccountStatus=values[0],liveOAuthLoginVerified=False,syntheticAccountStatusForSaveUI=False,nativeWebView2=True,status='PASSED_SIGNED_OUT_WINDOW_ONLY')
    if values[0].get('state')!='signed-out':raise RuntimeError('Isolated native profile unexpectedly signed in')
    (data_root/'native-window-self-test.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),'utf8')
    return result
