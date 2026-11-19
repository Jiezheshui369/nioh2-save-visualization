param([Parameter(Mandatory=$true)][string]$Url, [Parameter(Mandatory=$true)][string]$Profile,
      [Parameter(Mandatory=$true)][string]$Runtime, [string]$IconPath, [switch]$SelfTest, [string]$ResultFile, [string]$TestSave)
$ErrorActionPreference='Stop'
$endpoint=[Uri]$Url
if ($endpoint.Scheme -ne 'http' -or $endpoint.Host -ne '127.0.0.1') { throw 'Desktop control must stay on loopback' }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$core=Join-Path $Runtime 'Microsoft.Web.WebView2.Core.dll'
$forms=Join-Path $Runtime 'Microsoft.Web.WebView2.WinForms.dll'
if (-not (Test-Path -LiteralPath $core) -or -not (Test-Path -LiteralPath $forms)) { throw 'Existing WebView2 assemblies missing' }
[Reflection.Assembly]::LoadFrom($core) | Out-Null
[Reflection.Assembly]::LoadFrom($forms) | Out-Null
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NiohDllDirectory { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool SetDllDirectory(string p); }'
$loader=Join-Path $Runtime 'runtimes\win-x64\native'
if (-not [NiohDllDirectory]::SetDllDirectory($loader)) { throw 'Native WebView2 loader unavailable' }
$form=New-Object System.Windows.Forms.Form
$form.Text='存档资产 Save Asset'
$form.AutoScaleMode=[System.Windows.Forms.AutoScaleMode]::Dpi
if ($IconPath) { $form.Icon=[System.Drawing.Icon]::new($IconPath) }
$work=[System.Windows.Forms.Screen]::FromHandle($form.Handle).WorkingArea
$form.Width=[Math]::Min(1280,[Math]::Max(1,$work.Width-32)); $form.Height=[Math]::Min(900,[Math]::Max(1,$work.Height-32))
$form.MinimumSize=New-Object System.Drawing.Size([Math]::Min(800,$form.Width),[Math]::Min(600,$form.Height))
$form.StartPosition=[System.Windows.Forms.FormStartPosition]::Manual
$form.Left=$work.Left+[Math]::Floor(($work.Width-$form.Width)/2); $form.Top=$work.Top+[Math]::Floor(($work.Height-$form.Height)/2)
$view=New-Object Microsoft.Web.WebView2.WinForms.WebView2
$view.Dock=[System.Windows.Forms.DockStyle]::Fill
$form.Controls.Add($view)
if ($SelfTest) { $form.Opacity=0; $form.ShowInTaskbar=$false }
$script:failure=$null; $script:ready=$false; $script:scriptTask=$null
$script:dropStarted=$false
$script:saveBase64=$null
if ($TestSave) {
    if (-not $SelfTest) { throw 'Save test requires explicit self-test mode' }
    $bytes=[IO.File]::ReadAllBytes($TestSave)
    if ([IO.Path]::GetFileName($TestSave) -ne 'SAVEDATA.BIN' -or $bytes.Length -lt 1000000 -or $bytes.Length -gt 8388608) { throw 'Invalid test save' }
    $script:saveBase64=[Convert]::ToBase64String($bytes)
}
$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=100
$script:ticks=0
$timer.Add_Tick({
    $script:ticks++
    if ($script:scriptTask -and $script:scriptTask.IsCompleted) {
        try {
            $result=$script:scriptTask.GetAwaiter().GetResult() | ConvertFrom-Json
            if ($result.desktop -eq $true -and $result.importInput -eq $true -and $TestSave -and -not $script:dropStarted) {
                # Dispatch a real File through the same window drop handler. Fetch remains the actual native HTTP client.
                $drop='(() => { const realFetch=window.fetch; window.fetch=async (...args) => { const response=await realFetch(...args); if(args[0]==="/api/import-save") { const v=await response.clone().json(); window.__niohTestImport={httpStatus:response.status,snapshotId:v.snapshotId,publicationVersion:v.localPublication?.publicationVersion,equipment:v.equipmentInventory?.length,items:v.inventoryItems?.length,scrolls:v.scrolls?.length}; } return response; }; const bytes=Uint8Array.from(atob("' + $script:saveBase64 + '"),c=>c.charCodeAt(0)); const data=new DataTransfer(); data.items.add(new File([bytes],"SAVEDATA.BIN",{type:"application/octet-stream"})); window.dispatchEvent(new DragEvent("drop",{dataTransfer:data,bubbles:true,cancelable:true})); return true; })()'
                $view.CoreWebView2.ExecuteScriptAsync($drop) | Out-Null
                $script:dropStarted=$true
            }
            $importDone=(-not $TestSave) -or ($result.saveImport.httpStatus -eq 200 -and $result.saveImport.publicationVersion -gt 0 -and $result.savedNotice -eq $true -and $result.hasCharacter -eq $true)
            if ($result.desktop -eq $true -and $result.importInput -eq $true -and $importDone) {
                if ($ResultFile) { [IO.File]::WriteAllText($ResultFile, ($result | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false)) }
                [Console]::WriteLine(($result | ConvertTo-Json -Compress))
                $script:ready=$true; $form.Close(); return
            }
            $script:scriptTask=$null
        } catch { $script:failure=$_.Exception.Message; $form.Close(); return }
    }
    if ($SelfTest -and $view.CoreWebView2 -and -not $script:scriptTask) {
        $script:scriptTask=$view.CoreWebView2.ExecuteScriptAsync('({desktop:!!document.querySelector(".nd-shell"),importInput:!!document.querySelector("input[type=file][accept=\".bin\"]"),hasCharacter:!!document.querySelector(".nm-character-page"),isBrowserTab:false,saveImport:window.__niohTestImport||null,savedNotice:!!window.__niohTestImport&&document.body.innerText.includes("#"+window.__niohTestImport.publicationVersion)})')
    }
    if ($SelfTest -and $script:ticks -gt 1200) { $script:failure='Desktop render or save test timed out'; $form.Close() }
})
$form.Add_Shown({
    try {
        $envTask=[Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($null,$Profile)
        while (-not $envTask.IsCompleted) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
        $environment=$envTask.GetAwaiter().GetResult()
        $initTask=$view.EnsureCoreWebView2Async($environment)
        while (-not $initTask.IsCompleted) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
        $initTask.GetAwaiter().GetResult() | Out-Null
        $view.CoreWebView2.Settings.AreDevToolsEnabled=$false
        $view.CoreWebView2.Add_NavigationStarting({ param($sender,$event) if (-not $event.Uri.StartsWith($Url)) { $event.Cancel=$true } })
        $view.CoreWebView2.Add_NewWindowRequested({ param($sender,$event) $event.Handled=$true })
        $view.CoreWebView2.Navigate($Url)
        if ($SelfTest) { $timer.Start() }
    } catch { $script:failure=$_.Exception.Message; $form.Close() }
})
[System.Windows.Forms.Application]::Run($form)
$timer.Stop(); $timer.Dispose(); $view.Dispose(); $form.Dispose()
if ($script:failure) { throw $script:failure }
if ($SelfTest -and -not $script:ready) { throw 'Desktop window did not render' }
