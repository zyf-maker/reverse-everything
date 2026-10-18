[CmdletBinding()]
param(
  [string]$Output,
  [string]$PythonHome,
  [string]$ChromiumArchive,
  [switch]$Clean
)
$ErrorActionPreference = 'Stop'
$plugin = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $plugin '..')).Path
$package = Get-Content -LiteralPath (Join-Path $plugin 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
$distRoot = [IO.Path]::GetFullPath((Join-Path $plugin 'dist')).TrimEnd('\')
if (-not $Output) { $Output = Join-Path $distRoot "replica-workbench-mcp-win-x64-v$version" }
$Output = [IO.Path]::GetFullPath($Output)
if ([IO.Path]::GetDirectoryName($Output) -ine $distRoot -or [IO.Path]::GetFileName($Output) -notmatch '^replica-workbench-mcp-win-x64-v\d+\.\d+\.\d+$') { throw "Output must be a versioned direct child of $distRoot" }
$zipPath = "$Output.zip"
$hashPath = "$zipPath.sha256"
if (Test-Path -LiteralPath $Output) {
  if ((Get-Item -LiteralPath $Output -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to build through a directory link.' }
  if (-not $Clean) { throw "Output already exists. Use -Clean to replace this package: $Output" }
  Remove-Item -LiteralPath $Output -Recurse -Force
}
if ((Test-Path -LiteralPath $zipPath) -or (Test-Path -LiteralPath $hashPath)) {
  foreach ($path in @($zipPath,$hashPath)) { if ((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Refusing to replace a linked file: $path" } }
  if (-not $Clean) { throw "Release archive already exists. Use -Clean to replace it: $zipPath" }
  Remove-Item -LiteralPath $zipPath,$hashPath -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
New-Item -ItemType Directory -Path $Output | Out-Null

function Copy-Tree([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force }
}
function Copy-PythonTree([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy $Source $Destination /E /XD site-packages __pycache__ /XF '*.pyc' '*.pyo' | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Copying Python standard library failed with exit code $LASTEXITCODE" }
}
function Copy-File([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

if (-not $PythonHome) { $PythonHome = Split-Path (Get-Command python -ErrorAction Stop).Source }
$browserLock = Get-Content -LiteralPath (Join-Path $plugin 'browser-lock.json') -Raw | ConvertFrom-Json
$chromiumRevision = $browserLock.revision
$chromiumSha256 = $browserLock.sha256
if (-not $ChromiumArchive) {
  $localArchive = Join-Path $plugin "..\verification\$($browserLock.archive)"
  $cacheRoot = Join-Path $env:LOCALAPPDATA 'ReplicaWorkbench\cache'
  $cachedArchive = Join-Path $cacheRoot $browserLock.archive
  if (Test-Path -LiteralPath $localArchive) { $ChromiumArchive = $localArchive }
  elseif (Test-Path -LiteralPath $cachedArchive) { $ChromiumArchive = $cachedArchive }
  else {
    New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
    $ChromiumArchive = $cachedArchive
    $uri = $browserLock.url
    Write-Host "Downloading pinned ungoogled Chromium $chromiumRevision..."
    Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $ChromiumArchive
  }
}
$ChromiumArchive = (Resolve-Path -LiteralPath $ChromiumArchive).Path
$archiveHash = (Get-FileHash -LiteralPath $ChromiumArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($archiveHash -ne $chromiumSha256) { throw "Chromium archive hash mismatch: $archiveHash" }
$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $PythonHome 'python.exe'))) { throw "PythonHome must contain python.exe: $PythonHome" }
$nodeVersion = (& $node --version).Trim()
$pythonExe = Join-Path $PythonHome 'python.exe'
$pythonVersion = (& $pythonExe --version).Trim()
if ([version]($nodeVersion.TrimStart('v')) -lt [version]'20.0') { throw "Node.js 20+ is required to build this package; found $nodeVersion" }
if ($pythonVersion -notmatch '^Python (\d+)\.(\d+)') { throw "Could not read Python version: $pythonVersion" }
if ([int]$Matches[1] -lt 3 -or ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -lt 10)) { throw "Python 3.10+ is required to build this package; found $pythonVersion" }

Copy-Tree (Join-Path $plugin 'server') (Join-Path $Output 'server')
Copy-Tree (Join-Path $plugin 'node_modules') (Join-Path $Output 'node_modules')
foreach ($file in @('README.md','plugin.json','mcp.json','.mcp.json','browser-lock.json')) { Copy-File (Join-Path $plugin $file) (Join-Path $Output $file) }
Copy-Tree (Join-Path $plugin '.claude-plugin') (Join-Path $Output '.claude-plugin')
Copy-Tree (Join-Path $plugin '.codex-plugin') (Join-Path $Output '.codex-plugin')
Copy-File (Join-Path $plugin 'install-host.ps1') (Join-Path $Output 'install-host.ps1')
Copy-File (Join-Path $plugin 'install-host.sh') (Join-Path $Output 'install-host.sh')

$workbench = Join-Path $Output 'workbench'
New-Item -ItemType Directory -Force -Path (Join-Path $workbench 'work') | Out-Null
foreach ($name in @('src','scenarios','config','docs')) { Copy-Tree (Join-Path $repo "replica-workbench\$name") (Join-Path $workbench $name) }
foreach ($name in @('pyproject.toml','run.ps1','run.sh','README.md','THIRD_PARTY_NOTICES.md')) { Copy-File (Join-Path $repo "replica-workbench\$name") (Join-Path $workbench $name) }

$platform = Join-Path $Output 'own-reverse-platform'
foreach ($name in @('runtime','static-analyzer')) {
  $source = Join-Path $repo "own-reverse-platform\$name"
  $destination = Join-Path $platform $name
  Copy-Tree (Join-Path $source 'src') (Join-Path $destination 'src')
  if (Test-Path -LiteralPath (Join-Path $source 'node_modules')) { Copy-Tree (Join-Path $source 'node_modules') (Join-Path $destination 'node_modules') }
  foreach ($file in @('package.json','package-lock.json')) { if (Test-Path -LiteralPath (Join-Path $source $file)) { Copy-File (Join-Path $source $file) (Join-Path $destination $file) } }
}

$runtime = Join-Path $Output 'runtime'
Copy-File $node (Join-Path $runtime 'node.exe')
$runtimeChrome = Join-Path $runtime 'chrome'
Expand-Archive -LiteralPath $ChromiumArchive -DestinationPath $runtime -Force
$snapshotChrome = Join-Path $runtime $browserLock.directory
if (-not (Test-Path -LiteralPath (Join-Path $snapshotChrome 'chrome.exe'))) { throw 'Pinned Chromium distribution did not contain chrome-win/chrome.exe.' }
Move-Item -LiteralPath $snapshotChrome -Destination $runtimeChrome
$chromiumManifest = Get-ChildItem -LiteralPath $runtimeChrome -File -Filter '*.manifest' | Select-Object -First 1
if (-not $chromiumManifest) { throw 'Pinned Chromium distribution did not contain a version manifest.' }
$chromiumVersion = [IO.Path]::GetFileNameWithoutExtension($chromiumManifest.Name)
if ($chromiumVersion -ne $browserLock.version) { throw "Chromium version mismatch: $chromiumVersion" }
$python = Join-Path $runtime 'python'
foreach ($file in @('python.exe','pythonw.exe','vcruntime140.dll','vcruntime140_1.dll')) { if (Test-Path -LiteralPath (Join-Path $PythonHome $file)) { Copy-File (Join-Path $PythonHome $file) (Join-Path $python $file) } }
Get-ChildItem -LiteralPath $PythonHome -File -Filter 'python*.dll' | ForEach-Object { Copy-File $_.FullName (Join-Path $python $_.Name) }
Get-ChildItem -LiteralPath $PythonHome -File -Filter 'python*._pth' | ForEach-Object { Copy-File $_.FullName (Join-Path $python $_.Name) }
if (Test-Path -LiteralPath (Join-Path $PythonHome 'DLLs')) { Copy-Tree (Join-Path $PythonHome 'DLLs') (Join-Path $python 'DLLs') }
Copy-PythonTree (Join-Path $PythonHome 'Lib') (Join-Path $python 'Lib')

$manifest = [ordered]@{
  name='replica-workbench-mcp'; version=$version; platform='win-x64'; selfContained=$true
  entry='server/index.mjs'; browser='runtime/chrome/chrome.exe'; node='runtime/node.exe'; python='runtime/python/python.exe'
  runtimes=[ordered]@{ node=$nodeVersion; python=$pythonVersion; chromium=$chromiumVersion; chromiumRevision=$chromiumRevision }; hosts=@('codex','claude-code','mcp-compatible')
}
$manifestJson = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $Output 'manifest.json'), "$manifestJson`n", [Text.UTF8Encoding]::new($false))
$licenses = Join-Path $Output 'licenses'
$pythonLicense = Join-Path $PythonHome 'LICENSE.txt'
if (-not (Test-Path -LiteralPath $pythonLicense)) { throw 'PythonHome must include LICENSE.txt.' }
Copy-File $pythonLicense (Join-Path $licenses 'python-LICENSE.txt')
$nodeLicense = Join-Path $licenses 'node-LICENSE'
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile $nodeLicense
foreach ($required in @('chromium-LICENSE','ungoogled-chromium-LICENSE','ungoogled-chromium-windows-LICENSE','SOURCE_CODE.md')) {
  $licenseSource = Join-Path (Join-Path $plugin 'licenses') $required
  if (-not (Test-Path -LiteralPath $licenseSource) -or (Get-Item -LiteralPath $licenseSource).Length -eq 0) { throw "Required browser redistribution file missing: $required" }
}
Copy-Tree (Join-Path $plugin 'licenses') $licenses
& $pythonExe (Join-Path $plugin 'scripts\browser_notices.py') --browser (Join-Path $runtimeChrome 'chrome.exe') --output $licenses --lock (Join-Path $plugin 'browser-lock.json')
if ($LASTEXITCODE -ne 0) { throw 'Complete browser third-party notices are required; refusing to create a release ZIP.' }
$noticeManifest = Get-Content -LiteralPath (Join-Path $licenses 'chromium-notice-manifest.json') -Raw | ConvertFrom-Json
$manifest.runtimes.chromiumDistribution = $browserLock.distribution
$manifest['notices'] = [ordered]@{ chromiumProducts=$noticeManifest.products; chromium='licenses/chromium-THIRD-PARTY-NOTICES.html'; manifest='licenses/chromium-notice-manifest.json' }
$manifestJson = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $Output 'manifest.json'), "$manifestJson`n", [Text.UTF8Encoding]::new($false))
$chromiumSource = @"
Chromium runtime provenance
===========================
Binary: unbranded ungoogled Chromium, Windows x64
Version: $chromiumVersion
Revision: $chromiumRevision
Archive SHA-256: $chromiumSha256
Archive: $($browserLock.url)
Chromium source: $($browserLock.chromiumSource)
Patch source: $($browserLock.patchSource)
Windows build source: $($browserLock.buildSource)
Generated credits exported from this exact binary: $($noticeManifest.products) components.
See chromium-THIRD-PARTY-NOTICES.html (offline), chromium-THIRD-PARTY-NOTICES.txt,
chromium-credits.raw.html (original export), and chromium-notice-manifest.json (hashes).
"@
[IO.File]::WriteAllText((Join-Path $licenses 'chromium-PROVENANCE.txt'), $chromiumSource.Trim() + "`n", [Text.UTF8Encoding]::new($false))
$licenseReadme = @(
  'Runtime licenses and pinned Chromium provenance are included under this directory.',
  'chromium-THIRD-PARTY-NOTICES.html and .txt contain all components from the bundled browser credits.',
  'chromium-notice-manifest.json records component names and notice content hashes.',
  'Node module licenses are retained under node_modules.',
  'See SOURCE_CODE.md for corresponding browser source and build information.',
  'See workbench/THIRD_PARTY_NOTICES.md for project dependency notices.'
)
[IO.File]::WriteAllText((Join-Path $licenses 'README.txt'), ($licenseReadme -join "`n") + "`n", [Text.UTF8Encoding]::new($false))

if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { throw 'Windows tar.exe is required to create the release archive.' }
& tar.exe -a -cf $zipPath -C $distRoot (Split-Path $Output -Leaf)
if ($LASTEXITCODE -ne 0) { throw "Creating package ZIP failed with exit code $LASTEXITCODE" }
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path $zipPath -Leaf)" | Set-Content -LiteralPath $hashPath -Encoding ASCII
Write-Host "Built self-contained MCP plugin: $Output"
Write-Host "Created archive: $zipPath"
Write-Host "SHA-256: $hash"
