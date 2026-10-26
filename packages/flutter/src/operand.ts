// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Positional operands that cannot be mistaken for options.
 *
 * `flutter` parses its command line with Dart's `args` package, so a positional
 * that starts with `-` — a globbed test file called `--update-goldens`, or a
 * package name taken from build input — would be read as a flag. A relative
 * path is prefixed with `./`, which names the same file; a package name has no
 * such spelling, so one starting with `-` is refused.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";

/** `path` as a positional: prefixed with `./` when it starts with `-`. */
export function pathOperand(path: PathLike): string {
  const text = String(path);
  return text.startsWith("-") ? `./${text}` : text;
}

/** `name` as a positional, or a friendly error when it would read as a flag. */
export function nameOperand(task: string, name: string): string {
  if (name.startsWith("-")) {
    throw new Error(
      `FlutterTasks.${task}: ${JSON.stringify(name)} starts with "-" and ` +
        `would be read as a flag, not a package.`,
    );
  }
  return name;
}

/** `name` as the tail of a generated flag (`--enable-<name>`), or a friendly error. */
export function flagName(task: string, name: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `FlutterTasks.${task}: ${JSON.stringify(name)} is not a flag name ` +
        `(lowercase letters, digits and "-").`,
    );
  }
  return name;
}
