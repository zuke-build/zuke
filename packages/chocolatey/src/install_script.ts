// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `tools/chocolateyinstall.ps1` half of a rendered package: download the
 * release zip, check its SHA-256, and unpack it into the package's own
 * `tools` directory.
 *
 * Unpacking into `tools` is what makes the package complete without an
 * uninstall script: choco creates a shim on `PATH` for every `.exe` under the
 * package directory, and on `choco uninstall` removes the directory — the
 * unpacked files with it — and those shims. So a zip package ships no
 * `chocolateyuninstall.ps1`; one would only be needed for something the
 * install did outside the package directory, which this one never does.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { psString } from "./powershell.ts";

/** The validated values the install script renders. */
export interface InstallScriptValues {
  /** The package id, passed as `packageName`. */
  id: string;
  /** The 64-bit zip's `https` URL. */
  url64bit: string;
  /** The zip's SHA-256, 64 lowercase hex digits. */
  checksum64: string;
}

/** Render the install script. */
export function renderInstallScript(values: InstallScriptValues): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$toolsDir = $(Split-Path -parent $MyInvocation.MyCommand.Definition)",
    "",
    "$packageArgs = @{",
    `  packageName    = ${psString(values.id)}`,
    "  unzipLocation  = $toolsDir",
    `  url64bit       = ${psString(values.url64bit)}`,
    `  checksum64     = ${psString(values.checksum64)}`,
    "  checksumType64 = 'sha256'",
    "}",
    "",
    "Install-ChocolateyZipPackage @packageArgs",
    "",
  ].join("\n");
}
