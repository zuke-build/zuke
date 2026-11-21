// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The runtime a project's build file runs on: Deno unless the `runtime`
 * field of its `zuke.json` names Node.
 *
 * @module
 */

import { forgivingField } from "./records.ts";

/** The field of `zuke.json` naming the runtime the build file runs on. */
export const RUNTIME_FIELD = "runtime";

/** A runtime a project's build file can run on. */
export type ProjectRuntime = "deno" | "node";

/** The runtime of a project whose `zuke.json` names none. */
export const DEFAULT_RUNTIME: ProjectRuntime = "deno";

/**
 * The runtime a `zuke.json` with the contents `text` names: its `runtime`
 * field, {@link DEFAULT_RUNTIME} when there is none or the file is not a JSON
 * object (as for the build file's name, the file's presence alone marked a
 * project before the field existed).
 *
 * @throws {Error} when the field is there and names no runtime Zuke runs on.
 */
export function runtimeNamed(text: string): ProjectRuntime {
  const runtime = forgivingField(text, RUNTIME_FIELD);
  if (runtime === undefined) return DEFAULT_RUNTIME;
  if (runtime === "deno" || runtime === "node") return runtime;
  throw new Error(
    `zuke: zuke.json's '${RUNTIME_FIELD}' is ${
      JSON.stringify(runtime)
    }; it names the runtime the build file runs on, "deno" or "node".`,
  );
}
