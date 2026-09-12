// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The CLI's console sink: every line is neutralised on a GitHub Actions
 * runner and left alone anywhere else. The assertions are about the *start of
 * a line* — what the runner acts on — not about a substring: the text must
 * survive as text, and what must not happen is it opening a command.
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { output } from "../src/output.ts";

/**
 * The percent-encoded `::`, kept as its own constant so the encoded prefix
 * never fuses with the word after it into a token no dictionary can know.
 */
const ENC = "%3A%3A";

/** Run `fn` with both console streams captured, returning what was written. */
async function captured(
  fn: () => void | Promise<void>,
): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...parts: unknown[]) => void out.push(parts.join(" "));
  console.error = (...parts: unknown[]) => void err.push(parts.join(" "));
  try {
    await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
  return { out, err };
}

Deno.test("output neutralises a workflow command on an Actions runner, on both streams", async () => {
  const { out, err } = await captured(() =>
    withEnv({ GITHUB_ACTIONS: "true" }, () => {
      output.info("::stop-commands::forged");
      output.info("   ::error::forged annotation");
      output.error("held by ##[group]x");
      output.error("Unknown command: ::stop-commands::forged");
    })
  );
  assertEquals(out, [
    ENC + "stop-commands::forged",
    "   " + ENC + "error::forged annotation",
  ]);
  // A `::` that does not open the line is not a command, and stays readable.
  assertEquals(err, [
    "held by %23%23[group]x",
    "Unknown command: ::stop-commands::forged",
  ]);
});

Deno.test("output leaves every line alone off a runner", async () => {
  // Explicitly unset: the suite itself runs under Actions, where the variable
  // is inherited and the sink would otherwise escape for the wrong reason.
  const { out, err } = await captured(() =>
    withEnv({ GITHUB_ACTIONS: undefined }, () => {
      output.info("::stop-commands::forged");
      output.error("held by ##[group]x");
    })
  );
  assertEquals(out, ["::stop-commands::forged"]);
  assertEquals(err, ["held by ##[group]x"]);
});

Deno.test("output decides per line, not once at import", async () => {
  // The module was loaded before this test set the environment; a decision
  // captured at import time would escape neither line, or both.
  const { out } = await captured(async () => {
    await withEnv({ GITHUB_ACTIONS: undefined }, () => {
      output.info("::group::one");
    });
    await withEnv({ GITHUB_ACTIONS: "true" }, () => {
      output.info("::group::two");
    });
  });
  assertEquals(out, ["::group::one", ENC + "group::two"]);
});
