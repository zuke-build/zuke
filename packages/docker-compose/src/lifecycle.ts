// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the Compose subcommands that move services through their
 * lifecycle: `up`, `down`, `start`, `stop`, `restart` and `rm`.
 */

import { DockerComposeSettings } from "./settings.ts";

/**
 * When `compose up` fetches images before starting: `always` on every start,
 * `missing` only when the image is absent locally, `never` at all.
 */
export type DockerComposePullPolicy = "always" | "missing" | "never";

/** Settings for `compose up`. */
export class DockerComposeUpSettings extends DockerComposeSettings {
  #detach = false;
  #build = false;
  #forceRecreate = false;
  #removeOrphans = false;
  #wait = false;
  #abortOnContainerExit = false;
  #noDeps = false;
  #pull?: DockerComposePullPolicy;
  #exitCodeFrom?: string;
  #scale: string[] = [];
  #services: string[] = [];

  /** Run in the background (`-d`). */
  detach(): this {
    this.#detach = true;
    return this;
  }

  /** Build images before starting (`--build`). */
  build(): this {
    this.#build = true;
    return this;
  }

  /** Recreate containers even if unchanged (`--force-recreate`). */
  forceRecreate(): this {
    this.#forceRecreate = true;
    return this;
  }

  /** Remove containers for services no longer defined (`--remove-orphans`). */
  removeOrphans(): this {
    this.#removeOrphans = true;
    return this;
  }

  /** Wait until services are running/healthy (`--wait`). */
  wait(): this {
    this.#wait = true;
    return this;
  }

  /** Stop all containers if any container stops (`--abort-on-container-exit`). */
  abortOnContainerExit(): this {
    this.#abortOnContainerExit = true;
    return this;
  }

  /**
   * Start only the named services, leaving their dependencies alone
   * (`--no-deps`).
   *
   * Without it compose starts or recreates a dependency that is stopped or
   * whose configuration changed. With an already-healthy stack the two agree,
   * so the difference shows up only on the runs where a dependency was not
   * ready — which is where a target that meant "just this service" wants to be
   * explicit.
   */
  noDeps(): this {
    this.#noDeps = true;
    return this;
  }

  /**
   * When to fetch images before starting (`--pull`). `always` keeps a stack on
   * the current published images rather than whatever was pulled last;
   * `missing` fetches only what is absent locally; `never` uses what is there.
   *
   * Distinct from `DockerComposeBuildSettings.pull`, which is `build --pull`,
   * and from the `pull` task, which is the subcommand — each mirrors its own
   * command.
   */
  pull(policy: DockerComposePullPolicy): this {
    this.#pull = policy;
    return this;
  }

  /** Exit with this service's container's exit code (`--exit-code-from`). */
  exitCodeFrom(service: string): this {
    this.#exitCodeFrom = service;
    return this;
  }

  /** Scale a service to N instances (`--scale service=N`); repeatable. */
  scale(service: string, instances: number): this {
    this.#scale.push("--scale", `${service}=${instances}`);
    return this;
  }

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Assemble the `compose up` argv. */
  protected override composeArgs(): string[] {
    const argv = ["up"];
    if (this.#detach) argv.push("-d");
    if (this.#build) argv.push("--build");
    if (this.#forceRecreate) argv.push("--force-recreate");
    if (this.#removeOrphans) argv.push("--remove-orphans");
    if (this.#wait) argv.push("--wait");
    if (this.#abortOnContainerExit) argv.push("--abort-on-container-exit");
    if (this.#noDeps) argv.push("--no-deps");
    if (this.#pull !== undefined) argv.push("--pull", this.#pull);
    if (this.#exitCodeFrom !== undefined) {
      argv.push("--exit-code-from", this.#exitCodeFrom);
    }
    argv.push(...this.#scale, ...this.#services);
    return argv;
  }
}

/** Settings for `compose down`. */
export class DockerComposeDownSettings extends DockerComposeSettings {
  #volumes = false;
  #removeOrphans = false;
  #rmi?: string;
  #timeout?: number;

  /** Also remove named and anonymous volumes (`-v`). */
  volumes(): this {
    this.#volumes = true;
    return this;
  }

  /** Remove containers for services no longer defined (`--remove-orphans`). */
  removeOrphans(): this {
    this.#removeOrphans = true;
    return this;
  }

  /** Remove images of the given type (`--rmi`), e.g. `all` or `local`. */
  rmi(type: string): this {
    this.#rmi = type;
    return this;
  }

  /** Shutdown timeout in seconds (`-t`). */
  timeout(seconds: number): this {
    this.#timeout = seconds;
    return this;
  }

  /** Assemble the `compose down` argv. */
  protected override composeArgs(): string[] {
    const argv = ["down"];
    if (this.#volumes) argv.push("-v");
    if (this.#removeOrphans) argv.push("--remove-orphans");
    if (this.#rmi !== undefined) argv.push("--rmi", this.#rmi);
    if (this.#timeout !== undefined) argv.push("-t", String(this.#timeout));
    return argv;
  }
}

/** Settings for `compose start`. */
export class DockerComposeStartSettings extends DockerComposeSettings {
  #services: string[] = [];

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Assemble the `compose start` argv. */
  protected override composeArgs(): string[] {
    return ["start", ...this.#services];
  }
}

/** Settings for `compose stop`. */
export class DockerComposeStopSettings extends DockerComposeSettings {
  #timeout?: number;
  #services: string[] = [];

  /** Shutdown timeout in seconds (`-t`). */
  timeout(seconds: number): this {
    this.#timeout = seconds;
    return this;
  }

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Assemble the `compose stop` argv. */
  protected override composeArgs(): string[] {
    const argv = ["stop"];
    if (this.#timeout !== undefined) argv.push("-t", String(this.#timeout));
    argv.push(...this.#services);
    return argv;
  }
}

/** Settings for `compose restart`. */
export class DockerComposeRestartSettings extends DockerComposeSettings {
  #timeout?: number;
  #services: string[] = [];

  /** Restart timeout in seconds (`-t`). */
  timeout(seconds: number): this {
    this.#timeout = seconds;
    return this;
  }

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Assemble the `compose restart` argv. */
  protected override composeArgs(): string[] {
    const argv = ["restart"];
    if (this.#timeout !== undefined) argv.push("-t", String(this.#timeout));
    argv.push(...this.#services);
    return argv;
  }
}

/** Settings for `compose rm`. */
export class DockerComposeRmSettings extends DockerComposeSettings {
  #force = false;
  #stop = false;
  #volumes = false;
  #services: string[] = [];

  /** Do not prompt for confirmation (`-f`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Stop the containers first if needed (`-s`). */
  stop(): this {
    this.#stop = true;
    return this;
  }

  /** Also remove anonymous volumes (`-v`). */
  volumes(): this {
    this.#volumes = true;
    return this;
  }

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Assemble the `compose rm` argv. */
  protected override composeArgs(): string[] {
    const argv = ["rm"];
    if (this.#force) argv.push("-f");
    if (this.#stop) argv.push("-s");
    if (this.#volumes) argv.push("-v");
    argv.push(...this.#services);
    return argv;
  }
}
