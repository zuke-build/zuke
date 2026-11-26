// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the graph-page generate-then-verify flow, driven through the
 * real CLI `main()` — a fixture build whose targets call `writeGraphDoc` /
 * `checkGraphDoc` exactly the way `build.ts`'s `graphDoc` / `graphDocCheck`
 * targets do, proving the pattern works end-to-end (target execution, the
 * discovered graph feeding the generator, and the failing-check exit code).
 */

import { test } from "../_testing.ts";
import {
  Build,
  discoverTargets,
  FileTasks,
  target,
} from "../../packages/core/mod.ts";
import { assertEquals, assertStringIncludes } from "../_assert.ts";
import { checkGraphDoc, writeGraphDoc } from "../../build/graph_doc.ts";
import { runCli } from "./_harness.ts";

/** A fixture mirroring build.ts's graphDoc/graphDocCheck wiring. */
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

test({
  name: "graphDoc target writes the page and graphDocCheck then passes",
  denoOnly: "formats through deno fmt",
  fn: async () => {
    const dir = await FileTasks.makeTempDirectory((s) =>
      s.prefix("zuke-it-graph-doc-")
    );
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
      const page = await FileTasks.readText(path);
      assertStringIncludes(page, "```mermaid");
      assertStringIncludes(page, '"graphDocCheck"');
      // The page is written through `deno fmt`, which pads the table's columns
      // into alignment. That is layout, not content, and it shifts whenever a
      // fixture target's name changes length — so collapse runs of spaces and
      // assert the row is present, rather than how wide its neighbours made it.
      assertStringIncludes(
        page.replaceAll(/ +/g, " "),
        "| `test` | Test | `lint` |",
      );

      // …and the check passes against the written page.
      const after = await runCli(Demo, ["graphDocCheck"]);
      assertEquals(after.code, 0);
    } finally {
      await FileTasks.remove(dir, { recursive: true });
    }
  },
});

test({
  name: "graphDocCheck fails when the build gains a target after generation",
  denoOnly: "formats through deno fmt",
  fn: async () => {
    const dir = await FileTasks.makeTempDirectory((s) =>
      s.prefix("zuke-it-graph-drift-")
    );
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
      await FileTasks.remove(dir, { recursive: true });
    }
  },
});
