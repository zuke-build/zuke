// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The base every `security` subcommand's settings extend.
 *
 * `security` takes keychain and certificate passwords only as argv tokens —
 * there is no stdin form to use instead. So a password set through any of
 * these settings is handled as a secret twice over: it is registered with the
 * run's redactor, which masks it in every rendering of the command (the
 * dry-run echo, the reporter, a `CommandError` message) inside a run, and it is
 * masked out of the errors the run raises by the settings class itself, so a
 * wrapper used outside a run does not leak it either. What neither can mask is
 * the process table: while the command runs its argv is visible to other users
 * of the host, which is the reason `SecurityTasks.temporaryKeychain` generates
 * a throwaway keychain password rather than reusing one.
 *
 * @module
 */

import { type ToolResolution, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { runMasked } from "./secrets.ts";

/**
 * The shared settings of every `security` subcommand: the binary, and the
 * secret handling for the passwords a subcommand takes. A subclass names its
 * subcommand and builds its own arguments.
 */
export abstract class SecuritySettings extends ToolSettings {
  readonly #secrets: string[] = [];

  /** The default executable name (`security`). */
  protected override defaultTool(): string {
    return "security";
  }

  /** Resolve from `PATH` — `security` ships with macOS in `/usr/bin`. */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }

  /** The `security` subcommand, e.g. `create-keychain`. */
  protected abstract subcommand(): string;

  /** The subcommand's own arguments. */
  protected abstract subcommandArgs(): string[];

  /**
   * Record `value` as a password: registered with the run's redactor and
   * masked out of any error this command raises. Returns it, so a setter can
   * store it in the same line.
   */
  protected secret(value: string): string {
    this.#secrets.push(value);
    this.markSecret(value);
    return value;
  }

  /**
   * Run the command, with every password masked out of any `CommandError` or
   * timeout it raises — inside a run and outside one.
   */
  override run(): Promise<CommandOutput> {
    return runMasked(() => super.run(), this.#secrets);
  }

  /** Assemble `<subcommand> <args>`. */
  protected override buildArgs(): string[] {
    return [this.subcommand(), ...this.subcommandArgs()];
  }
}
