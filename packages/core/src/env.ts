/**
 * Process-environment helpers for a build. Right now that is {@link prependPath}
 * — put a provisioned tool's directory on `PATH` so every subprocess the build
 * spawns can find it.
 *
 * ```ts
 * import { installTree, prependPath } from "jsr:@zuke/core";
 *
 * const node = await installTree({ name: "node", ...  });
 * prependPath(node("bin")); // now `node`, `npm`, `npx` resolve on PATH
 * ```
 *
 * @module
 */

import { operatingSystem } from "./host.ts";
import type { PathLike } from "./path.ts";

/**
 * Prepend `dir` to the process `PATH`, and return the new value. A tool
 * provisioned into `dir` (e.g. the `bin` directory of an {@link "./install.ts".installTree}
 * runtime) then resolves for the rest of the build: the shell `$`, `Command`,
 * and every tool wrapper spawn subprocesses that inherit `Deno.env`, so the
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
  os: typeof Deno.build.os = Deno.build.os,
): string {
  const separator = operatingSystem(os) === "windows" ? ";" : ":";
  const entry = String(dir);
  const current = Deno.env.get("PATH") ?? "";
  const parts = current.split(separator).filter((part) => part !== "");
  if (parts.includes(entry)) return current; // already present — unchanged
  const next = current === "" ? entry : `${entry}${separator}${current}`;
  Deno.env.set("PATH", next);
  return next;
}
