// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The control flags every command that can stop mid-way shares: `--continue`,
 * `--abort`, `--skip`, `--quit`.
 *
 * `merge`, `rebase`, `cherry-pick`, and `revert` all leave the repository in
 * an in-progress state when they hit a conflict, and all four resume, unwind,
 * or drop it with the same four flags. {@link GitSequencerSettings} holds that
 * one implementation, so the check that refuses a control flag alongside the
 * command's ordinary arguments cannot drift between them.
 *
 * @module
 */

import { GitSettings } from "./settings.ts";

/** What to do with an operation git left in progress. */
export type SequencerAction = "continue" | "abort" | "skip" | "quit";

/**
 * Base for the commands that can be left in progress by a conflict. Subclasses
 * expose only the actions their command accepts — `merge` has no `--skip` —
 * and call {@link GitSequencerSettings.sequencer_} to record one.
 */
export abstract class GitSequencerSettings extends GitSettings {
  #action?: SequencerAction;

  /** Resume the operation once the conflict is resolved (`--continue`). */
  continue(): this {
    return this.sequencer_("continue");
  }

  /** Undo it and restore the pre-operation state (`--abort`). */
  abort(): this {
    return this.sequencer_("abort");
  }

  /** Forget the operation, leaving the tree as it is (`--quit`). */
  quit(): this {
    return this.sequencer_("quit");
  }

  /**
   * Record a control action. Subclasses use it to offer the ones their command
   * accepts — `skip` exists only on `rebase`, `cherry-pick`, and `revert`.
   */
  protected sequencer_(action: SequencerAction): this {
    this.#action = action;
    return this;
  }

  /** The chosen control flag, or an empty argv when the command is a fresh one. */
  protected sequencerArgs(): string[] {
    return this.#action === undefined ? [] : [`--${this.#action}`];
  }

  /**
   * Whether a control action was chosen. Every other flag and positional is
   * then invalid: git takes `--continue` and friends alone.
   */
  protected get controlling(): boolean {
    return this.#action !== undefined;
  }

  /**
   * The argv for a control action, given everything else the lambda set.
   * `options` is what the command would have run without one; a control flag
   * takes none of it, so anything there is refused by name rather than
   * silently dropped — which is the failure git itself reports as a bare
   * usage dump.
   */
  protected controlArgs_(
    task: string,
    command: string,
    options: string[],
  ): string[] {
    const offending = options[0];
    if (offending !== undefined) {
      throw new Error(
        `GitTasks.${task}: .continue()/.abort()/.skip()/.quit() resume or ` +
          `drop an operation already in progress, so \`${offending}\` has no ` +
          `meaning alongside them — drop one.`,
      );
    }
    return [command, ...this.sequencerArgs()];
  }
}
