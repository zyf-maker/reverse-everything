$ErrorActionPreference = 'Stop'

$workbench = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$installerSource = Join-Path $workbench 'install.ps1'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("replica-install-test-" + [guid]::NewGuid().ToString('N'))
$bin = Join-Path $tempRoot 'bin'
$mockSource = @'
using System;
using System.IO;
using System.Linq;

public class MockInstallerTool
{
    public static int Main(string[] args)
    {
        var executable = Path.GetFileName(Environment.GetCommandLineArgs()[0]).ToLowerInvariant();
        var failure = Environment.GetEnvironmentVariable("REPLICA_INSTALL_MOCK_FAIL") ?? "";

        if (executable == "python.exe")
        {
            if (args.Length == 1 && args[0] == "--version")
            {
                if (failure == "python-version") return 31;
                if (failure == "python-too-old")
                {
                    Console.WriteLine("Python 3.9.18");
                    return 0;
                }
                Console.WriteLine("Python 3.12.9");
                return 0;
            }
            if (args.Length >= 3 && args[0] == "-m" && args[1] == "venv")
            {
                if (failure == "venv") return 32;
                var scripts = Path.Combine(args[2], "Scripts");
                Directory.CreateDirectory(scripts);
                File.Copy(Environment.GetCommandLineArgs()[0], Path.Combine(scripts, "python.exe"), true);
                return 0;
            }
            if (args.Length >= 4 && args[0] == "-m" && args[1] == "pip")
            {
                if (failure == "pip-upgrade" && args[2] == "install" && args[3] == "--upgrade") return 33;
                if (failure == "pip-install" && args[2] == "install" && args[3] == "-e") return 34;
                return 0;
            }
        }

        if (executable == "node.exe" && args.Length == 1 && args[0] == "--version")
        {
            if (failure == "node-version") return 35;
            if (failure == "node-too-old")
            {
                Console.WriteLine("v12.22.9");
                return 0;
            }
            Console.WriteLine("v24.14.0");
            return 0;
        }

        if (executable == "npm.exe")
        {
            if (args.Length == 1 && args[0] == "--version")
            {
                if (failure == "npm-version") return 36;
                Console.WriteLine("11.9.0");
                return 0;
            }
            if (args.Contains("ci") && failure == "npm-ci") return 37;
            return 0;
        }

        return 0;
    }
}
'@

$originalPath = $env:PATH
$originalFailure = $env:REPLICA_INSTALL_MOCK_FAIL
$originalMockPython = $env:REPLICA_INSTALL_MOCK_PYTHON

try {
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $mockExe = Join-Path $bin 'mock.exe'
    $mockSourceFile = Join-Path $tempRoot 'MockInstallerTool.cs'
    Set-Content -LiteralPath $mockSourceFile -Value $mockSource -Encoding UTF8
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $csc /nologo /target:exe /out:$mockExe $mockSourceFile
    if ($LASTEXITCODE -ne 0) { throw "Compiling mock installer failed with exit code $LASTEXITCODE" }
    Copy-Item $mockExe (Join-Path $bin 'python.exe')
    Copy-Item $mockExe (Join-Path $bin 'node.exe')
    Copy-Item $mockExe (Join-Path $bin 'npm.exe')

    $env:PATH = "$bin$([IO.Path]::PathSeparator)$originalPath"
    $env:REPLICA_INSTALL_MOCK_PYTHON = Join-Path $bin 'python.exe'

    $scenarios = @(
        @{ Name = 'python-version'; ExpectedExit = 31 },
        @{ Name = 'python-too-old'; ExpectedExit = 0 },
        @{ Name = 'node-version'; ExpectedExit = 35 },
        @{ Name = 'node-too-old'; ExpectedExit = 0 },
        @{ Name = 'npm-version'; ExpectedExit = 36 },
        @{ Name = 'venv'; ExpectedExit = 32 },
        @{ Name = 'pip-upgrade'; ExpectedExit = 33 },
        @{ Name = 'pip-install'; ExpectedExit = 34 },
        @{ Name = 'npm-ci'; ExpectedExit = 37 },
        @{ Name = 'success'; ExpectedExit = 0 }
    )

    foreach ($scenario in $scenarios) {
        $caseRoot = Join-Path $tempRoot $scenario.Name
        $caseWorkbench = Join-Path $caseRoot 'replica-workbench'
        New-Item -ItemType Directory -Path (Join-Path $caseRoot 'own-reverse-platform\runtime') -Force | Out-Null
        New-Item -ItemType Directory -Path $caseWorkbench -Force | Out-Null
        Copy-Item $installerSource (Join-Path $caseWorkbench 'install.ps1')
        $env:REPLICA_INSTALL_MOCK_FAIL = $scenario.Name

        $caught = $false
        $output = @()
        try {
            $output = @(& (Join-Path $caseWorkbench 'install.ps1') 2>&1)
        }
        catch {
            $caught = $true
            $output += $_.Exception.Message
        }
        $text = $output | Out-String

        if ($scenario.Name -eq 'success') {
            if ($caught) {
                throw "Mock success scenario failed: $text"
            }
        }
        elseif ($scenario.Name -eq 'node-too-old' -or $scenario.Name -eq 'python-too-old') {
            $expected = if ($scenario.Name -eq 'node-too-old') { 'Node.js 18\+ is required; found v12\.22\.9' } else { 'Python 3\.10\+ is required; found Python 3\.9\.18' }
            if (-not $caught -or $text -match 'Replica Workbench installed' -or $text -notmatch $expected) {
                throw "Mock old runtime scenario '$($scenario.Name)' was not rejected correctly: $text"
            }
        }
        elseif (-not $caught -or $text -match 'Replica Workbench installed' -or $text -notmatch "exit code $($scenario.ExpectedExit)") {
            throw "Mock failure scenario '$($scenario.Name)' was not rejected correctly: $text"
        }

        Write-Output "PASS $($scenario.Name)"
    }
}
finally {
    $env:PATH = $originalPath
    if ($null -eq $originalFailure) { Remove-Item Env:REPLICA_INSTALL_MOCK_FAIL -ErrorAction SilentlyContinue }
    else { $env:REPLICA_INSTALL_MOCK_FAIL = $originalFailure }
    if ($null -eq $originalMockPython) { Remove-Item Env:REPLICA_INSTALL_MOCK_PYTHON -ErrorAction SilentlyContinue }
    else { $env:REPLICA_INSTALL_MOCK_PYTHON = $originalMockPython }

    $tempFull = [IO.Path]::GetFullPath($tempRoot)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($tempFull.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $tempFull) -like 'replica-install-test-*') {
        Remove-Item -LiteralPath $tempFull -Recurse -Force
    }
}
