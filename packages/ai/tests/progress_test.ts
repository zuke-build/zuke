// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import { ReviewProgress } from "../src/progress.ts";
import type { ReviewReactions, ReviewSignal } from "../src/hosts/types.ts";

/**
 * A fake {@link ReviewReactions} holding the token's reactions as a set — the
 * way a host does — seeded with `held`, and logging `+signal` / `-signal` for
 * every add and every withdrawal of one that was there.
 */
function recorder(
  held: ReviewSignal[] = [],
  key = "pr",
): {
  reactions: ReviewReactions;
  log: string[];
  held: Set<ReviewSignal>;
  refuse: Set<ReviewSignal>;
} {
  const log: string[] = [];
  const state = new Set(held);
  const refuse = new Set<ReviewSignal>();
  return {
    reactions: {
      key,
      add(signal) {
        if (refuse.has(signal)) return Promise.resolve(false);
        state.add(signal);
        log.push(`+${signal}`);
        return Promise.resolve(true);
      },
      remove(signal) {
        if (!state.delete(signal)) return Promise.resolve(false);
        log.push(`-${signal}`);
        return Promise.resolve(true);
      },
    },
    log,
    held: state,
    refuse,
  };
}

const noFetch = (() => Promise.reject(new Error("unused"))) as typeof fetch;

Deno.test("a review shows 👀, clears the verdict an earlier run left, then shows its own", async () => {
  const { reactions, log, held } = recorder(["minor"]);
  const finish = await new ReviewProgress().start("run-1", reactions, noFetch);
  assertEquals(log, ["+reviewing", "-minor"]);
  log.length = 0;
  await finish("passed");
  // The verdict goes up before 👀 comes down.
  assertEquals(log, ["+passed", "-reviewing"]);
  assertEquals([...held], ["passed"]);
});

Deno.test("reviewers in sequence keep the worst verdict, and a later one does not clear it", async () => {
  const progress = new ReviewProgress();
  const { reactions, log, held } = recorder();
  await (await progress.start("run", reactions, noFetch))("passed");
  log.length = 0;
  // The second reviewer of the run must not wipe the first one's verdict.
  const second = await progress.start("run", reactions, noFetch);
  assertEquals(log, ["+reviewing"]);
  await second("minor");
  assertEquals(log, ["+reviewing", "+minor", "-passed", "-reviewing"]);
  log.length = 0;
  // A clean third review cannot paper over the second one's findings.
  await (await progress.start("run", reactions, noFetch))("passed");
  assertEquals(log, ["+reviewing", "-reviewing"]);
  assertEquals([...held], ["minor"]);
});

Deno.test("a new run starts afresh, in the same process", async () => {
  const progress = new ReviewProgress();
  const { reactions, held } = recorder();
  await (await progress.start("run-1", reactions, noFetch))("minor");
  assertEquals([...held], ["minor"]);
  await (await progress.start("run-2", reactions, noFetch))("passed");
  assertEquals([...held], ["passed"]);
});

Deno.test("a pass after a failed run shows 🎉, and only while no reviewer of the run fails", async () => {
  const progress = new ReviewProgress();
  const { reactions, held } = recorder(["failed"]);
  const first = await progress.start("run", reactions, noFetch);
  await first("passed");
  assertEquals([...held], ["recovered"]);
  // A later reviewer of the same run with findings takes the 🎉 back down.
  await (await progress.start("run", reactions, noFetch))("minor");
  assertEquals([...held], ["minor"]);
  // 🎉 is for a run that follows a 👎 only: after a 🤏 a pass is 👍.
  await (await progress.start("next", reactions, noFetch))("passed");
  assertEquals([...held], ["passed"]);
});

Deno.test("👀 stays until the last reviewer in flight finishes", async () => {
  const progress = new ReviewProgress();
  const { reactions, log } = recorder();
  const first = await progress.start("run", reactions, noFetch);
  const second = await progress.start("run", reactions, noFetch);
  log.length = 0;
  await first("failed");
  assertEquals(log, ["+failed"]);
  await second("passed");
  assertEquals(log, ["+failed", "-reviewing"]);
});

Deno.test("a skipped review withdraws 👀 without claiming a verdict", async () => {
  const progress = new ReviewProgress();
  const { reactions, log, held } = recorder(["failed"]);
  await (await progress.start("run", reactions, noFetch))("skipped");
  assertEquals(log, ["+reviewing", "-failed", "-reviewing"]);
  assertEquals([...held], []);
});

Deno.test("a verdict that cannot be posted still takes the wrong one down, and the next reviewer retries", async () => {
  const progress = new ReviewProgress();
  const { reactions, held, refuse } = recorder();
  await (await progress.start("run", reactions, noFetch))("passed");
  refuse.add("failed");
  await (await progress.start("run", reactions, noFetch))("failed");
  // 👎 was refused: no verdict is better than a 👍 that no longer holds.
  assertEquals([...held], []);
  refuse.clear();
  await (await progress.start("run", reactions, noFetch))("passed");
  assertEquals([...held], ["failed"]);
});

Deno.test("a host that throws does not poison the pull request's later steps", async () => {
  const progress = new ReviewProgress();
  const { reactions, held } = recorder();
  let thrown = false;
  const flaky: ReviewReactions = {
    key: reactions.key,
    add(signal, doFetch) {
      if (!thrown) {
        thrown = true;
        return Promise.reject(new Error("broken host"));
      }
      return reactions.add(signal, doFetch);
    },
    remove: reactions.remove,
  };
  const finish = await progress.start("run", flaky, noFetch);
  await finish("minor");
  assertEquals([...held], ["minor"]);
});

Deno.test("pull requests are tracked apart, by key", async () => {
  const progress = new ReviewProgress();
  const one = recorder([], "one");
  const two = recorder([], "two");
  await (await progress.start("run", one.reactions, noFetch))("failed");
  await (await progress.start("run", two.reactions, noFetch))("passed");
  assertEquals([...one.held], ["failed"]);
  // The second pull request is not held to the first one's 👎.
  assertEquals([...two.held], ["passed"]);
});

Deno.test("the run reviewed nothing only when its last reviewer finishes with no verdict", async () => {
  const progress = new ReviewProgress();
  const { reactions } = recorder();
  const skipped = await progress.start("run", reactions, noFetch);
  const reviewed = await progress.start("run", reactions, noFetch);
  // Another reviewer is still in flight: not the run's answer yet.
  assertEquals(await skipped("skipped"), false);
  assertEquals(await reviewed("passed"), false);
  // One reviewer skipping after another reviewed is not a run that did not.
  assertEquals(
    await (await progress.start("run", reactions, noFetch))("skipped"),
    false,
  );
  const fresh = await progress.start("other", reactions, noFetch);
  assertEquals(await fresh("skipped"), true);
});
