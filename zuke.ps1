#!/usr/bin/env pwsh
#
# Zuke bootstrap launcher (PowerShell) — a `.\build.ps1`-style entry point.
#
#   .\zuke.ps1 ci          # run the full gate
#   .\zuke.ps1 test        # type-check + tests
#   .\zuke.ps1 --list      # list every target
#
# Ensures Deno is available (installing it on first use if missing), then runs
# the project's build file (zuke.ts). No global install required.
#
# Honoured environment variable:
#   DENO_INSTALL   where Deno is installed/looked for (default: ~/.deno)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not $env:DENO_INSTALL) {
  $env:DENO_INSTALL = Join-Path $HOME ".deno"
}

function Resolve-Deno {
  $onPath = Get-Command deno -CommandType Application -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $local = Join-Path $env:DENO_INSTALL "bin\deno.exe"
  if (Test-Path $local) { return $local }
  return $null
}

$deno = Resolve-Deno
if (-not $deno) {
  Write-Host "zuke: Deno not found - installing it now..."
  Invoke-RestMethod https://deno.land/install.ps1 | Invoke-Expression
  $deno = Join-Path $env:DENO_INSTALL "bin\deno.exe"
}

& $deno run -A (Join-Path $scriptDir "zuke.ts") @args
exit $LASTEXITCODE
