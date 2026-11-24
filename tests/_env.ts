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
    saved.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
