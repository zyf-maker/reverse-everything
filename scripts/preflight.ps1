[CmdletBinding()]
param(
  [ValidateSet('auto','javascript','web','binary','mobile','pentest')][string]$TargetType='auto',
  [string]$Client='codex', [string]$CdpEndpoint,
  [string]$ReverseSkillPath=$env:REVERSE_SKILL_PATH, [string]$PentagiPath=$env:PENTAGI_PATH,
  [string]$ComposeFile='docker-compose.yml',
  [switch]$Json, [switch]$SkipReaDoctor, [switch]$Install, [switch]$Approve,
  [int]$Timeout=15
)
$ErrorActionPreference='Stop'
$pythonCommand = if ($env:REVERSE_REPLICA_PYTHON) { $env:REVERSE_REPLICA_PYTHON } else { (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $pythonCommand) {
  Write-Output '{"verdict":"BLOCKED","error":"Python 3 is required; nothing installed"}'
  exit 1
}
$invokeArgs=@((Join-Path $PSScriptRoot 'preflight.py'),'--target',$TargetType,'--client',$Client,'--timeout',"$Timeout")
if ($CdpEndpoint) { $invokeArgs+=@('--cdp-endpoint',$CdpEndpoint) }
if ($ReverseSkillPath) { $invokeArgs+=@('--reverse-skill',$ReverseSkillPath) }
if ($PentagiPath) { $invokeArgs+=@('--pentagi',$PentagiPath) }
if ($ComposeFile) { $invokeArgs+=@('--compose-file',$ComposeFile) }
if ($Json) { $invokeArgs+='--json' }
if ($SkipReaDoctor) { $invokeArgs+='--skip-rea-doctor' }
if ($Install) { $invokeArgs+='--install' }
if ($Approve) { $invokeArgs+='--approve' }
& $pythonCommand @invokeArgs
exit $LASTEXITCODE
