// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a command's live output stays inside its own target's block.
 *
 * Concurrent targets buffer their framework output and flush it as one block on
 * completion. A child process used to stream straight to the terminal instead,
 * so a slow test run's output landed after whichever other target flushed
 * first, before its own header. These runs drive the real CLI `main()` and
 * capture console lines and raw child bytes into one ordered transcript.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, group, target } from "../../packages/core/mod.ts";
import { main } from "../../packages/core/src/cli.ts";
import { flushInFlightOutput } from "../../packages/core/src/scheduler.ts";
import { $ } from "../../packages/core/src/shell.ts";

/** What the run in progress has printed so far, readable from a target body. */
const printed: string[] = [];

/** Run `main` and return everything it printed, child output included, in order. */
async function transcript(
  BuildClass: new () => Build,
  args: string[],
): Promise<{ code: number; lines: string[] }> {
  const parts = printed;
  parts.length = 0;
  const decoder = new TextDecoder();
  const origLog = console.log;
  const origErr = console.error;
  const origOut = Deno.stdout.writeSync;
  const origStderr = Deno.stderr.writeSync;
  const raw = (p: Uint8Array) => {
    parts.push(decoder.decode(p));
    return p.length;
  };
  console.log = (...a: unknown[]) => void parts.push(a.join(" ") + "\n");
  console.error = (...a: unknown[]) => void parts.push(a.join(" ") + "\n");
  Deno.stdout.writeSync = raw;
  Deno.stderr.writeSync = raw;
  try {
    const code = await main(BuildClass, args);
    return { code, lines: parts.join("").split("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
    Deno.stdout.writeSync = origOut;
    Deno.stderr.writeSync = origStderr;
  }
}

/** Index of the first line matching `re`, failing the test when there is none. */
function lineOf(lines: string[], re: RegExp): number {
  const index = lines.findIndex((line) => re.test(line));
  assertEquals(index >= 0, true, `no line matches ${re}:\n${lines.join("\n")}`);
  return index;
}

/** A child that prints `text` after `ms` milliseconds. */
function echoLater(text: string, ms: number) {
  // Values go in as argv, so the evaluated code is a constant.
  const code =
    `await new Promise((r) => setTimeout(r, Number(Deno.args[1]))); console.log(Deno.args[0]);`;
  return $`${Deno.execPath()} eval ${code} ${text} ${String(ms)}`;
}

class GroupedBuild extends Build {
  checks = group();
  slow = target().partOf(this.checks).executes(async () => {
    await echoLater("SLOW-OUT", 400);
  });
  fast = target().partOf(this.checks).executes(async () => {
    await echoLater("FAST-OUT", 0);
  });
  ci = target().dependsOn(this.checks).executes(() => {});
}

Deno.test("integration: concurrent targets keep their command output in their own block", async () => {
  const { code, lines } = await transcript(GroupedBuild, ["ci", "--plain"]);
  assertEquals(code === 0, true, lines.join("\n"));
  const slowHeader = lineOf(lines, /\bslow\b/);
  const fastHeader = lineOf(lines, /\bfast\b/);
  const slowOut = lineOf(lines, /^SLOW-OUT$/);
  const fastOut = lineOf(lines, /^FAST-OUT$/);
  // `fast` settles first, so its block — output included — comes first.
  assertEquals(fastHeader < fastOut, true, lines.join("\n"));
  assertEquals(fastOut < slowHeader, true, lines.join("\n"));
  assertEquals(slowHeader < slowOut, true, lines.join("\n"));
});

class SerialScheduledBuild extends Build {
  // `always` routes the run through the scheduler without letting anything
  // overlap, so each target runs alone and streams live.
  first = target().executes(async () => {
    await echoLater("FIRST-OUT", 0);
  });
  teardown = target().dependsOn(this.first).always().executes(async () => {
    await echoLater("TEARDOWN-OUT", 0);
  });
}

Deno.test("integration: a target that runs alone prints its header before its command output", async () => {
  const { code, lines } = await transcript(SerialScheduledBuild, [
    "teardown",
    "--plain",
  ]);
  assertEquals(code === 0, true, lines.join("\n"));
  const firstHeader = lineOf(lines, /\bfirst\b/);
  const firstOut = lineOf(lines, /^FIRST-OUT$/);
  const teardownHeader = lineOf(lines, /\bteardown\b/);
  const teardownOut = lineOf(lines, /^TEARDOWN-OUT$/);
  assertEquals(firstHeader < firstOut, true, lines.join("\n"));
  assertEquals(firstOut < teardownHeader, true, lines.join("\n"));
  assertEquals(teardownHeader < teardownOut, true, lines.join("\n"));
});

class NestedFanOutBuild extends Build {
  checks = group();
  slow = target().partOf(this.checks).executes(async () => {
    await echoLater("SLOW-OUT", 600);
  });
  fan = target().partOf(this.checks).forEach(
    () => ["a", "b"],
    (item: string) => ({
      run: target().executes(async () => {
        await echoLater(`ITEM-${item}`, 0);
      }),
    }),
  );
  ci = target().dependsOn(this.checks).executes(() => {});
}

Deno.test("integration: a fan-out's item output stays inside its parent's block", async () => {
  const { code, lines } = await transcript(NestedFanOutBuild, [
    "ci",
    "--plain",
  ]);
  assertEquals(code === 0, true, lines.join("\n"));
  const fanHeader = lineOf(lines, /\bfan\b/);
  const slowHeader = lineOf(lines, /\bslow\b/);
  assertEquals(fanHeader < lineOf(lines, /^ITEM-a$/), true, lines.join("\n"));
  assertEquals(fanHeader < lineOf(lines, /^ITEM-b$/), true, lines.join("\n"));
  // The fan-out settles first, so its whole block precedes the slow target's.
  assertEquals(lineOf(lines, /^ITEM-a$/) < slowHeader, true, lines.join("\n"));
  assertEquals(lineOf(lines, /^ITEM-b$/) < slowHeader, true, lines.join("\n"));
});

class SerialFanOutBuild extends Build {
  // Whether each item's output had reached the terminal by the time it ended.
  live: boolean[] = [];
  fan = target().forEach(
    () => ["a", "b"],
    (item: string) => ({
      run: target().executes(async () => {
        await echoLater(`ITEM-${item}`, 0);
        this.live.push(printed.join("").includes(`ITEM-${item}`));
      }),
    }),
    (s) => s.concurrency(1),
  );
}

Deno.test("integration: a fan-out limited to one item at a time streams each item live", async () => {
  let build: SerialFanOutBuild | undefined;
  class Probe extends SerialFanOutBuild {
    constructor() {
      super();
      build = this;
    }
  }
  const { code, lines } = await transcript(Probe, ["fan", "--plain"]);
  assertEquals(code === 0, true, lines.join("\n"));
  assertEquals(build?.live, [true, true]);
});

class HungBuild extends Build {
  // What had reached the terminal when the forced exit flushed the buffers.
  seen = "";
  checks = group();
  hung = target().partOf(this.checks).executes(async () => {
    await echoLater("BEFORE-HANG", 0);
    // Stands in for the second Ctrl-C that force-exits a hung run.
    flushInFlightOutput();
    this.seen = printed.join("");
  });
  other = target().partOf(this.checks).executes(() => {});
}

Deno.test("integration: a forced exit prints what a hung target had written", async () => {
  let build: HungBuild | undefined;
  class Probe extends HungBuild {
    constructor() {
      super();
      build = this;
    }
  }
  const { code, lines } = await transcript(Probe, ["hung", "other", "--plain"]);
  assertEquals(code === 0, true, lines.join("\n"));
  assertEquals(build?.seen.includes("BEFORE-HANG"), true, build?.seen);
  // Flushed once: the block is not printed again when the target settles.
  assertEquals(lines.filter((l) => l === "BEFORE-HANG").length, 1);
});

class HungItemBuild extends Build {
  seen = "";
  checks = group();
  fan = target().partOf(this.checks).forEach(
    () => ["a", "b"],
    (item: string) => ({
      run: target().executes(async () => {
        await echoLater(`ITEM-${item}`, 0);
        // The forced exit runs outside every target's async context, but each
        // block must still go to the sink bound when its target launched.
        if (item === "a") {
          flushInFlightOutput();
          this.seen = printed.join("");
        }
      }),
    }),
  );
  other = target().partOf(this.checks).executes(() => {});
}

Deno.test("integration: a forced exit flushes a fan-out item to the sink it launched with", async () => {
  let build: HungItemBuild | undefined;
  class Probe extends HungItemBuild {
    constructor() {
      super();
      build = this;
    }
  }
  const { code, lines } = await transcript(Probe, ["fan", "other", "--plain"]);
  assertEquals(code === 0, true, lines.join("\n"));
  assertEquals(build?.seen.includes("ITEM-a"), true, build?.seen);
  assertEquals(lines.filter((l) => l === "ITEM-a").length, 1);
});
