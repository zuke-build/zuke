/**
 * Shared harness for the in-process integration suite. Drives a real build
 * through the CLI `main()` entry point — the same path the `zuke` command uses
 * — capturing its console output and, when needed, giving it an isolated,
 * temporary state directory. `main` returns an exit code rather than calling
 * `Deno.exit`, so a whole build runs end-to-end inside one test.
 *
 * @module
 */

import { main, type MainOptions } from "../../packages/core/src/cli.ts";
import type { Build } from "../../packages/core/mod.ts";

/** The captured result of one {@link runCli} invocation. */
export interface CliResult {
  /** The exit code `main` resolved to (0 success, 1 failure). */
  code: number;
  /** Lines written to `console.log`, joined by newlines. */
  out: string;
  /** Lines written to `console.error`, joined by newlines. */
  err: string;
}

/**
 * Run `BuildClass` through the real CLI `main()` with `args`, capturing
 * `console.log`/`console.error` instead of printing them. Does not manage the
 * state directory: wrap the call in {@link withStateDir} for builds that use
 * `waitsFor()`/`lock()` so their run records land in a temp dir, not the repo.
 */
export async function runCli(
  BuildClass: new () => Build,
  args: string[],
  options: MainOptions = {},
): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  // Guard the async-safety fixes: a promise rejection that escapes the run
  // (e.g. a scheduler path that dropped its `.catch`) must fail the test
  // explicitly, not merely rely on the Deno runner's default handling — which
  // this pins even if that default changes. We take ownership of the event
  // (preventDefault) so the check below is authoritative; a rejection firing
  // after this call (listener already removed) still falls back to the runner.
  const rejections: unknown[] = [];
  const onRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    rejections.push(event.reason);
  };
  addEventListener("unhandledrejection", onRejection);
  try {
    const code = await main(BuildClass, args, options);
    // A macrotask boundary so any queued unhandledrejection event has dispatched
    // before we inspect — it fires at a microtask checkpoint, which setTimeout(0)
    // is guaranteed to follow.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (rejections.length > 0) {
      const reasons = rejections
        .map((r) => (r instanceof Error ? r.message : String(r)))
        .join("; ");
      throw new Error(`unhandled promise rejection during runCli: ${reasons}`);
    }
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    removeEventListener("unhandledrejection", onRejection);
    console.log = origLog;
    console.error = origErr;
  }
}

/**
 * Run `fn` with a fresh temporary `ZUKE_STATE_DIR` so durable-state features
 * (`waitsFor()`, `lock()`, run records) persist to a throwaway directory shared
 * across every {@link runCli} call inside `fn` — the seam that lets one test
 * suspend a run and a later call resume it. Restores the previous env var and
 * removes the directory afterwards, even on failure.
 */
export async function withStateDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-" });
  const prev = Deno.env.get("ZUKE_STATE_DIR");
  Deno.env.set("ZUKE_STATE_DIR", dir);
  try {
    await fn(dir);
  } finally {
    if (prev === undefined) Deno.env.delete("ZUKE_STATE_DIR");
    else Deno.env.set("ZUKE_STATE_DIR", prev);
    // Best-effort cleanup: a removal error (e.g. a Windows file lock) must never
    // replace the test's own assertion failure, which is the error worth seeing.
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // ignore — the temp dir is throwaway; masking the real error is worse.
    }
  }
}
