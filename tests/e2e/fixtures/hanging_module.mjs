// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A Node module that produces a value and then never lets Node exit — the
 * shape an application factory takes once it has opened a server or a pool.
 * The interval stands in for that handle: nothing here ever clears it, so the
 * process only ends if something ends it.
 */
export function build() {
  setInterval(() => {}, 1000);
  return { document: "3.1.0" };
}
