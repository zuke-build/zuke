// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The sharded test runner behind `zuke.ts`'s `test` target: how files are
 * discovered and dealt into shards, and how the shards' outputs are printed,
 * summed and turned into a verdict. The runner seam is faked, so no `deno test`
 * is spawned here — `tests/integration/test_shards_test.ts` runs real ones.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { withTemp } from "../packages/core/tests/_temp.ts";
import { envCacheStore } from "../packages/core/mod.ts";
import {
  discoverTestFiles,
  HERMETIC_ENV,
  partitionShards,
  pruneEmptyProfiles,
  runShards,
  shardCount,
  type ShardOutput,
} from "../build/test_shards.ts";

/** A shard output whose stdout ends with deno's result line. */
function shard(code: number, result: string, stderr = ""): ShardOutput {
  return { code, stdout: `...\n\n${result} (1s)\n`, stderr };
}

Deno.test("partition: files are dealt round-robin, in order", () => {
  assertEquals(
    partitionShards(["a", "b", "c", "d", "e"], 2),
    [["a", "c", "e"], ["b", "d"]],
  );
});

Deno.test("partition: never more shards than files, never an empty one", () => {
  assertEquals(partitionShards(["a", "b"], 8), [["a"], ["b"]]);
  assertEquals(partitionShards([], 4), []);
  assertEquals(partitionShards(["a", "b"], 0), [["a", "b"]]);
});

Deno.test("shardCount: one per CPU, at least one, at most eight", () => {
  assertEquals(shardCount(4), 4);
  assertEquals(shardCount(0), 1);
  assertEquals(shardCount(64), 8);
  assertEquals(shardCount() >= 1, true);
});

Deno.test("discover: every *_test.ts, sorted, never inside node_modules", async () => {
  await withTemp(async (dir) => {
    for (
      const path of [
        "b/two_test.ts",
        "a/one_test.ts",
        "a/helper.ts",
        "a/fixture_suite.ts",
        "x/node_modules/pkg/dep_test.ts",
      ]
    ) {
      await Deno.mkdir(`${dir}/${path.replace(/\/[^/]+$/, "")}`, {
        recursive: true,
      });
      await Deno.writeTextFile(`${dir}/${path}`, "");
    }
    assertEquals(await discoverTestFiles(dir), [
      "a/one_test.ts",
      "b/two_test.ts",
    ]);
  });
});

/** Deno's default test-module pattern: `{*_,*.,}test.{ts,tsx,mts,js,mjs,jsx}`. */
const DENO_DEFAULT_TEST = /^(?:.*[_.])?test\.(?:ts|tsx|mts|js|mjs|jsx)$/;

/** Every file under `dir` deno's default discovery would run, skipping `.git` and `node_modules`. */
async function denoDiscoverable(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name !== ".git" && entry.name !== "node_modules") {
        found.push(...await denoDiscoverable(path));
      }
    } else if (entry.isFile && DENO_DEFAULT_TEST.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

Deno.test("discover: no file deno would run as a test is left out of the shards", async () => {
  // The shards run explicit file lists, so a test module named another way
  // deno accepts (`foo.test.ts`, `test.ts`) would run under a plain
  // `deno test` but silently in no shard. Rename it to `*_test.ts`.
  const sharded = new Set(await discoverTestFiles());
  const missing = (await denoDiscoverable(".")).filter((f) => !sharded.has(f));
  assertEquals(missing, [], "rename these to *_test.ts");
});

Deno.test("runShards: prints each shard in order and sums the counts", async () => {
  const printed: string[] = [];
  const outputs = [
    shard(0, "ok | 3 passed | 0 failed | 1 ignored"),
    shard(0, "ok | 2 passed (2 steps) | 0 failed"),
  ];
  const seen: string[][] = [];
  const counts = await runShards(
    [["a_test.ts"], ["b_test.ts"]],
    (files) => {
      seen.push(files);
      return Promise.resolve(outputs[seen.length - 1]);
    },
    (text) => printed.push(text),
  );
  assertEquals(counts, { passed: 5, failed: 0, skipped: 1 });
  assertEquals(seen, [["a_test.ts"], ["b_test.ts"]]);
  assertEquals(printed[0], "── test shard 1/2 ──");
  assertStringIncludes(printed[1], "3 passed");
  assertEquals(printed[2], "── test shard 2/2 ──");
  assertStringIncludes(printed[3], "2 passed");
});

Deno.test("runShards: a failing shard fails the run after every shard printed", async () => {
  const printed: string[] = [];
  const outputs = [
    shard(1, "FAILED | 1 passed | 2 failed", "error: Test failed"),
    shard(0, "ok | 4 passed | 0 failed"),
  ];
  let i = 0;
  const error = await assertRejects(
    () =>
      runShards(
        [["a_test.ts"], ["b_test.ts"]],
        () => Promise.resolve(outputs[i++]),
        (text) => printed.push(text),
      ),
    Error,
    "1 of 2 test shard(s) failed — 2 failing test(s)",
  );
  assertStringIncludes(error.message, "see the shard output above");
  // Every shard printed its result line, so none is called out as uncounted.
  assertEquals(error.message.includes("exited before"), false);
  assertStringIncludes(printed[1], "error: Test failed"); // stderr is shown
  assertEquals(printed[2], "── test shard 2/2 ──"); // the passing shard printed too
});

Deno.test("runShards: a shard that crashed before its result line still fails", async () => {
  const printed: string[] = [];
  let attempts = 0;
  await assertRejects(
    () =>
      runShards(
        [["a_test.ts"]],
        () => {
          attempts++;
          return Promise.resolve({ code: 1, stdout: "", stderr: "" });
        },
        (text) => printed.push(text),
      ),
    Error,
    "Shard(s) 1 exited before printing a result line, so their tests are " +
      "not counted.",
  );
  // Died before testing both times: run once more, then failed — never a loop.
  assertEquals(attempts, 2);
  // Nothing to print beyond the headers for empty shard outputs.
  assertEquals(printed, [
    "── test shard 1/1 ──",
    "── test shard 1/1: deno exited before running any test; ran it again ──",
  ]);
});

/** Deno's bare startup failure from #852, with nothing on stdout. */
const DIED: ShardOutput = {
  code: 1,
  stdout: "",
  stderr: "error: No such file or directory (os error 2)\n",
};

Deno.test("runShards: a shard whose deno died before testing is run again", async () => {
  const printed: string[] = [];
  const seen: string[][] = [];
  const counts = await runShards(
    [["a_test.ts"], ["b_test.ts"]],
    (files) => {
      seen.push(files);
      // Shard 1's first attempt dies at startup; every other run passes.
      return Promise.resolve(
        seen.length === 1 ? DIED : shard(0, "ok | 2 passed | 0 failed"),
      );
    },
    (text) => printed.push(text),
  );
  assertEquals(counts, { passed: 4, failed: 0, skipped: 0 });
  assertEquals(seen, [["a_test.ts"], ["b_test.ts"], ["a_test.ts"]]);
  // The dead attempt stays on record, ahead of the run that replaced it.
  assertEquals(printed.slice(0, 3), [
    "── test shard 1/2 ──",
    "error: No such file or directory (os error 2)",
    "── test shard 1/2: deno exited before running any test; ran it again ──",
  ]);
  assertStringIncludes(printed[3], "2 passed");
});

Deno.test("runShards: a shard that started a test file is never run again", async () => {
  // The colour codes deno prints are no disguise for its start line.
  const grey = "\x1b[0m\x1b[38;5;245m";
  const started: ShardOutput = {
    code: 1,
    stdout: `${grey}running 3 tests from ./a_test.ts\x1b[0m\n`,
    stderr: "error: Uncaught (in promise) Error: boom\n",
  };
  let attempts = 0;
  const error = await assertRejects(
    () =>
      runShards([["a_test.ts"]], () => {
        attempts++;
        return Promise.resolve(started);
      }, () => {}),
    Error,
    "1 of 1 test shard(s) failed",
  );
  assertEquals(attempts, 1);
  assertStringIncludes(error.message, "Shard(s) 1 exited before printing");
});

Deno.test("runShards: a shard that printed its result line is never run again", async () => {
  let attempts = 0;
  await assertRejects(
    () =>
      runShards([["a_test.ts"]], () => {
        attempts++;
        return Promise.resolve(shard(1, "FAILED | 0 passed | 1 failed"));
      }, () => {}),
    Error,
    "1 failing test(s)",
  );
  assertEquals(attempts, 1);
});

Deno.test("the hermetic env blanks the job's summary and remote cache", () => {
  // A ci job with the action's `actions-cache` input, and a developer's own
  // remote cache: either would hand every test build a remote cache, so a
  // target with declared inputs restores another test's outputs and skips its
  // body (the cancelled-run caching test turned green-by-cache this way).
  const job: Record<string, string> = {
    GITHUB_STEP_SUMMARY: "/tmp/summary.md",
    ACTIONS_RUNTIME_TOKEN: "runtime",
    ACTIONS_RESULTS_URL: "https://results.example/",
    ZUKE_REMOTE_CACHE_URL: "https://cache.example/",
    ZUKE_REMOTE_CACHE_DIR: "/tmp/remote",
  };
  const readEnv = (env: Record<string, string>) => (name: string) => env[name];
  assertEquals(envCacheStore(readEnv(job)) !== undefined, true);
  const hermetic = { ...job, ...HERMETIC_ENV };
  assertEquals(envCacheStore(readEnv(hermetic)), undefined);
  assertEquals(hermetic.GITHUB_STEP_SUMMARY, "");
});

Deno.test("pruneEmptyProfiles: drops the zero-byte profiles and keeps the rest", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(`${dir}/full.json`, "{}");
    await Deno.writeTextFile(`${dir}/cut-off.json`, "");
    await Deno.mkdir(`${dir}/nested`);
    assertEquals(await pruneEmptyProfiles(dir), 1);
    const left = [];
    for await (const entry of Deno.readDir(dir)) left.push(entry.name);
    assertEquals(left.sort(), ["full.json", "nested"]);
    assertEquals(await pruneEmptyProfiles(dir), 0);
  });
});
