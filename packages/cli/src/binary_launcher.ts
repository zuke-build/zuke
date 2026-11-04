// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `./zuke` and `zuke.ps1` launchers of a project another SDK hosts: a
 * Python build, say, with a `zuke.json` and no `zuke.ts`. They run the
 * standalone `zuke` binary, which carries the engine and every tool wrapper,
 * so the project needs nothing from a stack it does not use — no Deno, no
 * Node — on a laptop or a CI runner. Two variants, as for the Deno launchers
 * in {@link "./launcher.ts"}:
 *
 * - **download** — run the `zuke` release the launcher pins
 *   ({@link "./binary_pin.ts"}). On first use, download its archive from the
 *   release, verify it against the pinned SHA-256, and keep the binary in
 *   `ZUKE_INSTALL` (default `~/.zuke`), one directory per release. Nothing is
 *   installed that the pin did not vouch for; `ZUKE_RELEASES_URL` names a
 *   mirror, whose download is verified the same way.
 * - **plain** — require `zuke` on `PATH`, and when it is missing print where
 *   to get it and exit 1, for a project that must not download its tools.
 *
 * Both set `ZUKE_FORWARDED`, so the `zuke` they start runs the build itself
 * rather than this launcher again, and `ZUKE_LAUNCHER_ROOT` to the
 * launcher's directory: running a launcher is an explicit act on the
 * project it sits in, so the discovery trust gate does not judge that root.
 *
 * @module
 */

import {
  BINARY_INSTALL_DOCS,
  BINARY_POSIX_TARGETS,
  BINARY_RELEASES_URL,
  BINARY_WINDOWS_TARGET,
  type BinaryPin,
  binaryReleaseTag,
} from "./binary_pin.ts";
import { FORWARDED_ENV, LAUNCHER_ROOT_ENV } from "./dispatch.ts";

/** Which binary launcher variant to render. */
export interface BinaryLauncherOptions {
  /**
   * Download the pinned, checksum-verified `zuke` release when it is not
   * already kept (`true`), or require `zuke` on `PATH` and fail closed
   * without it (`false`).
   */
  download: boolean;
}

/** The line every binary launcher opens its description with. */
export const BINARY_LAUNCHER_MARKER =
  "# Zuke launcher for a build another SDK hosts";

/** The line a plain binary launcher carries, which `zuke upgrade --engine` keeps it plain by. */
export const PLAIN_BINARY_LAUNCHER = "# Runs the zuke on PATH:";

/** The MIT notice every generated launcher opens with (after its shebang). */
const LICENSE_HEADER = `# Copyright (c) 2026 the Zuke contributors
# SPDX-License-Identifier: MIT`;

/* cspell:disable */

/** The usage lines both scripts open with, for `./zuke` or `.\zuke.ps1`. */
function usage(command: string): string {
  return `#   ${command}               # run the default target
#   ${command} <target>      # run one target and its prerequisites
#   ${command} --list        # list every target`;
}

/** The bash launcher's download of the pinned release into `$zuke_bin`. */
function bashDownload(pin: BinaryPin): string {
  const arms = BINARY_POSIX_TARGETS.map((target) =>
    `    ${target})\n      echo "${pin.checksums[target]}" ;;`
  ).join("\n");
  return `# The pinned release, and the SHA-256 of each platform's archive, from the
# SHA256SUMS of ${BINARY_RELEASES_URL}/${binaryReleaseTag(pin.version)}.
# Moved by \`zuke upgrade --engine\`, which rewrites this file; never hand-edit.
ZUKE_VERSION="${pin.version}"
zuke_checksum_for() {
  case "$1" in
${arms}
    *)
      return 1 ;;
  esac
}

zuke_install="\${ZUKE_INSTALL:-$HOME/.zuke}"
zuke_bin="$zuke_install/releases/$ZUKE_VERSION/zuke"

if [ ! -x "$zuke_bin" ]; then
  echo "zuke: zuke $ZUKE_VERSION is not here yet — downloading it..." >&2
  for cmd in curl tar; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "zuke: $cmd is required to download zuke; install zuke instead:" >&2
      echo "      ${BINARY_INSTALL_DOCS}" >&2
      exit 1
    fi
  done

  # Map uname's OS/arch spelling to the release's target triple.
  case "$(uname -s)" in
    Linux) os_part="unknown-linux-gnu" ;;
    Darwin) os_part="apple-darwin" ;;
    *)
      echo "zuke: no zuke release is built for $(uname -s); use zuke.ps1 on Windows." >&2
      exit 1
      ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch_part="x86_64" ;;
    arm64 | aarch64) arch_part="aarch64" ;;
    *)
      echo "zuke: no zuke release is built for the $(uname -m) architecture." >&2
      exit 1
      ;;
  esac
  target="\${arch_part}-\${os_part}"
  expected_sha256="$(zuke_checksum_for "$target")" || {
    echo "zuke: no pinned checksum for $target." >&2
    exit 1
  }

  asset="zuke-\${ZUKE_VERSION}-\${target}.tar.gz"
  download_url="\${ZUKE_RELEASES_URL:-${BINARY_RELEASES_URL}}/cli-v\${ZUKE_VERSION}/\${asset}"
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT
  archive="$work_dir/$asset"

  # The network is occasionally flaky (a transient 5xx from the CDN), so a blip
  # is retried with backoff rather than failing the run.
  attempt=1
  max_attempts=4
  until curl -fsSL -o "$archive" "$download_url"; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "zuke: failed to download $download_url after $max_attempts attempts." >&2
      exit 1
    fi
    delay=$((attempt * 3))
    echo "zuke: download failed (attempt $attempt/$max_attempts); retrying in \${delay}s..." >&2
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

  tar -xzf "$archive" -C "$work_dir" zuke
  mkdir -p "$(dirname "$zuke_bin")"
  # Moved into place in one step, so a run interrupted mid-copy never leaves a
  # binary behind that later runs would trust without verifying.
  mv -f "$work_dir/zuke" "$zuke_bin.$$"
  chmod +x "$zuke_bin.$$"
  mv -f "$zuke_bin.$$" "$zuke_bin"
fi`;
}

/** The bash launcher's plain resolution: the `zuke` on `PATH`, or exit 1. */
function bashPlain(): string {
  return `if ! command -v zuke >/dev/null 2>&1; then
  echo "zuke: the zuke command is not on PATH. Install it, then re-run this launcher:" >&2
  echo "      ${BINARY_INSTALL_DOCS}" >&2
  exit 1
fi
zuke_bin="$(command -v zuke)"`;
}

/**
 * The bash launcher (`./zuke`) of a hosted build: runs the pinned `zuke`
 * release, downloading it first, or the `zuke` on `PATH` (see the module
 * docs for the variants).
 */
export function binaryLauncherBash(
  options: BinaryLauncherOptions,
  pin: BinaryPin,
): string {
  const purpose = options.download
    ? `# Runs zuke ${pin.version}, which carries the engine and every tool wrapper, so
# this project needs nothing installed but its own SDK's tools. On first use
# it downloads that release, checksum-verified, into ZUKE_INSTALL.
#
# Honoured environment variables:
#   ZUKE_INSTALL       where zuke releases are kept (default: ~/.zuke)
#   ZUKE_RELEASES_URL  a mirror of ${BINARY_RELEASES_URL};
#                      what it serves is verified against the pins below`
    : `${PLAIN_BINARY_LAUNCHER} ${BINARY_INSTALL_DOCS}`;
  const resolve = options.download ? bashDownload(pin) : bashPlain();
  return `#!/usr/bin/env bash
${LICENSE_HEADER}
#
${BINARY_LAUNCHER_MARKER}.
#
${usage("./zuke")}
#
${purpose}
set -euo pipefail

dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd -P)"
cd "$dir"

${resolve}

# zuke runs the build here itself rather than this launcher again, and does not
# hold this directory to the trust gate: running the launcher named it.
export ${FORWARDED_ENV}=1
export ${LAUNCHER_ROOT_ENV}="$dir"
exec "$zuke_bin" "$@"
`;
}

/** The PowerShell launcher's download of the pinned release into `$zuke`. */
function pwshDownload(pin: BinaryPin): string {
  return `# The pinned release, and the SHA-256 of its Windows archive, from the
# SHA256SUMS of ${BINARY_RELEASES_URL}/${binaryReleaseTag(pin.version)}.
# Moved by \`zuke upgrade --engine\`, which rewrites this file; never hand-edit.
$ZukeVersion = "${pin.version}"
$ZukeSha256 = "${pin.checksums[BINARY_WINDOWS_TARGET]}"

if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) {
  throw "zuke: zuke.ps1 runs the Windows release; on this OS run ./zuke instead."
}
$install = if ($env:ZUKE_INSTALL) { $env:ZUKE_INSTALL } else { Join-Path $HOME ".zuke" }
$zuke = Join-Path $install "releases\\$ZukeVersion\\zuke.exe"

if (-not (Test-Path $zuke)) {
  Write-Host "zuke: zuke $ZukeVersion is not here yet - downloading it..."
  # Arm64 Windows runs the x64 release under emulation; nothing else is built.
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  if ($arch -ne "X64" -and $arch -ne "Arm64") {
    throw "zuke: no zuke release is built for the $arch architecture."
  }
  $asset = "zuke-$ZukeVersion-${BINARY_WINDOWS_TARGET}.zip"
  $base = if ($env:ZUKE_RELEASES_URL) { $env:ZUKE_RELEASES_URL } else { "${BINARY_RELEASES_URL}" }
  $downloadUrl = "$base/cli-v$ZukeVersion/$asset"
  $workDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
  New-Item -ItemType Directory -Path $workDir | Out-Null
  $archive = Join-Path $workDir $asset
  try {
    # The progress bar slows a large download severalfold in Windows PowerShell.
    $ProgressPreference = "SilentlyContinue"
    # The network is occasionally flaky (a transient 5xx from the CDN), so a
    # blip is retried with backoff rather than failing the run.
    $maxAttempts = 4
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
      try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $archive -UseBasicParsing
        break
      } catch {
        if ($attempt -ge $maxAttempts) {
          throw "zuke: failed to download $downloadUrl after $maxAttempts attempts: $_"
        }
        $delay = $attempt * 3
        Write-Host "zuke: download failed (attempt $attempt/$maxAttempts); retrying in \${delay}s..."
        Start-Sleep -Seconds $delay
      }
    }

    $actualSha256 = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $ZukeSha256) {
      throw "zuke: checksum mismatch for \${asset}: expected $ZukeSha256, got $actualSha256"
    }

    Expand-Archive -Path $archive -DestinationPath $workDir -Force
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $zuke) | Out-Null
    # Moved into place in one step, so a run interrupted mid-copy never leaves
    # a binary behind that later runs would trust without verifying.
    Move-Item -Force -Path (Join-Path $workDir "zuke.exe") -Destination $zuke
  } finally {
    Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
  }
}`;
}

/** The PowerShell launcher's plain resolution: the `zuke` on `PATH`, or fail. */
function pwshPlain(): string {
  return `$found = Get-Command zuke -CommandType Application -ErrorAction SilentlyContinue
if (-not $found) {
  throw "zuke: the zuke command is not on PATH. Install it, then re-run this launcher: ${BINARY_INSTALL_DOCS}"
}
$zuke = $found.Source`;
}

/**
 * The PowerShell launcher (`.\zuke.ps1`) of a hosted build. Mirrors
 * {@link binaryLauncherBash}, variant for variant.
 */
export function binaryLauncherPwsh(
  options: BinaryLauncherOptions,
  pin: BinaryPin,
): string {
  const purpose = options.download
    ? `# Runs zuke ${pin.version}, which carries the engine and every tool wrapper, so
# this project needs nothing installed but its own SDK's tools. On first use
# it downloads that release, checksum-verified, into ZUKE_INSTALL.
#
# Honoured environment variables:
#   ZUKE_INSTALL       where zuke releases are kept (default: ~/.zuke)
#   ZUKE_RELEASES_URL  a mirror of ${BINARY_RELEASES_URL};
#                      what it serves is verified against the pin below`
    : `${PLAIN_BINARY_LAUNCHER} ${BINARY_INSTALL_DOCS}`;
  const resolve = options.download ? pwshDownload(pin) : pwshPlain();
  return `#!/usr/bin/env pwsh
${LICENSE_HEADER}
#
${BINARY_LAUNCHER_MARKER} (PowerShell).
#
${usage(".\\zuke.ps1")}
#
${purpose}

$ErrorActionPreference = "Stop"

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

${resolve}

# zuke runs the build here itself rather than this launcher again, and does not
# hold this directory to the trust gate: running the launcher named it.
$env:${FORWARDED_ENV} = "1"
$env:${LAUNCHER_ROOT_ENV} = $dir
& $zuke @args
exit $LASTEXITCODE
`;
}

/* cspell:enable */
