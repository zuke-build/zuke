/**
 * End-to-end: a `killAfter` timeout must reap a child that ignores `SIGTERM`.
 * The {@link file://./fixtures/kill_after_build.ts} fixture runs, in a real
 * process, a real child that swallows `SIGTERM` and sleeps for a minute. Only a
 * `SIGTERM` → grace → `SIGKILL` escalation ends that, so the build has to fail
 * with a timeout in seconds rather than hang for the child's full sleep. Signal
 * delivery to a live OS process is exactly what an in-process test cannot prove.
 * Excluded from the fast unit gate; run by the `integration` target on the OS
 * matrix.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";

const FIXTURE = new URL("./fixtures/kill_after_build.ts", import.meta.url);

/** The child sleeps 60s; anything under this bound proves it was killed. */
const MAX_MS = 30_000;

Deno.test("a killAfter timeout escalates to SIGKILL and does not hang", async () => {
  const started = performance.now();
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", FIXTURE.href, "timeout"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const elapsed = performance.now() - started;
  const decoder = new TextDecoder();
  const output = decoder.decode(stdout) + decoder.decode(stderr);

  // The child really started (so the timeout raced a live process)…
  assertEquals(
    output.includes("CHILD_UP"),
    true,
    `child never started:\n${output}`,
  );
  // …the build failed with the timeout, not with something else…
  assertEquals(code, 1, `expected a failing build, got ${code}:\n${output}`);
  assertEquals(
    output.includes("timed out after 200ms"),
    true,
    `expected a CommandTimeoutError:\n${output}`,
  );
  // …and it did not wait out the child's own sleep.
  assertEquals(elapsed < MAX_MS, true, `took ${Math.round(elapsed)}ms`);
});
