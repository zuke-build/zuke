// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Argo Rollouts subcommands that move a rollout: `set image` starts one,
 * `promote` advances it past a pause (or all the way), `status` waits on it,
 * `undo` rolls it back, and `restart` cycles its pods.
 *
 * @module
 */

import { ArgoRolloutsSettings, requireName } from "./settings.ts";

/**
 * Settings for `set image` — point a container of the rollout at a new image,
 * which starts a new rollout through the steps its manifest declares.
 */
export class ArgoRolloutsSetImageSettings extends ArgoRolloutsSettings {
  #name?: string;
  #container?: string;
  #image?: string;

  /** The rollout to update (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /**
   * The container and the image to set, as `CONTAINER=IMAGE` (required). Pass
   * `"*"` as the container to update every container in the rollout.
   */
  image(container: string, reference: string): this {
    this.#container = container;
    this.#image = reference;
    return this;
  }

  /** Assemble the `set image <rollout> <container>=<image>` argv. */
  protected override buildArgs(): string[] {
    const name = requireName(this.#name, "setImage");
    if (this.#container === undefined || this.#image === undefined) {
      throw new Error("ArgoRolloutsTasks.setImage: .image() is required.");
    }
    return [
      "set",
      "image",
      name,
      `${this.#container}=${this.#image}`,
      ...this.globalArgs(),
    ];
  }
}

/**
 * Settings for `promote` — advance a paused rollout to its next step, or with
 * {@link full} skip every remaining step, pause and analysis.
 */
export class ArgoRolloutsPromoteSettings extends ArgoRolloutsSettings {
  #name?: string;
  #full = false;

  /** The rollout to promote (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Promote to the desired version outright, skipping analysis, pauses and steps (`--full`). */
  full(): this {
    this.#full = true;
    return this;
  }

  /** Assemble the `promote <rollout>` argv. */
  protected override buildArgs(): string[] {
    const argv = [
      "promote",
      requireName(this.#name, "promote"),
      ...this.globalArgs(),
    ];
    if (this.#full) argv.push("--full");
    return argv;
  }
}

/**
 * Settings for `status` — report a rollout's status, by default watching until
 * it completes or degrades.
 */
export class ArgoRolloutsStatusSettings extends ArgoRolloutsSettings {
  #name?: string;
  #timeout?: string;
  #watch?: boolean;

  /** The rollout to report on (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** How long to watch before giving up, e.g. `"10m"`; `"0"` waits forever (`--timeout`). */
  timeout(duration: string): this {
    this.#timeout = duration;
    return this;
  }

  /** Print the current status once instead of watching it (`--watch=false`). */
  noWatch(): this {
    this.#watch = false;
    return this;
  }

  /** Assemble the `status <rollout>` argv. */
  protected override buildArgs(): string[] {
    const argv = [
      "status",
      requireName(this.#name, "status"),
      ...this.globalArgs(),
    ];
    if (this.#timeout !== undefined) argv.push("--timeout", this.#timeout);
    if (this.#watch === false) argv.push("--watch=false");
    return argv;
  }
}

/** Settings for `undo` — roll a rollout back to an earlier revision. */
export class ArgoRolloutsUndoSettings extends ArgoRolloutsSettings {
  #name?: string;
  #toRevision?: number;

  /** The rollout to roll back (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** The revision to roll back to; the previous one when unset (`--to-revision`). */
  toRevision(revision: number): this {
    this.#toRevision = revision;
    return this;
  }

  /** Assemble the `undo <rollout>` argv. */
  protected override buildArgs(): string[] {
    const argv = [
      "undo",
      requireName(this.#name, "undo"),
      ...this.globalArgs(),
    ];
    if (this.#toRevision !== undefined) {
      argv.push(`--to-revision=${this.#toRevision}`);
    }
    return argv;
  }
}

/** Settings for `restart` — restart a rollout's pods, now or after a delay. */
export class ArgoRolloutsRestartSettings extends ArgoRolloutsSettings {
  #name?: string;
  #in?: string;

  /** The rollout whose pods to restart (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Delay the restart, e.g. `"30s"`, `"5m"`, `"1h"` (`--in`). */
  in(duration: string): this {
    this.#in = duration;
    return this;
  }

  /** Assemble the `restart <rollout>` argv. */
  protected override buildArgs(): string[] {
    const argv = [
      "restart",
      requireName(this.#name, "restart"),
      ...this.globalArgs(),
    ];
    if (this.#in !== undefined) argv.push("--in", this.#in);
    return argv;
  }
}
