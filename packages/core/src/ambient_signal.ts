/**
 * The ambient {@link AbortSignal} for `$` commands.
 *
 * The executor runs each build's plan inside {@link withAmbientSignal} (see
 * `./executor.ts`); every `$`/{@link "./shell.ts".Command} started without an
 * explicit `.signal()` picks the run's signal up at spawn time, so a target
 * body's shell commands are terminated when the run is cancelled without the
 * body having to thread the signal through by hand.
 *
 * The signal lives in an `AsyncLocalStorage`, so it is scoped to the run's
 * async context rather than a process global: concurrent in-process runs each
 * see their own signal, and nothing is left behind when a run ends — even if it
 * throws. This is internal (not part of any published entrypoint).
 *
 * @module
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Per-async-context store holding the current run's cancellation signal. */
const storage = new AsyncLocalStorage<AbortSignal>();

/** The ambient signal in effect, read by {@link "./shell.ts".Command} at spawn time. */
export function ambientSignal(): AbortSignal | undefined {
  return storage.getStore();
}

/**
 * Run `fn` with `signal` installed as the ambient signal for its entire async
 * subtree, returning `fn`'s result. The binding is confined to this call — it
 * is not visible to concurrent runs and needs no manual teardown.
 */
export function withAmbientSignal<T>(
  signal: AbortSignal,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(signal, fn);
}
