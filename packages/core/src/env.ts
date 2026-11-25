// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Process-environment helpers for a build: {@link EnvTasks} reads a variable,
 * and {@link prependPath} puts a provisioned tool's directory on `PATH` so
 * every subprocess the build spawns can find it.
 *
 * ```ts
 * import { installTree, prependPath } from "@zuke/core";
 *
 * const node = await installTree({ name: "node", ...  });
 * prependPath(node("bin")); // now `node`, `npm`, `npx` resolve on PATH
 * ```
 *
 * @module
 */

import process from "node:process";
import { type HostOs, hostOs, operatingSystem } from "./host.ts";
import { defaultReadEnv } from "./internal.ts";
import type { PathLike } from "./path.ts";

/**
 * Prepend `dir` to the process `PATH`, and return the new value. A tool
 * provisioned into `dir` (e.g. the `bin` directory of an {@link "./install.ts".installTree}
 * runtime) then resolves for the rest of the build: the shell `$`, `Command`,
 * and every tool wrapper spawn subprocesses that inherit the environment, so the
 * `node_modules/.bin` shims and `NpmTasks` that assume a `node`/`npm` on `PATH`
 * find the provisioned one.
 *
 * Idempotent — a directory already on `PATH` is left in place, not duplicated —
 * and uses the platform separator (`;` on Windows, `:` elsewhere).
 *
 * @param dir the directory to place first on `PATH`.
 * @param os the OS whose `PATH` separator to use; defaults to the host (a test
 * seam, mirroring {@link operatingSystem}).
 * @returns the resulting `PATH` string.
 */
export function prependPath(
  dir: PathLike,
  os: HostOs = hostOs(),
): string {
  const separator = operatingSystem(os) === "windows" ? ";" : ":";
  const entry = String(dir);
  const current = process.env.PATH ?? "";
  const parts = current.split(separator).filter((part) => part !== "");
  if (parts.includes(entry)) return current; // already present — unchanged
  const next = current === "" ? entry : `${entry}${separator}${current}`;
  process.env.PATH = next;
  return next;
}

/** The shape of {@link EnvTasks}. */
export interface EnvTasksApi {
  /**
   * The value of the environment variable `name`, or `undefined` when it is
   * not set. A runtime that denies reading the environment, as Deno can, reads
   * as unset rather than throwing.
   */
  get(name: string): string | undefined;

  /**
   * Set the environment variable `name` to `value` for this process and the
   * processes it starts from now on.
   */
  set(name: string, value: string): void;

  /** Remove the environment variable `name`; a no-op when it is not set. */
  delete(name: string): void;
}

/**
 * The process environment, on whichever runtime the build runs on.
 *
 * ```ts
 * import { EnvTasks } from "@zuke/core";
 *
 * const token = EnvTasks.get("GITHUB_TOKEN");
 * ```
 */
export const EnvTasks: EnvTasksApi = {
  get(name: string): string | undefined {
    return defaultReadEnv(name);
  },

  set(name: string, value: string): void {
    process.env[name] = value;
  },

  delete(name: string): void {
    delete process.env[name];
  },
};
