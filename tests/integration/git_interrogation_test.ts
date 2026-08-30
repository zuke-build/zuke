// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `@zuke/git`'s interrogation commands: real builds,
 * driven through the CLI `main()` entry point, proving the refusals reach a
 * target as a failed build and that the value-returning readers fail rather
 * than hand back a confident answer when git cannot be found.
 *
 * The tests stay hermetic. git is an ambient tool, so nothing here runs a real
 * one — every task is pointed at a binary that cannot exist, which is also the
 * only way to assert the readers' failure path deterministically on a runner
 * that may or may not have git installed.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { GitTasks } from "../../packages/git/mod.ts";
import { runCli } from "./_harness.ts";

/** A tool path that cannot exist, so resolution fails before any process runs. */
const ABSENT = "/nonexistent/zuke-test-git";

Deno.test("a settings refusal fails the target and names the fix", async () => {
  class RefusalBuild extends Build {
    ancestor = target().executes(async () => {
      // git: "--is-ancestor takes exactly two commits".
      await GitTasks.isAncestor((s) =>
        s.toolPath(ABSENT).isAncestor().commits("only-one")
      );
    });
  }
  const { code, err } = await runCli(RefusalBuild, ["ancestor"]);
  assertEquals(code, 1);
  assertEquals(err.includes("exactly two commits"), true);
});

Deno.test("a reader refuses the option that would misreport its result", async () => {
  class FormatBuild extends Build {
    refs = target().executes(async () => {
      await GitTasks.refs((s) => s.toolPath(ABSENT).format("%(refname)"));
    });
  }
  const { code, err } = await runCli(FormatBuild, ["refs"]);
  assertEquals(code, 1);
  assertEquals(err.includes("move the fields this reader parses"), true);
});

Deno.test("the boolean readers fail on an absent git rather than answering", async () => {
  // These run with throwing suppressed so a legitimate non-zero status can come
  // back as data. That suppression must not swallow tool resolution: a build
  // asking "is this an ancestor?" must not be told `false` because git is
  // missing, which would look like a real answer and silently skip work.
  const executed: string[] = [];
  class BooleanBuild extends Build {
    ancestor = target().executes(async () => {
      executed.push(String(
        await GitTasks.isAncestor((s) => s.toolPath(ABSENT).commits("a", "b")),
      ));
    });
    ignored = target().executes(async () => {
      executed.push(String(
        await GitTasks.isIgnored((s) => s.toolPath(ABSENT).paths("build")),
      ));
    });
    merges = target().executes(async () => {
      executed.push(String(
        await GitTasks.mergesCleanly((s) =>
          s.toolPath(ABSENT).branches("a", "b")
        ),
      ));
    });
    signature = target().executes(async () => {
      executed.push(String(
        await GitTasks.isSignatureValid((s) =>
          s.toolPath(ABSENT).objects("HEAD")
        ),
      ));
    });
  }
  for (const name of ["ancestor", "ignored", "merges", "signature"]) {
    const { code } = await runCli(BooleanBuild, [name]);
    assertEquals(code, 1, name);
  }
  // Not one of them produced a value.
  assertEquals(executed, []);
});

Deno.test("the value readers fail on an absent git rather than returning empty", async () => {
  const executed: string[] = [];
  class ValueBuild extends Build {
    count = target().executes(async () => {
      executed.push(String(
        await GitTasks.commitCount((s) => s.toolPath(ABSENT).commits("HEAD")),
      ));
    });
    refs = target().executes(async () => {
      executed.push(String(
        (await GitTasks.refs((s) => s.toolPath(ABSENT))).length,
      ));
    });
    entries = target().executes(async () => {
      executed.push(String(
        (await GitTasks.treeEntries((s) => s.toolPath(ABSENT).tree("HEAD")))
          .length,
      ));
    });
    authors = target().executes(async () => {
      executed.push(String(
        (await GitTasks.shortlogEntries((s) => s.toolPath(ABSENT))).length,
      ));
    });
    lines = target().executes(async () => {
      executed.push(String(
        (await GitTasks.blameLines((s) => s.toolPath(ABSENT).file("a.ts")))
          .length,
      ));
    });
    base = target().executes(async () => {
      executed.push(
        await GitTasks.mergeBase((s) => s.toolPath(ABSENT).commits("a", "b")),
      );
    });
  }
  for (const name of ["count", "refs", "entries", "authors", "lines", "base"]) {
    const { code } = await runCli(ValueBuild, [name]);
    assertEquals(code, 1, name);
  }
  assertEquals(executed, []);
});

Deno.test("dependent targets run in order and the graph reports the new tasks", async () => {
  const order: string[] = [];
  class GraphBuild extends Build {
    refs = target().description("list refs").executes(() => {
      order.push("refs");
    });
    audit = target().description("audit history").dependsOn(this.refs)
      .executes(() => {
        order.push("audit");
      });
  }
  const { code } = await runCli(GraphBuild, ["audit"]);
  assertEquals(code, 0);
  assertEquals(order, ["refs", "audit"]);

  const listed = await runCli(GraphBuild, ["--list"]);
  assertEquals(listed.code, 0);
  assertEquals(listed.out.includes("audit"), true);
  assertEquals(listed.out.includes("audit history"), true);
});
