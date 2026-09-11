// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: under GitHub Actions styling, nothing a build prints can be
 * mistaken by the runner for a workflow command it did not intend to emit.
 *
 * The runner reads every line of a step's stdout and stderr, and acts on two
 * syntaxes: a line whose first non-blank characters are `::`, and the legacy
 * `##[command]` form, which it recognises anywhere in a line. A build carries
 * text it did not author into both streams — a failed tool's stderr, a fan-out
 * key derived from repository data — so this drives a real build through the
 * CLI and asserts the whole stream, rather than trusting a unit test of one
 * formatter to have covered every emission site.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  appendJobSummary,
  Build,
  externalSignal,
  parameter,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";
import { withEnv } from "../../packages/core/tests/_env.ts";

/** Zuke's own workflow commands, which are supposed to open with `::`. */
const OWN_COMMAND = /^::(?:endgroup::|group::|error title=|add-mask::)/;

/**
 * Trim what the *runner* considers blank before it tests for a command, which
 * is not the same set this language trims: NEXT LINE (U+0085) is whitespace to
 * the runner and not to `String.prototype.trimStart`. Using the language's
 * idea here would give the oracle the same blind spot as the code it checks.
 */
function runnerTrimStart(line: string): string {
  return line.replace(/^[\s\u0085]*/, "");
}

/** Physical lines the runner would parse, minus Zuke's own commands. */
function unintendedCommands(stream: string): string[] {
  return stream
    .split(/\r\n|\r|\n/)
    .filter((l) => {
      const trimmed = runnerTrimStart(l);
      if (OWN_COMMAND.test(trimmed)) return false;
      return trimmed.startsWith("::") || l.includes("##[");
    });
}

/** NEXT LINE: trimmed by the runner, not matched by this language's `\s`. */
const NEL = String.fromCharCode(0x85);

/** What a tool prints when it echoes hostile repository content back at us. */
const HOSTILE = [
  "lint failed on src/x.ts",
  "::stop-commands::deadbeef",
  "   ::error::forged annotation",
  // NEXT LINE is whitespace to the runner but not to this language, so it is
  // trimmed at parse time and the `::` lands at the front of the line.
  `${NEL}::error::forged past a language-specific trim`,
  "note: ##[error]forged too",
].join("\n");

Deno.test("integration: a failing target's output cannot forge workflow commands", async () => {
  class CI extends Build {
    lint = target().executes(() => {
      // Stands in for a captured tool failure: the message embeds the tool's
      // stderr, which quoted the file it was linting.
      throw new Error(HOSTILE);
    });
  }

  let r = { code: 0, out: "", err: "" };
  await withEnv({ GITHUB_ACTIONS: "true" }, async () => {
    r = await runCli(CI, ["lint"]);
  });
  assertEquals(r.code, 1);

  const stray = unintendedCommands(r.out + "\n" + r.err);
  assertEquals(
    stray,
    [],
    `these lines would run as workflow commands:\n${stray.join("\n")}`,
  );

  // The text is still legible — neutralised, not deleted.
  assertEquals((r.out + r.err).includes("lint failed on src/x.ts"), true);
  assertEquals(
    (r.out + r.err).includes("%3A%3A" + "stop-commands::deadbeef"),
    true,
  );
});

Deno.test("integration: a hostile target name cannot forge workflow commands", async () => {
  // A fan-out sub-target's name embeds its item key, which comes from
  // repository or remote data. The name reaches the group header, the pass
  // footer, the summary row and the closing line.
  class CI extends Build {
    ["deploy[a\n::stop-commands::x]"] = target().executes(() => {});
  }

  let r = { code: 0, out: "", err: "" };
  await withEnv({ GITHUB_ACTIONS: "true" }, async () => {
    r = await runCli(CI, ["deploy[a\n::stop-commands::x]"]);
  });
  assertEquals(r.code, 0, r.err);

  const stray = unintendedCommands(r.out + "\n" + r.err);
  assertEquals(
    stray,
    [],
    `these lines would run as workflow commands:\n${stray.join("\n")}`,
  );
});

Deno.test("a force's echoed reason cannot forge a command", async () => {
  // `zuke force` echoes the operator's reason back to the log. In a scripted
  // force that reason is often interpolated from a pull request title or an
  // issue body, so it is not something the job's own author controls.
  //
  // This asserts on the FORCE command's own output, not on a later run: the
  // forced target settles before the scheduler prints anything about it, so a
  // test that watched the resumed run would pass with the escaping removed.
  await withStateDir(async () => {
    class Pipeline extends Build {
      migrate = target().executes(() => {});
      gate = target()
        .dependsOn(this.migrate)
        .waitsFor((s) => s.on(externalSignal("go")));
      report = target().dependsOn(this.gate).executes(() => {});
    }

    const first = await runCli(Pipeline, ["report"]);
    assertEquals(first.code, 0, first.err);
    const listed = await runCli(Pipeline, ["runs", "list", "--json"]);
    const runId = String(JSON.parse(listed.out)[0].id);

    let forced = { code: -1, out: "", err: "" };
    await withEnv({ GITHUB_ACTIONS: "true" }, async () => {
      // `report` is still pending behind the gate; forcing an already-succeeded
      // target is refused, since the record would then claim something that did
      // not happen.
      forced = await runCli(Pipeline, [
        "force",
        runId,
        "report",
        "--outcome",
        "skipped",
        "--reason",
        HOSTILE,
        "--actor",
        "ops",
      ]);
    });
    assertEquals(forced.code, 0, forced.err);
    assertEquals(
      unintendedCommands(`${forced.out}\n${forced.err}`),
      [],
      "the force echo let hostile text reach the runner as a command",
    );
  });
});

Deno.test("a remediation's job-summary section is redacted", async () => {
  // Where the AI fixer writes. Its markdown is built from a failed command's
  // output and the model's response to it, which is exactly where a secret in
  // an argv would appear — and the summary is published to everyone who can
  // view the run. A remediation has no redactor on its context, so this works
  // only because the writer itself applies the ambient one.
  const dir = await Deno.makeTempDir();
  const summaryPath = `${dir}/summary.md`;
  await Deno.writeTextFile(summaryPath, "");
  try {
    class B extends Build {
      token = parameter("Deploy token").secret().required();
      check = target()
        .recoverWith({
          name: "probe-fixer",
          remediate: () => {
            appendJobSummary(
              "## Fix attempt\n\ncommand failed: deploy --token s3cr3t-value-xyz",
            );
            return { retry: false };
          },
        })
        .executes(() => {
          throw new Error("boom");
        });
    }
    await withEnv(
      { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summaryPath },
      async () => {
        await runCli(B, ["check", "--token", "s3cr3t-value-xyz"]);
      },
    );
    const written = await Deno.readTextFile(summaryPath);
    assertEquals(
      written.includes("s3cr3t-value-xyz"),
      false,
      "a remediation published a secret to the job summary",
    );
    assertStringIncludes(written, "[redacted]");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a build's lifecycle hooks write a redacted job summary", async () => {
  // `onStart` and `onFinish` are the natural places for a build to add its own
  // section to the job summary, and they run OUTSIDE the executor's own ambient
  // scope, which covers the plan rather than the calls around it. The redaction
  // is installed where the hooks are dispatched for that reason — an earlier
  // version of this fix guarded only the plan and published both hooks' output
  // in the clear.
  const dir = await Deno.makeTempDir();
  const summaryPath = `${dir}/summary.md`;
  await Deno.writeTextFile(summaryPath, "");
  try {
    class B extends Build {
      token = parameter("Deploy token").secret().required();
      ok = target().executes(() => {});
      override onStart(): void {
        appendJobSummary(`start: ${this.token.value}`);
      }
      override onFinish(): void {
        appendJobSummary(`finish: ${this.token.value}`);
      }
    }
    await withEnv(
      { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summaryPath },
      async () => {
        await runCli(B, ["ok", "--token", "s3cr3t-value-xyz"]);
      },
    );
    const written = await Deno.readTextFile(summaryPath);
    assertEquals(
      written.includes("s3cr3t-value-xyz"),
      false,
      "a lifecycle hook published a secret to the job summary",
    );
    assertStringIncludes(written, "start: [redacted]");
    assertStringIncludes(written, "finish: [redacted]");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a CLI error quoting its own argument cannot forge a command", async () => {
  // The run's sinks are covered; the CLI's own writes were not. Every command
  // here echoes an argument the invoker chose, and on Actions that is commonly a
  // `workflow_dispatch` input rather than something a person typed. The catch
  // arms quote a thrown message straight back, so they leaked exactly what the
  // success paths guard — one of them sat eleven lines below a success path
  // that escapes the same value deliberately.
  await withStateDir(async () => {
    class B extends Build {
      ok = target().executes(() => {});
    }
    for (const args of [["resume", HOSTILE], [HOSTILE], ["cancel", HOSTILE]]) {
      let r = { code: -1, out: "", err: "" };
      await withEnv({ GITHUB_ACTIONS: "true" }, async () => {
        r = await runCli(B, args);
      });
      assertEquals(r.code, 1, `${args[0]} unexpectedly succeeded`);
      assertEquals(
        unintendedCommands(`${r.out}\n${r.err}`),
        [],
        `\`zuke ${args[0]}\` let its argument reach the runner as a command`,
      );
    }
  });
});

Deno.test("the run-inspection commands cannot print a forged command", async () => {
  // `runs show` and `runs list` print an actor read back from the shared store,
  // and that actor is not always operator-typed: the registry MCP server feeds
  // `resolveActor` the client's own self-reported name from its `initialize`
  // request, so it can be chosen by whoever connects.
  //
  // These live in their own module with their own console writes, which is why
  // the sink added for `cli.ts` did not reach them — the same shape, one file
  // over.
  await withStateDir(async () => {
    class B extends Build {
      deploy = target().executes(() => {});
    }
    const hostile = ["mallory", "::stop-commands::TOKEN"].join("\n");
    assertEquals((await runCli(B, ["deploy", "--actor", hostile])).code, 0);
    const listed = await runCli(B, ["runs", "list", "--json"]);
    const runId = String(JSON.parse(listed.out)[0].id);

    for (const args of [["runs", "show", runId], ["runs", "list"]]) {
      let r = { code: -1, out: "", err: "" };
      await withEnv({ GITHUB_ACTIONS: "true" }, async () => {
        r = await runCli(B, args);
      });
      assertEquals(r.code, 0, r.err);
      assertEquals(
        unintendedCommands(`${r.out}\n${r.err}`),
        [],
        `\`zuke ${args.join(" ")}\` let a stored actor reach the runner`,
      );
    }
  });
});
