// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The state store the run-management commands (`resume`, `cancel`, `runs`, and
 * the MCP run tools) read from.
 *
 * They differ from an ordinary build run in exactly one way: the default
 * filesystem store under `<root>/.zuke/runs` is always on. A build only opts
 * into durable state (`--state`, a lock, a wait), but a command *about* runs has
 * nothing to do without a store, so it never has to be asked twice.
 *
 * Module-internal: deliberately not re-exported from `mod.ts`.
 *
 * @module
 */

import { ARTIFACT_DIR, findConfigDir, pathExists } from "./config.ts";
import { absolutePath } from "./path.ts";
import { defaultStateHost, type StateStore } from "./state/store.ts";
import { resolveStateStore } from "./state/resolve.ts";

/**
 * Pick the store for a run-management command: an explicit `option` wins
 * (`false` disables state), then a build's `declared` `stateStore()` override,
 * then the environment, then the default filesystem store under
 * `<root>/.zuke/runs`.
 *
 * @param option The store passed on the command's options.
 * @param declared The build's `stateStore()` override.
 * @param readEnv Reads an environment variable (injectable for tests).
 */
export function resolveRunStore(
  option: StateStore | false | undefined,
  declared: StateStore | undefined,
  readEnv: (name: string) => string | undefined,
): StateStore | undefined {
  return resolveStateStore(option, declared, {
    readEnv,
    host: defaultStateHost,
    defaultDir: absolutePath(
      findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd(),
    )(ARTIFACT_DIR, "runs").path,
    enableDefault: true,
  });
}
