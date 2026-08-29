// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link KubectlSettings} — the base every `kubectl` subcommand's settings
 * extend: the binary, and the cluster-targeting flags (`--namespace`,
 * `--context`, `--kubeconfig`) every subcommand accepts.
 *
 * It lives apart from the module that assembles `KubectlTasks` so a subcommand
 * in its own file can extend it without importing that module, which imports
 * the subcommands back.
 *
 * @module
 */

import { type PathLike, ToolSettings } from "@zuke/core/tooling";

/**
 * Base for all `kubectl` subcommand settings: the binary is `kubectl`, and the
 * cluster-targeting flags (`--namespace`, `--context`, `--kubeconfig`) are
 * shared by every subcommand.
 */
export abstract class KubectlSettings extends ToolSettings {
  #namespace?: string;
  #context?: string;
  #kubeconfig?: string;

  /** The tool binary invoked by every subcommand: `kubectl`. */
  protected override defaultTool(): string {
    return "kubectl";
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

/** The `--dry-run` strategies kubectl accepts. */
export type DryRunMode = "none" | "client" | "server";
