/**
 * The ambient **echo sink** for `$` commands under a deep dry run.
 *
 * When the executor runs a `.dryRunnable()` target's body under `--dry-run`, it
 * installs an echo sink via {@link withAmbientEcho}; every
 * `$`/{@link "./shell.ts".Command} then reports its resolved argv to the sink
 * and returns an empty success **without spawning a process**. Like the ambient
 * cancellation signal, the sink lives in an `AsyncLocalStorage`, so it is scoped
 * to the body's async subtree — concurrent runs don't see each other's, and
 * nothing is left behind when the body returns. Internal (not a published
 * entrypoint).
 *
 * @module
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Receives the resolved command line of each `$` invocation under a deep dry run. */
export type EchoSink = (commandLine: string) => void;

/** Per-async-context store holding the current deep-dry-run echo sink, if any. */
const storage = new AsyncLocalStorage<EchoSink>();

/** The echo sink in effect, read by {@link "./shell.ts".Command} before it spawns. */
export function ambientEcho(): EchoSink | undefined {
  return storage.getStore();
}

/**
 * Run `fn` with `sink` installed as the ambient echo sink for its entire async
 * subtree, returning `fn`'s result. Confined to this call — not visible to
 * concurrent runs, and needs no manual teardown.
 */
export function withAmbientEcho<T>(
  sink: EchoSink,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(sink, fn);
}
