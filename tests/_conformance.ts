// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The engine conformance suite, run by whoever supplies a way to run the
 * build: every case under `packages/engine/conformance/` is a test, and the
 * suite checks what the run did against what the case lists. The in-process
 * test runs each case through the CLI's `main()`; the e2e test runs it
 * through the `zuke` binary, a real process.
 *
 * Each case runs from its own empty directory, with its own state directory.
 * Its `zuke.json` names the fake worker as the build's SDK, so a process
 * started there runs the case's build.
 */

import { test } from "../packages/core/tests/_testing.ts";
import { assertEquals } from "../packages/core/tests/_assert.ts";
import { isRecord } from "../packages/engine/src/protocol.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../packages/core/mod.ts";
import { localVersion } from "../build/packages.ts";
import { withStateDir } from "./integration/_harness.ts";

const CASES = new URL("../packages/engine/conformance/", import.meta.url);

/** The scripted worker every case's build runs on. */
export const FAKE_WORKER =
  new URL("../packages/engine/tests/_fake_worker.ts", import.meta.url).href;

/** The command that starts {@link FAKE_WORKER}, as `zuke.json` names it. */
export const WORKER_COMMAND = [Deno.execPath(), "run", "-A", FAKE_WORKER];

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

/** A case: its first run, what `--list --json` prints, and the runs after. */
interface Case extends Run {
  readonly list?: { targets: unknown; parameters: unknown };
  readonly then: Run[];
}

/** A case where the engine dies mid-run: the worker must exit on its own. */
interface EngineDeath {
  readonly manifest: unknown;
  readonly argv: string[];
  readonly after: string;
  readonly workerExitsWithinMs: number;
}

/** What one run of the CLI printed and how it exited. */
export interface RunResult {
  /** The exit code. */
  readonly code: number;
  /** Everything written to stdout. */
  readonly out: string;
  /** Everything written to stderr, the worker's log among it. */
  readonly err: string;
}

/** How a suite runs a case's build. */
export interface ConformanceRunner {
  /**
   * Run the build the fake worker describes from `manifest`, with `argv`,
   * from the working directory.
   */
  run(manifest: unknown, argv: string[]): Promise<RunResult>;
  /**
   * The command that starts the engine as a process from the working
   * directory, for a case where the engine dies; the case's `argv` is
   * appended.
   */
  readonly engine: string[];
  /** Environment variables the engine process needs beyond the case's. */
  readonly engineEnv?: Record<string, string>;
}

function engineDeathOf(value: unknown, file: string): EngineDeath | undefined {
  if (!isRecord(value) || !isRecord(value.engineDies)) return undefined;
  const { after, workerExitsWithinMs } = value.engineDies;
  if (
    value.manifest === undefined || !Array.isArray(value.argv) ||
    typeof after !== "string" || typeof workerExitsWithinMs !== "number"
  ) {
    throw new Error(
      `${file}: an engineDies case needs manifest, argv, engineDies.after ` +
        "and engineDies.workerExitsWithinMs",
    );
  }
  return {
    manifest: value.manifest,
    argv: value.argv.map(String),
    after,
    workerExitsWithinMs,
  };
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
  return err.split(/\r?\n/).flatMap((line) =>
    line.startsWith(`worker: ${prefix} `)
      ? [line.slice(`worker: ${prefix} `.length)]
      : []
  );
}

/**
 * Register one test per case, named `<prefix>: <file>`, each run through
 * `runner`; `ignore` skips them all.
 */
export async function conformanceSuite(
  prefix: string,
  runner: () => Promise<ConformanceRunner>,
  ignore = false,
): Promise<void> {
  // The workspace `@zuke/deno` release the `tool_*` cases call: the engine
  // imports it at this exact version, so a case names it through
  // `$ZUKE_DENO_VERSION` rather than pinning a number a release moves.
  const denoVersion = await localVersion("deno");
  const engineVersion = await localVersion("engine");
  // In name order, so the suite runs the same way on every filesystem.
  const names: string[] = [];
  for await (const entry of Deno.readDir(CASES)) {
    if (entry.name.endsWith(".json")) names.push(entry.name);
  }
  for (const name of names.sort()) {
    const raw: unknown = JSON.parse(
      (await Deno.readTextFile(new URL(name, CASES)))
        .replaceAll("$ZUKE_DENO_VERSION", denoVersion)
        // The path as JSON holds it, so a Windows backslash stays escaped.
        .replaceAll("$DENO", JSON.stringify(Deno.execPath()).slice(1, -1)),
    );
    const death = engineDeathOf(raw, name);
    const spec = death === undefined ? caseOf(raw, name) : undefined;
    test({
      name: `${prefix}: ${name}`,
      ignore,
      fn: async () => {
        const run = await runner();
        // Each case runs from its own empty directory: the incremental cache
        // lives under the working directory's `.zuke/`, so a repeat of the
        // cache-key case in the repository would be a cache hit, not a run.
        const dir = await Deno.makeTempDir();
        const previous = Deno.cwd();
        Deno.chdir(dir);
        try {
          await Deno.writeTextFile(
            "zuke.json",
            JSON.stringify({
              sdk: { command: WORKER_COMMAND },
              engine: engineVersion,
            }),
          );
          if (death !== undefined) await replayEngineDeath(death, run);
          if (spec !== undefined) await replay(spec, run);
        } finally {
          Deno.chdir(previous);
          try {
            await Deno.remove(dir, { recursive: true });
          } catch {
            // A Windows lock on a file a process just closed is not a failure.
          }
        }
      },
    });
  }
}

async function replay(spec: Case, runner: ConformanceRunner): Promise<void> {
  await withStateDir(async (dir) => {
    if (spec.list !== undefined) {
      const listed = await runner.run(spec.manifest, ["--list", "--json"]);
      assertEquals(listed.code, 0, listed.err);
      const surface: unknown = JSON.parse(listed.out);
      const actual = isRecord(surface) ? surface : {};
      assertEquals(actual.targets, spec.list.targets);
      assertEquals(actual.parameters, spec.list.parameters);
    }
    await replayRun(spec, undefined, runner);
    // Every later run is a fresh process with a fresh worker, as `resume` is.
    for (const run of spec.then) {
      await replayRun(run, await onlyRunId(dir), runner);
    }
  });
}

async function replayRun(
  run: Run,
  runId: string | undefined,
  runner: ConformanceRunner,
): Promise<void> {
  const argv = run.argv.map((a) => a === "$RUN_ID" ? runId ?? a : a);
  const result = await runner.run(run.manifest, argv);
  assertEquals(result.code, run.code, result.out + result.err);
  assertEquals(logged(result.err, "call:"), run.calls, result.err);
  if (run.answers !== undefined) {
    assertEquals(logged(result.err, "answer:"), run.answers, result.err);
  }
  // A command that never runs the build configures nothing.
  const [configure] = logged(result.err, "configure:");
  const sent: unknown = JSON.parse(configure ?? "{}");
  const { parameters } = isRecord(sent) ? sent : {};
  assertEquals(configure === undefined ? {} : { parameters }, run.configure);
  for (const file of run.files) {
    assertEquals((await Deno.stat(file)).isFile, true, file);
  }
}

/**
 * Read `reader` until what was read holds `marker`, or to its end when none is
 * given: whether the marker was seen, and the text read.
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<string>,
  marker?: string,
): Promise<{ seen: boolean; text: string }> {
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return { seen: false, text };
    text += value;
    if (marker !== undefined && text.includes(marker)) {
      return { seen: true, text };
    }
  }
}

/** The OS's listing of process `pid`, empty once it is gone. */
async function processListing(pid: string): Promise<string> {
  const listing = Deno.build.os === "windows"
    ? ["tasklist", "/NH", "/FO", "CSV", "/FI", `PID eq ${pid}`]
    : ["ps", "-p", pid, "-o", "pid=,stat=,args="];
  const [program, ...args] = listing;
  const out = await new Deno.Command(program ?? "ps", { args }).output();
  const text = new TextDecoder().decode(out.stdout).trim();
  // tasklist answers a miss with an INFO line, never with the pid.
  return text.includes(`"${pid}"`) || text.startsWith(pid) ? text : "";
}

/**
 * Start the engine as a process on the fake worker, kill it with SIGKILL once
 * the named call is logged, and require the worker to exit on its own within
 * the bound. Its connection ended with no `run.exit` and no signal, which is
 * all a worker ever sees of an engine that died, and a worker that stays is
 * an orphan every cancelled job would leave behind.
 */
async function replayEngineDeath(
  spec: EngineDeath,
  runner: ConformanceRunner,
): Promise<void> {
  await withStateDir(async () => {
    const exitFile = `${Deno.cwd()}/worker-exit`;
    const startedFile = `${Deno.cwd()}/worker-started`;
    const [program, ...args] = runner.engine;
    const engine = new Deno.Command(program ?? Deno.execPath(), {
      args: [...args, ...spec.argv],
      env: {
        ...runner.engineEnv,
        ZUKE_FAKE_PLAN: JSON.stringify(spec.manifest),
        ZUKE_FAKE_EXIT_FILE: exitFile,
        ZUKE_FAKE_STARTED_FILE: startedFile,
      },
      stdin: "null",
      stdout: "null",
      stderr: "piped",
    }).spawn();
    const log = engine.stderr.pipeThrough(new TextDecoderStream()).getReader();
    const marker = `worker: call: ${spec.after}`;
    const { seen, text } = await readUntil(log, marker);
    if (!seen) {
      // The log ended, so the engine did: its last words say why.
      const status = await engine.status;
      throw new Error(
        `the engine exited with code ${status.code} before logging ` +
          `"${marker}":\n${text}`,
      );
    }
    engine.kill("SIGKILL");
    await engine.status;
    await readUntil(log);
    // The property is that no worker outlives a dead engine, so the worker's
    // process is what is watched. On Linux and macOS the worker sees its
    // connection end and exits on its own, and the exit file says so; on
    // Windows a child ends with the process that spawned it, so the worker is
    // taken down before it can run its own exit.
    const pid = (await Deno.readTextFile(startedFile).catch(() => "")).trim();
    assertEquals(pid === "", false, "the worker never recorded its start");
    const deadline = Date.now() + spec.workerExitsWithinMs;
    let listed = await processListing(pid);
    while (listed !== "" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      listed = await processListing(pid);
    }
    if (listed !== "") {
      const stage = await Deno.readTextFile(exitFile).catch(() => "(no file)");
      throw new Error(
        `the worker was still there ${spec.workerExitsWithinMs}ms after the ` +
          `engine's death; its last stage: ${stage}; listed as: ${listed}`,
      );
    }
  });
}
