// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The bases every `brew` invocation's settings extend.
 *
 * {@link BrewSettings} is the binary and the command builder inherited from
 * `SubcommandSettings` — what `BrewTasks.run` configures for anything not yet
 * modelled. {@link BrewCommandSettings} is the shape the typed subcommands
 * share: the verb, its flags, then its operands.
 *
 * They live apart from the module that assembles `BrewTasks` so each typed
 * subcommand can extend them without importing that module back.
 *
 * @module
 */

import { SubcommandSettings, type ToolResolution } from "@zuke/core/tooling";

/** Settings for a `brew` invocation. */
export class BrewSettings extends SubcommandSettings {
  /** The default executable name (`brew`). */
  protected override defaultTool(): string {
    return "brew";
  }

  /**
   * Resolve `brew` from `PATH` — Homebrew is a native install under its own
   * prefix, never a `node_modules` package.
   */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }
}

/**
 * Base for a typed `brew` subcommand: the verb, then its own flags, then its
 * operands — the order brew's own usage lines print. Anything added through
 * the inherited `.command(...)`/`.flag(...)` escape hatches follows.
 *
 * Operands are refused when they start with `-`. A formula or tap name never
 * does, and brew would read one that did as an option — so `--force` passed as
 * a "formula" would change what the command does rather than fail.
 */
export abstract class BrewCommandSettings extends BrewSettings {
  readonly #operands: string[] = [];

  /** The subcommand, e.g. `install`. */
  protected abstract verb(): string;

  /** This subcommand's own flags. */
  protected abstract commandFlags(): string[];

  /** Append operands — formula, tap or file names — in order. */
  protected addOperands(values: readonly string[]): void {
    this.#operands.push(...values);
  }

  /** The operands added so far. */
  protected get operands(): readonly string[] {
    return this.#operands;
  }

  /** The verb, the flags and the operands lead the argv. */
  protected override leadingTokens(): string[] {
    for (const operand of this.#operands) {
      if (operand === "" || operand.startsWith("-")) {
        throw new Error(
          `brew ${this.verb()}: refusing the operand ` +
            `${JSON.stringify(operand)} — a name that is empty or starts ` +
            `with "-" would be read as an option, not a name.`,
        );
      }
    }
    return [this.verb(), ...this.commandFlags(), ...this.#operands];
  }
}
