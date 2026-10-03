param(
    [switch]$CheckOnly,
    [string]$JdkPath,
    [string]$SdkPath,
    [string]$GradleCachePath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ASCII messages keep this script usable from both Windows PowerShell 5 and pwsh.
if (-not $JdkPath) { $JdkPath = $env:JAVA_HOME }
if (-not $JdkPath -and (Test-Path -LiteralPath 'D:\Android\jdk-21\bin\java.exe')) {
    $JdkPath = 'D:\Android\jdk-21'
}
if (-not $JdkPath -and (Test-Path -LiteralPath 'D:\Android\android-studio\jbr')) {
    $JdkPath = 'D:\Android\android-studio\jbr'
}
if (-not $JdkPath -and (Test-Path -LiteralPath 'C:\Program Files\Android\Android Studio\jbr')) {
    $JdkPath = 'C:\Program Files\Android\Android Studio\jbr'
}
if (-not $SdkPath) { $SdkPath = $env:ANDROID_HOME }
if (-not $SdkPath) { $SdkPath = $env:ANDROID_SDK_ROOT }
if (-not $SdkPath -and (Test-Path -LiteralPath 'D:\Android\sdk\platforms\android-36\android.jar')) {
    $SdkPath = 'D:\Android\sdk'
}
if (-not $SdkPath) { $SdkPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not $GradleCachePath) { $GradleCachePath = $env:GRADLE_USER_HOME }
if (-not $GradleCachePath -and (Test-Path -LiteralPath 'D:\Android')) {
    $GradleCachePath = 'D:\Android\gradle-cache'
}
if (-not $GradleCachePath) { $GradleCachePath = Join-Path $PSScriptRoot '.build\gradle' }

$missing = @()
if (-not $JdkPath -or -not (Test-Path -LiteralPath (Join-Path $JdkPath 'bin\java.exe'))) {
    $missing += 'JDK 21 (Android Studio bundled JBR is supported)'
}
if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'platforms\android-36\android.jar'))) {
    $missing += 'Android SDK Platform 36'
}
if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'build-tools'))) {
    $missing += 'Android SDK Build-Tools'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $missing += 'Node.js 22 or newer' }
if ($missing.Count -gt 0) {
    Write-Host 'Android build prerequisites are missing:'
    $missing | ForEach-Object { Write-Host " - $_" }
    Write-Host 'Install Android Studio and use SDK Manager. See docs/ANDROID_DEVELOPMENT.md.'
    exit 1
}
Write-Host 'Android build prerequisites found.'
if ($CheckOnly) { exit 0 }

$previousJdk = $env:JAVA_HOME
$previousSdk = $env:ANDROID_HOME
$previousGradle = $env:GRADLE_USER_HOME
$previousAndroidUser = $env:ANDROID_USER_HOME
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$previousJavaOptions = $env:JAVA_TOOL_OPTIONS
Push-Location $PSScriptRoot
try {
    $env:JAVA_HOME = $JdkPath
    $env:ANDROID_HOME = $SdkPath
    $env:GRADLE_USER_HOME = $GradleCachePath
    if (-not $env:ANDROID_USER_HOME -and (Test-Path -LiteralPath 'D:\Android\user')) {
        $env:ANDROID_USER_HOME = 'D:\Android\user'
    }
    if (Test-Path -LiteralPath 'D:\Android\temp') {
        $env:TEMP = 'D:\Android\temp'
        $env:TMP = 'D:\Android\temp'
        $env:JAVA_TOOL_OPTIONS = "$previousJavaOptions -Djava.io.tmpdir=D:\Android\temp -Djdk.net.unixdomain.tmpdir=D:\Android\temp".Trim()
    }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
    & npm.cmd run android:sync
    if ($LASTEXITCODE -ne 0) { throw 'Android asset build/sync failed.' }
    & (Join-Path $PSScriptRoot 'android\gradlew.bat') -p android assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android compilation failed.' }
    Write-Host 'Debug APK: android/app/build/outputs/apk/debug/app-debug.apk'
    Write-Host 'For internal testing only. Do not publish as a signed production release.'
} finally {
    $env:JAVA_HOME = $previousJdk
    $env:ANDROID_HOME = $previousSdk
    $env:GRADLE_USER_HOME = $previousGradle
    $env:ANDROID_USER_HOME = $previousAndroidUser
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
    $env:JAVA_TOOL_OPTIONS = $previousJavaOptions
    Pop-Location
}
