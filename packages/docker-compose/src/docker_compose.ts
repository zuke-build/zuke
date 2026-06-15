/**
 * `DockerComposeTasks` — typed task functions for Docker Compose, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { DockerComposeTasks } from "jsr:@zuke/docker-compose";
 * await DockerComposeTasks.up((s) => s.file("compose.yml").detach());
 * await DockerComposeTasks.down((s) => s.volumes());
 * ```
 *
 * Compose ships in two shapes: the v2 CLI plugin invoked as `docker compose`
 * and the legacy v1 standalone binary `docker-compose`. This wrapper detects
 * which one is installed at run time (preferring the v2 plugin) and caches the
 * result, so the same build file works on either host. Pin the form explicitly
 * with {@link DockerComposeSettings.usePlugin} or
 * {@link DockerComposeSettings.useStandalone} to skip detection.
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { Command, type CommandOutput } from "@zuke/core/shell";

/**
 * Probes whether a candidate Compose invocation is runnable on this host.
 * Receives the binary-and-prefix argv (`["docker", "compose"]` or
 * `["docker-compose"]`) and resolves to `true` when it works. Injectable so
 * detection can be unit-tested without a real Docker install.
 */
export type ComposeProbe = (argv: readonly string[]) => Promise<boolean>;

/**
 * The default {@link ComposeProbe}: run the candidate's `version` subcommand
 * quietly and treat a zero exit as success. A missing binary resolves to
 * `false` rather than throwing, so detection can fall through to the next
 * candidate.
 */
export async function defaultComposeProbe(
  argv: readonly string[],
): Promise<boolean> {
  try {
    const out = await new Command([...argv, "version"]).noThrow().quiet();
    return out.code === 0;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

let cached: Promise<string[]> | undefined;

/** Detect the installed Compose invocation, preferring the v2 plugin. */
async function detect(probe: ComposeProbe): Promise<string[]> {
  if (await probe(["docker", "compose"])) return ["docker", "compose"];
  if (await probe(["docker-compose"])) return ["docker-compose"];
  throw new ToolNotFoundError("docker compose");
}

/**
 * Resolve how Docker Compose is invoked on this host: `["docker", "compose"]`
 * for the v2 plugin or `["docker-compose"]` for the v1 standalone binary. The
 * v2 plugin is preferred; if neither is runnable a {@link ToolNotFoundError} is
 * raised. The result is cached after the first successful detection (a failed
 * detection is not cached, so a later call retries). Pass a custom
 * {@link ComposeProbe} to override how candidates are tested.
 */
export function resolveComposeInvocation(
  probe: ComposeProbe = defaultComposeProbe,
): Promise<string[]> {
  if (cached === undefined) {
    cached = detect(probe).catch((error) => {
      cached = undefined;
      throw error;
    });
  }
  return cached;
}

/**
 * Clear the cached Compose invocation so the next
 * {@link resolveComposeInvocation} re-detects. Internal test seam — the
 * trailing underscore signals it is not part of the stable public API.
 */
export function resetComposeInvocationCache_(): void {
  cached = undefined;
}

/**
 * Base for all Compose subcommand settings. Holds the invocation prefix
 * (`docker compose` vs `docker-compose`) and the global options that precede
 * every subcommand (`-f`, `-p`, `--profile`, …), and resolves the prefix at
 * run time unless it was pinned with {@link usePlugin}/{@link useStandalone}.
 */
export abstract class DockerComposeSettings extends ToolSettings {
  #invocation: string[] = ["docker", "compose"];
  #detect = true;
  #files: string[] = [];
  #projectName?: string;
  #profiles: string[] = [];
  #projectDirectory?: string;
  #envFile?: string;

  protected override defaultTool(): string {
    return this.#invocation[0] ?? "docker";
  }

  /** Add a Compose file (`-f`); repeatable, order-significant. */
  file(path: string): this {
    this.#files.push("-f", path);
    return this;
  }

  /** Set the project name (`-p`). */
  projectName(name: string): this {
    this.#projectName = name;
    return this;
  }

  /** Enable a service profile (`--profile`); repeatable. */
  profile(name: string): this {
    this.#profiles.push("--profile", name);
    return this;
  }

  /** Set the project working directory (`--project-directory`). */
  projectDirectory(path: string): this {
    this.#projectDirectory = path;
    return this;
  }

  /** Load environment from a file (`--env-file`). */
  envFile(path: string): this {
    this.#envFile = path;
    return this;
  }

  /** Force the v2 plugin form (`docker compose`) and skip detection. */
  usePlugin(): this {
    this.#invocation = ["docker", "compose"];
    this.#detect = false;
    return this;
  }

  /** Force the v1 standalone form (`docker-compose`) and skip detection. */
  useStandalone(): this {
    this.#invocation = ["docker-compose"];
    this.#detect = false;
    return this;
  }

  /** The subcommand argv (without global options). Must be pure — no I/O. */
  protected abstract composeArgs(): string[];

  protected override buildArgs(): string[] {
    const argv = this.#invocation.slice(1);
    argv.push(...this.#files);
    if (this.#projectName !== undefined) argv.push("-p", this.#projectName);
    argv.push(...this.#profiles);
    if (this.#projectDirectory !== undefined) {
      argv.push("--project-directory", this.#projectDirectory);
    }
    if (this.#envFile !== undefined) argv.push("--env-file", this.#envFile);
    argv.push(...this.composeArgs());
    return argv;
  }

  /**
   * Resolve the invocation prefix (unless pinned) and run, so the same build
   * works against either the v2 plugin or the v1 standalone binary.
   */
  override async run(): Promise<CommandOutput> {
    if (this.#detect) this.#invocation = await resolveComposeInvocation();
    return super.run();
  }
}

/** Settings for `compose up`. */
export class DockerComposeUpSettings extends DockerComposeSettings {
  #detach = false;
  #build = false;
  #forceRecreate = false;
  #removeOrphans = false;
  #wait = false;
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

  protected override composeArgs(): string[] {
    const argv = ["up"];
    if (this.#detach) argv.push("-d");
    if (this.#build) argv.push("--build");
    if (this.#forceRecreate) argv.push("--force-recreate");
    if (this.#removeOrphans) argv.push("--remove-orphans");
    if (this.#wait) argv.push("--wait");
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

  protected override composeArgs(): string[] {
    const argv = ["down"];
    if (this.#volumes) argv.push("-v");
    if (this.#removeOrphans) argv.push("--remove-orphans");
    if (this.#rmi !== undefined) argv.push("--rmi", this.#rmi);
    if (this.#timeout !== undefined) argv.push("-t", String(this.#timeout));
    return argv;
  }
}

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

  protected override composeArgs(): string[] {
    const argv = ["push"];
    if (this.#ignorePushFailures) argv.push("--ignore-push-failures");
    argv.push(...this.#services);
    return argv;
  }
}

/** Settings for `compose run`. */
export class DockerComposeRunSettings extends DockerComposeSettings {
  #service?: string;
  #rm = false;
  #detach = false;
  #noDeps = false;
  #name?: string;
  #env: string[] = [];
  #commandArgs: string[] = [];

  /** The service to run (required). */
  service(name: string): this {
    this.#service = name;
    return this;
  }

  /** Remove the container after it exits (`--rm`). */
  rm(): this {
    this.#rm = true;
    return this;
  }

  /** Run in the background (`-d`). */
  detach(): this {
    this.#detach = true;
    return this;
  }

  /** Do not start linked services (`--no-deps`). */
  noDeps(): this {
    this.#noDeps = true;
    return this;
  }

  /** Assign a container name (`--name`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Set an environment variable (`-e KEY=value`); repeatable. */
  envVar(key: string, value: string): this {
    this.#env.push("-e", `${key}=${value}`);
    return this;
  }

  /** The command and arguments to run inside the container. */
  commandArgs(...args: Array<string | number>): this {
    this.#commandArgs.push(...args.map(String));
    return this;
  }

  protected override composeArgs(): string[] {
    if (this.#service === undefined) {
      throw new Error("DockerComposeTasks.run: .service() is required.");
    }
    const argv = ["run"];
    if (this.#rm) argv.push("--rm");
    if (this.#detach) argv.push("-d");
    if (this.#noDeps) argv.push("--no-deps");
    if (this.#name !== undefined) argv.push("--name", this.#name);
    argv.push(...this.#env, this.#service, ...this.#commandArgs);
    return argv;
  }
}

/** Settings for `compose exec`. */
export class DockerComposeExecSettings extends DockerComposeSettings {
  #service?: string;
  #detach = false;
  #noTty = false;
  #workdir?: string;
  #env: string[] = [];
  #commandArgs: string[] = [];

  /** The service whose container to exec into (required). */
  service(name: string): this {
    this.#service = name;
    return this;
  }

  /** Run in the background (`-d`). */
  detach(): this {
    this.#detach = true;
    return this;
  }

  /** Disable pseudo-TTY allocation (`-T`). */
  noTty(): this {
    this.#noTty = true;
    return this;
  }

  /** Working directory inside the container (`-w`). */
  workdir(path: string): this {
    this.#workdir = path;
    return this;
  }

  /** Set an environment variable (`-e KEY=value`); repeatable. */
  envVar(key: string, value: string): this {
    this.#env.push("-e", `${key}=${value}`);
    return this;
  }

  /** The command and arguments to execute. */
  commandArgs(...args: Array<string | number>): this {
    this.#commandArgs.push(...args.map(String));
    return this;
  }

  protected override composeArgs(): string[] {
    if (this.#service === undefined) {
      throw new Error("DockerComposeTasks.exec: .service() is required.");
    }
    const argv = ["exec"];
    if (this.#detach) argv.push("-d");
    if (this.#noTty) argv.push("-T");
    if (this.#workdir !== undefined) argv.push("-w", this.#workdir);
    argv.push(...this.#env, this.#service, ...this.#commandArgs);
    return argv;
  }
}

/** Settings for `compose logs`. */
export class DockerComposeLogsSettings extends DockerComposeSettings {
  #follow = false;
  #timestamps = false;
  #tail?: string;
  #services: string[] = [];

  /** Stream new log output (`-f`). */
  follow(): this {
    this.#follow = true;
    return this;
  }

  /** Prefix each line with a timestamp (`-t`). */
  timestamps(): this {
    this.#timestamps = true;
    return this;
  }

  /** Show only the last N lines, or `all` (`--tail`). */
  tail(lines: number | "all"): this {
    this.#tail = String(lines);
    return this;
  }

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  protected override composeArgs(): string[] {
    const argv = ["logs"];
    if (this.#follow) argv.push("-f");
    if (this.#timestamps) argv.push("-t");
    if (this.#tail !== undefined) argv.push("--tail", this.#tail);
    argv.push(...this.#services);
    return argv;
  }
}

/** Settings for `compose ps`. */
export class DockerComposePsSettings extends DockerComposeSettings {
  #all = false;
  #quiet = false;
  #services = false;
  #serviceNames: string[] = [];

  /** Show stopped containers too (`-a`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Only show container IDs (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Display services instead of containers (`--services`). */
  servicesOnly(): this {
    this.#services = true;
    return this;
  }

  /** Restrict to specific services (positional); optional. */
  services(...names: string[]): this {
    this.#serviceNames.push(...names);
    return this;
  }

  protected override composeArgs(): string[] {
    const argv = ["ps"];
    if (this.#all) argv.push("-a");
    if (this.#quiet) argv.push("-q");
    if (this.#services) argv.push("--services");
    argv.push(...this.#serviceNames);
    return argv;
  }
}

/** Settings for `compose config`. */
export class DockerComposeConfigSettings extends DockerComposeSettings {
  #quiet = false;
  #servicesOnly = false;
  #volumesOnly = false;
  #format?: string;

  /** Only validate, printing nothing (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Print the service names only (`--services`). */
  servicesOnly(): this {
    this.#servicesOnly = true;
    return this;
  }

  /** Print the volume names only (`--volumes`). */
  volumesOnly(): this {
    this.#volumesOnly = true;
    return this;
  }

  /** Output format (`--format`), e.g. `yaml` or `json`. */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  protected override composeArgs(): string[] {
    const argv = ["config"];
    if (this.#quiet) argv.push("-q");
    if (this.#servicesOnly) argv.push("--services");
    if (this.#volumesOnly) argv.push("--volumes");
    if (this.#format !== undefined) argv.push("--format", this.#format);
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

  protected override composeArgs(): string[] {
    const argv = ["rm"];
    if (this.#force) argv.push("-f");
    if (this.#stop) argv.push("-s");
    if (this.#volumes) argv.push("-v");
    argv.push(...this.#services);
    return argv;
  }
}

/** The shape of {@link DockerComposeTasks}. */
export interface DockerComposeTasksApi {
  /** Create and start services: `compose up`. */
  up(configure?: Configure<DockerComposeUpSettings>): Promise<CommandOutput>;
  /** Stop and remove services: `compose down`. */
  down(
    configure?: Configure<DockerComposeDownSettings>,
  ): Promise<CommandOutput>;
  /** Build service images: `compose build`. */
  build(
    configure?: Configure<DockerComposeBuildSettings>,
  ): Promise<CommandOutput>;
  /** Pull service images: `compose pull`. */
  pull(
    configure?: Configure<DockerComposePullSettings>,
  ): Promise<CommandOutput>;
  /** Push service images: `compose push`. */
  push(
    configure?: Configure<DockerComposePushSettings>,
  ): Promise<CommandOutput>;
  /** Run a one-off command: `compose run`. */
  run(configure?: Configure<DockerComposeRunSettings>): Promise<CommandOutput>;
  /** Exec into a running service: `compose exec`. */
  exec(
    configure?: Configure<DockerComposeExecSettings>,
  ): Promise<CommandOutput>;
  /** View service logs: `compose logs`. */
  logs(
    configure?: Configure<DockerComposeLogsSettings>,
  ): Promise<CommandOutput>;
  /** List containers: `compose ps`. */
  ps(configure?: Configure<DockerComposePsSettings>): Promise<CommandOutput>;
  /** Render the resolved configuration: `compose config`. */
  config(
    configure?: Configure<DockerComposeConfigSettings>,
  ): Promise<CommandOutput>;
  /** Start existing services: `compose start`. */
  start(
    configure?: Configure<DockerComposeStartSettings>,
  ): Promise<CommandOutput>;
  /** Stop running services: `compose stop`. */
  stop(
    configure?: Configure<DockerComposeStopSettings>,
  ): Promise<CommandOutput>;
  /** Restart services: `compose restart`. */
  restart(
    configure?: Configure<DockerComposeRestartSettings>,
  ): Promise<CommandOutput>;
  /** Remove stopped service containers: `compose rm`. */
  rm(configure?: Configure<DockerComposeRmSettings>): Promise<CommandOutput>;
}

/** Typed task functions for Docker Compose (`docker compose`/`docker-compose`). */
export const DockerComposeTasks: DockerComposeTasksApi = {
  up(
    configure?: Configure<DockerComposeUpSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeUpSettings(), configure);
  },
  down(
    configure?: Configure<DockerComposeDownSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeDownSettings(), configure);
  },
  build(
    configure?: Configure<DockerComposeBuildSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeBuildSettings(), configure);
  },
  pull(
    configure?: Configure<DockerComposePullSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposePullSettings(), configure);
  },
  push(
    configure?: Configure<DockerComposePushSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposePushSettings(), configure);
  },
  run(
    configure?: Configure<DockerComposeRunSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeRunSettings(), configure);
  },
  exec(
    configure?: Configure<DockerComposeExecSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeExecSettings(), configure);
  },
  logs(
    configure?: Configure<DockerComposeLogsSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeLogsSettings(), configure);
  },
  ps(
    configure?: Configure<DockerComposePsSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposePsSettings(), configure);
  },
  config(
    configure?: Configure<DockerComposeConfigSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeConfigSettings(), configure);
  },
  start(
    configure?: Configure<DockerComposeStartSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeStartSettings(), configure);
  },
  stop(
    configure?: Configure<DockerComposeStopSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeStopSettings(), configure);
  },
  restart(
    configure?: Configure<DockerComposeRestartSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeRestartSettings(), configure);
  },
  rm(
    configure?: Configure<DockerComposeRmSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DockerComposeRmSettings(), configure);
  },
};
