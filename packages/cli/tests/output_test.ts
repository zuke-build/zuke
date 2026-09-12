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
import { capture } from "../../core/tests/_console.ts";
import { consoleWriters, ENC } from "../../core/tests/_escaping.ts";
import { neutralise, output } from "../src/output.ts";
import { cliReporter } from "@zuke/core";

Deno.test("output neutralises a workflow command on an Actions runner, on both streams", async () => {
  const { out, err } = await capture(async () => {
    await withEnv({ GITHUB_ACTIONS: "true" }, () => {
      output.info("::stop-commands::forged");
      output.info("   ::error::forged annotation");
      output.error("held by ##[group]x");
      output.error("Unknown command: ::stop-commands::forged");
    });
    return 0;
  });
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

Deno.test("output is core's own sink, and neutralise makes the same decision", async () => {
  // The escaping has one implementation: the sink is `cliReporter` itself,
  // not a composition that could drift from it, and the prompt's step agrees
  // with it line for line in both environments.
  assertEquals(output === cliReporter, true);
  await withEnv({ GITHUB_ACTIONS: "true" }, () => {
    assertEquals(
      neutralise("::stop-commands::forged"),
      ENC + "stop-commands::forged",
    );
    assertEquals(neutralise("held by ##[group]x"), "held by %23%23[group]x");
  });
  await withEnv({ GITHUB_ACTIONS: undefined }, () => {
    assertEquals(
      neutralise("::stop-commands::forged"),
      "::stop-commands::forged",
    );
  });
});

Deno.test("output leaves every line alone off a runner", async () => {
  // Explicitly unset: the suite itself runs under Actions, where the variable
  // is inherited and the sink would otherwise escape for the wrong reason.
  const { out, err } = await capture(async () => {
    await withEnv({ GITHUB_ACTIONS: undefined }, () => {
      output.info("::stop-commands::forged");
      output.error("held by ##[group]x");
    });
    return 0;
  });
  assertEquals(out, ["::stop-commands::forged"]);
  assertEquals(err, ["held by ##[group]x"]);
});

Deno.test("output decides per line, not once at import", async () => {
  // The module was loaded before this test set the environment; a decision
  // captured at import time would escape neither line, or both.
  const { out } = await capture(async () => {
    await withEnv({ GITHUB_ACTIONS: undefined }, () => {
      output.info("::group::one");
    });
    await withEnv({ GITHUB_ACTIONS: "true" }, () => {
      output.info("::group::two");
    });
    return 0;
  });
  assertEquals(out, ["::group::one", ENC + "group::two"]);
});

Deno.test("no module of @zuke/cli writes to the console except its sink", async () => {
  // The bug behind #575 was a bare `console.log` in the package's host, and
  // reverting the sink to one leaves every behavioural test above green only
  // as long as its inputs happen to reach that write. This holds the property
  // itself: a new direct write anywhere in the package fails here rather than
  // being noticed on a runner later. Scanned from the package root, because
  // `mod.ts` lives there, and narrowed to what the package publishes:
  // `deno.json` keeps `tests/` out of it, and a test printing a diagnostic is
  // not a write the sink was meant to own.
  const allowed = new Set([
    // The sink itself.
    "src/output.ts",
    // The scaffolded starter build, inside a template literal: its
    // `console.log` runs in the user's project, not in this process.
    "src/starter.ts",
  ]);
  const offenders = (await consoleWriters(
    new URL("../", import.meta.url),
    allowed,
  )).filter((path) => !path.startsWith("tests/"));
  assertEquals(
    offenders,
    [],
    `these write to the console directly; use the sink in src/output.ts: ${
      offenders.join(", ")
    }`,
  );
});
