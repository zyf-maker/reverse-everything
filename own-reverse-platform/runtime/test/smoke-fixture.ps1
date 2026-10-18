$ErrorActionPreference = 'Stop'

function Get-FreeLoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Stop-ProcessTree {
  param([System.Diagnostics.Process]$Process)
  if ($null -eq $Process) { return }
  try {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.Id /T /F *> $null
  } catch {
    # The process may already have exited; the cleanup attempt remains best-effort.
  }
  try {
    if (-not $Process.HasExited) {
      Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
  } catch {
    # The process may have exited between taskkill and the status check.
  }
}

function Remove-RunRoot {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $tempPrefix = if ($tempRoot.EndsWith('\') -or $tempRoot.EndsWith('/')) {
    $tempRoot
  } else {
    $tempRoot + [IO.Path]::DirectorySeparatorChar
  }
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $canonical = [IO.Path]::GetFullPath($resolved)
  $directory = Get-Item -LiteralPath $canonical
  $leaf = $directory.Name
  if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Refusing to remove a reparse-point run directory: $canonical"
  }
  if (-not $canonical.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or
      $leaf -notmatch '^rr-runtime-fixture-[0-9a-f]{32}$') {
    throw "Refusing to remove an unexpected run directory: $canonical"
  }
  Remove-Item -LiteralPath $canonical -Recurse -Force
}

$fixture = (Resolve-Path (Join-Path $PSScriptRoot '..\examples')).Path
$runRoot = Join-Path ([IO.Path]::GetTempPath()) ("rr-runtime-fixture-{0}" -f ([guid]::NewGuid().ToString('N')))
$fixtureRoot = Join-Path $runRoot 'fixture'
$profilePath = Join-Path $runRoot 'profile'
$inspectPath = Join-Path $runRoot 'inspect.json'
$capturePath = Join-Path $runRoot 'capture.json'
$server = $null
$blockedServer = $null
$browser = $null

try {
  New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $fixture 'static-page.html') -Destination $fixtureRoot

  $serverPort = Get-FreeLoopbackPort
  $blockedPort = Get-FreeLoopbackPort
  while ($blockedPort -eq $serverPort) { $blockedPort = Get-FreeLoopbackPort }
  $debugPort = Get-FreeLoopbackPort
  while ($debugPort -in @($serverPort, $blockedPort)) { $debugPort = Get-FreeLoopbackPort }

  $pageOrigin = "http://127.0.0.1:$serverPort"
  $blockedOrigin = "http://127.0.0.1:$blockedPort"
  $pageUrl = "$pageOrigin/static-page.html"
  $blockedUrl = "$blockedOrigin/blocked"
  $pagePath = Join-Path $fixtureRoot 'static-page.html'
  (Get-Content -LiteralPath $pagePath -Raw) -replace 'http://127\.0\.0\.1:\d+/blocked', $blockedUrl |
    Set-Content -LiteralPath $pagePath -Encoding utf8

  $server = Start-Process -FilePath 'python' -ArgumentList @('-m','http.server',"$serverPort",'--bind','127.0.0.1') -WorkingDirectory $fixtureRoot -PassThru
  $blockedServer = Start-Process -FilePath 'python' -ArgumentList @('-m','http.server',"$blockedPort",'--bind','127.0.0.1') -WorkingDirectory $fixtureRoot -PassThru
  $browser = Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList @('--headless=new','--disable-gpu','--no-sandbox',"--remote-debugging-port=$debugPort",("--user-data-dir={0}" -f $profilePath),$pageUrl) -PassThru

  Start-Sleep -Seconds 3
  & node src/cli.js inspect --endpoint "http://127.0.0.1:$debugPort" --out "$inspectPath"
  $captureArgs = @('src/cli.js', 'capture', '--endpoint', "http://127.0.0.1:$debugPort",
    '--page-url', $pageUrl, '--navigate', "${pageUrl}?probe=1", '--allow-origin', $pageOrigin,
    '--duration-ms', '800', '--out', $capturePath)
  & node @captureArgs
  $capture = Get-Content -LiteralPath $capturePath -Raw | ConvertFrom-Json
  $blocked = @($capture.events | Where-Object { $_.kind -eq 'request.blocked' -and $_.payload.url -eq $blockedUrl })
  if ($blocked.Count -ne 1) { throw 'Runtime did not record the out-of-origin request as blocked' }
  'exact-origin network guard passed'
} finally {
  Stop-ProcessTree $browser
  Stop-ProcessTree $server
  Stop-ProcessTree $blockedServer
  Remove-RunRoot $runRoot
}
