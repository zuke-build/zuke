// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `build/fmt_text.ts` — the helper that runs generated text
 * through `deno fmt` so a generated file and the formatter cannot disagree.
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { withTempCwd } from "../packages/core/tests/_temp.ts";
import { formatText } from "../build/fmt_text.ts";

Deno.test("formatText formats TypeScript with the repository's rules", async () => {
  const formatted = await formatText("const   x={a:1,b:2}\n", "ts");
  assertEquals(formatted, "const x = { a: 1, b: 2 };\n");
});

Deno.test("formatText parses by extension, not by content", async () => {
  // The same bytes are a different document in each language, which is why the
  // extension is a parameter rather than assumed: read as Markdown this is a
  // paragraph and survives untouched; read as TypeScript it would not parse.
  const prose = "A sentence that is plainly not code.\n";
  assertEquals(await formatText(prose, "md"), prose);
});

Deno.test("formatText is idempotent", async () => {
  // What every caller relies on: the output is a fixed point, so a committed
  // generated file matches what a later `deno fmt` over the repository leaves.
  const once = await formatText("# Title\n\n|a|b|\n|---|---|\n|1|2|\n", "md");
  assertEquals(await formatText(once, "md"), once);
});

Deno.test("formatText leaves no temporary directory behind", async () => {
  // formatText makes its scratch directory in the working directory, and the
  // suite's other shards call it concurrently in the repository root, so the
  // root is no place to count them (#857). A private working directory inside
  // the repository — dot-prefixed so a concurrent `deno fmt` skips it, as
  // formatText's own is — still formats under the repository's config, and
  // only this call can leave anything in it.
  await withTempCwd(async (dir) => {
    await formatText("const x = 1;\n", "ts");
    assertEquals(await entries(dir), []);
  }, { dir: Deno.cwd(), prefix: ".fmt-cleanup-test-" });
});

/** Every entry in `dir`. */
async function entries(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) found.push(entry.name);
  return found;
}
