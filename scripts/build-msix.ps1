<#
.SYNOPSIS
  Builds The Love Media (Tauri v2) into an MSIX package suitable for the
  Microsoft Store (Partner Center) or sideloading.

.DESCRIPTION
  Tauri's bundler does not emit MSIX, so this script bridges the gap:

    1. Runs the Tauri release build (unless -SkipBuild is passed).
    2. Locates makeappx.exe + signtool.exe from the installed Windows SDK.
    3. Assembles an MSIX layout folder (app exe + Store image assets).
    4. Injects Partner Center identity values into AppxManifest.xml.
    5. Packs the layout into a .msix (or .msixupload) with makeappx.
    6. Optionally signs the package with a .pfx (for local testing).

.PARAMETER PackageName
  The MSIX Identity Name. MUST match the value Partner Center shows for your
  reserved app (Product identity -> Package/Identity/Name).
  Default: the Tauri bundle identifier.

.PARAMETER Publisher
  The MSIX Publisher string. MUST match Partner Center exactly and is always
  in the form CN=<Guid>. Default: a clearly-marked placeholder that will NOT
  upload to the Store (so you don't accidentally submit a wrong identity).

.PARAMETER PublisherDisplayName
  Human-readable publisher name shown in the Store. Default: "The Love Media".

.PARAMETER Version
  Four-part MSIX version (major.minor.patch.build). Default: derived from
  package.json, padded with a trailing ".0".

.PARAMETER Architecture
  x64 | x86 | arm64. Default: x64.

.PARAMETER CertificatePath
  Optional path to a .pfx used to sign the package for local side-loading.
  Store submissions are re-signed by Microsoft, so this is normally omitted.

.PARAMETER CertificatePassword
  Password for the .pfx, as a SecureString.

.PARAMETER SkipBuild
  Skip `npm run tauri:build` and reuse the last release binary.

.EXAMPLE
  ./scripts/build-msix.ps1 -PackageName "12345Daisyator.TheLoveMedia" `
      -Publisher "CN=1a2b3c4d-0000-0000-0000-000000000000"

.EXAMPLE
  ./scripts/build-msix.ps1 -SkipBuild -CertificatePath ./dev.pfx -CertificatePassword (Read-Host -AsSecureString)
#>
[CmdletBinding()]
param(
  [string]$PackageName = "com.thelovemedia.desktop",
  [string]$Publisher = "CN=PLACEHOLDER-SET-ME-FROM-PARTNER-CENTER",
  [string]$PublisherDisplayName = "The Love Media",
  [string]$Version,
  [ValidateSet("x64", "x86", "arm64")]
  [string]$Architecture = "x64",
  [string]$CertificatePath,
  [System.Security.SecureString]$CertificatePassword,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

# --- Resolve paths relative to the repository root -------------------------
$RepoRoot   = Split-Path -Parent $PSScriptRoot
$SrcTauri   = Join-Path $RepoRoot "src-tauri"
$ManifestTpl = Join-Path $SrcTauri "msix\AppxManifest.xml"
$AssetSource = Join-Path $SrcTauri "icons"
$ReleaseDir  = Join-Path $SrcTauri "target\release"
$OutputDir   = Join-Path $SrcTauri "target\msix"
$LayoutDir   = Join-Path $OutputDir "layout"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "!!  $msg" -ForegroundColor Yellow }

# --- Determine MSIX version ------------------------------------------------
if (-not $Version) {
  $pkg = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
  $parts = @($pkg.version -split "\.")
  while ($parts.Count -lt 4) { $parts += "0" }
  $Version = ($parts[0..3] -join ".")
}
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') {
  throw "MSIX Version must be four integers (e.g. 1.0.0.0). Got: $Version"
}

# --- Locate Windows SDK tooling --------------------------------------------
function Find-SdkTool([string]$name) {
  $bases = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "$env:ProgramFiles\Windows Kits\10\bin"
  )
  $hits = foreach ($b in $bases) {
    if (Test-Path -LiteralPath $b) {
      Get-ChildItem -LiteralPath $b -Recurse -Filter $name -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "\\$Architecture\\" } |
        Sort-Object FullName -Descending
    }
  }
  if ($hits) { return ($hits | Select-Object -First 1).FullName }
  return $null
}

$makeappx = Find-SdkTool "makeappx.exe"
if (-not $makeappx) {
  throw @"
makeappx.exe was not found. Install the Windows SDK (the 'Windows SDK for
Desktop C++' / 'MSIX Packaging Tools' workload) from
https://developer.microsoft.com/windows/downloads/windows-sdk/ and re-run.
"@
}
Write-Step "Using makeappx: $makeappx"

# --- 1. Build the Tauri desktop binary -------------------------------------
if (-not $SkipBuild) {
  Write-Step "Building Tauri release bundle"
  Push-Location $RepoRoot
  try {
    & npm run tauri:build
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
} else {
  Write-Warn "SkipBuild set - reusing existing release output"
}

# --- 2. Assemble the MSIX layout -------------------------------------------
Write-Step "Assembling MSIX layout at $LayoutDir"
if (Test-Path -LiteralPath $LayoutDir) { Remove-Item -Recurse -Force -LiteralPath $LayoutDir }
New-Item -ItemType Directory -Force -Path $LayoutDir | Out-Null
$assetsDir = Join-Path $LayoutDir "Assets"
New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null

# Copy every packaging logo Tauri generated (StoreLogo, Square*, Wide*, etc.)
Get-ChildItem -LiteralPath $AssetSource -Filter *.png | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $assetsDir -Force
}
if (-not (Test-Path (Join-Path $assetsDir "StoreLogo.png"))) {
  throw "StoreLogo.png missing. Run 'npm run tauri icon' to regenerate src-tauri/icons first."
}

# Copy the compiled application. Tauri emits app.exe (binary name from Cargo.toml).
$exeName = "app.exe"
$exePath = Join-Path $ReleaseDir $exeName
if (-not (Test-Path -LiteralPath $exePath)) {
  # Fall back to any single .exe that isn't a helper DLL-target.
  $candidate = Get-ChildItem -LiteralPath $ReleaseDir -Filter *.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch "crashpad|setup" } | Select-Object -First 1
  if ($candidate) { $exeName = $candidate.Name; $exePath = $candidate.FullName }
}
if (-not (Test-Path -LiteralPath $exePath)) {
  throw "Could not find the built application .exe in $ReleaseDir. Build first."
}
Write-Step "Packaging executable: $exeName"
Copy-Item -LiteralPath $exePath -Destination $LayoutDir -Force

# Ship any additional loose runtime files Tauri/WebView2 produced next to the exe
Get-ChildItem -LiteralPath $ReleaseDir -File | Where-Object {
  $_.Extension -in ".dll", ".json" -and $_.Name -notmatch "^(build|.*\.d)\.(json|d)$"
} | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $LayoutDir -Force }

# --- 3. Inject identity values into the manifest ---------------------------
Write-Step "Writing AppxManifest.xml"
$manifest = Get-Content -LiteralPath $ManifestTpl -Raw
$manifest = $manifest.Replace("{{PACKAGE_NAME}}", $PackageName)
$manifest = $manifest.Replace("{{PUBLISHER}}", $Publisher)
$manifest = $manifest.Replace("{{PUBLISHER_DISPLAY_NAME}}", $PublisherDisplayName)
$manifest = $manifest.Replace("{{VERSION}}", $Version)
$manifest = $manifest.Replace("{{ARCHITECTURE}}", $Architecture)
$manifest = $manifest.Replace("{{EXECUTABLE}}", $exeName)
$manifest | Set-Content -LiteralPath (Join-Path $LayoutDir "AppxManifest.xml") -Encoding UTF8

# --- 4. Pack ---------------------------------------------------------------
$msixPath = Join-Path $OutputDir "TheLoveMedia_${Version}_${Architecture}.msix"
Write-Step "Packing $msixPath"
& $makeappx pack /d $LayoutDir /p $msixPath /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed with exit code $LASTEXITCODE" }

# --- 5. Optional local signing --------------------------------------------
if ($CertificatePath) {
  $signtool = Find-SdkTool "signtool.exe"
  if (-not $signtool) { throw "signtool.exe not found; cannot sign." }
  Write-Step "Signing package for local testing"
  $signArgs = @("sign", "/fd", "SHA256", "/f", $CertificatePath)
  if ($CertificatePassword) { $signArgs += @("/p", $CertificatePassword) }
  $signArgs += $msixPath
  & $signtool @signArgs
  if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE" }
} else {
  Write-Warn "Package left unsigned. The Store re-signs uploads, but to sideload locally run:"
  Write-Warn "  makeappx ... then signtool sign /fd SHA256 /f <your.pfx> `"$msixPath`""
}

Write-Host ""
Write-Host "MSIX ready: $msixPath" -ForegroundColor Green
Write-Host "Upload this file (or an .msixupload bundle) in Partner Center > Packages." -ForegroundColor Green