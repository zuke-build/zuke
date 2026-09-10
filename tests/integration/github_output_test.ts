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

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";
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
