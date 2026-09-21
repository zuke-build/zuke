// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the opening banner as a real run through the CLI `main()` path
 * actually emits it — that it is wired in at all, lands before the first
 * target, and that both off-switches reach the executor.
 *
 * What it deliberately does not re-test is which lines the banner contains:
 * that is `bannerLines`, which is pure and exhaustively covered in
 * `packages/core/tests/banner_test.ts`. In particular the wordmark is asserted
 * only through the version line here, because this suite runs on CI as well as
 * locally and the art is dropped on CI by design — an assertion on it would
 * pass on a laptop and fail on the runner.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { runCli } from "./_harness.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { execute } from "../../packages/core/src/executor.ts";
import { discoverTargets } from "../../packages/core/src/build.ts";
import { VERSION } from "../../packages/core/src/version.ts";

/** The line every run prints, on CI and off it. */
const IDENTITY = `zuke ${VERSION} · deno `;

class Quiet extends Build {
  work = target().description("do nothing").executes(() => {});
}

/** Run with `ZUKE_NO_BANNER` set to `value`, restoring the previous value. */
async function withNoBanner(
  value: string,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = Deno.env.get("ZUKE_NO_BANNER");
  Deno.env.set("ZUKE_NO_BANNER", value);
  try {
    await fn();
  } finally {
    if (previous === undefined) Deno.env.delete("ZUKE_NO_BANNER");
    else Deno.env.set("ZUKE_NO_BANNER", previous);
  }
}

Deno.test("integration: a run opens with the banner, above the first target", async () => {
  const { code, out } = await runCli(Quiet, ["work"]);
  assertEquals(code, 0);

  const banner = out.indexOf(IDENTITY);
  assertEquals(banner >= 0, true, `no banner in:\n${out}`);
  // The run line carries the id and the directory.
  assertEquals(/\nrun [0-9a-f-]{36} · \S/.test(out), true, out);
  // And all of it precedes the first target's header.
  assertEquals(banner < out.indexOf("work"), true, out);
});

Deno.test("integration: --no-banner suppresses it, leaving the run intact", async () => {
  const { code, out } = await runCli(Quiet, ["work", "--no-banner"]);
  assertEquals(code, 0);
  assertEquals(out.includes(IDENTITY), false, out);
  assertEquals(out.includes("run "), false, out);
  // The run itself still reports normally.
  assertEquals(out.includes("work"), true, out);
});

Deno.test("integration: ZUKE_NO_BANNER suppresses it from the environment", async () => {
  await withNoBanner("1", async () => {
    const { code, out } = await runCli(Quiet, ["work"]);
    assertEquals(code, 0);
    assertEquals(out.includes(IDENTITY), false, out);
  });
});

Deno.test("integration: ZUKE_NO_BANNER=false means what it says", async () => {
  // The conventional "not set" values must not read as "suppress", or a shell
  // exporting ZUKE_NO_BANNER=false would silently turn the banner off.
  for (const value of ["false", "0", ""]) {
    await withNoBanner(value, async () => {
      const { out } = await runCli(Quiet, ["work"]);
      assertEquals(out.includes(IDENTITY), true, `${value}:\n${out}`);
    });
  }
});

Deno.test("integration: --no-banner beats ZUKE_NO_BANNER=false", async () => {
  // The explicit flag is the caller's decision for this run; the variable is
  // the shell's standing preference.
  await withNoBanner("false", async () => {
    const { out } = await runCli(Quiet, ["work", "--no-banner"]);
    assertEquals(out.includes(IDENTITY), false, out);
  });
});

Deno.test("integration: an embedded execute() gets no banner in its own sink", async () => {
  // A caller that supplies a reporter is embedding the executor. Painting the
  // wordmark into somebody else's sink is not core's decision to make — the
  // same reasoning that gates the job-summary write on writing to the console.
  const lines: string[] = [];
  const reporter = {
    info: (line: string) => void lines.push(line),
    error: (line: string) => void lines.push(line),
  };
  const build = new Quiet();
  discoverTargets(build);

  const result = await execute(build, build.work, { reporter });
  assertEquals(result.ok, true);
  assertEquals(
    lines.some((l) => l.includes(IDENTITY)),
    false,
    lines.join("\n"),
  );
  // The run still reported itself normally.
  assertEquals(lines.some((l) => l.includes("work")), true);
});
