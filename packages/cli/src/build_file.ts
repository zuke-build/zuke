// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The name of a project's build file: `zuke.ts` unless the `build` field of
 * its `zuke.json` names another.
 *
 * The name is written into a shell script, a PowerShell script and JSON, and
 * handed to `deno run`, so one check decides what a name may be and every
 * place that reads or writes it goes through it.
 *
 * @module
 */

import { isRecord } from "./records.ts";

/** The build file of a project whose `zuke.json` names none. */
export const BUILD_FILE = "zuke.ts";

/** The build file `zuke setup` gives a new project, recorded in its `zuke.json`. */
export const NEW_BUILD_FILE = "build.ts";

/** The field of `zuke.json` naming the build file. */
export const BUILD_FIELD = "build";

/**
 * A plain file name: letters, digits, dots, dashes and underscores, no
 * leading dash (it would read as an option), ending in `.ts`.
 */
const BUILD_FILE_NAME = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*\.ts$/;

/**
 * `name`, when it is a build file name that is safe to write into a launcher
 * and pass to `deno run`.
 *
 * @throws {Error} naming the two places a name comes from, and the rule,
 * otherwise.
 */
export function assertBuildFileName(name: string): string {
  if (!BUILD_FILE_NAME.test(name)) {
    throw new Error(
      `zuke: the build file name '${name}' (zuke.json's '${BUILD_FIELD}', ` +
        "or --build-file) is not a plain TypeScript file name: letters, " +
        "digits, dots, dashes and underscores only, not starting with a " +
        "dash, ending in .ts",
    );
  }
  return name;
}

/**
 * The build file a `zuke.json` with the contents `text` names.
 *
 * {@link BUILD_FILE} when the file has no `build` field, and also when it is
 * not a JSON object: the file's presence alone marked a project before the
 * field existed, so an empty or malformed one still means `zuke.ts`.
 *
 * @throws {Error} when the field is there and is not a valid name, see
 * {@link assertBuildFileName}.
 */
export function buildFileNamed(text: string): string {
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    return BUILD_FILE;
  }
  if (!isRecord(config) || !(BUILD_FIELD in config)) return BUILD_FILE;
  const name = config[BUILD_FIELD];
  // Anything but a string is refused as written: String() would turn the
  // array ["build.ts"] into a name that passes.
  return assertBuildFileName(
    typeof name === "string" ? name : JSON.stringify(name),
  );
}
