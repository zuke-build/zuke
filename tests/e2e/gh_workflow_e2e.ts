/**
 * End-to-end: a `githubWorkflow(...)` wait across two real processes. Process A
 * reaches the gate, dispatches (recording the marker to a file), and suspends;
 * process B runs `resume --check`, sees the (env-driven) workflow completed, and
 * ships — reading the gate's published per-job result. It proves the durable
 * {@link "@zuke/core".WaitContext} correlation state survives the process
 * boundary: process B never re-dispatches, because the `dispatched` flag persists
 * in the run record. Uses a file-backed fake GitHub API — hermetic, no network.
 *
 * Excluded from the fast unit gate (`*_e2e.ts`); run by the `integration` target.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../../packages/core/mod.ts";

const FIXTURE = new URL("./fixtures/gh_workflow_build.ts", import.meta.url);

/** The captured result of one fixture subprocess. */
interface Run {
  code: number;
  out: string;
}

/** Run the fixture as a real `deno` subprocess with the given extra env. */
async function runFixture(
  args: string[],
  dir: string,
  env: Record<string, string>,
): Promise<Run> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", FIXTURE.href, ...args],
    env: { ZUKE_STATE_DIR: dir, ...env },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout } = await command.output();
  return { code, out: new TextDecoder().decode(stdout) };
}

/** The number of non-empty lines in the dispatch file (i.e. dispatch count). */
async function dispatchCount(file: string): Promise<number> {
  const text = await Deno.readTextFile(file);
  return text.split("\n").filter((l) => l !== "").length;
}

Deno.test("a githubWorkflow wait dispatches once and resumes across processes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-gh-workflow-e2e-" });
  const dispatchFile = `${dir}/dispatches.txt`;
  await Deno.writeTextFile(dispatchFile, "");
  try {
    // Process A: reach the gate, dispatch, suspend (the workflow is not done).
    const first = await runFixture(["ship"], dir, {
      GH_DISPATCH_FILE: dispatchFile,
      GH_RUN_STATUS: "in_progress",
    });
    assertEquals(first.code, 0);
    assertEquals(first.out.includes("SHIPPED"), false);
    assertEquals(await dispatchCount(dispatchFile), 1);

    const store = new FileSystemStateStore(dir, defaultStateHost);
    const runs = await store.listRuns({});
    assertEquals(runs.length, 1);
    const id = runs[0].id;
    assertEquals(runs[0].status, "suspended");

    // Process B: the workflow has completed; resume --check re-evaluates.
    const second = await runFixture(["resume", id, "--check"], dir, {
      GH_DISPATCH_FILE: dispatchFile,
      GH_RUN_STATUS: "completed",
      GH_RUN_CONCLUSION: "success",
    });
    assertEquals(second.code, 0);
    assertStringIncludes(second.out, "SHIPPED:passed=true:conclusion=success");

    // The dispatched flag persisted across processes: B did NOT re-dispatch.
    assertEquals(await dispatchCount(dispatchFile), 1);
    assertEquals(
      await store.getRun(id).then((g) => g?.record.status),
      "succeeded",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
