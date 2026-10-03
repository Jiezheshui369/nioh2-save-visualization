param([switch]$Lan)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "dist\index.html"))) {
    throw "尚未找到 dist\index.html，请先运行 npm install 和 npm run build。"
}

$store = Join-Path $projectRoot ".local\snapshots"
New-Item -ItemType Directory -Path $store -Force | Out-Null

if ($Lan) {
    Write-Host "正在开启局域网手机测试模式。只应在可信任的家庭专用网络中使用。"
    Write-Host "启动后请在手机打开终端显示的 Phone pairing URL。"
} else {
    Write-Host "仁王2 存档伴侣正在本机启动： http://127.0.0.1:13252/"
}
Write-Host "按 Ctrl+C 停止。Agent 不提供存档写回功能。"

$pythonExe = $null
$pythonPrefix = @()
foreach ($candidate in @("python", "python3")) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
        & $command.Source --version *> $null
        if ($LASTEXITCODE -eq 0) {
            $pythonExe = $command.Source
            break
        }
    }
}

if (-not $pythonExe) {
    $launcher = Get-Command "py" -ErrorAction SilentlyContinue
    if ($launcher) {
        & $launcher.Source -3 --version *> $null
        if ($LASTEXITCODE -eq 0) {
            $pythonExe = $launcher.Source
            $pythonPrefix = @("-3")
        }
    }
}

if (-not $pythonExe) {
    $userProfile = [Environment]::GetFolderPath("UserProfile")
    $codexPython = Join-Path $userProfile ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    if (Test-Path -LiteralPath $codexPython) {
        & $codexPython --version *> $null
        if ($LASTEXITCODE -eq 0) {
            $pythonExe = $codexPython
        }
    }
}

if (-not $pythonExe) {
    throw "未找到可用的 Python 3.11+。请先安装 Python，并勾选 Add Python to PATH。"
}

$serveArguments = @("-m", "agent.nioh2_agent", "serve", "--store", $store, "--web-root", (Join-Path $projectRoot "dist"))
if ($Lan) { $serveArguments += "--lan" }
& $pythonExe @pythonPrefix @serveArguments
