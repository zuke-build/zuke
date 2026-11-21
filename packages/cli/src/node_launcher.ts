// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `./zuke` (bash) and `zuke.ps1` (PowerShell) launchers of a project whose
 * build runs on Node, so a checkout with no Node installed can run
 * `./zuke <target>`. Each uses, in order: a `node` on `PATH` whose major
 * version is at least the pin's ({@link "./node_pin.ts"}); the copy cached
 * under `ZUKE_NODE_HOME` (default `~/.zuke/node`), one directory per release;
 * or the pinned release downloaded from nodejs.org, verified against its
 * SHA-256 and unpacked there. `NODE_VERSION` overrides the release and must
 * come with `NODE_SHA256`: nothing unverified is ever installed.
 *
 * The chosen node's directory goes first on `PATH`, so the `npm` the build runs
 * is that node's. Dependencies are installed with `--ignore-scripts` before the
 * build starts: `npm ci` when `package-lock.json` is newer than `node_modules`
 * (or it is missing), `npm install` when there is a `package.json` and no
 * lockfile. The launcher is a Node project's own; it names no other stack.
 *
 * @module
 */

import { assertBuildFileName, BUILD_FILE } from "./build_file.ts";
import {
  bashFetchVerified,
  LICENSE_HEADER,
  pwshFetchVerified,
} from "./launcher_shared.ts";
import {
  NODE_DIST_URL,
  NODE_PIN,
  NODE_POSIX_PLATFORMS,
  NODE_WINDOWS_PLATFORMS,
  type NodePin,
} from "./node_pin.ts";

/** What a Node launcher is rendered for. */
export interface NodeLauncherOptions {
  /** The build file the launcher runs. Omitted: `zuke.ts`. */
  buildFile?: string;
}

/** The pin's major version: the oldest `node` on `PATH` a launcher accepts. */
function majorOf(pin: NodePin): string {
  return pin.version.split(".")[0];
}

/** The `NODE_VERSION` / `NODE_SHA256` / `ZUKE_NODE_HOME` contract, as the comment block both scripts carry. */
function envDocs(pin: NodePin): string {
  return `# Honoured environment variables:
#   ZUKE_NODE_HOME  where Node is kept (default: ~/.zuke/node), one directory
#                   per release
#   NODE_VERSION    which Node to download, an exact release (e.g. ${pin.version}).
#                   Defaults to the pinned, verified ${pin.version}.
#   NODE_SHA256     required alongside a NODE_VERSION override: the SHA-256 of
#                   the release asset for the current platform. This launcher
#                   never downloads an unverified binary.`;
}

/* cspell:disable */

/**
 * The bash launcher (`./zuke`) of a Node project.
 *
 * @throws {Error} when the build file name is not a plain file name.
 */
export function nodeLauncherBash(
  options: NodeLauncherOptions = {},
  pin: NodePin = NODE_PIN,
): string {
  const build = assertBuildFileName(options.buildFile ?? BUILD_FILE);
  const arms = NODE_POSIX_PLATFORMS.map((platform) =>
    `    ${platform})\n      echo "${pin.checksums[platform]}" ;;`
  ).join("\n");
  return `#!/usr/bin/env bash
${LICENSE_HEADER}
#
# Zuke launcher for a build that runs on Node.
#
#   ./zuke               # run the default target
#   ./zuke <target>      # run one target and its prerequisites
#   ./zuke --list        # list every target
#
# Uses the node on PATH when it is Node ${majorOf(pin)} or newer, else a pinned,
# checksum-verified Node it downloads once, then installs the project's
# dependencies and runs ${build}.
#
${envDocs(pin)}
set -euo pipefail

DEFAULT_NODE_VERSION="${pin.version}"
MIN_NODE_MAJOR=${majorOf(pin)}

# SHA-256 of each \`node-v<version>-<platform>.tar.gz\` asset, from
# ${NODE_DIST_URL}/v${pin.version}/SHASUMS256.txt. Generated from @zuke/cli's
# node_pin.ts: change the pin there.
node_checksum_for() {
  case "$1" in
${arms}
    *)
      return 1 ;;
  esac
}

dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$dir"

node_version="\${NODE_VERSION:-$DEFAULT_NODE_VERSION}"
node_version="\${node_version#v}"
node_home="\${ZUKE_NODE_HOME:-$HOME/.zuke/node}/v$node_version"

# The major version of the node on PATH, empty when there is none.
path_major=""
if command -v node >/dev/null 2>&1; then
  path_major="$(node --version 2>/dev/null | sed -n 's/^v\\([0-9][0-9]*\\)\\..*/\\1/p')"
fi

if [ -n "$path_major" ] && [ "$path_major" -ge "$MIN_NODE_MAJOR" ]; then
  node_dir="$(dirname "$(command -v node)")"
elif [ -x "$node_home/bin/node" ]; then
  node_dir="$node_home/bin"
else
  echo "zuke: Node $MIN_NODE_MAJOR or newer not found — installing $node_version now..." >&2
  for cmd in curl tar; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "zuke: $cmd is required to download Node; install Node $MIN_NODE_MAJOR or newer instead." >&2
      exit 1
    fi
  done

  case "$(uname -s)" in
    Linux) os_part="linux" ;;
    Darwin) os_part="darwin" ;;
    *)
      echo "zuke: unsupported OS for the checksum-verified Node download: $(uname -s)." >&2
      exit 1
      ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch_part="x64" ;;
    arm64 | aarch64) arch_part="arm64" ;;
    *)
      echo "zuke: unsupported architecture for the checksum-verified Node download: $(uname -m)." >&2
      exit 1
      ;;
  esac
  platform="\${os_part}-\${arch_part}"

  if [ "$node_version" = "$DEFAULT_NODE_VERSION" ]; then
    expected_sha256="$(node_checksum_for "$platform")" || {
      echo "zuke: no pinned checksum for $platform." >&2
      exit 1
    }
  elif [ -n "\${NODE_SHA256:-}" ]; then
    expected_sha256="$NODE_SHA256"
  else
    echo "zuke: NODE_VERSION=$node_version overrides the pinned $DEFAULT_NODE_VERSION," >&2
    echo "      but no checksum is pinned for it. Set NODE_SHA256 to the expected" >&2
    echo "      SHA-256 of node-v$node_version-$platform.tar.gz, or unset NODE_VERSION." >&2
    exit 1
  fi

  asset="node-v\${node_version}-\${platform}.tar.gz"
  download_url="${NODE_DIST_URL}/v\${node_version}/\${asset}"
${bashFetchVerified("Node")}

  # Unpack beside the final directory, then move it in whole, so an interrupted
  # run never leaves a half-extracted Node that looks installed.
  mkdir -p "$(dirname "$node_home")" "$work_dir/unpacked"
  tar -xzf "$archive" -C "$work_dir/unpacked" --strip-components=1
  rm -rf "$node_home"
  mv "$work_dir/unpacked" "$node_home"
  node_dir="$node_home/bin"
fi

# This node first on PATH, so the npm and npx the build runs are its own.
export PATH="$node_dir:$PATH"

if [ -f package-lock.json ]; then
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
    npm ci --ignore-scripts
  fi
elif [ -f package.json ] && [ ! -d node_modules ]; then
  echo "zuke: no package-lock.json here yet — running npm install so one can be written." >&2
  npm install --ignore-scripts
fi

exec node ${build} "$@"
`;
}

/**
 * The PowerShell launcher (`.\zuke.ps1`) of a Node project, mirroring
 * {@link nodeLauncherBash}.
 *
 * @throws {Error} when the build file name is not a plain file name.
 */
export function nodeLauncherPowerShell(
  options: NodeLauncherOptions = {},
  pin: NodePin = NODE_PIN,
): string {
  const build = assertBuildFileName(options.buildFile ?? BUILD_FILE);
  const width = Math.max(...NODE_WINDOWS_PLATFORMS.map((p) => p.length)) + 2;
  const entries = NODE_WINDOWS_PLATFORMS.map((platform) =>
    `  ${`"${platform}"`.padEnd(width)} = "${pin.checksums[platform]}"`
  ).join("\n");
  return `#!/usr/bin/env pwsh
${LICENSE_HEADER}
#
# Zuke launcher (PowerShell) for a build that runs on Node.
#
#   .\\zuke.ps1               # run the default target
#   .\\zuke.ps1 <target>      # run one target and its prerequisites
#   .\\zuke.ps1 --list        # list every target
#
# Uses the node on PATH when it is Node ${majorOf(pin)} or newer, else a pinned,
# checksum-verified Node it downloads once, then installs the project's
# dependencies and runs ${build}.
#
${envDocs(pin)}

$ErrorActionPreference = "Stop"

$DefaultNodeVersion = "${pin.version}"
$MinNodeMajor = ${majorOf(pin)}

# SHA-256 of each \`node-v<version>-<platform>.zip\` asset, from
# ${NODE_DIST_URL}/v${pin.version}/SHASUMS256.txt. Generated from @zuke/cli's
# node_pin.ts: change the pin there.
$NodeChecksums = @{
${entries}
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$nodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { $DefaultNodeVersion }
$nodeVersion = $nodeVersion.TrimStart("v")
$nodeRoot = if ($env:ZUKE_NODE_HOME) { $env:ZUKE_NODE_HOME } else { Join-Path $HOME ".zuke\\node" }
$nodeHome = Join-Path $nodeRoot "v$nodeVersion"

function Resolve-Node {
  $onPath = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
  if ($onPath) {
    $reported = & $onPath.Source --version
    if ($reported -match '^v(\\d+)\\.' -and [int]$Matches[1] -ge $MinNodeMajor) {
      return $onPath.Source
    }
  }
  $local = Join-Path $nodeHome "node.exe"
  if (Test-Path $local) { return $local }
  return $null
}

$node = Resolve-Node
if (-not $node) {
  Write-Host "zuke: Node $MinNodeMajor or newer not found - installing $nodeVersion now..."

  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  $platform = switch ($arch) {
    "X64" { "win-x64" }
    "Arm64" { "win-arm64" }
    default {
      throw "zuke: unsupported architecture for the checksum-verified Node download: $arch."
    }
  }

  if ($nodeVersion -eq $DefaultNodeVersion -and $NodeChecksums.ContainsKey($platform)) {
    $expectedSha256 = $NodeChecksums[$platform]
  } elseif ($env:NODE_SHA256) {
    $expectedSha256 = $env:NODE_SHA256
  } else {
    throw "zuke: NODE_VERSION=$nodeVersion overrides the pinned $DefaultNodeVersion, " +
      "but no checksum is pinned for it. Set NODE_SHA256 to the expected SHA-256 " +
      "of node-v$nodeVersion-$platform.zip, or unset NODE_VERSION."
  }

  $asset = "node-v$nodeVersion-$platform.zip"
  $downloadUrl = "${NODE_DIST_URL}/v$nodeVersion/$asset"
  $workDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
  New-Item -ItemType Directory -Path $workDir | Out-Null
  $archive = Join-Path $workDir $asset
  try {
${pwshFetchVerified("Node")}

    # Unpack in the work directory, then move the release folder in whole, so
    # an interrupted run never leaves a half-extracted Node that looks installed.
    Expand-Archive -Path $archive -DestinationPath (Join-Path $workDir "unpacked") -Force
    New-Item -ItemType Directory -Force -Path $nodeRoot | Out-Null
    if (Test-Path $nodeHome) { Remove-Item -Recurse -Force $nodeHome }
    $release = Get-ChildItem -Path (Join-Path $workDir "unpacked") -Directory | Select-Object -First 1
    Move-Item -Path $release.FullName -Destination $nodeHome
  } finally {
    Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
  }

  $node = Join-Path $nodeHome "node.exe"
}

# This node first on PATH, so the npm and npx the build runs are its own.
$env:PATH = (Split-Path -Parent $node) + [IO.Path]::PathSeparator + $env:PATH

$install = $null
if (Test-Path "package-lock.json") {
  if (-not (Test-Path "node_modules") -or
    (Get-Item "package-lock.json").LastWriteTime -gt (Get-Item "node_modules").LastWriteTime) {
    $install = "ci"
  }
} elseif ((Test-Path "package.json") -and -not (Test-Path "node_modules")) {
  Write-Warning "zuke: no package-lock.json here yet - running npm install so one can be written."
  $install = "install"
}
if ($install) {
  & npm $install --ignore-scripts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

& $node (Join-Path $dir "${build}") @args
exit $LASTEXITCODE
`;
}

/* cspell:enable */
