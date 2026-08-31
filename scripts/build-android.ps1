$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root "android"

function Find-JavaHome {
  $candidates = @()
  foreach ($scope in @("Process", "User", "Machine")) {
    $value = [Environment]::GetEnvironmentVariable("JAVA_HOME", $scope)
    if ($value) { $candidates += $value }
  }
  $candidates += @(
    "${env:ProgramFiles}\Microsoft\jdk-17.0.20.101-hotspot",
    "${env:ProgramFiles}\Android\Android Studio\jbr"
  )
  $candidates += Get-ChildItem "${env:ProgramFiles}\Microsoft" -Directory -Filter "jdk-*" -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName }
  $candidates += Get-ChildItem "${env:ProgramFiles}\Eclipse Adoptium" -Directory -Filter "jdk-*" -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName }
  $candidates += Get-ChildItem "${env:ProgramFiles}\Java" -Directory -Filter "jdk-*" -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName }

  foreach ($jdkHome in $candidates | Where-Object { $_ } | Select-Object -Unique) {
    if (Test-Path (Join-Path $jdkHome "bin\java.exe")) { return $jdkHome }
  }
  return $null
}

if (-not (Get-Command java -ErrorAction SilentlyContinue) -or -not $env:JAVA_HOME) {
  $javaHome = Find-JavaHome
  if (-not $javaHome) {
    Write-Error "JDK 17 не найден. Установите Microsoft OpenJDK 17 и откройте новый терминал, либо задайте JAVA_HOME."
    exit 1
  }
  $env:JAVA_HOME = $javaHome
  $env:Path = "$(Join-Path $javaHome 'bin');$env:Path"
  Write-Host "JAVA_HOME=$javaHome"
}

if (-not $env:ANDROID_HOME) {
  $defaultSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
  if (Test-Path $defaultSdk) { $env:ANDROID_HOME = $defaultSdk }
}

$localProps = Join-Path $android "local.properties"
if (-not (Test-Path $localProps) -and $env:ANDROID_HOME) {
  $sdk = ($env:ANDROID_HOME -replace '\\', '\\')
  "sdk.dir=$($env:ANDROID_HOME -replace '\\', '/')" | Set-Content -Path $localProps -Encoding ASCII
}

Set-Location $android
& .\gradlew.bat assembleRelease --no-daemon
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$apk = Join-Path $android "app\build\outputs\apk\release\app-release.apk"
Write-Host ""
Write-Host "Android APK: $apk"
