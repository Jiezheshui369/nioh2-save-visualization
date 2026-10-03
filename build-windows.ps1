param([switch]$SkipWebBuild, [switch]$SkipTests, [string]$PythonPath, [string]$BuildToolsPath, [string]$DesktopRuntimePath)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$package = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
if ($package.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid package version.' }
$releaseBase = Join-Path $projectRoot "release\windows-$($package.version)"
$releaseApp = Join-Path $releaseBase 'Nioh2SaveCompanion'
$archive = Join-Path $projectRoot "release\仁王2存档伴侣-$($package.version)-windows-x64.zip"
$checksum = Join-Path $projectRoot "release\仁王2存档伴侣-$($package.version)-windows-x64.sha256.txt"
foreach ($target in @($releaseBase, $archive, $checksum)) {
    if (Test-Path -LiteralPath $target) { throw "Refusing to overwrite existing release: $target. Choose a new package version." }
}

if (-not $SkipWebBuild) {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "网页生产构建失败。" }
}

$pythonExe = $null
if ($PythonPath) { $pythonExe = (Resolve-Path -LiteralPath $PythonPath).Path }
foreach ($candidate in @("python", "python3")) {
    if ($pythonExe) { break }
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
        & $command.Source --version *> $null
        if ($LASTEXITCODE -eq 0) { $pythonExe = $command.Source; break }
    }
}
if (-not $pythonExe) {
    $codexPython = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    if (Test-Path -LiteralPath $codexPython) { $pythonExe = $codexPython }
}
if (-not $pythonExe) { throw "未找到可用的 Python。" }

& $pythonExe -c "import cryptography; assert cryptography.__version__ == '50.0.1'"
if ($LASTEXITCODE -ne 0) { throw "加密同步需要 cryptography 50.0.1；请在构建环境安装 packaging/requirements-runtime.txt。" }

if (-not $SkipTests) {
    & $pythonExe -m unittest discover -s agent\tests -v
    if ($LASTEXITCODE -ne 0) { throw "Python 回归测试失败。" }
    npm test -- --run
    if ($LASTEXITCODE -ne 0) { throw "网页回归测试失败。" }
}

$buildTools = if ($BuildToolsPath) { [IO.Path]::GetFullPath($BuildToolsPath) } else { Join-Path $projectRoot ".build-tools-sync" }
$desktopRuntime = if ($DesktopRuntimePath) { [IO.Path]::GetFullPath($DesktopRuntimePath) } else { Join-Path $projectRoot '.desktop-runtime' }
$previousPythonPath = $env:PYTHONPATH
try {
$env:PYTHONPATH = "$buildTools;$desktopRuntime"
& $pythonExe -c "import webview; import importlib.metadata as m; assert m.version('pywebview') == '6.2.1'" 2>$null
if ($LASTEXITCODE -ne 0) {
    & $pythonExe -m pip install --disable-pip-version-check --no-index --find-links .build-wheelhouse --require-hashes --target $desktopRuntime -r packaging\requirements-desktop.txt
    if ($LASTEXITCODE -ne 0) { throw 'Desktop WebView runtime dependencies are missing.' }
    & $pythonExe -c "import webview; import importlib.metadata as m; assert m.version('pywebview') == '6.2.1'"
    if ($LASTEXITCODE -ne 0) { throw 'Desktop runtime remains unreadable. Preserve the old cache and specify a NEW -DesktopRuntimePath directory; do not change file permissions or delete the old cache.' }
}
& $pythonExe -c "import PyInstaller.__main__" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "正在从项目离线 wheel 缓存安装锁定版本的 PyInstaller（不修改系统 Python）。"
    & $pythonExe -m pip install --disable-pip-version-check --no-index --find-links .build-wheelhouse --require-hashes --target $buildTools -r packaging\requirements-build.txt
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller 构建依赖安装失败。" }
    & $pythonExe -c "import PyInstaller.__main__"
    if ($LASTEXITCODE -ne 0) { throw 'Build tools remain unreadable. Preserve the old cache and specify a NEW -BuildToolsPath directory.' }
}

& $pythonExe -m PyInstaller --noconfirm --distpath $releaseBase --workpath ".build\pyinstaller-$($package.version)" packaging\nioh2_companion.spec
if ($LASTEXITCODE -ne 0) { throw "Windows 打包失败。" }
} finally {
    $env:PYTHONPATH = $previousPythonPath
}

Copy-Item -LiteralPath packaging\启动手机模式.cmd -Destination (Join-Path $releaseApp '启动手机模式.cmd')
Copy-Item -LiteralPath packaging\启动手机模式.cmd -Destination (Join-Path $releaseApp 'Start-Phone-Mode.cmd')
Copy-Item -LiteralPath packaging\USER_GUIDE.txt -Destination (Join-Path $releaseApp 'TESTING-GUIDE.txt')
Copy-Item -LiteralPath packaging\Start-Sync-Test.cmd -Destination $releaseApp
Copy-Item -LiteralPath packaging\Start-Browser-Mode.cmd -Destination $releaseApp
Copy-Item -LiteralPath docs\WINDOWS_APP_074.md -Destination (Join-Path $releaseApp 'WINDOWS-APP-TEST.md')
Copy-Item -LiteralPath docs\ANDROID_SYNC_TEST.md -Destination (Join-Path $releaseApp 'ANDROID-SYNC-TEST.md')
Copy-Item -LiteralPath docs\MAC_HANDOFF.md -Destination $releaseApp

& $pythonExe packaging\verify_release.py $releaseApp
if ($LASTEXITCODE -ne 0) { throw "发布目录安全校验失败。" }

Compress-Archive -LiteralPath $releaseApp -DestinationPath $archive -CompressionLevel Optimal
& $pythonExe packaging\verify_release.py $releaseApp --archive $archive
if ($LASTEXITCODE -ne 0) { throw "ZIP 发布包安全校验失败。" }
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
Set-Content -LiteralPath $checksum -Value "$archiveHash  $([IO.Path]::GetFileName($archive))" -Encoding utf8

Write-Host "构建完成：$releaseApp\仁王2存档伴侣.exe"
Write-Host "发布包：$archive"
Write-Host "SHA-256：$archiveHash"
