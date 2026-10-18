$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 20+ is required for the MCP plugin' }
$nodeVersion = & $node.Source --version
$major = [int]($nodeVersion -replace '^v?(\d+).*','$1')
if ($major -lt 20) { throw "Node.js 20+ is required; found $nodeVersion" }
Push-Location $root
try { npm ci --ignore-scripts }
finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "Reverse Everything dependency installation failed with exit code $LASTEXITCODE" }
Write-Host 'Reverse Everything MCP dependencies installed. Register replica-unified with your MCP host.'
