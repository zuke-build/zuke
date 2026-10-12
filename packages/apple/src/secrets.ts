// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Keeping passwords out of the errors a credential-bearing command raises.
 *
 * `security` takes keychain and certificate passwords, and `notarytool` an
 * app-specific password, only as argv tokens. The wrappers register each one
 * with the run's redactor (`markSecret`), which masks every rendering of the
 * command inside a run. Outside a run — a wrapper used from a plain script —
 * there is no redactor, so a failure would otherwise put the password into the
 * `CommandError` message verbatim. {@link runMasked} closes that gap by masking
 * the values itself, with core's own {@link Redactor}, on every error a run can
 * raise that carries the command line.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { Redactor } from "@zuke/core";
import {
  CommandError,
  type CommandOutput,
  CommandTimeoutError,
} from "@zuke/core/shell";

/** `text` with every one of `secrets` replaced by core's redaction marker. */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  const redactor = new Redactor();
  for (const secret of secrets) redactor.add(secret);
  return redactor.redact(text);
}

/**
 * Run `run`, rethrowing a {@link CommandError} or {@link CommandTimeoutError}
 * with `secrets` masked out of its command line and captured stderr. Any other
 * error — a `ToolNotFoundError`, which names only the binary — passes through.
 */
export async function runMasked(
  run: () => Promise<CommandOutput>,
  secrets: readonly string[],
): Promise<CommandOutput> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CommandError) {
      throw new CommandError(
        maskSecrets(error.command, secrets),
        error.code,
        maskSecrets(error.stderr, secrets),
      );
    }
    if (error instanceof CommandTimeoutError) {
      throw new CommandTimeoutError(
        maskSecrets(error.command, secrets),
        error.timeoutMs,
      );
    }
    throw error;
  }
}
