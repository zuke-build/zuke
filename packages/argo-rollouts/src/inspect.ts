// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Argo Rollouts subcommands that read state without changing it:
 * `get rollout`, `get experiment`, `list rollouts`, `list experiments`, and
 * `version`.
 *
 * @module
 */

import {
  ArgoRolloutsSettings,
  requireInteger,
  requireName,
} from "./settings.ts";

/** Settings for `get rollout` — show a rollout's steps, replica sets and analysis. */
export class ArgoRolloutsGetRolloutSettings extends ArgoRolloutsSettings {
  #name?: string;
  #watch = false;
  #noColor = false;
  #timeoutSeconds?: number;

  /** The rollout to show (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Keep printing live updates (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Print without colour (`--no-color`). */
  noColor(): this {
    this.#noColor = true;
    return this;
  }

  /** With {@link watch}, give up after this many seconds (`--timeout-seconds`). */
  timeoutSeconds(seconds: number): this {
    this.#timeoutSeconds = seconds;
    return this;
  }

  /** Assemble the `get rollout <rollout>` argv. */
  protected override buildArgs(): string[] {
    const argv = [
      "get",
      "rollout",
      requireName(this.#name, "getRollout"),
      ...this.globalArgs(),
    ];
    if (this.#watch) argv.push("--watch");
    if (this.#noColor) argv.push("--no-color");
    if (this.#timeoutSeconds !== undefined) {
      const seconds = requireInteger(
        this.#timeoutSeconds,
        "--timeout-seconds",
        "getRollout",
      );
      argv.push(`--timeout-seconds=${seconds}`);
    }
    return argv;
  }
}

/** Settings for `get experiment` — show an experiment's templates and analysis. */
export class ArgoRolloutsGetExperimentSettings extends ArgoRolloutsSettings {
  #name?: string;
  #watch = false;
  #noColor = false;

  /** The experiment to show (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Keep printing live updates (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Print without colour (`--no-color`). */
  noColor(): this {
    this.#noColor = true;
    return this;
  }

  /** Assemble the `get experiment <experiment>` argv. */
  protected override buildArgs(): string[] {
    const argv = [
      "get",
      "experiment",
      requireName(this.#name, "getExperiment"),
      ...this.globalArgs(),
    ];
    if (this.#watch) argv.push("--watch");
    if (this.#noColor) argv.push("--no-color");
    return argv;
  }
}

/** Settings for `list rollouts`. */
export class ArgoRolloutsListRolloutsSettings extends ArgoRolloutsSettings {
  #allNamespaces = false;
  #name?: string;
  #timestamps = false;
  #watch = false;

  /** List across every namespace (`--all-namespaces`). */
  allNamespaces(): this {
    this.#allNamespaces = true;
    return this;
  }

  /** Only show the rollout with this name (`--name`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** With {@link watch}, print a timestamp on each update (`--timestamps`). */
  timestamps(): this {
    this.#timestamps = true;
    return this;
  }

  /** Keep printing changes (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Assemble the `list rollouts` argv. */
  protected override buildArgs(): string[] {
    const argv = ["list", "rollouts", ...this.globalArgs()];
    if (this.#allNamespaces) argv.push("--all-namespaces");
    if (this.#name !== undefined) argv.push("--name", this.#name);
    if (this.#timestamps) argv.push("--timestamps");
    if (this.#watch) argv.push("--watch");
    return argv;
  }
}

/**
 * Settings for `list experiments`. Unlike `list rollouts` it has no watch or
 * name filter: the plugin registers only `--all-namespaces` for it, whatever
 * its help text's examples suggest.
 */
export class ArgoRolloutsListExperimentsSettings extends ArgoRolloutsSettings {
  #allNamespaces = false;

  /** List across every namespace (`--all-namespaces`). */
  allNamespaces(): this {
    this.#allNamespaces = true;
    return this;
  }

  /** Assemble the `list experiments` argv. */
  protected override buildArgs(): string[] {
    const argv = ["list", "experiments", ...this.globalArgs()];
    if (this.#allNamespaces) argv.push("--all-namespaces");
    return argv;
  }
}

/** Settings for `version`. */
export class ArgoRolloutsVersionSettings extends ArgoRolloutsSettings {
  #short = false;

  /** Print only the plugin's version number (`--short`). */
  short(): this {
    this.#short = true;
    return this;
  }

  /** Assemble the `version` argv. */
  protected override buildArgs(): string[] {
    const argv = ["version", ...this.globalArgs()];
    if (this.#short) argv.push("--short");
    return argv;
  }
}
