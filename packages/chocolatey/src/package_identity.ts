// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A package's identity — its id and its version — and the checks both pass
 * before they are rendered into a nuspec, written as a file name, or handed to
 * `choco` as an operand.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

/** The longest id NuGet accepts. */
const MAX_ID = 100;

/**
 * A Chocolatey package id: lowercase letters and digits, in runs joined by a
 * single `.`, `-` or `_`. Narrower than NuGet on purpose — Chocolatey's
 * guidelines want ids lowercase, and the id is also the nuspec's file name, so
 * nothing in it may be a path separator or `..`.
 */
const ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/** A numeric version part, with no leading zero. */
const PART = "(?:0|[1-9][0-9]*)";

/** A dot-separated run of SemVer identifiers, for a label or metadata. */
const IDENTIFIERS = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";

/**
 * A NuGet version as Chocolatey v2 reads it: two to four numeric parts, then
 * an optional `-prerelease` label and `+metadata`. Leading zeros are refused,
 * because NuGet normalises `1.01` to `1.1` — the version written would not be
 * the version installed.
 */
const VERSION = new RegExp(
  `^${PART}\\.${PART}(?:\\.${PART}){0,2}(?:-${IDENTIFIERS})?(?:\\+${IDENTIFIERS})?$`,
);

/**
 * Refuse an id Chocolatey would not accept, or that could not safely become
 * a file name.
 *
 * @throws {Error} naming the id and the rule it breaks.
 */
export function assertPackageId(id: string): void {
  if (!ID.test(id) || id.length > MAX_ID) {
    throw new Error(
      `invalid package id ${JSON.stringify(id)}: use lowercase letters and ` +
        `digits, joined by single ".", "-" or "_" (e.g. "app" or ` +
        `"app-cli"), at most ${MAX_ID} characters.`,
    );
  }
}

/**
 * Refuse a version that is not a NuGet version.
 *
 * @throws {Error} naming the version and the expected form.
 */
export function assertPackageVersion(version: string): void {
  if (!VERSION.test(version)) {
    throw new Error(
      `invalid package version ${JSON.stringify(version)}: use a NuGet ` +
        `version such as 1.2.3, 1.2.3.4 or 1.2.3-beta.1, with no leading ` +
        `zeros.`,
    );
  }
}
