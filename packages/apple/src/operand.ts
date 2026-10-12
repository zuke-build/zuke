// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Path operands that cannot be mistaken for options.
 *
 * `codesign`, `ditto`, `security` and `notarytool` all parse their command
 * line with getopt, so a positional path that happens to start with a hyphen —
 * a file a build globbed up called `-f`, or `--deep` — would be read as a flag
 * rather than as the file it names. Prefixing a relative path with `./` names
 * the same file and can no longer be parsed as an option, so the rewrite is
 * applied to every path operand rather than refusing the build.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";

/**
 * `path`, made safe to pass as a positional operand: unchanged unless it starts
 * with `-`, in which case it is prefixed with `./`. An absolute path starts
 * with `/` and is never rewritten.
 */
export function operand(path: PathLike): string {
  const text = String(path);
  return text.startsWith("-") ? `./${text}` : text;
}
