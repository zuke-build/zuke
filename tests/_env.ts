// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Scoped environment-variable overrides for the test suite. Tests that exercise
 * CI detection, host discovery, token plumbing or the Actions job summary all
 * need the same thing: set a few variables, run a body, put the originals back
 * — including deleting one that was not set before.
 *
 * @module
 */

import process from "node:process";
import { EnvTasks } from "@zuke/core";

/**
 * Run `fn` with `values` applied to the process environment, restoring every
 * name's prior value afterwards (deleting the ones that were unset). A value of
 * `undefined` deletes the variable for the duration, which is how a test proves
 * behaviour in the absence of a signal it might otherwise inherit from CI.
 */
export async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    saved.set(name, EnvTasks.get(name));
    setEnv(name, value);
  }
  try {
    await fn();
  } finally {
    for (const [name, value] of saved) setEnv(name, value);
  }
}

/**
 * Set `name` for the rest of the process, or delete it when `value` is
 * `undefined`. Core reads the environment but never writes it, so a test that
 * must leave a variable changed comes here; {@link withEnv}, which restores
 * it, is the better fit wherever the change has a scope.
 */
export function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
