$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) { throw 'Python 3.10+ is required' }
$pythonVersion = & $pythonCommand.Source --version 2>&1
if ($LASTEXITCODE -ne 0) { throw "Python version check failed with exit code $LASTEXITCODE" }
if ($pythonVersion -notmatch 'Python\s+(?<major>\d+)\.(?<minor>\d+)') { throw "Could not parse Python version: $pythonVersion" }
if ([int]$Matches.major -lt 3 -or ([int]$Matches.major -eq 3 -and [int]$Matches.minor -lt 10)) {
  throw "Python 3.10+ is required; found $pythonVersion"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js 18+ is required for browser runtime' }
$nodeVersion = & $nodeCommand.Source --version 2>&1
if ($LASTEXITCODE -ne 0) { throw "Node.js version check failed with exit code $LASTEXITCODE" }
if ($nodeVersion -notmatch '^v?(?<major>\d+)\.(?<minor>\d+)') { throw "Could not parse Node.js version: $nodeVersion" }
if ([int]$Matches.major -lt 18) { throw "Node.js 18+ is required; found $nodeVersion" }

$npmCommand = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCommand) { throw 'npm is required for browser runtime dependencies' }
$npmVersion = & $npmCommand.Source --version 2>&1
if ($LASTEXITCODE -ne 0) { throw "npm version check failed with exit code $LASTEXITCODE" }

python -m venv (Join-Path $root '.venv')
if ($LASTEXITCODE -ne 0) { throw "Creating the Python environment failed with exit code $LASTEXITCODE" }
$python = Join-Path $root '.venv\Scripts\python.exe'
& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Upgrading pip failed with exit code $LASTEXITCODE" }
& $python -m pip install -e $root
if ($LASTEXITCODE -ne 0) { throw "Installing the workbench failed with exit code $LASTEXITCODE" }
& npm --prefix (Join-Path $root '..\own-reverse-platform\runtime') ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw "Installing browser runtime dependencies failed with exit code $LASTEXITCODE" }
Write-Host "Replica Workbench installed. Run .\run.ps1 doctor"
