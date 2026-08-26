// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  listStoreLocks,
  target,
} from "../../packages/core/mod.ts";
import { envStateStore } from "../../packages/core/src/state/resolve.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** Released by the test once the holding run has taken the lock. */
let release: () => void = () => {};

/** Set as the holder reaches its body, so the test can time the reader. */
const held: string[] = [];

class HolderBuild extends Build {
  stack = target()
    .description("hold the shared resource until the test lets go")
    .lock((s) => s.lockKey("dev-env").withTtl("1h"))
    .executes(async () => {
      held.push("in");
      await new Promise<void>((resolve) => (release = resolve));
    });
}

// The question a wedged resource always raises, asked from a build: who has it,
// and until when if they never come back?
class ReportBuild extends Build {
  locks = target()
    .description("report every lock currently held")
    .executes(async () => {
      const store = envStateStore(
        (name) => Deno.env.get(name),
        defaultStateHost,
      );
      if (store === undefined) throw new Error("no state store configured");
      for (const entry of await listStoreLocks(store)) {
        console.log(
          `LOCK ${entry.key} actor=${entry.holder.actor} ` +
            `run=${entry.holder.runId} since=${entry.holder.since}`,
        );
      }
      console.log("END");
    });
}

Deno.test("a build can report who holds a lock while another run holds it", async () => {
  await withStateDir(async () => {
    held.length = 0;
    // The actor is what a reader most wants to see, so name it: the CLI takes
    // it from ZUKE_ACTOR.
    Deno.env.set("ZUKE_ACTOR", "alice");
    const holding = runCli(HolderBuild, ["stack"]);
    while (held.length === 0) await new Promise((r) => setTimeout(r, 5));

    const report = await runCli(ReportBuild, ["locks"]);
    assertEquals(report.code, 0, report.err);
    assertStringIncludes(report.out, "LOCK dev-env actor=alice");

    release();
    assertEquals((await holding).code, 0);

    // Released, so the same question now has a different answer.
    const after = await runCli(ReportBuild, ["locks"]);
    assertEquals(after.code, 0, after.err);
    assertEquals(after.out.includes("LOCK dev-env"), false, after.out);
    assertStringIncludes(after.out, "END");
    Deno.env.delete("ZUKE_ACTOR");
  });
});
