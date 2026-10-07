// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az functionapp` — Azure Functions: deploying a zip package.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * await AzTasks.functionappDeploymentSourceConfigZip((s) =>
 *   s.name("jobs").resourceGroup("rg-prod").src("dist/jobs.zip")
 *     .buildRemote(true)
 * );
 * ```
 *
 * @module
 */

import { AzResourceSettings } from "./resource.ts";
import { bool, option, required } from "./validate.ts";

/**
 * Settings for `az functionapp deployment source config-zip`: deploy a zip
 * package to a function app. This is the generally available command;
 * `az functionapp deploy` is still in preview.
 */
export class AzFunctionappDeploymentSourceConfigZipSettings
  extends AzResourceSettings {
  #src?: string;
  #buildRemote?: boolean;
  #timeout?: number;
  #slot?: string;

  /** The zip package (`--src`). */
  src(path: string): this {
    this.#src = path;
    return this;
  }

  /** Build the package on the service — install dependencies there (`--build-remote`). */
  buildRemote(value: boolean): this {
    this.#buildRemote = value;
    return this;
  }

  /** How long to wait for the deployment's status, in seconds (`--timeout`). */
  timeout(seconds: number): this {
    this.#timeout = seconds;
    return this;
  }

  /** A slot instead of production (`--slot`). */
  slot(name: string): this {
    this.#slot = name;
    return this;
  }

  /** Emit `functionapp deployment source config-zip` with its options. */
  protected override leadingTokens(): string[] {
    const task = "functionappDeploymentSourceConfigZip";
    const src = required(this.#src, task, "no package — add .src('app.zip').");
    const argv = [
      "functionapp",
      "deployment",
      "source",
      "config-zip",
      ...this.resourceTokens(task, "function app"),
      option("--src", src),
    ];
    if (this.#buildRemote !== undefined) {
      argv.push(bool("--build-remote", this.#buildRemote));
    }
    if (this.#timeout !== undefined) {
      argv.push(option("--timeout", this.#timeout));
    }
    if (this.#slot !== undefined) argv.push(option("--slot", this.#slot));
    return argv;
  }
}
