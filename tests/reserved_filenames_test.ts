// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * No file in the repository is named after a reserved DOS device.
 *
 * Windows still resolves `CON`, `PRN`, `AUX`, `NUL`, `COM1`…`COM9`, and
 * `LPT1`…`LPT9` as devices, **including with an extension** — `nul.ts` is the
 * NUL device, not a file. git refuses to write such a path on checkout
 * (`error: invalid path 'packages/git/src/nul.ts'`) and exits 128, so every
 * Windows job dies in `actions/checkout`, before a single test runs. On Linux
 * and macOS the file is perfectly ordinary, so nothing local catches it.
 *
 * That is a whole platform's CI lost to a file name, discovered only from a
 * red run. This test is the cheap guard: it names the offending file and the
 * rule, in the lane every contributor already runs.
 *
 * @module
 */

import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";

/** The device names Windows reserves, whatever extension follows them. */
const RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** Directories that hold no source of ours, or that git never checks out. */
const SKIP = new Set([
  ".git",
  "node_modules",
  "cov_profile",
  "target",
  "dist",
]);

/**
 * The name Windows resolves as a device: everything before the first dot,
 * lowercased — which is why an extension does not save `nul.ts`.
 */
function deviceName(fileName: string): string {
  const dot = fileName.indexOf(".");
  return (dot === -1 ? fileName : fileName.slice(0, dot)).toLowerCase();
}

/**
 * Every path under `dir`, recursively, skipping what git does not track. A
 * directory that is gone by the time it is read is skipped too: the gate's
 * other steps create and remove scratch directories in the repository root
 * (`.fmt-text-*`, `.snippets-*`) while the tests run, and none is tracked.
 */
async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(dir));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return found;
    throw error;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    found.push(path);
    if (entry.isDirectory) found.push(...await walk(path));
  }
  return found;
}

test("no path is named after a reserved DOS device", async () => {
  const offending: string[] = [];
  for (const path of await walk(".")) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (RESERVED.has(deviceName(name))) offending.push(path);
  }
  assertEquals(
    offending,
    [],
    `paths Windows resolves as a device, which git cannot check out there ` +
      `(rename them — an extension does not help, "nul.ts" is still NUL):\n  ${
        offending.join("\n  ")
      }`,
  );
});

test("the device check reads the name before the extension", () => {
  // The rule this test exists for: an extension does not make it a file.
  assertEquals(deviceName("nul.ts"), "nul");
  assertEquals(deviceName("NUL"), "nul");
  assertEquals(deviceName("com1.txt"), "com1");
  // ...and near-misses stay ordinary files.
  assertEquals(RESERVED.has(deviceName("nul_records.ts")), false);
  assertEquals(RESERVED.has(deviceName("console.ts")), false);
  assertEquals(RESERVED.has(deviceName("com10.ts")), false);
});
