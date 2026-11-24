// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { denoCalls } from "./_runtime_neutral.ts";

/** A package root holding `mod.ts` and `src/a.ts` with `source`. */
async function fixture(source: string): Promise<URL> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/src`);
  await Deno.writeTextFile(`${root}/mod.ts`, "");
  await Deno.writeTextFile(`${root}/src/a.ts`, source);
  return new URL(`file://${root}/`);
}

Deno.test("denoCalls reports a call that a comment marker in a string precedes", async () => {
  const root = await fixture(
    'const prefix = " // ";\nconst token = Deno.env.get("TOKEN") + prefix;\n' +
      'const open = "/*"; const t = Deno.env.get("A"); const close = "*/";\n',
  );
  assertEquals(await denoCalls(root), ["src/a.ts:2", "src/a.ts:3"]);
});

Deno.test("denoCalls skips whole comment lines", async () => {
  const root = await fixture(
    "/**\n * Defaults to `Deno.env.get`.\n */\n// Deno.readFile once\nexport const x = 1;\n",
  );
  assertEquals(await denoCalls(root), []);
});
