// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `docker build` — turning a build context and a Dockerfile into an image.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.build((s) => s.tag("app:latest").platform("linux/amd64"));
 * ```
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { DockerSettings } from "./settings.ts";

/** Settings for `docker build`. */
export class DockerBuildSettings extends DockerSettings {
  #tags: string[] = [];
  #file?: string;
  #target?: string;
  #platform?: string;
  #buildArgs: string[] = [];
  #noCache = false;
  #pull = false;
  #push = false;
  #context = ".";

  /** Add an image tag (`-t`); repeatable. */
  tag(reference: string): this {
    this.#tags.push(reference);
    return this;
  }

  /** Use an explicit Dockerfile (`-f`). */
  file(path: PathLike): this {
    this.#file = String(path);
    return this;
  }

  /** Build a specific stage (`--target`). */
  target(stage: string): this {
    this.#target = stage;
    return this;
  }

  /** Set the target platform(s) (`--platform`). */
  platform(value: string): this {
    this.#platform = value;
    return this;
  }

  /** Pass a build-time variable (`--build-arg KEY=value`); repeatable. */
  buildArg(key: string, value: string): this {
    this.#buildArgs.push("--build-arg", `${key}=${value}`);
    return this;
  }

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

  /** Push the result to the registry after building (`--push`). */
  push(): this {
    this.#push = true;
    return this;
  }

  /** The build context path or URL (default `.`). */
  context(path: PathLike): this {
    this.#context = String(path);
    return this;
  }

  /** Assemble the `docker build` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["build"];
    for (const t of this.#tags) argv.push("-t", t);
    if (this.#file !== undefined) argv.push("-f", this.#file);
    if (this.#target !== undefined) argv.push("--target", this.#target);
    if (this.#platform !== undefined) argv.push("--platform", this.#platform);
    if (this.#noCache) argv.push("--no-cache");
    if (this.#pull) argv.push("--pull");
    if (this.#push) argv.push("--push");
    argv.push(...this.#buildArgs);
    argv.push(this.#context);
    return argv;
  }
}
