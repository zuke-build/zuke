// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the graph-page generate-then-verify flow, driven through the
 * real CLI `main()` — a fixture build whose targets call `writeGraphDoc` /
 * `checkGraphDoc` exactly the way `zuke.ts`'s `graphDoc` / `graphDocCheck`
 * targets do, proving the pattern works end-to-end (target execution, the
 * discovered graph feeding the generator, and the failing-check exit code).
 */

import { Build, discoverTargets, target } from "../../packages/core/mod.ts";
import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { checkGraphDoc, writeGraphDoc } from "../../build/graph_doc.ts";
import { runCli } from "./_harness.ts";

/** A fixture mirroring zuke.ts's graphDoc/graphDocCheck wiring. */
function fixture(path: string): new () => Build {
  return class GraphDocDemo extends Build {
    lint = target().description("Lint").executes(() => {});
    test = target().description("Test").dependsOn(this.lint).executes(
      () => {},
    );
    graphDoc = target()
      .description("Regenerate the graph page")
      .executes(async () => {
        await writeGraphDoc(discoverTargets(this), path);
      });
    graphDocCheck = target()
      .description("Verify the graph page is current")
      .executes(async () => {
        const stale = await checkGraphDoc(discoverTargets(this), path);
        if (stale.length > 0) {
          throw new Error(
            `The build-graph page is out of date:\n  ${stale.join("\n  ")}`,
          );
        }
      });
  };
}

Deno.test("graphDoc target writes the page and graphDocCheck then passes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-graph-doc-" });
  const path = `${dir}/graph.md`;
  try {
    const Demo = fixture(path);

    // The check fails before the page exists…
    const before = await runCli(Demo, ["graphDocCheck"]);
    assertEquals(before.code, 1);
    assertStringIncludes(before.err, "out of date");
    assertStringIncludes(before.err, "(missing)");

    // …the generator target writes it…
    const generate = await runCli(Demo, ["graphDoc"]);
    assertEquals(generate.code, 0);
    const page = await Deno.readTextFile(path);
    assertStringIncludes(page, "```mermaid");
    assertStringIncludes(page, '"graphDocCheck"');
    assertStringIncludes(page, "| `test` | Test | `lint` |");

    // …and the check passes against the written page.
    const after = await runCli(Demo, ["graphDocCheck"]);
    assertEquals(after.code, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("graphDocCheck fails when the build gains a target after generation", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-graph-drift-" });
  const path = `${dir}/graph.md`;
  try {
    const generate = await runCli(fixture(path), ["graphDoc"]);
    assertEquals(generate.code, 0);

    // The same build plus one target: the committed page is now stale.
    const Base = fixture(path);
    class Grown extends Base {
      extra = target().description("New work").executes(() => {});
    }
    const check = await runCli(Grown, ["graphDocCheck"]);
    assertEquals(check.code, 1);
    assertStringIncludes(check.err, "(stale)");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
