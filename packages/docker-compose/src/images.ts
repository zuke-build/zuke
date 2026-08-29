// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the Compose subcommands that act on service images rather than
 * on running containers: `build`, `pull` and `push`.
 */

import { DockerComposeSettings } from "./settings.ts";

/** Settings for `compose build`. */
export class DockerComposeBuildSettings extends DockerComposeSettings {
  #noCache = false;
  #pull = false;
  #buildArgs: string[] = [];
  #services: string[] = [];

  /** Do not use the layer cache (`--no-cache`). */
  noCache(): this {
    this.#noCache = true;
    return this;
  }

  /** Always attempt to pull newer base images (`--pull`). */
  pull(): this {
    this.#pull = true;
    return this;
  }

  /** Pass a build-time variable (`--build-arg KEY=value`); repeatable. */
  buildArg(key: string, value: string): this {
    this.#buildArgs.push("--build-arg", `${key}=${value}`);
    return this;
  }

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Assemble the `compose build` argv. */
  protected override composeArgs(): string[] {
    const argv = ["build"];
    if (this.#noCache) argv.push("--no-cache");
    if (this.#pull) argv.push("--pull");
    argv.push(...this.#buildArgs, ...this.#services);
    return argv;
  }
}

/** Settings for `compose pull`. */
export class DockerComposePullSettings extends DockerComposeSettings {
  #ignorePullFailures = false;
  #quiet = false;
  #services: string[] = [];

  /** Continue past services whose pull fails (`--ignore-pull-failures`). */
  ignorePullFailures(): this {
    this.#ignorePullFailures = true;
    return this;
  }

  /** Pull without printing progress (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Assemble the `compose pull` argv. */
  protected override composeArgs(): string[] {
    const argv = ["pull"];
    if (this.#ignorePullFailures) argv.push("--ignore-pull-failures");
    if (this.#quiet) argv.push("-q");
    argv.push(...this.#services);
    return argv;
  }
}

/** Settings for `compose push`. */
export class DockerComposePushSettings extends DockerComposeSettings {
  #ignorePushFailures = false;
  #services: string[] = [];

  /** Continue past services whose push fails (`--ignore-push-failures`). */
  ignorePushFailures(): this {
    this.#ignorePushFailures = true;
    return this;
  }

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Assemble the `compose push` argv. */
  protected override composeArgs(): string[] {
    const argv = ["push"];
    if (this.#ignorePushFailures) argv.push("--ignore-push-failures");
    argv.push(...this.#services);
    return argv;
  }
}
