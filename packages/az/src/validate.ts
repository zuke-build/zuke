// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The argv guards every settings class shares. Internal to the package.
 *
 * Each closes a way a value could make the Azure CLI do something other than
 * what the settings say:
 *
 * - **A token that starts with `-`** is read by the CLI's argument parser as
 *   the next option. An option's own value is safe when sent as one
 *   `--flag=value` token ({@link option}), but a positional operand or one
 *   element of a list-valued option (`--metrics a b`, `--tags k=v`) is a token
 *   of its own, so `metrics("Requests", "--subscription=other")` would have
 *   run the command against another subscription. {@link operand} and
 *   {@link operands} refuse such a value.
 * - **A value that starts with `@`** is replaced by the contents of that file
 *   before the command is even parsed — `@-` by standard input. The CLI does
 *   this for *every* token (`azure.cli.core.commands._expand_file_prefixed_files`),
 *   looking at the part after a token's first `=`, or the whole token when it
 *   has none; so `--tags=@x` and a list element `KEY=@~/.azure/msal_token_cache.json`
 *   are both read from disk and sent to Azure. {@link option} and
 *   {@link operand} refuse a value the CLI would expand, so every typed setter
 *   is guarded by construction. {@link fromStdin} is the one deliberate use:
 *   it is how a secret reaches the CLI without entering the argv.
 *
 * @module
 */

/**
 * Whether the CLI would replace `token` with a file's contents: the part after
 * its first `=` — or the whole token, when it has none — starts with `@` and
 * names something. A mirror of the CLI's own rule, so the refusal fires on
 * exactly what it would expand.
 */
function expandsFile(token: string): boolean {
  const at = token.indexOf("=");
  const value = at === -1 ? token : token.slice(at + 1);
  return value.startsWith("@") && value.length > 1;
}

/** Refuse `token` when the CLI would read a file in its place. */
function refuseExpansion(what: string, shown: string, token: string): void {
  if (expandsFile(token)) {
    throw new Error(
      `AzTasks: the ${what} value "${shown}" starts with '@', which the Azure ` +
        "CLI replaces with the contents of the file it names — so the file " +
        "would leave the machine instead of the value. Refused.",
    );
  }
}

/**
 * `--flag=value` as one token, so a value starting with `-` stays the value.
 * Refused when the CLI would read the value from a file.
 */
export function option(flag: string, value: string | number): string {
  const token = `${flag}=${value}`;
  refuseExpansion(flag, String(value), token);
  return token;
}

/** `--flag=true` or `--flag=false`, the form the CLI's three-state flags take. */
export function bool(flag: string, value: boolean): string {
  return option(flag, value ? "true" : "false");
}

/**
 * `value`, refused when the CLI would read it as an option, or read a file in
 * its place.
 */
export function operand(task: string, what: string, value: string): string {
  if (value.startsWith("-")) {
    throw new Error(
      `AzTasks.${task}: the ${what} value "${value}" starts with '-', which ` +
        "the Azure CLI would read as an option rather than a value. Refused — " +
        "a path can be written ./-name instead.",
    );
  }
  refuseExpansion(what, value, value);
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
 * `key`, refused when it is empty, holds an `=`, or starts with a character
 * the CLI gives a meaning to: `-` (an option), `@` (a file) or `{`/`[` (a
 * JSON document) — or with whitespace, which the CLI strips before that JSON
 * check, so ` {"a":1,"b":2}=x` would have set two settings.
 */
export function settingKey(task: string, what: string, key: string): string {
  if (key === "" || key.includes("=") || /^[\s\-@{[]/.test(key)) {
    throw new Error(
      `AzTasks.${task}: "${key}" is not usable as a ${what} name — it is ` +
        "empty, holds '=', or starts with whitespace, '-', '@', '{' or '['.",
    );
  }
  return key;
}

/**
 * `key=value`, with the key checked by {@link settingKey}. For a pair sent
 * inside one `--flag=key=value` token, where the CLI reads no file from the
 * value.
 */
export function keyed(
  task: string,
  what: string,
  key: string,
  value: string | number,
): string {
  return `${settingKey(task, what, key)}=${value}`;
}

/**
 * `key=value` as one list element of its own — an app setting, an
 * environment variable, a tag, a traffic weight — with the key checked by
 * {@link keyed} and the whole element by {@link operand}, which refuses a
 * value the CLI would read from a file.
 */
export function pair(
  task: string,
  what: string,
  key: string,
  value: string | number,
): string {
  return operand(task, what, keyed(task, what, key, value));
}

/**
 * `--flag=@-`: the CLI reads the value from standard input, so it never
 * enters the argv or the process table. The settings supply that input; the
 * CLI strips trailing line breaks from what it reads.
 */
export function fromStdin(flag: string): string {
  return `${flag}=@-`;
}

/** `value`, refused unless it is a finite number. */
export function finite(task: string, what: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${task}: ${what} needs a finite number, got ${value}.`);
  }
  return value;
}

/** `value`, or a refusal naming the setter that supplies it. */
export function required<T>(
  value: T | undefined,
  task: string,
  hint: string,
): T {
  if (value === undefined) {
    throw new Error(`AzTasks.${task}: ${hint}`);
  }
  return value;
}
