// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for the fixer scope gate: a real build, driven through
 * the CLI `main()` entry point, with an `aiFixer` attached to a failing target
 * exactly as Zuke's own `lint` target attaches one.
 *
 * This is the layer that matters for `.runOnly("ci")`, because the property being
 * asserted is about a whole build run — a red target on a developer's machine
 * must stay red, with nothing written and no model call, rather than being
 * silently rewritten underneath the person running it.
 *
 * Hermetic: the model call, the file write, git, and the environment are all
 * injected seams, so nothing here reaches the network or the working tree.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { type AiFixer, aiFixer } from "../../packages/ai/mod.ts";
import { runCli } from "./_harness.ts";

/** An env reader that looks like a GitHub Actions runner. */
const ON_CI = (name: string) => name === "GITHUB_ACTIONS" ? "true" : undefined;
/** An env reader that looks like a developer's machine. */
const OFF_CI = () => undefined;

/** A model response proposing one edit. */
const FIX = JSON.stringify({
  content: [{
    type: "text",
    text: JSON.stringify({
      diagnosis: "unused import",
      rootCause: "leftover import",
      confidence: "high",
      edits: [{ path: "src/app.ts", content: "export const x = 1;\n" }],
    }),
  }],
  stop_reason: "end_turn",
});

/** What a run recorded: model calls made and paths written. */
interface Recorded {
  modelCalls: string[];
  writes: string[];
}

/**
 * Run a build whose only target fails until the fixer writes something, with
 * every seam injected. Returns the CLI exit code and what the fixer did.
 */
async function runWithFixer(
  configure: (f: AiFixer) => AiFixer,
  env: (name: string) => string | undefined,
): Promise<{ code: number; recorded: Recorded }> {
  const recorded: Recorded = { modelCalls: [], writes: [] };
  const fetchImpl = ((input: string | URL | Request) => {
    recorded.modelCalls.push(String(input));
    return Promise.resolve(new Response(FIX, { status: 200 }));
  }) as typeof fetch;

  const fixer = configure(
    aiFixer((f) => f.provider("claude").apiKey("k").autoApply()),
  )
    .conventions("")
    .diff((d) => d.text(""))
    .exec(() => Promise.resolve(""))
    .write((path) => {
      recorded.writes.push(path);
      return Promise.resolve();
    })
    .fetch(fetchImpl)
    .env(env)
    .noComment()
    .quiet();

  class Healing extends Build {
    lint = target()
      .description("fails until the fixer writes something")
      .recoverWith(fixer)
      .executes(() => {
        if (recorded.writes.length === 0) throw new Error("lint failed");
      });
  }
  const { code } = await runCli(Healing, ["lint"]);
  return { code, recorded };
}

Deno.test('runOnly("ci") leaves a failing local build failed, untouched, and costing nothing', async () => {
  const { code, recorded } = await runWithFixer((f) => f.runOnly("ci"), OFF_CI);

  // The target stays red — the developer fixes it, not the fixer.
  assertEquals(code, 1);
  assertEquals(recorded.writes, []);
  // No model call means no charge against a key that happens to be exported
  // locally, which is what made the old "a missing key gates it" reasoning
  // unsound in the first place.
  assertEquals(recorded.modelCalls, []);
});

Deno.test('runOnly("ci") heals the same build on CI', async () => {
  const { code, recorded } = await runWithFixer((f) => f.runOnly("ci"), ON_CI);

  // Applied the fix and the executor re-ran the body, which now passes.
  assertEquals(code, 0);
  assertEquals(recorded.writes, ["src/app.ts"]);
  assertEquals(recorded.modelCalls.length, 1);
});

Deno.test("the default scope is unchanged: it still heals a local build", async () => {
  // .runOnly("ci") is additive — a fixer that does not ask for it behaves exactly as
  // it did before, which is what keeps this a non-breaking change.
  const { code, recorded } = await runWithFixer((f) => f, OFF_CI);

  assertEquals(code, 0);
  assertEquals(recorded.writes, ["src/app.ts"]);
});
