$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$workbench = Join-Path $root '..\replica-workbench'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 20+ is required for the MCP plugin' }
$nodeVersion = & $node.Source --version
$major = [int]($nodeVersion -replace '^v?(\d+).*','$1')
if ($major -lt 20) { throw "Node.js 20+ is required; found $nodeVersion" }
if (-not (Test-Path (Join-Path $workbench 'install.ps1'))) { throw "Replica Workbench not found at $workbench" }
& (Join-Path $workbench 'install.ps1')
if ($LASTEXITCODE -ne 0) { throw "Replica Workbench installation failed with exit code $LASTEXITCODE" }
Push-Location $root
try { npm install --ignore-scripts }
finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "MCP plugin dependency installation failed with exit code $LASTEXITCODE" }
Write-Host 'Replica MCP plugin installed. Configure mcp.json in your agent host, then run npm run doctor.'
