// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `./zuke` (bash) and `zuke.ps1` (PowerShell) launcher scripts, rendered
 * from one template in two variants:
 *
 * - **bootstrap** — when no Deno is on `PATH`, download the pinned release
 *   from {@link "./deno_pin.ts"}, verify it against the per-platform SHA-256,
 *   unpack it into `DENO_INSTALL` (default `~/.deno`), and run the build with
 *   it. A checkout needs nothing installed up front. The launcher never runs
 *   an install script and never installs an unverified binary: an overriding
 *   `DENO_VERSION` must be an exact release tag and must come with the matching
 *   `DENO_SHA256`, and `latest` is rejected because a moving target has no
 *   hash to pin.
 * - **plain** — require Deno on `PATH`, and when it is missing print the one
 *   command to run and exit 1. For a project that must never download a
 *   tool from its build entry point (a locked-down CI image, a policy against
 *   downloads), so it fails closed instead.
 *
 * Both variants pass `--frozen` only once a `deno.lock` exists: a freshly
 * scaffolded project has none, and `deno run --frozen` against a missing
 * lockfile fails outright ("The lockfile is out of date") instead of writing
 * one. So the first run resolves and records the graph, and every run after
 * that verifies it and fails loudly if it changed. The unfrozen branch says so
 * on stderr — the same branch is taken if a `deno.lock` is later removed, which
 * drops integrity verification, so it must not run unverified in silence.
 *
 * Zuke's own `./zuke` and `zuke.ps1` are the bootstrap variant, generated
 * from here by `./zuke launcherSync` and verified by `launcherSyncCheck`, so
 * the scripts `zuke setup` stamps into a project are the ones this repository
 * runs on every CI job.
 *
 * @module
 */

import {
  DENO_PIN,
  type DenoPin,
  denoReleaseTag,
  POSIX_TARGETS,
  WINDOWS_TARGETS,
} from "./deno_pin.ts";

/** Which launcher variant to render. */
/**
 * The notice a run without a lockfile prints — a fresh scaffold has none, so
 * the first run must be allowed to write one, and saying so keeps a deleted
 * lockfile from downgrading verification silently. Shared by both launcher
 * templates and the global CLI's forwarding, so the three cannot drift.
 * `dash` is the hyphen the caller's encoding is comfortable with (PowerShell
 * sources are kept ASCII).
 */
export function noLockNotice(dash: string): string {
  return `zuke: no deno.lock here yet ${dash} running without lockfile ` +
    "verification so Deno can write one.";
}

export interface LauncherOptions {
  /**
   * Bootstrap a pinned, checksum-verified Deno when none is on `PATH`
   * (`true`), or require one and fail closed when it is missing (`false`).
   */
  bootstrapDeno: boolean;
}

/** The URL the plain launchers point at when Deno is missing. */
export const DENO_INSTALL_DOCS =
  "https://docs.deno.com/runtime/getting_started/installation/";

/** The MIT notice every generated launcher opens with (after its shebang). */
const LICENSE_HEADER = `# Copyright (c) 2026 the Zuke contributors
# SPDX-License-Identifier: MIT`;

/* cspell:disable */

/**
 * The `DENO_VERSION` / `DENO_SHA256` / `DENO_INSTALL` contract, as the comment
 * block both bootstrap launchers carry. `dash` is the hyphen the script's
 * encoding is comfortable with (PowerShell sources are kept ASCII).
 */
function bootstrapEnvDocs(pin: DenoPin, dash: string): string {
  return `# Honoured environment variables:
#   DENO_INSTALL   where Deno is installed/looked for (default: ~/.deno)
#   DENO_VERSION   which Deno to install on bootstrap. Defaults to a pinned,
#                  known-good version (see below) for reproducible and more
#                  predictable installs. An override must name an exact release
#                  tag (e.g. ${
    denoReleaseTag(pin)
  }) ${dash} "latest" is rejected, because a moving
#                  target has no checksum to pin ${dash} and is only installed if
#                  DENO_SHA256 also supplies the matching per-platform checksum
#                  (see below); this launcher never downloads an unverified
#                  binary.
#   DENO_SHA256    required alongside a DENO_VERSION override: the expected
#                  SHA-256 of the release zip for the *current* platform (see
#                  the asset name printed on a checksum mismatch).`;
}

/** The provenance comment above the pinned checksums. */
function checksumProvenance(pin: DenoPin, versionVar: string): string {
  return `# SHA-256 of each \`deno-<target>.zip\` release asset, from
# https://github.com/denoland/deno/releases/tag/${
    denoReleaseTag(pin)
  } (GitHub's own reported
# asset \`digest\`, cross-checked by downloading and hashing the artifact).
# Bump *together* with ${versionVar}: this file is generated from
# @zuke/cli's deno_pin.ts, so change the pin there and regenerate.`;
}

/** The bash launcher's Deno resolution: the bootstrap, or the fail-closed check. */
function bashResolveDeno(options: LauncherOptions, pin: DenoPin): string {
  if (!options.bootstrapDeno) {
    return `if ! command -v deno >/dev/null 2>&1; then
  echo "zuke: Deno not found on PATH. Install it, then re-run this launcher:" >&2
  echo "      ${DENO_INSTALL_DOCS}" >&2
  exit 1
fi
deno_bin="$(command -v deno)"`;
  }
  return `deno_install="\${DENO_INSTALL:-$HOME/.deno}"

if command -v deno >/dev/null 2>&1; then
  deno_bin="$(command -v deno)"
elif [ -x "$deno_install/bin/deno" ]; then
  deno_bin="$deno_install/bin/deno"
else
  echo "zuke: Deno not found — installing it now..." >&2
  for cmd in curl unzip; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "zuke: $cmd is required to bootstrap Deno; install Deno manually:" >&2
      echo "      ${DENO_INSTALL_DOCS}" >&2
      exit 1
    fi
  done

  deno_version="\${DENO_VERSION:-$DEFAULT_DENO_VERSION}"
  case "$deno_version" in
    latest)
      # There is no \`latest\` release tag to download, and a moving target has no
      # checksum to pin — so name the release you want instead.
      echo "zuke: DENO_VERSION=latest is not supported: this launcher verifies the" >&2
      echo "      download against a pinned SHA-256, and \\"latest\\" has no fixed hash." >&2
      echo "      Set DENO_VERSION to an exact release tag (e.g. ${
    denoReleaseTag(pin)
  }) plus DENO_SHA256" >&2
      echo "      with that release's deno-<target>.zip hash, or unset DENO_VERSION to" >&2
      echo "      install the verified default $DEFAULT_DENO_VERSION." >&2
      exit 1
      ;;
    v*) ;;
    *) deno_version="v$deno_version" ;;
  esac

  # Map uname's OS/arch spelling to Deno's release asset target triple.
  case "$(uname -s)" in
    Linux) os_part="unknown-linux-gnu" ;;
    Darwin) os_part="apple-darwin" ;;
    *)
      echo "zuke: unsupported OS for the checksum-verified bootstrap: $(uname -s)." >&2
      echo "      Install Deno manually: ${DENO_INSTALL_DOCS}" >&2
      exit 1
      ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch_part="x86_64" ;;
    arm64 | aarch64) arch_part="aarch64" ;;
    *)
      echo "zuke: unsupported architecture for the checksum-verified bootstrap: $(uname -m)." >&2
      echo "      Install Deno manually: ${DENO_INSTALL_DOCS}" >&2
      exit 1
      ;;
  esac
  target="\${arch_part}-\${os_part}"

  if [ "$deno_version" = "$DEFAULT_DENO_VERSION" ]; then
    expected_sha256="$(deno_checksum_for "$target")" || {
      echo "zuke: no pinned checksum for $target — this platform isn't covered yet." >&2
      exit 1
    }
  elif [ -n "\${DENO_SHA256:-}" ]; then
    # An explicit override: the caller vouches for this version/platform pair
    # by supplying its own checksum, so the download is still verified.
    expected_sha256="$DENO_SHA256"
  else
    echo "zuke: DENO_VERSION=$deno_version overrides the pinned $DEFAULT_DENO_VERSION," >&2
    echo "      but no checksum is pinned for it. Set DENO_SHA256 to the expected" >&2
    echo "      SHA-256 of deno-$target.zip for that release, or unset DENO_VERSION" >&2
    echo "      to use the verified default." >&2
    exit 1
  fi

  asset="deno-\${target}.zip"
  download_url="https://github.com/denoland/deno/releases/download/\${deno_version}/\${asset}"
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT
  archive="$work_dir/$asset"

  # The download fetches over the network, which is occasionally flaky (e.g. a
  # transient 5xx from the CDN). Retry a few times with backoff so a blip
  # doesn't fail the whole run.
  download_deno() {
    curl -fsSL -o "$archive" "$download_url"
  }
  attempt=1
  max_attempts=4
  until download_deno; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "zuke: failed to download Deno after $max_attempts attempts." >&2
      exit 1
    fi
    delay=$((attempt * 3))
    echo "zuke: Deno download failed (attempt $attempt/$max_attempts); retrying in \${delay}s..." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done

  if command -v sha256sum >/dev/null 2>&1; then
    actual_sha256="$(sha256sum "$archive" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual_sha256="$(shasum -a 256 "$archive" | awk '{print $1}')"
  else
    echo "zuke: neither sha256sum nor shasum is available to verify the download." >&2
    exit 1
  fi
  if [ "$actual_sha256" != "$expected_sha256" ]; then
    echo "zuke: checksum mismatch for $asset:" >&2
    echo "      expected $expected_sha256" >&2
    echo "      got      $actual_sha256" >&2
    exit 1
  fi

  mkdir -p "$deno_install/bin"
  unzip -oq "$archive" -d "$deno_install/bin"
  chmod +x "$deno_install/bin/deno"
  deno_bin="$deno_install/bin/deno"
fi

# Put this Deno on PATH so CLIs the build provisions with \`deno install\` — whose
# generated launchers invoke \`deno\` by name — can find it even when Deno was
# bootstrapped to a non-PATH location (e.g. ~/.deno/bin).
export PATH="$(dirname "$deno_bin"):$PATH"`;
}

/** The bash launcher's pin block: the version and the per-platform checksums. */
function bashPin(pin: DenoPin): string {
  const arms = POSIX_TARGETS.map((target) =>
    `    ${target})\n      echo "${pin.checksums[target]}" ;;`
  ).join("\n");
  return `# Pinned default so the bootstrap installs a known version rather than whatever
# "latest" happens to be.
DEFAULT_DENO_VERSION="${denoReleaseTag(pin)}"

# --- Pinned per-platform checksums for DEFAULT_DENO_VERSION -----------------
${checksumProvenance(pin, "DEFAULT_DENO_VERSION")}
deno_checksum_for() {
  case "$1" in
${arms}
    *)
      return 1 ;;
  esac
}
# -----------------------------------------------------------------------------
`;
}

/**
 * The bash launcher (`./zuke`). Runs `zuke.ts` with the Deno on `PATH`, or
 * with the one it bootstraps first (see the module docs for the variants).
 */
export function launcherBash(
  options: LauncherOptions,
  pin: DenoPin = DENO_PIN,
): string {
  const purpose = options.bootstrapDeno
    ? `# Zuke bootstrap launcher — a \`./build.sh\`-style entry point for Deno.
#
#   ./zuke               # run the default target
#   ./zuke <target>      # run one target and its prerequisites
#   ./zuke --list        # list every target
#
# Ensures Deno is available (installing it on first use if missing), then runs
# the project's build file (zuke.ts). No global install required.
#
${bootstrapEnvDocs(pin, "—")}`
    : `# Zuke launcher — runs the project's build file (zuke.ts) with the Deno on PATH.
#
#   ./zuke               # run the default target
#   ./zuke <target>      # run one target and its prerequisites
#   ./zuke --list        # list every target
#
# Requires Deno: ${DENO_INSTALL_DOCS}`;
  const pinBlock = options.bootstrapDeno ? `\n${bashPin(pin)}` : "";
  return `#!/usr/bin/env bash
${LICENSE_HEADER}
#
${purpose}
set -euo pipefail
${pinBlock}
dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$dir"

${bashResolveDeno(options, pin)}

# The first run has no lockfile to verify against, so let Deno write one; from
# then on --frozen fails the build if the module graph changed. Say so when
# skipping, so a deleted lockfile downgrades verification visibly instead of
# silently.
if [ -f deno.lock ]; then
  exec "$deno_bin" run -A --frozen zuke.ts "$@"
else
  echo "${noLockNotice("—")}" >&2
  exec "$deno_bin" run -A zuke.ts "$@"
fi
`;
}

/** The PowerShell launcher's Deno resolution: the bootstrap, or the fail-closed check. */
function pwshResolveDeno(options: LauncherOptions, pin: DenoPin): string {
  if (!options.bootstrapDeno) {
    return `$found = Get-Command deno -CommandType Application -ErrorAction SilentlyContinue
if (-not $found) {
  Write-Error "zuke: Deno not found on PATH. Install it, then re-run this launcher: ${DENO_INSTALL_DOCS}"
  exit 1
}
$deno = $found.Source`;
  }
  return `if (-not $env:DENO_INSTALL) {
  $env:DENO_INSTALL = Join-Path $HOME ".deno"
}

function Resolve-Deno {
  $onPath = Get-Command deno -CommandType Application -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $local = Join-Path $env:DENO_INSTALL "bin\\deno.exe"
  if (Test-Path $local) { return $local }
  return $null
}

$deno = Resolve-Deno
if (-not $deno) {
  Write-Host "zuke: Deno not found - installing it now..."

  $denoVersion = if ($env:DENO_VERSION) { $env:DENO_VERSION } else { $DefaultDenoVersion }
  if ($denoVersion -eq "latest") {
    # There is no \`latest\` release tag to download, and a moving target has no
    # checksum to pin - so name the release you want instead.
    throw "zuke: DENO_VERSION=latest is not supported: this launcher verifies the " +
      "download against a pinned SHA-256, and ""latest"" has no fixed hash. Set " +
      "DENO_VERSION to an exact release tag (e.g. ${
    denoReleaseTag(pin)
  }) plus DENO_SHA256 with that " +
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
        "Install Deno manually: ${DENO_INSTALL_DOCS}"
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
        Write-Host "zuke: Deno download failed (attempt $attempt/$maxAttempts); retrying in \${delay}s..."
        Start-Sleep -Seconds $delay
      }
    }

    $actualSha256 = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $expectedSha256.ToLowerInvariant()) {
      throw "zuke: checksum mismatch for \${asset}: expected $expectedSha256, got $actualSha256"
    }

    $binDir = Join-Path $env:DENO_INSTALL "bin"
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    Expand-Archive -Path $archive -DestinationPath $binDir -Force
  } finally {
    Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
  }

  $deno = Join-Path $env:DENO_INSTALL "bin\\deno.exe"
}

# Put this Deno on PATH so CLIs the build provisions with \`deno install\` - whose
# generated launchers invoke \`deno\` by name - can find it even when Deno was
# bootstrapped to a non-PATH location.
$env:PATH = (Split-Path -Parent $deno) + [IO.Path]::PathSeparator + $env:PATH`;
}

/** The PowerShell launcher's pin block: the version and the per-platform checksums. */
function pwshPin(pin: DenoPin): string {
  const width = Math.max(...WINDOWS_TARGETS.map((t) => t.length)) + 2;
  const entries = WINDOWS_TARGETS.map((target) =>
    `  ${`"${target}"`.padEnd(width)} = "${pin.checksums[target]}"`
  ).join("\n");
  return `# Pinned default so the bootstrap installs a known version rather than whatever
# "latest" happens to be.
$DefaultDenoVersion = "${pin.version}"

# --- Pinned per-platform checksums for $DefaultDenoVersion ------------------
${checksumProvenance(pin, "$DefaultDenoVersion")}
$DenoChecksums = @{
${entries}
}
# -----------------------------------------------------------------------------
`;
}

/**
 * The PowerShell launcher (`.\zuke.ps1`). Mirrors {@link launcherBash},
 * variant for variant, including the conditional `--frozen`.
 */
export function launcherPwsh(
  options: LauncherOptions,
  pin: DenoPin = DENO_PIN,
): string {
  const purpose = options.bootstrapDeno
    ? `# Zuke bootstrap launcher (PowerShell) - a \`.\\build.ps1\`-style entry point.
#
#   .\\zuke.ps1               # run the default target
#   .\\zuke.ps1 <target>      # run one target and its prerequisites
#   .\\zuke.ps1 --list        # list every target
#
# Ensures Deno is available (installing it on first use if missing), then runs
# the project's build file (zuke.ts). No global install required.
#
${bootstrapEnvDocs(pin, "-")}`
    : `# Zuke launcher (PowerShell) - runs the project's build file (zuke.ts) with the Deno on PATH.
#
#   .\\zuke.ps1               # run the default target
#   .\\zuke.ps1 <target>      # run one target and its prerequisites
#   .\\zuke.ps1 --list        # list every target
#
# Requires Deno: ${DENO_INSTALL_DOCS}`;
  const pinBlock = options.bootstrapDeno ? `\n${pwshPin(pin)}` : "";
  return `#!/usr/bin/env pwsh
${LICENSE_HEADER}
#
${purpose}

$ErrorActionPreference = "Stop"
${pinBlock}
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

${pwshResolveDeno(options, pin)}

# The first run has no lockfile to verify against, so let Deno write one; from
# then on --frozen fails the build if the module graph changed. Say so when
# skipping, so a deleted lockfile downgrades verification visibly instead of
# silently.
$denoArgs = @("run", "-A")
if (Test-Path (Join-Path $dir "deno.lock")) {
  $denoArgs += "--frozen"
} else {
  Write-Warning "${noLockNotice("-")}"
}
$denoArgs += (Join-Path $dir "zuke.ts")
& $deno @denoArgs @args
exit $LASTEXITCODE
`;
}

/* cspell:enable */
