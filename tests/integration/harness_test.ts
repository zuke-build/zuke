/**
 * Regression tests for the integration harness itself: its throwaway temp-dir
 * cleanup must never mask the failure a test actually cares about. A `finally`
 * that lets `Deno.remove` throw would replace the real assertion error with a
 * removal error (e.g. a Windows file lock), so the cleanup is best-effort.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { withStateDir } from "./_harness.ts";

Deno.test("withStateDir surfaces the body error even when cleanup fails", async () => {
  const marker = new Error("body failure");
  let caught: unknown;
  try {
    await withStateDir(async (dir) => {
      // Delete the dir out from under the finally so its Deno.remove throws
      // (NotFound) — proving the removal error is swallowed, not the body's.
      await Deno.remove(dir, { recursive: true });
      throw marker;
    });
  } catch (error) {
    caught = error;
  }
  assertEquals(caught, marker);
});

Deno.test("withStateDir resolves when cleanup fails after a successful body", async () => {
  // The body succeeds but removes the dir itself, so the finally's own
  // Deno.remove throws NotFound. On the old (unwrapped) code that rejected
  // withStateDir even though nothing meaningful failed; the best-effort catch
  // means a clean body now resolves — this is the behaviour the PR adds, and
  // this call throwing would fail the test on a revert.
  const prev = Deno.env.get("ZUKE_STATE_DIR");
  await withStateDir(async (dir) => {
    await Deno.remove(dir, { recursive: true });
  });
  // The env var is still restored on the success-with-failed-cleanup path.
  assertEquals(Deno.env.get("ZUKE_STATE_DIR"), prev);
});
