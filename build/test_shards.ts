// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Run the test suite as several `deno test` **processes** at once, each over
 * its own slice of the test files, instead of one process walking all of them
 * in turn.
 *
 * Why processes and not `deno test --parallel`: `--parallel` runs the modules
 * as workers inside one process, and a large part of this suite sets
 * `Deno.env` (the state-dir harness, token readers) or calls `Deno.chdir` —
 * both process-wide — so concurrent modules trample each other. A process per
 * shard gives each slice its own environment and working directory, and the
 * files inside a shard still run one after another exactly as before. The
 * shards write coverage into the same profile directory (deno names each
 * profile file uniquely), so the coverage gate reads one merged report.
 *
 * @module
 */

import { glob, reportTestCounts, type TestCounts } from "@zuke/core";
import { stripAnsi } from "@zuke/core/render";
import { parseTestSummary } from "../packages/deno/src/test_summary.ts";

/**
 * Environment every test process runs with, layered over the inherited one. A
 * blank value reads as unset to each reader, so the suite stays hermetic on a
 * CI job that would otherwise lend it the job's own services: the step
 * summary, which tests exercising it would append to, and the remote cache —
 * `ACTIONS_RUNTIME_TOKEN`/`ACTIONS_RESULTS_URL` (the action's `actions-cache`
 * input) or an ambient `ZUKE_REMOTE_CACHE_*` — through which a test build with
 * declared inputs would restore another test's outputs instead of running its
 * body. The parent `./zuke` run keeps them all, so its own targets still use
 * the cache and write the summary.
 */
export const HERMETIC_ENV: Record<string, string> = {
  GITHUB_STEP_SUMMARY: "",
  ACTIONS_RUNTIME_TOKEN: "",
  ACTIONS_RESULTS_URL: "",
  ZUKE_REMOTE_CACHE_URL: "",
  ZUKE_REMOTE_CACHE_S3_URL: "",
  ZUKE_REMOTE_CACHE_DIR: "",
};

/**
 * The test files the suite consists of: every `*_test.ts`, sorted, outside
 * `node_modules`. This is the repository's naming convention, and
 * `tests/test_shards_test.ts` pins that no file deno's default discovery
 * would pick up falls outside it — so sharding can never silently drop one.
 */
export async function discoverTestFiles(cwd?: string): Promise<string[]> {
  const files = await glob("**/*_test.ts", { cwd });
  return files.filter((f) => !f.split("/").includes("node_modules"));
}

/**
 * Deal `files` round-robin into at most `count` non-empty shards. The input is
 * sorted by discovery, so the deal is deterministic, and round-robin spreads
 * each package's files (which tend to cost alike) across every shard.
 */
export function partitionShards(files: string[], count: number): string[][] {
  const size = Math.max(1, Math.min(count, files.length));
  const shards: string[][] = Array.from({ length: size }, () => []);
  files.forEach((file, i) => shards[i % size].push(file));
  return shards.filter((shard) => shard.length > 0);
}

/**
 * How many shards to run. One per CPU, so the machine is busy without being
 * oversubscribed, capped at 8 — each shard is a full deno process holding its
 * own module graph, and past that the memory grows faster than the run
 * shrinks.
 */
export function shardCount(
  cpus: number = navigator.hardwareConcurrency,
): number {
  return Math.max(1, Math.min(cpus, 8));
}

/** What one shard's `deno test` produced. */
export interface ShardOutput {
  /** The process exit code. */
  code: number;
  /** Captured stdout (the reporter's output and result line). */
  stdout: string;
  /** Captured stderr. */
  stderr: string;
}

/** The seam that runs `deno test` over one shard's files. */
export type ShardRunner = (files: string[]) => Promise<ShardOutput>;

/** Deno's line as it starts a test file: `running 3 tests from ./a_test.ts`. */
const STARTED_FILE = /^running \d+ tests? from /m;

/**
 * Whether deno exited before it ran a single test file: a non-zero exit with
 * neither a `running … from` line nor a result line. Deno itself failed, not a
 * test — on a freshly provisioned macOS runner it has exited at startup with a
 * bare `No such file or directory (os error 2)` (#852) — so running the slice
 * again cannot hide a failing test. A shard that started even one file is
 * never re-run: whatever it printed is the verdict.
 */
function diedBeforeTesting(out: ShardOutput): boolean {
  return out.code !== 0 && parseTestSummary(out.stdout) === undefined &&
    !STARTED_FILE.test(stripAnsi(out.stdout));
}

/** One shard's final output, and the attempt that died before testing, if any. */
interface ShardRun {
  out: ShardOutput;
  died: ShardOutput | undefined;
}

/** Run one shard, and run it once more if deno died before testing. */
async function runShard(
  files: string[],
  runner: ShardRunner,
): Promise<ShardRun> {
  const first = await runner(files);
  if (!diedBeforeTesting(first)) return { out: first, died: undefined };
  return { out: await runner(files), died: first };
}

/** A shard output as one block of text, or `""` when it printed nothing. */
function textOf(out: ShardOutput): string {
  return `${out.stdout}${out.stderr}`.trimEnd();
}

/** Sum the counts of every shard that printed a result line. */
function sumCounts(outputs: ShardOutput[]): TestCounts {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const out of outputs) {
    const counts = parseTestSummary(out.stdout);
    if (counts === undefined) continue;
    passed += counts.passed;
    failed += counts.failed;
    skipped += counts.skipped ?? 0;
  }
  return { passed, failed, skipped };
}

/**
 * Run every shard concurrently through `runner`, then print each shard's
 * captured output **in shard order** — interleaved live output from several
 * processes would be unreadable, and a failure's detail must stay next to its
 * test. A shard whose deno died before it ran any test is run once more, and
 * both attempts are printed. The summed counts are reported into the running
 * target's row, and returned.
 *
 * @throws when any shard exits non-zero, after every shard has finished and
 * printed, so one failing slice never hides another's result.
 */
export async function runShards(
  shards: string[][],
  runner: ShardRunner,
  print: (text: string) => void = (text) => console.log(text),
): Promise<TestCounts> {
  const runs = await Promise.all(
    shards.map((files) => runShard(files, runner)),
  );
  runs.forEach((run, i) => {
    const label = `test shard ${i + 1}/${shards.length}`;
    print(`── ${label} ──`);
    if (run.died !== undefined) {
      const died = textOf(run.died);
      if (died !== "") print(died);
      print(
        `── ${label}: deno exited before running any test; ran it again ──`,
      );
    }
    const text = textOf(run.out);
    if (text !== "") print(text);
  });
  const outputs = runs.map((run) => run.out);
  const counts = sumCounts(outputs);
  reportTestCounts(counts);
  const failedShards = outputs.filter((out) => out.code !== 0).length;
  if (failedShards > 0) {
    // A shard that died before deno printed its result line (a module that
    // fails to load, a crashed process) contributes no counts, so the failing
    // total alone would understate it — name those shards outright.
    const silent = outputs.flatMap((out, i) =>
      out.code !== 0 && parseTestSummary(out.stdout) === undefined
        ? [i + 1]
        : []
    );
    const uncounted = silent.length === 0
      ? ""
      : ` Shard(s) ${
        silent.join(", ")
      } exited before printing a result line, so their tests are not counted.`;
    throw new Error(
      `${failedShards} of ${shards.length} test shard(s) failed — ` +
        `${counts.failed} failing test(s); see the shard output above.` +
        uncounted,
    );
  }
  return counts;
}
