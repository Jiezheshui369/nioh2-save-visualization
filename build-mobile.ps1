param([switch]$SkipWebBuild)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not $SkipWebBuild) {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "网页生产构建失败。" }
}

$package = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
$mobileRoot = Join-Path $projectRoot "release\mobile-web"
$archive = Join-Path $projectRoot "release\仁王2存档伴侣-$($package.version)-iphone-web.zip"
$checksum = Join-Path $projectRoot "release\仁王2存档伴侣-$($package.version)-iphone-web.sha256.txt"

if (Test-Path -LiteralPath $mobileRoot) { Remove-Item -LiteralPath $mobileRoot -Recurse -Force }
New-Item -ItemType Directory -Path $mobileRoot | Out-Null
Copy-Item -Path (Join-Path $projectRoot "dist\*") -Destination $mobileRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "public\_headers") -Destination (Join-Path $mobileRoot "_headers") -Force

$demo = Join-Path $mobileRoot "data\demo-snapshot.json"
if (Test-Path -LiteralPath $demo) { Remove-Item -LiteralPath $demo -Force }
if (Test-Path -LiteralPath (Split-Path -Parent $demo)) {
    $remaining = Get-ChildItem -LiteralPath (Split-Path -Parent $demo) -Force
    if ($remaining.Count -eq 0) { Remove-Item -LiteralPath (Split-Path -Parent $demo) -Force }
}

$forbidden = Get-ChildItem -LiteralPath $mobileRoot -Recurse -File | Where-Object {
    $_.Name -in @("SAVEDATA.BIN", "BACKUP.BIN") -or $_.FullName -match "[\\/]\.local[\\/]"
}
if ($forbidden) { throw "手机发布包混入了禁止文件：$($forbidden.FullName -join ', ')" }

if (-not (Test-Path -LiteralPath (Join-Path $mobileRoot "sw.js"))) { throw "手机发布包缺少 Service Worker。" }
if (-not (Test-Path -LiteralPath (Join-Path $mobileRoot "manifest.webmanifest"))) { throw "手机发布包缺少应用清单。" }
if (-not (Test-Path -LiteralPath (Join-Path $mobileRoot "_headers"))) { throw "手机发布包缺少 HTTPS 安全响应头配置。" }

if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
Compress-Archive -Path (Join-Path $mobileRoot "*") -DestinationPath $archive -CompressionLevel Optimal
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
Set-Content -LiteralPath $checksum -Value "$archiveHash  $([IO.Path]::GetFileName($archive))" -Encoding utf8

Write-Host "iPhone Web 发布包：$archive"
Write-Host "SHA-256：$archiveHash"
