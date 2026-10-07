// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A fake {@link AwsSettingsRunner} for the tests: it records the argv of
 * every command it is handed and answers each with the next queued output,
 * so no test ever spawns `aws`.
 *
 * @module
 */

import { CommandOutput } from "@zuke/core/shell";
import type { AwsSettings, AwsSettingsRunner } from "../mod.ts";

/** A runner that answers from a queue and records what it ran. */
export class FakeAws {
  /** The argv of every command run, binary first. */
  readonly calls: string[][] = [];
  readonly #answers: Array<CommandOutput | ((argv: string[]) => CommandOutput)>;

  /** A fake answering, in order, with `answers`; stdout strings mean exit 0. */
  constructor(
    ...answers: Array<
      string | CommandOutput | ((argv: string[]) => CommandOutput)
    >
  ) {
    this.#answers = answers.map((answer) =>
      typeof answer === "string" ? new CommandOutput(0, answer, "") : answer
    );
  }

  /** The runner to hand to `.runner(...)`. */
  readonly run: AwsSettingsRunner = (settings: AwsSettings) => {
    const argv = settings.argv();
    this.calls.push(argv);
    const next = this.#answers.length > 1
      ? this.#answers.shift()
      : this.#answers[0];
    if (next === undefined) {
      return Promise.reject(new Error(`FakeAws: no answer for ${argv}`));
    }
    return Promise.resolve(typeof next === "function" ? next(argv) : next);
  };

  /**
   * The value of `flag` in call `index`, whether it was sent as one
   * `--flag=value` token or as `--flag value`.
   */
  flag(index: number, flag: string): string | undefined {
    const argv = this.calls[index];
    const joined = argv.find((token) => token.startsWith(`${flag}=`));
    if (joined !== undefined) return joined.slice(flag.length + 1);
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  }
}

/** JSON text, as the CLI prints it. */
export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 4)}\n`;
}

/**
 * Run `fn` with `PATH` pointing at an empty directory, so a task called
 * without a lambda — which spawns the bare `aws` — reaches execution and
 * finds nothing, rather than a real CLI that may be installed on the host.
 */
export async function withEmptyPath(fn: () => Promise<void>): Promise<void> {
  const previous = Deno.env.get("PATH");
  const empty = await Deno.makeTempDir();
  Deno.env.set("PATH", empty);
  try {
    await fn();
  } finally {
    if (previous === undefined) Deno.env.delete("PATH");
    else Deno.env.set("PATH", previous);
    await Deno.remove(empty);
  }
}
