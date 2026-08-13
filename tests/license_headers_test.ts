// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Every source file carries the copyright and SPDX license header — the
 * per-file identification the OpenSSF Best Practices gold criteria
 * (`copyright_per_file`, `license_per_file`) require. Enforced here so a new
 * file cannot quietly ship without one.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";

const COPYRIGHT = "Copyright (c) ";
const SPDX = "SPDX-License-Identifier: MIT";

/** Directories whose `.ts` files are all subject to the header requirement. */
const TS_ROOTS = ["packages", "build", "tests"];

/** Every `.ts` file under `dir`, recursively. */
async function tsFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) found.push(...await tsFiles(path));
    else if (entry.isFile && entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

/** The files that must carry the header, whatever their comment syntax. */
async function allSources(): Promise<string[]> {
  const files: string[] = [];
  for (const root of TS_ROOTS) files.push(...await tsFiles(root));
  files.push("zuke.ts", "zuke", "zuke.ps1", "internal/hcl_tool.ts.tmpl");
  return files.sort();
}

Deno.test("every source file carries the copyright and SPDX header", async () => {
  const missing: string[] = [];
  for (const file of await allSources()) {
    // Only the head is inspected: the header belongs at the top (after a
    // shebang, for the launchers), not buried somewhere in the file.
    const head = (await Deno.readTextFile(file)).slice(0, 300);
    if (!head.includes(COPYRIGHT) || !head.includes(SPDX)) missing.push(file);
  }
  assertEquals(
    missing,
    [],
    `files missing the copyright/SPDX header (add the two header lines at ` +
      `the top, after any shebang):\n  ${missing.join("\n  ")}`,
  );
});
