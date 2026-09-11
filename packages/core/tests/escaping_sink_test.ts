// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The neutralising of text Zuke did not author, on the stream a GitHub Actions
 * runner parses for workflow commands: the `escapeLineIf` decision, the
 * `escapingReporter` sink the executor and the operator commands write through,
 * and the two composed lines that were still going out raw.
 *
 * The runner acts on a line whose first non-blank characters are `::`, and on
 * `##[` anywhere in a line. Every assertion below is about the *start of a
 * line*, not about a substring: the injected text is expected to survive as
 * text, and what must not happen is it opening a command. Asserting
 * `includes("::stop-commands::")` would pass whether or not the fix is there.
 */

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { escapeLineIf } from "../src/render.ts";
import {
  escapingReporter,
  type Reporter,
  silentReporter,
} from "../src/reporter.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { execute } from "../src/executor.ts";
import type { Plugin } from "../src/plugin.ts";

const NL = String.fromCharCode(10);

/**
 * The percent-encoded `::`, kept as its own constant so the encoded prefix
 * never fuses with the word after it into a token no dictionary can know: the
 * spell gate reads the encoding and the word that follows it as one. The same
 * reason `report_test.ts` splits its literal.
 */
const ENC = "%3A%3A";

/** A reporter that records every line, so a test can inspect the stream. */
function capture(): { reporter: Reporter; info: string[]; error: string[] } {
  const info: string[] = [];
  const error: string[] = [];
  return {
    reporter: {
      info: (l) => void info.push(l),
      error: (l) => void error.push(l),
    },
    info,
    error,
  };
}

/** Every line of `lines`, split on newlines — what the runner actually reads. */
function streamLines(lines: string[]): string[] {
  return lines.flatMap((l) => l.split(NL));
}

Deno.test("escapeLineIf escapes only when something is parsing for commands", () => {
  const forged = "::stop-commands::deadbeef";
  assertEquals(escapeLineIf(false, forged), forged);
  assertEquals(escapeLineIf(true, forged), ENC + "stop-commands::deadbeef");
  // Ordinary text is untouched in both directions — the escape is not a filter.
  assertEquals(escapeLineIf(true, "lint passed"), "lint passed");
  assertEquals(escapeLineIf(false, "lint passed"), "lint passed");
});

Deno.test("escapingReporter neutralises a command and leaves prose alone", () => {
  const sink = capture();
  const wrapped = escapingReporter(sink.reporter);

  wrapped.info("Run abc123 cancelled — 2 compensation(s) ran.");
  wrapped.info("::error::forged annotation");
  wrapped.info("   ::stop-commands::deadbeef"); // leading blanks are trimmed
  wrapped.error("held by ##[group]x");

  assertEquals(sink.info[0], "Run abc123 cancelled — 2 compensation(s) ran.");
  assertEquals(sink.info[1], ENC + "error::forged annotation");
  assertEquals(sink.info[2], "   " + ENC + "stop-commands::deadbeef");
  assertEquals(sink.error[0], "held by %23%23[group]x");
});

Deno.test("escapingReporter is idempotent, so double-wrapping is harmless", () => {
  const once = capture();
  const twice = capture();
  escapingReporter(once.reporter).info("::error::x");
  escapingReporter(escapingReporter(twice.reporter)).info("::error::x");
  assertEquals(twice.info, once.info);
});

/** A build whose only target succeeds — enough to produce a target block. */
class Quiet extends Build {
  work = target().executes(() => {});
}

/** Run `Quiet` and return everything written, split into runner-visible lines. */
async function runQuiet(
  opts: { github: boolean; plugins?: Plugin[] },
): Promise<{ info: string[]; error: string[] }> {
  const sink = capture();
  const build = new Quiet();
  const root = discoverTargets(build).get("work");
  if (root === undefined) throw new Error("fixture target not found");
  await execute(build, root, {
    reporter: sink.reporter,
    github: opts.github,
    ...(opts.plugins === undefined ? {} : { plugins: opts.plugins }),
  });
  return { info: streamLines(sink.info), error: streamLines(sink.error) };
}

Deno.test("a plugin's message cannot forge a command through the executor's sink", async () => {
  // A plugin that throws is reported through the lifecycle's `warn` channel,
  // which embeds the thrown message verbatim — third-party text on a stream the
  // runner parses.
  const hostile: Plugin = {
    name: "rogue",
    onStart: () => {
      throw new Error(["boom", "::stop-commands::deadbeef"].join(NL));
    },
  };

  const actions = await runQuiet({ github: true, plugins: [hostile] });
  // The whole set of command-opening lines, asserted exactly: the two the
  // renderer authored and nothing else. Weaker forms pass vacuously — an
  // allowlist by prefix would admit a forged `::group::`, and "no line starts
  // with `::`" is false here for a legitimate reason.
  assertEquals(
    actions.info.filter((l) => l.startsWith("::")),
    ["::group::work", "::endgroup::"],
  );
  // The text is still there — neutralised, not filtered.
  assertStringIncludes(
    actions.info.join(NL),
    ENC + "stop-commands::deadbeef",
  );

  // Off a runner the same line is left readable: nothing is parsing it.
  const local = await runQuiet({ github: false, plugins: [hostile] });
  assertEquals(
    local.info.some((l) => l.startsWith("::stop-commands::deadbeef")),
    true,
  );
});

Deno.test("the renderer's own workflow commands survive the executor's sink", async () => {
  // The guard on the other side: wrapping the renderer's sink too would encode
  // `::endgroup::` and break every target's grouping. This fails if the
  // escaping reporter is put in front of `ctx.reporter` instead of beside it.
  const actions = await runQuiet({ github: true });
  assertEquals(actions.info.includes("::endgroup::"), true);
  assertEquals(actions.info.some((l) => l.startsWith("::group::")), true);
});

/** A stage that is itself a fan-out, so its parent's name carries an item key. */
const innerFanOut = target().forEach(
  () => ["one"],
  () => ({ work: target().executes(() => {}) }),
);

class NestedFanOut extends Build {
  outer = target().forEach(
    () => [["a", "::stop-commands::deadbeef"].join(NL)],
    () => ({ stage: innerFanOut }),
  );
}

Deno.test("a fan-out item key cannot forge a command through the count line", async () => {
  // Reachability is the point: a top-level fan-out's name is a class field, but
  // a *stage* may declare a fan-out of its own, and the nested one is named
  // `outer[<key>].stage` — so the count line is composed from an item key.
  const sink = capture();
  const build = new NestedFanOut();
  const root = discoverTargets(build).get("outer");
  if (root === undefined) throw new Error("fixture target not found");
  const result = await execute(build, root, {
    reporter: sink.reporter,
    github: true,
  });
  assertEquals(result.ok, true);

  const lines = streamLines(sink.info);
  const counts = lines.filter((l) => l.includes("fan-out over"));
  // Two of them: the outer target's, and the nested one whose name carries the
  // key. Asserted so a change that stops reaching the nested line fails here
  // rather than passing vacuously.
  assertEquals(counts.length, 2);
  assertEquals(
    counts.some((l) => l.includes(ENC + "stop-commands::deadbeef")),
    true,
  );
  assertEquals(lines.some((l) => l.startsWith("::stop-commands::")), false);
});

Deno.test("silentReporter stays silent once wrapped", () => {
  // The wrapper composes with the other reporters rather than replacing them.
  escapingReporter(silentReporter).info("::error::x");
});
