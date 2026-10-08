// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `zuke cache`: fetch everything the build imports, keeping the lock.
 *
 * It runs `deno install --entrypoint zuke.ts` in the project root, which
 * downloads whatever the module graph needs into Deno's cache and records any
 * resolution the lock is missing — a warm-up for CI or for going offline.
 * Unlike `zuke relock`, the existing lock stays: what it already pins is not
 * moved. `--min-dep-age` passes Deno's `--minimum-dependency-age` through,
 * and only matters for a resolution the lock does not have yet.
 *
 * @module
 */

import type { BuildProbe } from "./dispatch.ts";
import type { CliPaint } from "./paint.ts";
import {
  installArgs,
  parseInstallFlags,
  type ProjectHost,
  projectRoot,
} from "./project.ts";

/**
 * Run `zuke cache <args>` from `cwd`, reporting through `log`, and return the
 * exit code.
 *
 * @throws {Error} with a message for the user when the request cannot be
 * carried out. `main` prints the message and exits 1.
 */
export async function runCache(
  args: string[],
  log: (line: string) => void,
  host: ProjectHost,
  paint: CliPaint,
  cwd: string,
  probe: BuildProbe,
): Promise<number> {
  const flags = parseInstallFlags("cache", args);
  const root = await projectRoot(cwd, probe, "cache");
  const denoArgs = installArgs("cache", flags, host.denoVersion());
  if (flags.dryRun) {
    log(`Would cache the build's dependencies: deno ${denoArgs.join(" ")}`);
    return 0;
  }
  const code = await host.deno(denoArgs, root);
  if (code !== 0) {
    log(paint.fail(`zuke cache: deno install exited ${code}.`));
    return code;
  }
  log(paint.ok("Cached everything the build imports."));
  return 0;
}
