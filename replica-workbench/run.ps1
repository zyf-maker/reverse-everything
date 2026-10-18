[CmdletBinding()]
param(
  [Parameter(Position=0, ValueFromRemainingArguments=$true)]
  [string[]]$CliArgs,
  [Parameter(ValueFromPipeline=$true)]
  [AllowNull()]
  [object]$InputLine
)
begin {
  $ErrorActionPreference = 'Stop'
  $root = Split-Path -Parent $MyInvocation.MyCommand.Path
  $python = $env:REPLICA_PYTHON_BIN
  if (-not $python) { $python = Join-Path $root '.venv\Scripts\python.exe' }
  if (-not (Test-Path $python)) { $python = (Get-Command python -ErrorAction Stop).Source }
  $env:PYTHONPATH = Join-Path $root 'src'
  $inputLines = [System.Collections.Generic.List[string]]::new()
}
process {
  if ($null -ne $InputLine) { $inputLines.Add([string]$InputLine) }
}
end {
  if ($inputLines.Count -gt 0) {
    ($inputLines -join [Environment]::NewLine) | & $python -m replica_platform.cli @CliArgs
  } else {
    & $python -m replica_platform.cli @CliArgs
  }
  exit $LASTEXITCODE
}
