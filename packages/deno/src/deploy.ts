// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the two `deno deploy` commands that upload source: deploying a
 * directory to an application, and creating an application.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { DenoDeployUploadSettings, option } from "./deploy_settings.ts";

/** Settings for `deno deploy`: upload a directory to an application. */
export class DenoDeploySettings extends DenoDeployUploadSettings {
  #prod = false;

  /** Deploy straight to production rather than as a preview (`--prod`). */
  prod(): this {
    this.#prod = true;
    return this;
  }

  /** `deno deploy` has no subcommand. */
  protected override commandPath(): string[] {
    return [];
  }

  /** `--prod`, then the upload flags and the root directory. */
  protected override commandArgs(): string[] {
    return this.#prod ? ["--prod", ...this.uploadArgs()] : this.uploadArgs();
  }
}

/** Where a new application's source comes from (`--source`). */
export type DenoDeploySource = "local" | "github";

/** How a new application runs (`--runtime-mode`). */
export type DenoDeployRuntimeMode = "dynamic" | "static";

/** Where a new application is deployed (`--region`). */
export type DenoDeployRegion = "us" | "eu" | "global";

/** Settings for `deno deploy create`: create an application. */
export class DenoDeployCreateSettings extends DenoDeployUploadSettings {
  #flags: string[] = [];

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** Validate the flags without creating the application (`--dry-run`). */
  dryRun(): this {
    return this.#push("--dry-run");
  }

  /** Where the source comes from (`--source`). */
  source(source: DenoDeploySource): this {
    return this.#push(option("source", source));
  }

  /** A GitHub source repository: `--owner` and `--repo`. */
  repository(owner: string, repo: string): this {
    return this.#push(option("owner", owner), option("repo", repo));
  }

  /** The application's directory inside the source (`--app-directory`). */
  appDirectory(path: PathLike): this {
    return this.#push(option("app-directory", String(path)));
  }

  /** Ignore the detected build configuration (`--do-not-use-detected-build-config`). */
  doNotUseDetectedBuildConfig(): this {
    return this.#push("--do-not-use-detected-build-config");
  }

  /** The framework preset, e.g. `fresh` or `astro` (`--framework-preset`). */
  frameworkPreset(preset: string): this {
    return this.#push(option("framework-preset", preset));
  }

  /** The install command (`--install-command`). */
  installCommand(command: string): this {
    return this.#push(option("install-command", command));
  }

  /** The build command (`--build-command`). */
  buildCommand(command: string): this {
    return this.#push(option("build-command", command));
  }

  /** The command run before each deployment (`--pre-deploy-command`). */
  preDeployCommand(command: string): this {
    return this.#push(option("pre-deploy-command", command));
  }

  /** Whether the application is a server or static files (`--runtime-mode`). */
  runtimeMode(mode: DenoDeployRuntimeMode): this {
    return this.#push(option("runtime-mode", mode));
  }

  /** A dynamic application's entrypoint (`--entrypoint`). */
  entrypoint(path: PathLike): this {
    return this.#push(option("entrypoint", String(path)));
  }

  /** An argument for a dynamic application's entrypoint (`--arguments`); repeatable. */
  argument(value: string): this {
    return this.#push(option("arguments", value));
  }

  /** A dynamic application's working directory (`--working-directory`). */
  workingDirectory(path: PathLike): this {
    return this.#push(option("working-directory", String(path)));
  }

  /** The directory a static application is served from (`--static-dir`). */
  staticDir(path: PathLike): this {
    return this.#push(option("static-dir", String(path)));
  }

  /** Serve `index.html` for every path without a file (`--single-page-app`). */
  singlePageApp(): this {
    return this.#push("--single-page-app");
  }

  /** The build timeout, e.g. `10m` or `600s` (`--build-timeout`). */
  buildTimeout(duration: string | number): this {
    return this.#push(option("build-timeout", duration));
  }

  /** The build memory limit in megabytes (`--build-memory-limit`). */
  buildMemoryLimit(megabytes: number): this {
    return this.#push(option("build-memory-limit", megabytes));
  }

  /** The region to deploy to (`--region`). */
  region(region: DenoDeployRegion): this {
    return this.#push(option("region", region));
  }

  /** `deno deploy create`. */
  protected override commandPath(): string[] {
    return ["create"];
  }

  /** The create flags, then the upload flags and the root directory. */
  protected override commandArgs(): string[] {
    return [...this.#flags, ...this.uploadArgs()];
  }
}
