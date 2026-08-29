// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `kubectl` commands a build reads to find out what the cluster is doing:
 * `wait` and `top`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { KubectlSettings } from "./settings.ts";

/** Settings for `kubectl wait`. */
export class KubectlWaitSettings extends KubectlSettings {
  #files: string[] = [];
  #resources: string[] = [];
  #forCondition?: string;
  #timeout?: string;
  #selector?: string;
  #all = false;

  /** Wait on resources defined in a file (`-f`); repeatable. */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** Resource tokens, e.g. `("pod/web")` or `("pods")`; repeatable. */
  resource(...tokens: string[]): this {
    this.#resources.push(...tokens);
    return this;
  }

  /** The condition to wait for, e.g. `condition=Available` or `delete`. */
  forCondition(condition: string): this {
    this.#forCondition = condition;
    return this;
  }

  /** How long to wait, e.g. `60s` (`--timeout`). */
  timeout(duration: string): this {
    this.#timeout = duration;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Wait on all resources of the given type (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Assemble the `kubectl wait` argv. */
  protected override buildArgs(): string[] {
    if (this.#files.length === 0 && this.#resources.length === 0) {
      throw new Error("KubectlTasks.wait: specify .file() or .resource(...).");
    }
    if (this.#forCondition === undefined) {
      throw new Error("KubectlTasks.wait: .forCondition() is required.");
    }
    const argv = ["wait", ...this.globalArgs()];
    for (const f of this.#files) argv.push("-f", f);
    argv.push(...this.#resources);
    argv.push(`--for=${this.#forCondition}`);
    if (this.#timeout !== undefined) argv.push(`--timeout=${this.#timeout}`);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#all) argv.push("--all");
    return argv;
  }
}

/** Settings for `kubectl top`. */
export class KubectlTopSettings extends KubectlSettings {
  #kind?: "pods" | "nodes";
  #name?: string;
  #selector?: string;
  #containers = false;
  #allNamespaces = false;

  /** Report pod usage (`top pods`). */
  pods(): this {
    this.#kind = "pods";
    return this;
  }

  /** Report node usage (`top nodes`). */
  nodes(): this {
    this.#kind = "nodes";
    return this;
  }

  /** Limit to a single named pod or node. */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Break pod usage down by container (`--containers`). */
  containers(): this {
    this.#containers = true;
    return this;
  }

  /** Report across all namespaces (`-A`). */
  allNamespaces(): this {
    this.#allNamespaces = true;
    return this;
  }

  /** Assemble the `kubectl top <pods|nodes>` argv. */
  protected override buildArgs(): string[] {
    if (this.#kind === undefined) {
      throw new Error("KubectlTasks.top: choose .pods() or .nodes().");
    }
    // kubectl `top` accepts a single NAME or a label selector, never both — for
    // pods and nodes alike. Emitting `top pods NAME -l sel` is rejected by
    // kubectl, so reject it here (same class as the `logs` name+selector fix).
    if (this.#name !== undefined && this.#selector !== undefined) {
      throw new Error(
        "KubectlTasks.top: .name() and .selector() are mutually exclusive — " +
          "pass a single name or a label selector, not both.",
      );
    }
    // `--containers` and `-A`/`--all-namespaces` are `top pod`-only; kubectl
    // rejects them on `top node` ("unknown flag"). `-l`/selector stays valid.
    if (this.#containers && this.#kind !== "pods") {
      throw new Error(
        "KubectlTasks.top: .containers() is only valid with .pods().",
      );
    }
    if (this.#allNamespaces && this.#kind !== "pods") {
      throw new Error(
        "KubectlTasks.top: .allNamespaces() is only valid with .pods().",
      );
    }
    const argv = ["top", this.#kind, ...this.globalArgs()];
    if (this.#name !== undefined) argv.push(this.#name);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#containers) argv.push("--containers");
    if (this.#allNamespaces) argv.push("-A");
    return argv;
  }
}
