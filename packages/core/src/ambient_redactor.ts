/**
 * The ambient {@link Redactor} for command lines.
 *
 * The executor seeds a redactor with every `secret` parameter's resolved value
 * and runs the plan inside {@link withAmbientRedactor} (see `./executor.ts`).
 * {@link "./shell.ts".Command.commandLine} then masks those values, so the
 * diagnostic form of a command — the dry-run echo, a `CommandError` message, a
 * {@link "./shell.ts".SpawnedProcess}'s recorded line — can never carry a secret
 * that a target passed as an argv token. The argv handed to the operating system
 * is untouched: masking happens only where the line is rendered for a human.
 *
 * This is belt-and-braces with the redacting {@link "./reporter.ts".Reporter}:
 * that one masks everything Zuke prints, while this one keeps the secret out of
 * the string in the first place — including a line a target body prints itself,
 * which never passes through the reporter at all.
 *
 * Like the ambient signal, it lives in an `AsyncLocalStorage`, so it is scoped to
 * the run's async subtree: concurrent runs do not see each other's, and nothing
 * is left behind when a run ends. Internal (not a published entrypoint).
 *
 * @module
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Redactor } from "./redact.ts";

/** Per-async-context store holding the current run's redactor. */
const storage = new AsyncLocalStorage<Redactor>();

/** The redactor in effect, read when a command line is rendered. */
export function ambientRedactor(): Redactor | undefined {
  return storage.getStore();
}

/**
 * Run `fn` with `redactor` installed as the ambient redactor for its entire
 * async subtree, returning `fn`'s result. Confined to this call — not visible to
 * concurrent runs, and needs no manual teardown.
 */
export function withAmbientRedactor<T>(
  redactor: Redactor,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(redactor, fn);
}

/** Mask every registered secret in `line`, or return it unchanged if none. */
export function redactLine(line: string): string {
  const redactor = ambientRedactor();
  return redactor === undefined ? line : redactor.redact(line);
}
