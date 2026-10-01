// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Argo Rollouts subcommands that work from manifests: `create`,
 * `create analysisrun`, and `lint`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { ArgoRolloutsSettings } from "./settings.ts";

/** Settings for `create` — create a Rollout or Experiment from files. */
export class ArgoRolloutsCreateSettings extends ArgoRolloutsSettings {
  #files: string[] = [];
  #watch = false;
  #noColor = false;

  /** A manifest to create from (`--filename`); repeatable, at least one is required. */
  filename(...paths: PathLike[]): this {
    this.#files.push(...paths.map(String));
    return this;
  }

  /** Keep printing live updates after creating (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Print without colour (`--no-color`). */
  noColor(): this {
    this.#noColor = true;
    return this;
  }

  /** Assemble the `create` argv. */
  protected override buildArgs(): string[] {
    if (this.#files.length === 0) {
      throw new Error("ArgoRolloutsTasks.create: .filename() is required.");
    }
    const argv = ["create", ...this.globalArgs()];
    for (const file of this.#files) argv.push("--filename", file);
    if (this.#watch) argv.push("--watch");
    if (this.#noColor) argv.push("--no-color");
    return argv;
  }
}

/**
 * Settings for `create analysisrun` — run an AnalysisTemplate (or, with
 * {@link global}, a ClusterAnalysisTemplate) once, from the cluster or a file.
 */
export class ArgoRolloutsCreateAnalysisRunSettings
  extends ArgoRolloutsSettings {
  #from?: string;
  #fromFile?: string;
  #global = false;
  #arguments: string[] = [];
  #name?: string;
  #generateName?: string;
  #instanceId?: string;

  /** The template in the cluster to run (`--from`); this or {@link fromFile} is required. */
  from(template: string): this {
    this.#from = template;
    return this;
  }

  /** A local template file to run (`--from-file`); this or {@link from} is required. */
  fromFile(path: PathLike): this {
    this.#fromFile = String(path);
    return this;
  }

  /** Use a ClusterAnalysisTemplate instead of an AnalysisTemplate (`--global`). */
  global(): this {
    this.#global = true;
    return this;
  }

  /** Pass a template argument as `name=value` (`--argument`); repeatable. */
  argument(name: string, value: string): this {
    this.#arguments.push(`${name}=${value}`);
    return this;
  }

  /** Name the run exactly (`--name`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Let the cluster name the run from this prefix (`--generate-name`). */
  generateName(prefix: string): this {
    this.#generateName = prefix;
    return this;
  }

  /** The controller instance the run belongs to (`--instance-id`). */
  instanceId(id: string): this {
    this.#instanceId = id;
    return this;
  }

  /** Assemble the `create analysisrun` argv. */
  protected override buildArgs(): string[] {
    if ((this.#from === undefined) === (this.#fromFile === undefined)) {
      throw new Error(
        "ArgoRolloutsTasks.createAnalysisRun: set exactly one of .from() " +
          "and .fromFile().",
      );
    }
    const argv = ["create", "analysisrun", ...this.globalArgs()];
    if (this.#from !== undefined) argv.push("--from", this.#from);
    if (this.#fromFile !== undefined) argv.push("--from-file", this.#fromFile);
    if (this.#global) argv.push("--global");
    for (const arg of this.#arguments) argv.push("--argument", arg);
    if (this.#name !== undefined) argv.push("--name", this.#name);
    if (this.#generateName !== undefined) {
      argv.push("--generate-name", this.#generateName);
    }
    if (this.#instanceId !== undefined) {
      argv.push("--instance-id", this.#instanceId);
    }
    return argv;
  }
}

/** Settings for `lint` — validate a Rollout manifest without applying it. */
export class ArgoRolloutsLintSettings extends ArgoRolloutsSettings {
  #file?: string;

  /** The manifest to lint (`--filename`, required). */
  filename(path: PathLike): this {
    this.#file = String(path);
    return this;
  }

  /** Assemble the `lint` argv. */
  protected override buildArgs(): string[] {
    if (this.#file === undefined) {
      throw new Error("ArgoRolloutsTasks.lint: .filename() is required.");
    }
    return ["lint", ...this.globalArgs(), "--filename", this.#file];
  }
}
