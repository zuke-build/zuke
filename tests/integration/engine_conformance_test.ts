// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Replay every case under `spike/engine/conformance/` through the real CLI
 * `main()`: the fake worker answers the case's manifest, and the run must make
 * exactly the calls the case lists, exit as it says, and list what it says.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import type { Build } from "../../packages/core/mod.ts";
import { WorkerHost } from "../../spike/engine/src/host.ts";
import { materialize } from "../../spike/engine/src/materialize.ts";
import { isRecord } from "../../spike/engine/src/protocol.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

const CASES = new URL("../../spike/engine/conformance/", import.meta.url);
const FAKE =
  new URL("../../spike/engine/fixtures/fake_worker.ts", import.meta.url)
    .href;

/** One run of a case: the first, or a later one under `then`. */
interface Run {
  readonly manifest: unknown;
  readonly argv: string[];
  readonly code: number;
  readonly calls: string[];
  readonly configure: unknown;
  readonly answers?: string[];
  readonly files: string[];
}

interface Case extends Run {
  readonly list?: { targets: unknown; parameters: unknown };
  readonly then: Run[];
}

function runOf(value: unknown, file: string, manifest: unknown): Run {
  if (
    !isRecord(value) || !Array.isArray(value.argv) ||
    typeof value.code !== "number" || !Array.isArray(value.calls) ||
    value.configure === undefined
  ) {
    throw new Error(
      `${file}: a run needs argv, code, calls and configure`,
    );
  }
  return {
    manifest: value.manifest ?? manifest,
    argv: value.argv.map(String),
    code: value.code,
    calls: value.calls.map(String),
    configure: value.configure,
    answers: Array.isArray(value.answers)
      ? value.answers.map(String)
      : undefined,
    files: Array.isArray(value.files) ? value.files.map(String) : [],
  };
}

function caseOf(value: unknown, file: string): Case {
  if (!isRecord(value) || value.manifest === undefined) {
    throw new Error(`${file}: a case needs a manifest`);
  }
  const list = isRecord(value.list)
    ? { targets: value.list.targets, parameters: value.list.parameters }
    : undefined;
  return {
    ...runOf(value, file, value.manifest),
    list,
    then: Array.isArray(value.then)
      ? value.then.map((r) => runOf(r, file, value.manifest))
      : [],
  };
}

/** The id of the one run the CLI persisted under `dir`. */
async function onlyRunId(dir: string): Promise<string> {
  const runs = await new FileSystemStateStore(dir, defaultStateHost).listRuns(
    {},
  );
  assertEquals(runs.length, 1);
  return runs[0]?.id ?? "";
}

/** The `worker: <prefix> …` lines of the log, without the prefix. */
function logged(err: string, prefix: string): string[] {
  return err.split("\n").flatMap((line) =>
    line.startsWith(`worker: ${prefix} `)
      ? [line.slice(`worker: ${prefix} `.length)]
      : []
  );
}

for await (const entry of Deno.readDir(CASES)) {
  if (!entry.name.endsWith(".json")) continue;
  const spec = caseOf(
    JSON.parse(await Deno.readTextFile(new URL(entry.name, CASES))),
    entry.name,
  );
  Deno.test(`conformance: ${entry.name}`, async () => {
    // Each case runs from its own empty directory: the incremental cache
    // lives under the working directory's `.zuke/`, so a repeat of the
    // cache-key case in the repository would be a cache hit, not a run.
    const dir = await Deno.makeTempDir();
    const previous = Deno.cwd();
    Deno.chdir(dir);
    try {
      await replay(spec);
    } finally {
      Deno.chdir(previous);
      await Deno.remove(dir, { recursive: true });
    }
  });
}

async function replay(spec: Case): Promise<void> {
  await withStateDir(async (dir) => {
    const listed = await withWorker(spec.manifest, async (Remote) => {
      if (spec.list === undefined) return;
      const result = await runCli(Remote, ["--list", "--json"]);
      assertEquals(result.code, 0, result.err);
      return result.out;
    });
    if (spec.list !== undefined) {
      const surface: unknown = JSON.parse(listed ?? "");
      const actual = isRecord(surface) ? surface : {};
      assertEquals(actual.targets, spec.list.targets);
      assertEquals(actual.parameters, spec.list.parameters);
    }
    await replayRun(spec, undefined);
    // Every later run is a fresh process with a fresh worker, as `resume` is.
    for (const run of spec.then) await replayRun(run, await onlyRunId(dir));
  });
}

/** Start a fake worker on `manifest`, materialise its build, run `fn`, stop it. */
async function withWorker<T>(
  manifest: unknown,
  fn: (Remote: new () => Build) => Promise<T>,
): Promise<T> {
  Deno.env.set("ZUKE_FAKE_PLAN", JSON.stringify(manifest));
  Deno.env.delete("ZUKE_FAKE_BAD_TOKEN");
  const host = await WorkerHost.start({
    command: [Deno.execPath(), "run", "-A", FAKE],
    cwd: Deno.cwd(),
    graceMs: 1_000,
  });
  try {
    return await fn(materialize(await host.describe(), host));
  } finally {
    await host.finish(0);
  }
}

async function replayRun(run: Run, runId: string | undefined): Promise<void> {
  await withWorker(run.manifest, async (Remote) => {
    const argv = run.argv.map((a) => a === "$RUN_ID" ? runId ?? a : a);
    const result = await runCli(Remote, argv);
    assertEquals(result.code, run.code, result.out + result.err);
    assertEquals(logged(result.err, "call:"), run.calls);
    if (run.answers !== undefined) {
      assertEquals(logged(result.err, "answer:"), run.answers);
    }
    // A command that never runs the build configures nothing.
    const [configure] = logged(result.err, "configure:");
    const sent: unknown = JSON.parse(configure ?? "{}");
    const { parameters } = isRecord(sent) ? sent : {};
    assertEquals(configure === undefined ? {} : { parameters }, run.configure);
    for (const file of run.files) {
      assertEquals((await Deno.stat(file)).isFile, true, file);
    }
  });
}
