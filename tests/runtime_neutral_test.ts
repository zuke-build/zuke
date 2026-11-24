// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";
import { denoCalls } from "./_runtime_neutral.ts";

/** A package root holding `mod.ts` and `src/a.ts` with `source`. */
async function fixture(source: string): Promise<URL> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/src`);
  await Deno.writeTextFile(`${root}/mod.ts`, "");
  await Deno.writeTextFile(`${root}/src/a.ts`, source);
  return new URL(`file://${root}/`);
}

test("denoCalls reports a call that a comment marker in a string precedes", async () => {
  const root = await fixture(
    'const prefix = " // ";\nconst token = Deno.env.get("TOKEN") + prefix;\n' +
      'const open = "/*"; const t = Deno.env.get("A"); const close = "*/";\n',
  );
  assertEquals(await denoCalls(root), ["src/a.ts:2", "src/a.ts:3"]);
});

test("denoCalls reports a call after a block comment on its line", async () => {
  const root = await fixture('/* explanation */ Deno.env.get("TOKEN");\n');
  assertEquals(await denoCalls(root), ["src/a.ts:1"]);
});

test("denoCalls ignores Deno named inside strings and template text", async () => {
  const root = await fixture(
    "const a = \"Deno.env.get\";\nconst b = 'Deno.x';\nconst c = `Deno.y ${1}`;\n",
  );
  assertEquals(await denoCalls(root), []);
});

test("denoCalls reports a call inside a template substitution", async () => {
  const root = await fixture(
    'const a = `x ${Deno.env.get("A")} y`;\nconst b = `p\n${{ k: 1 }.k} q`;\nDeno.exit();\n',
  );
  assertEquals(await denoCalls(root), ["src/a.ts:1", "src/a.ts:4"]);
});

test("denoCalls reads past regular expressions holding quotes and backticks", async () => {
  const root = await fixture(
    'const backtick = /`/;\nconst q = text.replace(/["\'`/]+/g, "");\nconst half = 4 / 2; Deno.exit();\nDeno.cwd();\n',
  );
  assertEquals(await denoCalls(root), ["src/a.ts:3", "src/a.ts:4"]);
});

test("denoCalls reads a regular expression after a condition or a keyword", async () => {
  const root = await fixture(
    "if (ok(a)) /`/.test(s);\nwhile (x) /* c */ /'/.exec(t);\nconst t = typeof /`/;\nconst r = (a) / 2;\nDeno.cwd();\n",
  );
  assertEquals(await denoCalls(root), ["src/a.ts:5"]);
});

test("denoCalls skips whole comment lines", async () => {
  const root = await fixture(
    "/**\n * Defaults to `Deno.env.get`.\n */\n// Deno.readFile once\nexport const x = 1;\n",
  );
  assertEquals(await denoCalls(root), []);
});
