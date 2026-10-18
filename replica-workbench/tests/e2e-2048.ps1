$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$root = Split-Path -Parent $repo
$caseRoot = Join-Path $repo 'work\e2e-2048-20261017-final'
$rebuildRoot = Join-Path $repo 'work\own-2048-platform-rebuild'
$scenario = Join-Path $repo 'scenarios\2048-comprehensive.json'
$env:PYTHONPATH = Join-Path $repo 'src'
Push-Location $root
try {
  python -m replica_platform.cli verify --case $caseRoot --rebuild $rebuildRoot --scenario $scenario
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
