# @zuke/docker-compose

Typed Docker Compose task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `up`, `down`,
`build`, `pull`, `push`, `run`, `exec`, `logs`, `ps`, `config`, `start`, `stop`,
`restart`, and `rm` — in a fluent settings-lambda API. Arguments stay a discrete
argv array, so command construction is injection-free.

Compose ships in two shapes: the v2 CLI plugin invoked as `docker compose` and
the legacy v1 standalone binary `docker-compose`. This wrapper detects which is
installed at run time (preferring the v2 plugin) and caches the result, so the
same build file works on either host. Pin the form explicitly with
`.usePlugin()` or `.useStandalone()` to skip detection.

```ts
import { DockerComposeTasks } from "jsr:@zuke/docker-compose";

await DockerComposeTasks.up((s) => s.file("compose.yml").detach().build());
await DockerComposeTasks.logs((s) => s.follow().tail(100));
await DockerComposeTasks.down((s) => s.volumes());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/docker-compose` — typed Docker Compose task wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it. The wrapper detects whether Compose is installed as the v2 plugin
(`docker compose`) or the v1 standalone binary (`docker-compose`) at run
time, so the same build works on either host.

```ts
import { DockerComposeTasks } from "jsr:@zuke/docker-compose";

await DockerComposeTasks.up((s) => s.file("compose.yml").detach().build());
await DockerComposeTasks.logs((s) => s.follow().tail(100));
await DockerComposeTasks.down((s) => s.volumes());
```
@module

async function defaultComposeProbe(argv: readonly string[]): Promise<boolean>
  The default {@link ComposeProbe}: run the candidate's `version` subcommand
  quietly and treat a zero exit as success. A missing binary resolves to
  `false` rather than throwing, so detection can fall through to the next
  candidate.

function resetComposeInvocationCache_(): void
  Clear the cached Compose invocation so the next
  {@link resolveComposeInvocation} re-detects. Internal test seam — the
  trailing underscore signals it is not part of the stable public API.

function resolveComposeInvocation(probe: ComposeProbe): Promise<string[]>
  Resolve how Docker Compose is invoked on this host: `["docker", "compose"]`
  for the v2 plugin or `["docker-compose"]` for the v1 standalone binary. The
  v2 plugin is preferred; if neither is runnable a {@link ToolNotFoundError} is
  raised. The result is cached after the first successful detection (a failed
  detection is not cached, so a later call retries). Pass a custom
  {@link ComposeProbe} to override how candidates are tested.

const DockerComposeTasks: DockerComposeTasksApi
  Typed task functions for Docker Compose (`docker compose`/`docker-compose`).

class DockerComposeBuildSettings extends DockerComposeSettings
  Settings for `compose build`.

  noCache(): this
    Do not use the layer cache (`--no-cache`).
  pull(): this
    Always attempt to pull newer base images (`--pull`).
  buildArg(key: string, value: string): this
    Pass a build-time variable (`--build-arg KEY=value`); repeatable.
  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose build` argv.

class DockerComposeConfigSettings extends DockerComposeSettings
  Settings for `compose config`.

  quietOutput(): this
    Only validate, printing nothing (`-q`).
  servicesOnly(): this
    Print the service names only (`--services`).
  volumesOnly(): this
    Print the volume names only (`--volumes`).
  format(value: string): this
    Output format (`--format`), e.g. `yaml` or `json`.
  override protected composeArgs(): string[]
    Assemble the `compose config` argv.

class DockerComposeDownSettings extends DockerComposeSettings
  Settings for `compose down`.

  volumes(): this
    Also remove named and anonymous volumes (`-v`).
  removeOrphans(): this
    Remove containers for services no longer defined (`--remove-orphans`).
  rmi(type: string): this
    Remove images of the given type (`--rmi`), e.g. `all` or `local`.
  timeout(seconds: number): this
    Shutdown timeout in seconds (`-t`).
  override protected composeArgs(): string[]
    Assemble the `compose down` argv.

class DockerComposeExecSettings extends DockerComposeSettings
  Settings for `compose exec`.

  service(name: string): this
    The service whose container to exec into (required).
  detach(): this
    Run in the background (`-d`).
  noTty(): this
    Disable pseudo-TTY allocation (`-T`).
  workdir(path: PathLike): this
    Working directory inside the container (`-w`).
  envVar(key: string, value: string): this
    Set an environment variable (`-e KEY=value`); repeatable.
  commandArgs(...args: Array<string | number>): this
    The command and arguments to execute.
  override protected composeArgs(): string[]
    Assemble the `compose exec` argv.

class DockerComposeLogsSettings extends DockerComposeSettings
  Settings for `compose logs`.

  follow(): this
    Stream new log output (`-f`).
  timestamps(): this
    Prefix each line with a timestamp (`-t`).
  tail(lines: number | "all"): this
    Show only the last N lines, or `all` (`--tail`).
  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose logs` argv.

class DockerComposePsSettings extends DockerComposeSettings
  Settings for `compose ps`.

  all(): this
    Show stopped containers too (`-a`).
  quietOutput(): this
    Only show container IDs (`-q`).
  servicesOnly(): this
    Display services instead of containers (`--services`).
  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose ps` argv.

class DockerComposePullSettings extends DockerComposeSettings
  Settings for `compose pull`.

  ignorePullFailures(): this
    Continue past services whose pull fails (`--ignore-pull-failures`).
  quietOutput(): this
    Pull without printing progress (`-q`).
  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose pull` argv.

class DockerComposePushSettings extends DockerComposeSettings
  Settings for `compose push`.

  ignorePushFailures(): this
    Continue past services whose push fails (`--ignore-push-failures`).
  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose push` argv.

class DockerComposeRestartSettings extends DockerComposeSettings
  Settings for `compose restart`.

  timeout(seconds: number): this
    Restart timeout in seconds (`-t`).
  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose restart` argv.

class DockerComposeRmSettings extends DockerComposeSettings
  Settings for `compose rm`.

  force(): this
    Do not prompt for confirmation (`-f`).
  stop(): this
    Stop the containers first if needed (`-s`).
  volumes(): this
    Also remove anonymous volumes (`-v`).
  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose rm` argv.

class DockerComposeRunSettings extends DockerComposeSettings
  Settings for `compose run`.

  service(name: string): this
    The service to run (required).
  rm(): this
    Remove the container after it exits (`--rm`).
  detach(): this
    Run in the background (`-d`).
  noDeps(): this
    Do not start linked services (`--no-deps`).
  name(value: string): this
    Assign a container name (`--name`).
  envVar(key: string, value: string): this
    Set an environment variable (`-e KEY=value`); repeatable.
  commandArgs(...args: Array<string | number>): this
    The command and arguments to run inside the container.
  override protected composeArgs(): string[]
    Assemble the `compose run` argv.

abstract class DockerComposeSettings extends ToolSettings
  Base for all Compose subcommand settings. Holds the invocation prefix
  (`docker compose` vs `docker-compose`) and the global options that precede
  every subcommand (`-f`, `-p`, `--profile`, …), and resolves the prefix at
  run time unless it was pinned with {@link usePlugin}/{@link useStandalone}.

  override protected defaultTool(): string
    The resolved binary (`docker` or `docker-compose`) for error messages.
  file(path: PathLike): this
    Add a Compose file (`-f`); repeatable, order-significant.
  projectName(name: string): this
    Set the project name (`-p`).
  profile(name: string): this
    Enable a service profile (`--profile`); repeatable.
  projectDirectory(path: PathLike): this
    Set the project working directory (`--project-directory`).
  envFile(path: PathLike): this
    Load environment from a file (`--env-file`).
  usePlugin(): this
    Force the v2 plugin form (`docker compose`) and skip detection.
  useStandalone(): this
    Force the v1 standalone form (`docker-compose`) and skip detection.
  abstract protected composeArgs(): string[]
    The subcommand argv (without global options). Must be pure — no I/O.
  override protected buildArgs(): string[]
    Assemble the global options followed by the subcommand argv.
  override async run(): Promise<CommandOutput>
    Resolve the invocation prefix (unless pinned) and run, so the same build
    works against either the v2 plugin or the v1 standalone binary.

class DockerComposeStartSettings extends DockerComposeSettings
  Settings for `compose start`.

  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose start` argv.

class DockerComposeStopSettings extends DockerComposeSettings
  Settings for `compose stop`.

  timeout(seconds: number): this
    Shutdown timeout in seconds (`-t`).
  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose stop` argv.

class DockerComposeUpSettings extends DockerComposeSettings
  Settings for `compose up`.

  detach(): this
    Run in the background (`-d`).
  build(): this
    Build images before starting (`--build`).
  forceRecreate(): this
    Recreate containers even if unchanged (`--force-recreate`).
  removeOrphans(): this
    Remove containers for services no longer defined (`--remove-orphans`).
  wait(): this
    Wait until services are running/healthy (`--wait`).
  scale(service: string, instances: number): this
    Scale a service to N instances (`--scale service=N`); repeatable.
  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose up` argv.

interface DockerComposeTasksApi
  The shape of {@link DockerComposeTasks}.

  up(configure?: Configure<DockerComposeUpSettings>): Promise<CommandOutput>
    Create and start services: `compose up`.
  down(configure?: Configure<DockerComposeDownSettings>): Promise<CommandOutput>
    Stop and remove services: `compose down`.
  build(configure?: Configure<DockerComposeBuildSettings>): Promise<CommandOutput>
    Build service images: `compose build`.
  pull(configure?: Configure<DockerComposePullSettings>): Promise<CommandOutput>
    Pull service images: `compose pull`.
  push(configure?: Configure<DockerComposePushSettings>): Promise<CommandOutput>
    Push service images: `compose push`.
  run(configure?: Configure<DockerComposeRunSettings>): Promise<CommandOutput>
    Run a one-off command: `compose run`.
  exec(configure?: Configure<DockerComposeExecSettings>): Promise<CommandOutput>
    Exec into a running service: `compose exec`.
  logs(configure?: Configure<DockerComposeLogsSettings>): Promise<CommandOutput>
    View service logs: `compose logs`.
  ps(configure?: Configure<DockerComposePsSettings>): Promise<CommandOutput>
    List containers: `compose ps`.
  config(configure?: Configure<DockerComposeConfigSettings>): Promise<CommandOutput>
    Render the resolved configuration: `compose config`.
  start(configure?: Configure<DockerComposeStartSettings>): Promise<CommandOutput>
    Start existing services: `compose start`.
  stop(configure?: Configure<DockerComposeStopSettings>): Promise<CommandOutput>
    Stop running services: `compose stop`.
  restart(configure?: Configure<DockerComposeRestartSettings>): Promise<CommandOutput>
    Restart services: `compose restart`.
  rm(configure?: Configure<DockerComposeRmSettings>): Promise<CommandOutput>
    Remove stopped service containers: `compose rm`.

type ComposeProbe = (argv: readonly string[]) => Promise<boolean>
  Probes whether a candidate Compose invocation is runnable on this host.
  Receives the binary-and-prefix argv (`["docker", "compose"]` or
  `["docker-compose"]`) and resolves to `true` when it works. Injectable so
  detection can be unit-tested without a real Docker install.
````

</details>

<!-- ZUKE:API:END -->
