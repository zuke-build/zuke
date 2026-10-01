// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link ArgoRolloutsSettings} — the base every Argo Rollouts subcommand's
 * settings extend: the binary, and the cluster-targeting flags every
 * subcommand accepts — plus {@link ArgoRolloutsNamedSettings}, the one shape
 * shared by the subcommands that take nothing but a resource name.
 *
 * @module
 */

import { type PathLike, ToolSettings } from "@zuke/core/tooling";

/**
 * The resource-name operand a subcommand requires, or a friendly error naming
 * the task. Module-internal: shared by every settings file in this package.
 */
export function requireName(name: string | undefined, task: string): string {
  if (name === undefined) {
    throw new Error(`ArgoRolloutsTasks.${task}: .name() is required.`);
  }
  return name;
}

/**
 * An integer flag's value, or a friendly error naming the task: the plugin
 * parses these flags as integers and would reject `1.5` or `NaN` only once it
 * runs. Module-internal, like {@link requireName}.
 */
export function requireInteger(
  value: number,
  flag: string,
  task: string,
): number {
  if (!Number.isInteger(value)) {
    throw new Error(
      `ArgoRolloutsTasks.${task}: ${flag} takes a whole number, got ${value}.`,
    );
  }
  return value;
}

/**
 * Base for all Argo Rollouts subcommand settings. The binary is the plugin
 * itself, `kubectl-argo-rollouts`, which takes the same subcommands as
 * `kubectl argo rollouts`; the cluster-targeting flags (`--namespace`,
 * `--context`, `--kubeconfig`) are shared by every subcommand.
 */
export abstract class ArgoRolloutsSettings extends ToolSettings {
  #namespace?: string;
  #context?: string;
  #kubeconfig?: string;

  /** The plugin binary invoked by every subcommand: `kubectl-argo-rollouts`. */
  protected override defaultTool(): string {
    return "kubectl-argo-rollouts";
  }

  /** Target a namespace (`--namespace`). */
  namespace(name: string): this {
    this.#namespace = name;
    return this;
  }

  /** Use a named kubeconfig context (`--context`). */
  context(name: string): this {
    this.#context = name;
    return this;
  }

  /** Use an explicit kubeconfig file (`--kubeconfig`). */
  kubeconfig(path: PathLike): this {
    this.#kubeconfig = String(path);
    return this;
  }

  /** The cluster-targeting flags shared by every subcommand. */
  protected globalArgs(): string[] {
    const argv: string[] = [];
    if (this.#namespace !== undefined) {
      argv.push("--namespace", this.#namespace);
    }
    if (this.#context !== undefined) argv.push("--context", this.#context);
    if (this.#kubeconfig !== undefined) {
      argv.push("--kubeconfig", this.#kubeconfig);
    }
    return argv;
  }
}

/**
 * Settings for the subcommands whose only operand is a resource name:
 * `abort`, `pause`, `retry rollout`, `retry experiment`, `terminate
 * analysisrun` and `terminate experiment`. They differ only in their leading
 * tokens, so they share one implementation rather than six copies of it.
 */
export class ArgoRolloutsNamedSettings extends ArgoRolloutsSettings {
  readonly #command: readonly string[];
  readonly #task: string;
  #name?: string;

  /**
   * Bind the settings to one subcommand: its leading `command` tokens (e.g.
   * `["retry", "rollout"]`) and the `task` name used in error messages.
   */
  constructor(command: readonly string[], task: string) {
    super();
    this.#command = command;
    this.#task = task;
  }

  /** The rollout, experiment or analysis run to act on (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Assemble the `<command> <name>` argv. */
  protected override buildArgs(): string[] {
    return [
      ...this.#command,
      requireName(this.#name, this.#task),
      ...this.globalArgs(),
    ];
  }
}
