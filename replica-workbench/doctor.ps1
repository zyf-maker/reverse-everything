param([switch]$RequireDocker, [string]$Cdp)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = (Get-Command python -ErrorAction Stop).Source }
$env:PYTHONPATH = Join-Path $root 'src'
$args = @('doctor')
if ($RequireDocker) { $args += '--require-docker' }
if ($Cdp) { $args += @('--cdp', $Cdp) }
& $python -m replica_platform.cli @args
exit $LASTEXITCODE
