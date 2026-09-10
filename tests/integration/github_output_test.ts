// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration tests for what a build writes when the GitHub Actions runner is
 * listening.
 *
 * The unit tests cover the escapes themselves. These assert over the **whole
 * stream** of a real build, because the risk is not that one helper is wrong —
 * it is that some emission site never calls it. A site added later that prints
 * a target name or a failure message raw is caught here rather than trusted.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  externalSignal,
  parameter,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** Run `args` with the runner's environment in place, and restore it after. */
async function underActions(
  build: Parameters<typeof runCli>[0],
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stream: string }> {
  const previous = new Map<string, string | undefined>();
  const all = { GITHUB_ACTIONS: "true", ...env };
  for (const [k, v] of Object.entries(all)) {
    previous.set(k, Deno.env.get(k));
    Deno.env.set(k, v);
  }
  try {
    const { code, out, err } = await runCli(build, args);
    return { code, stream: `${out}\n${err}` };
  } finally {
    for (const [k, v] of previous) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

/** Every line the runner would treat as a workflow command. */
function commandLines(stream: string): string[] {
  return stream.split("\n").filter((l) =>
    // The runner trims leading whitespace before testing for `::`.
    l.trimStart().startsWith("::") || l.includes("##[")
  );
}

Deno.test("a failure message cannot forge or suspend workflow commands", async () => {
  // The sharpest case: the detail line carries a subprocess's stderr verbatim
  // and is printed BEFORE the annotation, so an unescaped `::stop-commands::`
  // would disarm the very annotation the escaping protects.
  class B extends Build {
    deploy = target().executes(() => {
      throw new Error(
        "build failed\n::stop-commands::TOKEN\n::error::forged\n##[command]hidden",
      );
    });
  }
  const { code, stream } = await underActions(B, ["deploy"]);
  assertEquals(code, 1);

  // Only Zuke's own commands survive as commands.
  for (const line of commandLines(stream)) {
    const own = line.startsWith("::group::") ||
      line.startsWith("::endgroup::") ||
      line.startsWith("::error title=");
    assertEquals(own, true, `unexpected workflow command in output: ${line}`);
  }
  // The attacker's text is still there, just disarmed and readable.
  assertStringIncludes(stream, "%3A%3Astop-commands::TOKEN");
  assertStringIncludes(stream, "%23%23[command]hidden");
});

Deno.test("a target name cannot forge a workflow command", async () => {
  // A fan-out sub-target's name carries its item key, which comes from
  // repository or remote data.
  //
  // The item deliberately contains a NEWLINE. A `::` merely embedded in a name
  // is harmless — it lands mid-line, where the runner ignores it — so a test
  // using one passes whether or not the escaping is applied, and proves
  // nothing. Only a newline puts the marker at the start of a line of its own,
  // which is the attack.
  class B extends Build {
    fan = target().forEach(
      () => ["item\n::stop-commands::TOKEN"],
      () => ({ step: target().executes(() => {}) }),
    );
    top = target().dependsOn(this.fan).executes(() => {});
  }
  const { code, stream } = await underActions(B, ["top"]);
  assertEquals(code, 0);
  for (const line of commandLines(stream)) {
    const own = line.startsWith("::group::") ||
      line.startsWith("::endgroup::");
    assertEquals(own, true, `unexpected workflow command in output: ${line}`);
  }
});

Deno.test("ordinary output is untouched when the runner is listening", async () => {
  // The escape must not cost readability: a build with nothing to escape looks
  // exactly as it always did.
  class B extends Build {
    check = target().executes(() => {});
  }
  const { code, stream } = await underActions(B, ["check"]);
  assertEquals(code, 0);
  assertStringIncludes(stream, "check");
  assertEquals(stream.includes("%3A%3A"), false);
  assertEquals(stream.includes("%23%23"), false);
});

Deno.test("a secret in a summary note is redacted in the job summary file", async () => {
  // Every other sink is redacted — the console through the reporter, the run
  // record as it is persisted. This file was the one place a resolved secret
  // reached the outside world in the clear, and `::add-mask::` does not cover
  // it: that masks the runner's log stream, not a file the build writes.
  const dir = await Deno.makeTempDir();
  const summaryPath = `${dir}/summary.md`;
  await Deno.writeTextFile(summaryPath, "");

  class B extends Build {
    token = parameter("Deploy token").secret().required();
    deploy = target().executes((ctx) => {
      ctx.reportSummary({ Token: this.token.value });
    });
  }
  const { code } = await underActions(
    B,
    ["deploy", "--token", "s3cr3t-value-xyz"],
    { GITHUB_STEP_SUMMARY: summaryPath },
  );
  assertEquals(code, 0);

  const written = await Deno.readTextFile(summaryPath);
  assertEquals(
    written.includes("s3cr3t-value-xyz"),
    false,
    "the job summary published a secret in the clear",
  );
  assertStringIncludes(written, "[redacted]");
});

Deno.test("a force's echoed reason cannot forge a command", async () => {
  // `zuke force` echoes the operator's reason back to the log. In a scripted
  // force that reason is often interpolated from a pull request title or an
  // issue body, so it is not something the job's own author controls.
  //
  // This asserts on the FORCE command's own output. An earlier version of this
  // test asserted on the resumed run instead and passed with the escaping
  // removed — the forced target settles before the scheduler prints anything
  // about it, so that stream never carried the value at all.
  await withStateDir(async () => {
    class B extends Build {
      migrate = target().executes(() => {});
      gate = target()
        .dependsOn(this.migrate)
        .waitsFor((s) => s.on(externalSignal("go")));
      report = target().dependsOn(this.gate).executes(() => {});
    }

    const first = await runCli(B, ["report"]);
    assertEquals(first.code, 0, first.err);
    const listed = await runCli(B, ["runs", "list", "--json"]);
    const runId = String(JSON.parse(listed.out)[0].id);

    // `report` is still pending behind the gate; forcing an already-succeeded
    // target is refused, since the record would then claim something that did
    // not happen.
    const { code, stream } = await underActions(B, [
      "force",
      runId,
      "report",
      "--outcome",
      "skipped",
      "--reason",
      "done\n::stop-commands::TOKEN",
      "--actor",
      "ops",
    ]);
    assertEquals(code, 0, stream);
    for (const line of commandLines(stream)) {
      assertEquals(false, true, `unexpected workflow command: ${line}`);
    }
    assertStringIncludes(stream, "%3A%3Astop-commands::TOKEN");
  });
});
