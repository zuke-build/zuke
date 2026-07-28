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
# Honoured environment variables:
#   DENO_INSTALL   where Deno is installed/looked for (default: ~/.deno)
#   DENO_VERSION   which Deno to install on bootstrap. Defaults to a pinned,
#                  known-good version ($DefaultDenoVersion) for reproducible and
#                  more predictable installs. An override must name an exact
#                  release tag (e.g. v2.8.3) - "latest" is rejected, because a
#                  moving target has no checksum to pin - and is only installed
#                  if DENO_SHA256 also supplies the matching per-platform
#                  checksum (see below); this launcher never downloads an
#                  unverified binary.
#   DENO_SHA256    required alongside a DENO_VERSION override: the expected
#                  SHA-256 of the release zip for the *current* platform (see
#                  the asset name printed on a checksum mismatch).

$ErrorActionPreference = "Stop"

# Pinned default so the bootstrap installs a known version rather than whatever
# "latest" happens to be. Bump deliberately; keep in sync with the zuke script.
$DefaultDenoVersion = "2.8.3"

# --- Pinned per-platform checksums for $DefaultDenoVersion ------------------
# SHA-256 of each `deno-<target>.zip` release asset, from
# https://github.com/denoland/deno/releases/tag/v2.8.3 (GitHub's own reported
# asset `digest`, cross-checked by downloading and hashing the artifact).
# Bump *together* with $DefaultDenoVersion - pull the new asset digests from
# that release's page (or `gh release view <tag> --repo denoland/deno --json
# assets`) before changing the version above.
$DenoChecksums = @{
  "x86_64-pc-windows-msvc"  = "7fdd1f42e6b0855421ecf27bb406e2492ade1087c85e30ebf0deab6280ea743c"
  "aarch64-pc-windows-msvc" = "243f478ac577ade1bbd980ecf510607a10ed8cc977b462083ada48e5f6580de1"
}
# -----------------------------------------------------------------------------

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

  $denoVersion = if ($env:DENO_VERSION) { $env:DENO_VERSION } else { $DefaultDenoVersion }
  if ($denoVersion -eq "latest") {
    # There is no `latest` release tag to download, and a moving target has no
    # checksum to pin - so name the release you want instead.
    throw "zuke: DENO_VERSION=latest is not supported: this launcher verifies the " +
      "download against a pinned SHA-256, and ""latest"" has no fixed hash. Set " +
      "DENO_VERSION to an exact release tag (e.g. v2.8.3) plus DENO_SHA256 with that " +
      "release's deno-<target>.zip hash, or unset DENO_VERSION to install the " +
      "verified default $DefaultDenoVersion."
  }
  $vTag = if ($denoVersion.StartsWith("v")) { $denoVersion } else { "v$denoVersion" }
  $bareVersion = $vTag.Substring(1)

  # .ToString() forces a plain string comparison in the switch below,
  # independent of how PowerShell would otherwise coerce the enum/string types.
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  $target = switch ($arch) {
    "X64" { "x86_64-pc-windows-msvc" }
    "Arm64" { "aarch64-pc-windows-msvc" }
    default {
      throw "zuke: unsupported architecture for the checksum-verified bootstrap: $arch. " +
        "Install Deno manually: https://docs.deno.com/runtime/getting_started/installation/"
    }
  }

  if ($bareVersion -eq $DefaultDenoVersion -and $DenoChecksums.ContainsKey($target)) {
    $expectedSha256 = $DenoChecksums[$target]
  } elseif ($env:DENO_SHA256) {
    # An explicit override: the caller vouches for this version/platform pair
    # by supplying its own checksum, so the download is still verified.
    $expectedSha256 = $env:DENO_SHA256
  } else {
    throw "zuke: DENO_VERSION=$denoVersion overrides the pinned $DefaultDenoVersion, " +
      "but no checksum is pinned for it. Set DENO_SHA256 to the expected SHA-256 " +
      "of deno-$target.zip for that release, or unset DENO_VERSION to use the " +
      "verified default."
  }

  $asset = "deno-$target.zip"
  $downloadUrl = "https://github.com/denoland/deno/releases/download/$vTag/$asset"
  $workDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
  New-Item -ItemType Directory -Path $workDir | Out-Null
  $archive = Join-Path $workDir $asset
  try {
    # The download fetches over the network, which is occasionally flaky (e.g.
    # a transient 5xx from the CDN). Retry a few times with backoff so a blip
    # doesn't fail the whole run.
    $maxAttempts = 4
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
      try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
        break
      } catch {
        if ($attempt -ge $maxAttempts) {
          throw "zuke: failed to download Deno after $maxAttempts attempts: $_"
        }
        $delay = $attempt * 3
        Write-Host "zuke: Deno download failed (attempt $attempt/$maxAttempts); retrying in ${delay}s..."
        Start-Sleep -Seconds $delay
      }
    }

    $actualSha256 = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $expectedSha256.ToLowerInvariant()) {
      throw "zuke: checksum mismatch for ${asset}: expected $expectedSha256, got $actualSha256"
    }

    $binDir = Join-Path $env:DENO_INSTALL "bin"
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    Expand-Archive -Path $archive -DestinationPath $binDir -Force
  } finally {
    Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
  }

  $deno = Join-Path $env:DENO_INSTALL "bin\deno.exe"
}

# Put this Deno on PATH so CLIs the build provisions with `deno install` — whose
# generated launchers invoke `deno` by name — can find it even when Deno was
# bootstrapped to a non-PATH location.
$env:PATH = (Split-Path -Parent $deno) + [IO.Path]::PathSeparator + $env:PATH

# --frozen so this invocation cannot rewrite deno.lock; see the comment in the
# POSIX launcher. Regenerate deliberately with `deno install`, then commit it.
& $deno run -A --frozen (Join-Path $scriptDir "zuke.ts") @args
exit $LASTEXITCODE
