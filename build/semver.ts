// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Ordering plain `<major>.<minor>.<patch>` versions.
 *
 * One implementation, because the interesting part is the mistake it prevents:
 * `1.10.0` sorts *below* `1.9.0` as text, and that comparison is wrong exactly
 * once the tenth release lands — late enough to be an unpleasant surprise, and
 * quiet enough that a second copy of the logic would keep it. The build has two
 * callers that need this order: picking the newest action release tag
 * (`action_release.ts`) and asserting that a plugin version moved *up*
 * (`plugin_version_check.ts`).
 *
 * Deliberately not a semver library: no ranges, no prerelease ordering, no
 * build metadata. Both callers compare two exact versions this repository
 * produced, and a prerelease has never been one of them. A version that does
 * not parse is reported as such, for the caller to refuse or ignore as its own
 * contract requires.
 *
 * @module
 */

/** A parsed `<major>.<minor>.<patch>` version. */
export interface Semver {
  /** The major component. */
  major: number;
  /** The minor component. */
  minor: number;
  /** The patch component. */
  patch: number;
}

/** A plain three-component version, with nothing before or after it. */
const TRIPLE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parse `<major>.<minor>.<patch>`, or `undefined` when `text` is not one.
 *
 * A leading `v` is not accepted: a caller whose input carries one (a release
 * tag) strips it, so this stays a single unambiguous shape.
 */
export function parseSemver(text: string): Semver | undefined {
  const match = TRIPLE.exec(text.trim());
  if (match === null) return undefined;
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

/**
 * Order two parsed versions by major, then minor, then patch: negative when `a`
 * is older, positive when it is newer, zero when they are the same.
 */
export function compareSemver(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Whether `candidate` is strictly newer than `previous`.
 *
 * `false` when either side does not parse — the honest answer for two versions
 * this cannot order, and the safe one for a caller using it as a gate, since it
 * refuses rather than waving through what it did not understand.
 */
export function isNewerSemver(candidate: string, previous: string): boolean {
  const a = parseSemver(candidate);
  const b = parseSemver(previous);
  if (a === undefined || b === undefined) return false;
  return compareSemver(a, b) > 0;
}
