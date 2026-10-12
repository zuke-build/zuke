// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The bases every `choco` invocation's settings extend.
 *
 * {@link ChocoSettings} is the binary and the command builder inherited from
 * `SubcommandSettings` — what `ChocoTasks.run` configures for anything not yet
 * modelled. {@link ChocoCommandSettings} is the shape the typed commands
 * share: the command, its operands, its own options, then the switches choco
 * accepts on every command (`--yes`, `--force`, `--no-progress`,
 * `--limit-output`, `--verbose`).
 *
 * They live apart from the module that assembles `ChocoTasks` so each typed
 * command can extend them without importing that module back.
 *
 * @module
 */

import { SubcommandSettings, type ToolResolution } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { runMasked } from "./mask.ts";

/** Settings for a `choco` invocation. */
export class ChocoSettings extends SubcommandSettings {
  /** The default executable name (`choco`). */
  protected override defaultTool(): string {
    return "choco";
  }

  /**
   * Resolve `choco` from `PATH` — Chocolatey is a native install under
   * `%ChocolateyInstall%`, never a `node_modules` package.
   */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }
}

/**
 * An operand choco would read as a switch: anything starting with `-`, and a
 * `/name` with no further path separator — choco's option parser accepts the
 * Windows `/y` spelling too. A path such as `/tmp/x.nupkg` is still accepted.
 */
const SWITCH_LIKE = /^(-|\/[^/\\]*$)/;

/**
 * Base for a typed `choco` command: the command, then its operands, then its
 * own options, then the common switches — the order choco's own usage lines
 * print (`choco install <pkg> [<options/switches>]`). Anything added through
 * the inherited `.command(...)`/`.flag(...)` escape hatches follows.
 *
 * Valued options render as one `--name=value` token, the spelling choco's
 * help prints, so a value that starts with `-` stays the option's value
 * rather than becoming a switch of its own.
 *
 * Operands are refused when choco would read them as a switch: a package id
 * or file path never starts with `-`, and passing `--force` as a "package"
 * would change what the command does rather than fail.
 */
export abstract class ChocoCommandSettings extends ChocoSettings {
  readonly #operands: string[] = [];
  readonly #secrets: string[] = [];
  #yes = false;
  #force = false;
  #noProgress = false;
  #limitOutput = false;
  #verbose = false;

  /** The command, e.g. `["install"]` or `["apikey", "add"]`. */
  protected abstract verb(): string[];

  /** This command's own options. */
  protected abstract commandFlags(): string[];

  /** Answer yes to every prompt (`--yes`), which also accepts licenses. */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /**
   * Force the behaviour (`--force`) — reinstall an installed package, say.
   * Choco warns against it in normal operation.
   */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Do not print download progress percentages (`--no-progress`). */
  noProgress(): this {
    this.#noProgress = true;
    return this;
  }

  /** Print only the essential information (`--limit-output`). */
  limitOutput(): this {
    this.#limitOutput = true;
    return this;
  }

  /** Print verbose messages (`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** Append operands — package ids or file paths — in order. */
  protected addOperands(values: readonly string[]): void {
    this.#operands.push(...values);
  }

  /** The operands added so far. */
  protected get operands(): readonly string[] {
    return this.#operands;
  }

  /**
   * Record `value` as a credential this command carries on its command line:
   * registered with the run's redactor, and masked out of any error the
   * command raises — inside a run or outside one.
   */
  protected secret(value: string): void {
    this.#secrets.push(value);
    this.markSecret(value);
  }

  /** The command, its operands, its options, then the common switches. */
  protected override leadingTokens(): string[] {
    const verb = this.verb().join(" ");
    for (const operand of this.#operands) {
      if (operand === "" || SWITCH_LIKE.test(operand)) {
        throw new Error(
          `choco ${verb}: refusing the operand ${JSON.stringify(operand)} — ` +
            `an empty operand, or one choco would read as a switch ("-x", ` +
            `"/x"), is not a package or a path.`,
        );
      }
    }
    const common: string[] = [];
    if (this.#yes) common.push("--yes");
    if (this.#force) common.push("--force");
    if (this.#noProgress) common.push("--no-progress");
    if (this.#limitOutput) common.push("--limit-output");
    if (this.#verbose) common.push("--verbose");
    return [
      ...this.verb(),
      ...this.#operands,
      ...this.commandFlags(),
      ...common,
    ];
  }

  /**
   * Run the command, masking every value passed to {@link secret} out of any
   * `CommandError` or `CommandTimeoutError` it raises.
   */
  override run(): Promise<CommandOutput> {
    return runMasked(() => super.run(), this.#secrets);
  }
}

/** Push `--name=value` onto `argv` when `value` is set. */
export function optionIf(
  argv: string[],
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined) argv.push(`--${name}=${value}`);
}
