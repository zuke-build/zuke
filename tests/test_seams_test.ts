// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests reach the runtime and the test framework only through seams of our
 * own (AGENTS.md, "Testing"): core's tasks for the runtime, `tests/_testing.ts`
 * and `tests/_assert.ts` for the framework. So no test file calls `Deno.`,
 * imports a `node:` module or imports a test library, apart from:
 *
 * - the root helpers, `tests/_*.ts` and `tests/integration/_harness.ts`, which
 *   hold what core does not offer;
 * - fixtures and fakes a test runs as a subprocess, under `tests/support/` and
 *   any `fixtures/` directory, and the e2e suite, which runs on Deno alone;
 * - the files still on `tests/node_pending.json`, which follow as they are
 *   ported;
 * - {@link BOUNDARY}, the tests whose subject is the boundary itself.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";
import { codeOnly } from "./_runtime_neutral.ts";

/** Tests that hand core a runtime's own objects, or stub the runtime. */
const BOUNDARY = new Set([
  // Their Deno-only tests compare core's answers with Deno's own, stub
  // Deno.env, or build Deno's error classes.
  "packages/core/tests/internal_test.ts",
  "packages/core/tests/runtime_test.ts",
  "packages/core/tests/signal_test.ts",
  // Stubs `process.exit` to see the CLI's exit code.
  "packages/core/tests/cli_test.ts",
  // Feed core's servers, streams and stdio Node's sockets and streams.
  "packages/core/tests/serve_test.ts",
  "packages/core/tests/stdio_test.ts",
  "packages/core/tests/stream_net_test.ts",
  "packages/core/tests/web_stream_test.ts",
]);

/** Whether `path` may call the runtime directly, without being in a list. */
function exempt(path: string): boolean {
  return /^tests\/(integration\/)?_[^/]+\.ts$/.test(path) ||
    path.startsWith("tests/support/") || path.startsWith("tests/e2e/") ||
    path.includes("/fixtures/");
}

/** Every `.ts` file under `dir`, recursively, `/`-separated. */
async function tsFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await FileTasks.readDirectory(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) found.push(...await tsFiles(path));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

/** Why `source` reaches past the seams, or nothing when it does not. */
export function reachesPast(source: string): string[] {
  const reasons: string[] = [];
  if (/\bDeno\./.test(codeOnly(source))) reasons.push("calls Deno.");
  for (
    const [, from] of source.matchAll(/^import\b[^;]*?\bfrom\s+"([^"]+)"/gms)
  ) {
    if (from.startsWith("node:")) reasons.push(`imports ${from}`);
    else if (/^(npm:)?(vitest|jest|mocha)\b/.test(from)) {
      reasons.push(`imports ${from}`);
    }
  }
  return reasons;
}

test("reachesPast finds a Deno call, a node: import and a test library, and nothing in strings", () => {
  assertEquals(reachesPast('await Deno.readTextFile("a");\n'), ["calls Deno."]);
  assertEquals(
    reachesPast('import { readFile } from "node:fs/promises";\n'),
    ["imports node:fs/promises"],
  );
  assertEquals(
    reachesPast('import {\n  expect,\n} from "vitest";\n'),
    ["imports vitest"],
  );
  assertEquals(
    reachesPast(
      'import { FileTasks } from "@zuke/core";\n' +
        'const fixture = `await Deno.exit(1); import "node:fs";`;\n' +
        "// Deno.cwd() in a comment\n",
    ),
    [],
  );
});

test("test files reach the runtime and the test framework only through the seams", async () => {
  const pending = new Set<string>(
    await FileTasks.readJson("tests/node_pending.json"),
  );
  const files = [
    ...await tsFiles("tests"),
    ...(await FileTasks.readDirectory("packages"))
      .filter((pkg) => pkg.isDirectory)
      .map((pkg) => `packages/${pkg.name}/tests`),
  ];
  const offenders: string[] = [];
  for (const root of files) {
    const paths = root.endsWith(".ts")
      ? [root]
      : await FileTasks.exists(root)
      ? await tsFiles(root)
      : [];
    for (const path of paths) {
      if (exempt(path) || pending.has(path) || BOUNDARY.has(path)) continue;
      for (const reason of reachesPast(await FileTasks.readText(path))) {
        offenders.push(`${path}: ${reason}`);
      }
    }
  }
  assertEquals(
    offenders.sort(),
    [],
    "use core's tasks, tests/_testing.ts and tests/_assert.ts; anything core " +
      "lacks belongs in a root helper, tests/_*.ts",
  );
});
