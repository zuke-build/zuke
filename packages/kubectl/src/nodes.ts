// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `kubectl` commands that take a node out of service and put it back:
 * `cordon`, `uncordon`, `drain`, and `taint`.
 *
 * These are the sharp end of a deploy build. `drain` evicts running pods and
 * waits for them to go, so the settings refuse the combinations kubectl would
 * otherwise resolve on its own — see {@link KubectlDrainSettings}.
 *
 * @module
 */

import { type DryRunMode, KubectlSettings } from "./settings.ts";

/**
 * Settings for `kubectl cordon` and `kubectl uncordon` — marking a node
 * unschedulable, and letting it take pods again.
 */
export class KubectlCordonSettings extends KubectlSettings {
  #node?: string;
  #uncordon = false;
  #selector?: string;
  #dryRun?: DryRunMode;

  /** The node to act on; required unless a {@link selector} picks them. */
  node(name: string): this {
    this.#node = name;
    return this;
  }

  /** Make the node schedulable again instead — `kubectl uncordon`. */
  uncordon(): this {
    this.#uncordon = true;
    return this;
  }

  /** Act on every node matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Preview without persisting (`--dry-run=`; defaults to `client`). */
  dryRun(mode: DryRunMode = "client"): this {
    this.#dryRun = mode;
    return this;
  }

  /** Assemble the `kubectl cordon`/`uncordon` argv. */
  protected override buildArgs(): string[] {
    const task = this.#uncordon ? "uncordon" : "cordon";
    if (this.#node === undefined && this.#selector === undefined) {
      throw new Error(
        `KubectlTasks.${task}: name a node with .node(...) or pick them with ` +
          ".selector(...) — kubectl needs one or the other.",
      );
    }
    if (this.#node !== undefined && this.#selector !== undefined) {
      throw new Error(
        `KubectlTasks.${task}: .node(...) names one node and .selector(...) ` +
          "picks them by label — kubectl refuses both, so pick one.",
      );
    }
    const argv = [task, ...this.globalArgs()];
    if (this.#node !== undefined) argv.push(this.#node);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#dryRun !== undefined) argv.push(`--dry-run=${this.#dryRun}`);
    return argv;
  }
}

/**
 * Settings for `kubectl drain`.
 *
 * kubectl refuses to drain a node whose pods it cannot safely move, and the
 * two flags that override that refusal are exactly the ones worth being
 * deliberate about: `--ignore-daemonsets` and `--delete-emptydir-data`, the
 * second of which destroys local data. Neither is defaulted here.
 */
export class KubectlDrainSettings extends KubectlSettings {
  #node?: string;
  #force = false;
  #ignoreDaemonSets = false;
  #deleteEmptyDirData = false;
  #disableEviction = false;
  #gracePeriod?: number;
  #timeout?: string;
  #podSelector?: string;
  #selector?: string;
  #skipWaitForDeleteTimeout?: number;
  #dryRun?: DryRunMode;

  /** The node to drain; required unless a {@link selector} picks them. */
  node(name: string): this {
    this.#node = name;
    return this;
  }

  /** Evict pods no controller manages, which nothing will recreate (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Proceed past DaemonSet-managed pods, which drain never deletes (`--ignore-daemonsets`). */
  ignoreDaemonSets(): this {
    this.#ignoreDaemonSets = true;
    return this;
  }

  /** Proceed past pods using emptyDir, destroying that data (`--delete-emptydir-data`). */
  deleteEmptyDirData(): this {
    this.#deleteEmptyDirData = true;
    return this;
  }

  /**
   * Delete rather than evict (`--disable-eviction`), which bypasses every
   * PodDisruptionBudget — the guardrail an operator wrote down on purpose.
   */
  disableEviction(): this {
    this.#disableEviction = true;
    return this;
  }

  /** Seconds each pod gets to terminate (`--grace-period`). */
  gracePeriod(seconds: number): this {
    this.#gracePeriod = seconds;
    return this;
  }

  /** How long to wait for the drain overall, e.g. `5m` (`--timeout`). */
  timeout(duration: string): this {
    this.#timeout = duration;
    return this;
  }

  /** Only drain pods matching this label selector (`--pod-selector`). */
  podSelector(query: string): this {
    this.#podSelector = query;
    return this;
  }

  /** Drain every node matching this label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Stop waiting on pods already deleting this long (`--skip-wait-for-delete-timeout`). */
  skipWaitForDeleteTimeout(seconds: number): this {
    this.#skipWaitForDeleteTimeout = seconds;
    return this;
  }

  /** Preview without persisting (`--dry-run=`; defaults to `client`). */
  dryRun(mode: DryRunMode = "client"): this {
    this.#dryRun = mode;
    return this;
  }

  /** Assemble the `kubectl drain` argv. */
  protected override buildArgs(): string[] {
    if (this.#node === undefined && this.#selector === undefined) {
      throw new Error(
        "KubectlTasks.drain: name a node with .node(...) or pick them with " +
          ".selector(...) — kubectl needs one or the other.",
      );
    }
    if (this.#node !== undefined && this.#selector !== undefined) {
      throw new Error(
        "KubectlTasks.drain: .node(...) names one node and .selector(...) " +
          "picks them by label — kubectl refuses both, so pick one.",
      );
    }
    const argv = ["drain", ...this.globalArgs()];
    if (this.#node !== undefined) argv.push(this.#node);
    if (this.#force) argv.push("--force");
    if (this.#ignoreDaemonSets) argv.push("--ignore-daemonsets");
    if (this.#deleteEmptyDirData) argv.push("--delete-emptydir-data");
    if (this.#disableEviction) argv.push("--disable-eviction");
    if (this.#gracePeriod !== undefined) {
      argv.push(`--grace-period=${this.#gracePeriod}`);
    }
    if (this.#timeout !== undefined) argv.push(`--timeout=${this.#timeout}`);
    if (this.#podSelector !== undefined) {
      argv.push(`--pod-selector=${this.#podSelector}`);
    }
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#skipWaitForDeleteTimeout !== undefined) {
      argv.push(
        `--skip-wait-for-delete-timeout=${this.#skipWaitForDeleteTimeout}`,
      );
    }
    if (this.#dryRun !== undefined) argv.push(`--dry-run=${this.#dryRun}`);
    return argv;
  }
}

/** What a taint does to pods that do not tolerate it. */
export type TaintEffect = "NoSchedule" | "PreferNoSchedule" | "NoExecute";

/** Settings for `kubectl taint`. */
export class KubectlTaintSettings extends KubectlSettings {
  #nodes: string[] = [];
  #taints: string[] = [];
  #all = false;
  #overwrite = false;
  #selector?: string;
  #dryRun?: DryRunMode;

  /** A node to taint; repeatable. */
  node(...names: string[]): this {
    this.#nodes.push(...names);
    return this;
  }

  /** Add a taint, as `key=value:effect`; repeatable. */
  taint(key: string, value: string, effect: TaintEffect): this {
    this.#taints.push(`${key}=${value}:${effect}`);
    return this;
  }

  /** Remove a taint, which kubectl spells with a trailing `-`; repeatable. */
  removeTaint(key: string, effect?: TaintEffect): this {
    this.#taints.push(effect === undefined ? `${key}-` : `${key}:${effect}-`);
    return this;
  }

  /** Taint every node in the cluster (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Replace a taint of the same key rather than failing (`--overwrite`). */
  overwrite(): this {
    this.#overwrite = true;
    return this;
  }

  /** Taint every node matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Preview without persisting (`--dry-run=`; defaults to `client`). */
  dryRun(mode: DryRunMode = "client"): this {
    this.#dryRun = mode;
    return this;
  }

  /** Assemble the `kubectl taint` argv. */
  protected override buildArgs(): string[] {
    if (this.#taints.length === 0) {
      throw new Error(
        "KubectlTasks.taint: .taint(...) or .removeTaint(...) is required — " +
          "there is nothing to apply otherwise.",
      );
    }
    if (
      this.#nodes.length === 0 && !this.#all && this.#selector === undefined
    ) {
      throw new Error(
        "KubectlTasks.taint: name a node with .node(...), or pick them with " +
          ".all()/.selector(...) — kubectl needs one of the three.",
      );
    }
    if (this.#nodes.length > 0 && this.#all) {
      throw new Error(
        "KubectlTasks.taint: .node(...) names nodes and .all() takes every " +
          "one — pick one.",
      );
    }
    const argv = ["taint", "node", ...this.globalArgs(), ...this.#nodes];
    if (this.#all) argv.push("--all");
    argv.push(...this.#taints);
    if (this.#overwrite) argv.push("--overwrite");
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#dryRun !== undefined) argv.push(`--dry-run=${this.#dryRun}`);
    return argv;
  }
}
