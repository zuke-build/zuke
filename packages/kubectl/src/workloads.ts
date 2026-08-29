// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `kubectl` commands that drive a workload: `rollout`, `scale`, and
 * `set image`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { KubectlSettings } from "./settings.ts";

/** A rollout sub-action: `kubectl rollout <action>`. */
export type RolloutAction = "status" | "restart" | "undo" | "history";

/** Settings for `kubectl rollout`. */
export class KubectlRolloutSettings extends KubectlSettings {
  #action?: RolloutAction;
  #resource?: string;
  #toRevision?: number;
  #timeout?: string;

  /** Show rollout status (`rollout status`). */
  status(): this {
    this.#action = "status";
    return this;
  }

  /** Restart a rollout (`rollout restart`). */
  restart(): this {
    this.#action = "restart";
    return this;
  }

  /** Roll back to the previous revision (`rollout undo`). */
  undo(): this {
    this.#action = "undo";
    return this;
  }

  /** Show rollout history (`rollout history`). */
  history(): this {
    this.#action = "history";
    return this;
  }

  /** The resource, e.g. `deployment/api` (required). */
  resource(name: string): this {
    this.#resource = name;
    return this;
  }

  /** With `undo`, the revision to roll back to (`--to-revision`). */
  toRevision(revision: number): this {
    this.#toRevision = revision;
    return this;
  }

  /** With `status`, how long to wait, e.g. `60s` (`--timeout`). */
  timeout(duration: string): this {
    this.#timeout = duration;
    return this;
  }

  /** Assemble the `kubectl rollout <action>` argv. */
  protected override buildArgs(): string[] {
    if (this.#action === undefined) {
      throw new Error(
        "KubectlTasks.rollout: choose .status(), .restart(), .undo(), or .history().",
      );
    }
    if (this.#resource === undefined) {
      throw new Error("KubectlTasks.rollout: .resource() is required.");
    }
    const argv = [
      "rollout",
      this.#action,
      ...this.globalArgs(),
      this.#resource,
    ];
    if (this.#toRevision !== undefined) {
      argv.push(`--to-revision=${this.#toRevision}`);
    }
    if (this.#timeout !== undefined) argv.push(`--timeout=${this.#timeout}`);
    return argv;
  }
}

/** Settings for `kubectl scale`. */
export class KubectlScaleSettings extends KubectlSettings {
  #replicas?: number;
  #resource?: string;
  #file?: string;
  #currentReplicas?: number;
  #selector?: string;
  #all = false;

  /** Desired replica count (`--replicas`, required). */
  replicas(count: number): this {
    this.#replicas = count;
    return this;
  }

  /** The resource to scale, e.g. `deployment/api`. */
  resource(name: string): this {
    this.#resource = name;
    return this;
  }

  /** Scale a resource defined in a file (`-f`). */
  file(path: PathLike): this {
    this.#file = String(path);
    return this;
  }

  /** Only scale if the current replica count matches (`--current-replicas`). */
  currentReplicas(count: number): this {
    this.#currentReplicas = count;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Scale all resources of the given type (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Assemble the `kubectl scale` argv. */
  protected override buildArgs(): string[] {
    if (this.#replicas === undefined) {
      throw new Error("KubectlTasks.scale: .replicas() is required.");
    }
    if (this.#resource === undefined && this.#file === undefined) {
      throw new Error("KubectlTasks.scale: specify .resource() or .file().");
    }
    const argv = [
      "scale",
      ...this.globalArgs(),
      `--replicas=${this.#replicas}`,
    ];
    if (this.#currentReplicas !== undefined) {
      argv.push(`--current-replicas=${this.#currentReplicas}`);
    }
    if (this.#file !== undefined) argv.push("-f", this.#file);
    if (this.#resource !== undefined) argv.push(this.#resource);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#all) argv.push("--all");
    return argv;
  }
}

/** Settings for `kubectl set image`. */
export class KubectlSetImageSettings extends KubectlSettings {
  #resource?: string;
  #images: string[] = [];
  #selector?: string;
  #all = false;

  /** The resource to update, e.g. `deployment/api` (required). */
  resource(name: string): this {
    this.#resource = name;
    return this;
  }

  /** Set a container's image (`container=image`); repeatable, at least one. */
  image(container: string, reference: string): this {
    this.#images.push(`${container}=${reference}`);
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Apply to all resources of the given type (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Assemble the `kubectl set image` argv. */
  protected override buildArgs(): string[] {
    if (this.#resource === undefined) {
      throw new Error("KubectlTasks.setImage: .resource() is required.");
    }
    if (this.#images.length === 0) {
      throw new Error(
        "KubectlTasks.setImage: at least one .image() is required.",
      );
    }
    const argv = ["set", "image", ...this.globalArgs(), this.#resource];
    argv.push(...this.#images);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#all) argv.push("--all");
    return argv;
  }
}
