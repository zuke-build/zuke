// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Joining the repeatable values gcloud takes as one comma-separated argument.
 *
 * Internal to the package: not exported from `mod.ts`. It exists so every flag
 * that takes a list joins it the same way and refuses the same input, rather
 * than each doing its own `join(",")`.
 *
 * The refusal is the point. A value containing a comma cannot survive this
 * encoding: gcloud splits on the comma and reads the remainder as another
 * entry. It does notice — `--set-env-vars A=1,2,B=3` fails with "Bad syntax for
 * dict arg: [2]" — but that message describes the argument gcloud received, not
 * the call the build made, and it points at `gcloud topic escaping` rather than
 * at the value responsible. Since this is the code that does the joining, it is
 * the code that can say which value cannot be joined.
 *
 * @module
 */

/**
 * The values as one comma-separated argument, refusing any that already
 * contains a comma.
 *
 * gcloud's own escape for such a value is the alternate-delimiter syntax
 * (`^:^A=1,2:B=3`), which a caller can still pass through the settings class's
 * inherited `.flag(...)` when they genuinely need it.
 */
export function commaJoined(
  values: readonly string[],
  task: string,
  flag: string,
): string {
  const offender = values.find((value) => value.includes(","));
  if (offender !== undefined) {
    throw new Error(
      `GcloudTasks.${task}: ${flag} joins its values with commas, so ` +
        `${
          JSON.stringify(offender)
        } cannot be passed this way — gcloud would ` +
        "read the text after the comma as another entry. Use gcloud's " +
        "alternate-delimiter syntax through .flag() for a value that must " +
        "contain one.",
    );
  }
  return values.join(",");
}
