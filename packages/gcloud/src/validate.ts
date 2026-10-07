// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The argv guards the logging and monitoring settings classes share. Internal
 * to the package.
 *
 * A token that starts with `-` is read by gcloud's argument parser as the
 * next flag: `gcloud logging read -severity=ERROR` exits 2 with
 * "unrecognized arguments". An option's own value is safe when it is sent as
 * one `--flag=value` token ({@link option}), but a positional operand is a
 * token of its own, so `policy("--project=other")` would have described a
 * policy in another project. {@link operand} refuses such a value.
 *
 * @module
 */

/** `--flag=value` as one token, so a value starting with `-` stays the value. */
export function option(flag: string, value: string | number): string {
  return `${flag}=${value}`;
}

/** `value`, refused when gcloud would read it as a flag rather than a value. */
export function operand(task: string, what: string, value: string): string {
  if (value.startsWith("-")) {
    throw new Error(
      `GcloudTasks.${task}: the ${what} "${value}" starts with '-', which ` +
        "gcloud would read as a flag rather than a value. Refused.",
    );
  }
  return value;
}

/** `value`, refused unless it is a finite number. */
export function finite(task: string, what: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${task}: ${what} needs a finite number, got ${value}.`);
  }
  return value;
}
