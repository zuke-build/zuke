// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The dependency-group flags several npm commands share.
 *
 * Internal to the package: not exported from `mod.ts`. `install`, `audit`,
 * `ls`, and `sbom` all take `--omit`/`--include`, but the commands that do not
 * — `run`, `publish`, `view` — would be offered flags npm rejects if these
 * lived on a shared base, so the rendering is shared as a function instead.
 *
 * @module
 */

import type { NpmIncludeType, NpmOmitType } from "./settings.ts";

/** Render `--omit=<group>` and `--include=<group>`, in npm's own order. */
export function dependencyGroupArgs(
  omit: readonly NpmOmitType[],
  include: readonly NpmIncludeType[],
): string[] {
  const argv: string[] = [];
  for (const type of omit) argv.push(`--omit=${type}`);
  for (const type of include) argv.push(`--include=${type}`);
  return argv;
}
