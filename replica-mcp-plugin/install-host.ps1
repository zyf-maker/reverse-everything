[CmdletBinding()]
param(
  [ValidateSet('codex','claude','both')]
  [string]$Agent = 'both'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$node = Join-Path $root 'runtime\node.exe'
$server = Join-Path $root 'server\index.mjs'
if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $server -PathType Leaf)) {
  throw 'This installer must be run from an extracted self-contained package.'
}

$targets = if ($Agent -eq 'both') { @('codex','claude') } else { @($Agent) }
$commands = @{}
foreach ($target in $targets) {
  $command = Get-Command $target -ErrorAction SilentlyContinue
  if (-not $command) { throw "The $target CLI was not found. Use the host plugin UI or install its CLI first." }
  $commands[$target] = $command.Source
}

foreach ($target in $targets) {
  if ($target -eq 'codex') {
    & $commands[$target] mcp add replica-unified -- $node $server
  } else {
    & $commands[$target] mcp add --scope user --transport stdio replica-unified -- $node $server
  }
  if ($LASTEXITCODE -ne 0) { throw "Registering Reverse Everything with $target failed with exit code $LASTEXITCODE" }
}
Write-Host "Registered Reverse Everything with: $($targets -join ', '). Restart the host and check its MCP server list."
