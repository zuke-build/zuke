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

/** Settings for `compose create`. */
export class DockerComposeCreateSettings extends DockerComposeSettings {
  #services: string[] = [];
  #build = false;
  #noBuild = false;
  #forceRecreate = false;
  #noRecreate = false;
  #removeOrphans = false;
  #quietPull = false;
  #yes = false;
  #pull?: DockerComposePullPolicy;
  #scale: string[] = [];

  /** Restrict creation to these services. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Build images before creating containers (`--build`). */
  build(): this {
    this.#build = true;
    return this;
  }

  /** Never build, whatever the policy says (`--no-build`). */
  noBuild(): this {
    this.#noBuild = true;
    return this;
  }

  /** Recreate containers even when their configuration has not changed (`--force-recreate`). */
  forceRecreate(): this {
    this.#forceRecreate = true;
    return this;
  }

  /** Leave existing containers in place (`--no-recreate`). */
  noRecreate(): this {
    this.#noRecreate = true;
    return this;
  }

  /** Remove containers for services no longer in the file (`--remove-orphans`). */
  removeOrphans(): this {
    this.#removeOrphans = true;
    return this;
  }

  /** Pull without progress output (`--quiet-pull`). */
  quietPull(): this {
    this.#quietPull = true;
    return this;
  }

  /** When to pull images before creating (`--pull`). */
  pull(policy: DockerComposePullPolicy): this {
    this.#pull = policy;
    return this;
  }

  /** Create `replicas` containers for `service` (`--scale`). */
  scale(service: string, replicas: number): this {
    this.#scale.push("--scale", `${service}=${replicas}`);
    return this;
  }

  /** Answer every prompt affirmatively (`--yes`), so an unattended run cannot stall. */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** Assemble the `compose create` argv. */
  protected override composeArgs(): string[] {
    if (this.#build && this.#noBuild) {
      throw new Error(
        "DockerComposeTasks.create: .build() and .noBuild() are opposite " +
          "answers to whether images are built — pick one.",
      );
    }
    if (this.#forceRecreate && this.#noRecreate) {
      throw new Error(
        "DockerComposeTasks.create: .forceRecreate() and .noRecreate() are " +
          "opposite answers to whether existing containers are replaced — " +
          "pick one.",
      );
    }
    const argv = ["create"];
    if (this.#build) argv.push("--build");
    if (this.#noBuild) argv.push("--no-build");
    if (this.#forceRecreate) argv.push("--force-recreate");
    if (this.#noRecreate) argv.push("--no-recreate");
    if (this.#removeOrphans) argv.push("--remove-orphans");
    if (this.#quietPull) argv.push("--quiet-pull");
    if (this.#pull !== undefined) argv.push("--pull", this.#pull);
    argv.push(...this.#scale);
    if (this.#yes) argv.push("--yes");
    argv.push(...this.#services);
    return argv;
  }
}

/** Settings for `compose kill`. */
export class DockerComposeKillSettings extends DockerComposeSettings {
  #services: string[] = [];
  #signal?: string;
  #removeOrphans = false;

  /** Restrict the kill to these services. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /**
   * The signal to send (`--signal`), `SIGKILL` by default. Send `SIGTERM` to
   * let a service run its shutdown path — `kill` skips the grace period `stop`
   * gives it.
   */
  signal(name: string): this {
    this.#signal = name;
    return this;
  }

  /** Remove containers for services no longer in the file (`--remove-orphans`). */
  removeOrphans(): this {
    this.#removeOrphans = true;
    return this;
  }

  /** Assemble the `compose kill` argv. */
  protected override composeArgs(): string[] {
    const argv = ["kill"];
    if (this.#signal !== undefined) argv.push("--signal", this.#signal);
    if (this.#removeOrphans) argv.push("--remove-orphans");
    argv.push(...this.#services);
    return argv;
  }
}

/**
 * Settings shared by `compose pause` and `compose unpause`, which take only a
 * service list.
 */
export abstract class DockerComposeServiceListSettings
  extends DockerComposeSettings {
  #services: string[] = [];

  /** Restrict the command to these services. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** The subcommand this class renders. */
  protected abstract get subcommand(): string;

  /** Assemble the subcommand argv. */
  protected override composeArgs(): string[] {
    return [this.subcommand, ...this.#services];
  }
}

/** Settings for `compose pause`. */
export class DockerComposePauseSettings
  extends DockerComposeServiceListSettings {
  /** The subcommand this class renders. */
  protected override get subcommand(): string {
    return "pause";
  }
}

/** Settings for `compose unpause`. */
export class DockerComposeUnpauseSettings
  extends DockerComposeServiceListSettings {
  /** The subcommand this class renders. */
  protected override get subcommand(): string {
    return "unpause";
  }
}

/** Settings for `compose scale`. */
export class DockerComposeScaleSettings extends DockerComposeSettings {
  #scales: string[] = [];
  #noDeps = false;

  /** Scale `service` to `replicas` instances; repeatable (required). */
  scale(service: string, replicas: number): this {
    this.#scales.push(`${service}=${replicas}`);
    return this;
  }

  /** Do not start linked services (`--no-deps`). */
  noDeps(): this {
    this.#noDeps = true;
    return this;
  }

  /** Assemble the `compose scale` argv. */
  protected override composeArgs(): string[] {
    if (this.#scales.length === 0) {
      throw new Error(
        "DockerComposeTasks.scale: at least one service is required (use " +
          ".scale(service, replicas)).",
      );
    }
    const argv = ["scale"];
    if (this.#noDeps) argv.push("--no-deps");
    argv.push(...this.#scales);
    return argv;
  }
}

/**
 * Settings for `compose wait`.
 *
 * The command blocks until the named services' containers stop, then exits
 * with the first container's own exit status. That makes its exit code a
 * result rather than a failure — see {@link DockerComposeTasks.waitExitCode},
 * which hands the code back instead of failing the target.
 */
export class DockerComposeWaitSettings extends DockerComposeSettings {
  #services: string[] = [];
  #downProject = false;

  /** The services to wait on (required). */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /**
   * Tear the project down once the first container stops (`--down-project`),
   * so a test run cleans up after itself without a second command.
   */
  downProject(): this {
    this.#downProject = true;
    return this;
  }

  /** Assemble the `compose wait` argv. */
  protected override composeArgs(): string[] {
    if (this.#services.length === 0) {
      throw new Error(
        "DockerComposeTasks.wait: at least one service is required (use " +
          ".services()). Compose waits on named services, not on the whole " +
          "project.",
      );
    }
    const argv = ["wait"];
    if (this.#downProject) argv.push("--down-project");
    argv.push(...this.#services);
    return argv;
  }
}
