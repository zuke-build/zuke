# @zuke/docker-compose

Typed Docker Compose task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API: `up`, `down`, `create`, `start`, `stop`, `restart`,
`pause`, `unpause`, `kill`, `rm`, `scale` and `wait`; `build`, `pull`, `push`,
`images` and `commit`; `run`, `exec`, `cp`, `top`, `export` and `logs`; and
`ps`, `config`, `ls`, `volumes`, `port`, `events` and `version`. Arguments stay
a discrete argv array, so command construction is injection-free.

## Readers

Three tasks return a value rather than an exit code, for the questions a build
actually asks of a running project. `servicePort` reports the host port a
service was published on — the point of letting Compose pick an ephemeral port
is asking which one it picked. `waitExitCode` hands back the status the
waited-on container stopped with, which is how a containerised test suite
reports its verdict. `composeVersion` reports the installed Compose version.

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

class DockerComposeCommitSettings extends DockerComposeSettings
  Settings for `compose commit`.

  service(name: string): this
    The service whose container to commit (required).
  reference(value: string): this
    The image reference to create, e.g. `my-app:test`.
  author(value: string): this
    Image author (`--author`).
  message(value: string): this
    Commit message (`--message`).
  change(...instructions: string[]): this
    Apply a Dockerfile instruction to the created image (`--change`).
  index(value: number): this
    Pick the replica to commit when the service has several (`--index`).
  noPause(): this
    Leave the container running during the commit (`--pause=false`). Compose
    pauses it by default so the filesystem cannot change mid-capture; turning
    that off trades a consistent image for uninterrupted service.
  override protected composeArgs(): string[]
    Assemble the `compose commit` argv.

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

class DockerComposeCpSettings extends DockerComposeSettings
  Settings for `compose cp`.

  Compose copies between a service container and the local filesystem, so
  exactly one side names a service. Naming both or neither is refused rather
  than handed to Compose as a path it cannot resolve.

  fromService(service: string, path: PathLike): this
    Copy out of `service` at `path` (`SERVICE:PATH`).
  fromLocal(path: PathLike): this
    Copy out of a local path.
  toService(service: string, path: PathLike): this
    Copy into `service` at `path` (`SERVICE:PATH`).
  toLocal(path: PathLike): this
    Copy into a local path.
  index(value: number): this
    Pick the replica to copy from when the service has several (`--index`).
  all(): this
    Include containers created by `compose run` (`--all`).
  archive(): this
    Preserve uid/gid information (`--archive`).
  followLink(): this
    Follow symbolic links in the source path (`--follow-link`).
  override protected composeArgs(): string[]
    Assemble the `compose cp` argv.

class DockerComposeCreateSettings extends DockerComposeSettings
  Settings for `compose create`.

  services(...names: string[]): this
    Restrict creation to these services.
  build(): this
    Build images before creating containers (`--build`).
  noBuild(): this
    Never build, whatever the policy says (`--no-build`).
  forceRecreate(): this
    Recreate containers even when their configuration has not changed (`--force-recreate`).
  noRecreate(): this
    Leave existing containers in place (`--no-recreate`).
  removeOrphans(): this
    Remove containers for services no longer in the file (`--remove-orphans`).
  quietPull(): this
    Pull without progress output (`--quiet-pull`).
  pull(policy: DockerComposePullPolicy): this
    When to pull images before creating (`--pull`).
  scale(service: string, replicas: number): this
    Create `replicas` containers for `service` (`--scale`).
  yes(): this
    Answer every prompt affirmatively (`--yes`), so an unattended run cannot stall.
  override protected composeArgs(): string[]
    Assemble the `compose create` argv.

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

class DockerComposeEventsSettings extends DockerComposeSettings
  Settings for `compose events`.

  services(...names: string[]): this
    Restrict the stream to these services.
  json(): this
    Emit each event as a JSON object (`--json`).
  since(timestamp: string): this
    Include events since a timestamp (`--since`).
  until(timestamp: string): this
    Stop streaming at a timestamp (`--until`).

    Without it the command streams until interrupted, so a build target that
    awaits it blocks — bound the run with this or with `.killAfter(ms)`.
  override protected composeArgs(): string[]
    Assemble the `compose events` argv.

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

class DockerComposeExportSettings extends DockerComposeSettings
  Settings for `compose export`.

  service(name: string): this
    The service whose container filesystem to export (required).
  output(path: PathLike): this
    Write the tar archive to a file (`--output`) instead of stdout. Prefer it:
    a tar stream captured as the command's stdout goes through Zuke's output
    buffer, which is text-shaped and size-capped.
  index(value: number): this
    Pick the replica to export when the service has several (`--index`).
  override protected composeArgs(): string[]
    Assemble the `compose export` argv.

class DockerComposeImagesSettings extends DockerComposeListingSettings
  Settings for `compose images`.

  services(...names: string[]): this
    Restrict the listing to these services.
  override protected composeArgs(): string[]
    Assemble the `compose images` argv.

class DockerComposeKillSettings extends DockerComposeSettings
  Settings for `compose kill`.

  services(...names: string[]): this
    Restrict the kill to these services.
  signal(name: string): this
    The signal to send (`--signal`), `SIGKILL` by default. Send `SIGTERM` to
    let a service run its shutdown path — `kill` skips the grace period `stop`
    gives it.
  removeOrphans(): this
    Remove containers for services no longer in the file (`--remove-orphans`).
  override protected composeArgs(): string[]
    Assemble the `compose kill` argv.

abstract class DockerComposeListingSettings extends DockerComposeSettings
  Shared by the listing subcommands that accept `--format` and `--quiet`.

  `--format json` is what makes these readable by a build rather than by a
  person, so the convenience {@link json} spells it rather than leaving the
  caller to remember the value.

  format(value: string): this
    Format the output (`--format`), e.g. `table` or `json`.
  json(): this
    Emit JSON (`--format json`).
  quietOutput(): this
    Print only identifiers or names (`--quiet`).
  protected listingFlags(): string[]
    The shared listing flags, in the CLI's own order.

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

class DockerComposeLsSettings extends DockerComposeListingSettings
  Settings for `compose ls`, which lists Compose projects rather than services.

  all(): this
    Include stopped projects (`--all`).
  filter(expression: string): this
    Filter the listing (`--filter`), e.g. `name=my-project`.
  override protected composeArgs(): string[]
    Assemble the `compose ls` argv.

class DockerComposePauseSettings extends DockerComposeServiceListSettings
  Settings for `compose pause`.

  override protected get subcommand(): string
    The subcommand this class renders.

class DockerComposePortSettings extends DockerComposeSettings
  Settings for `compose port`, which prints the host address a service's
  container port was published on.

  service(name: string): this
    The service to ask about (required).
  privatePort(port: number): this
    The container-side port to look up (required).
  protocol(value: "tcp" | "udp"): this
    The protocol of the binding (`--protocol`), `tcp` by default.
  index(value: number): this
    Pick the replica to ask when the service has several (`--index`).
  override protected composeArgs(): string[]
    Assemble the `compose port` argv.

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

class DockerComposeScaleSettings extends DockerComposeSettings
  Settings for `compose scale`.

  scale(service: string, replicas: number): this
    Scale `service` to `replicas` instances; repeatable (required).
  noDeps(): this
    Do not start linked services (`--no-deps`).
  override protected composeArgs(): string[]
    Assemble the `compose scale` argv.

abstract class DockerComposeServiceListSettings extends DockerComposeSettings
  Settings shared by `compose pause` and `compose unpause`, which take only a
  service list.

  services(...names: string[]): this
    Restrict the command to these services.
  abstract protected get subcommand(): string
    The subcommand this class renders.
  override protected composeArgs(): string[]
    Assemble the subcommand argv.

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

class DockerComposeTopSettings extends DockerComposeSettings
  Settings for `compose top`.

  services(...names: string[]): this
    Restrict the report to these services.
  override protected composeArgs(): string[]
    Assemble the `compose top` argv.

class DockerComposeUnpauseSettings extends DockerComposeServiceListSettings
  Settings for `compose unpause`.

  override protected get subcommand(): string
    The subcommand this class renders.

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
  abortOnContainerExit(): this
    Stop all containers if any container stops (`--abort-on-container-exit`).
  noDeps(): this
    Start only the named services, leaving their dependencies alone
    (`--no-deps`).

    Without it compose starts or recreates a dependency that is stopped or
    whose configuration changed. With an already-healthy stack the two agree,
    so the difference shows up only on the runs where a dependency was not
    ready — which is where a target that meant "just this service" wants to be
    explicit.
  pull(policy: DockerComposePullPolicy): this
    When to fetch images before starting (`--pull`). `always` keeps a stack on
    the current published images rather than whatever was pulled last;
    `missing` fetches only what is absent locally; `never` uses what is there.

    Distinct from `DockerComposeBuildSettings.pull`, which is `build --pull`,
    and from the `pull` task, which is the subcommand — each mirrors its own
    command.
  exitCodeFrom(service: string): this
    Exit with this service's container's exit code (`--exit-code-from`).
  scale(service: string, instances: number): this
    Scale a service to N instances (`--scale service=N`); repeatable.
  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose up` argv.

class DockerComposeVersionSettings extends DockerComposeSettings
  Settings for `compose version`.

  format(value: string): this
    Format the output (`--format`), `pretty` or `json`.
  json(): this
    Emit JSON (`--format json`).
  short(): this
    Print only the version number (`--short`).
  override protected composeArgs(): string[]
    Assemble the `compose version` argv.

class DockerComposeVolumesSettings extends DockerComposeListingSettings
  Settings for `compose volumes`.

  services(...names: string[]): this
    Restrict the listing to the volumes these services use.
  override protected composeArgs(): string[]
    Assemble the `compose volumes` argv.

class DockerComposeWaitSettings extends DockerComposeSettings
  Settings for `compose wait`.

  The command blocks until the named services' containers stop, then exits
  with the first container's own exit status. That makes its exit code a
  result rather than a failure — see {@link DockerComposeTasks.waitExitCode},
  which hands the code back instead of failing the target.

  services(...names: string[]): this
    The services to wait on (required).
  downProject(): this
    Tear the project down once the first container stops (`--down-project`),
    so a test run cleans up after itself without a second command.
  override protected composeArgs(): string[]
    Assemble the `compose wait` argv.

class ReplicaIndex
  The `--index` flag that picks one replica of a scaled service.

  `cp`, `export`, `commit` and `port` all take it with the same meaning and
  the same rendering, so they hold one of these rather than four copies of
  the field and the `argv.push` that goes with it. Each still exposes its own
  setter, because the public surface is per-command.

  set(value: number): void
    Record the replica to act on.
  render(): string[]
    The flag, if one was set.

class ServiceList
  The trailing service-name operands most Compose subcommands accept.

  Same reasoning as {@link ReplicaIndex}: the list and the way it is appended
  are identical wherever it appears, so it lives here once. Each settings
  class still exposes its own `services()` setter, because which subcommands
  take the operand — and what it means for each — is part of the public
  surface.

  add(names: readonly string[]): void
    Add service names to the list.
  get isEmpty(): boolean
    Whether any service was named.
  render(): string[]
    The names, in the order they were added.

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
  create(configure?: Configure<DockerComposeCreateSettings>): Promise<CommandOutput>
    Create containers without starting them: `compose create`.
  kill(configure?: Configure<DockerComposeKillSettings>): Promise<CommandOutput>
    Force-stop service containers: `compose kill`.
  pause(configure?: Configure<DockerComposePauseSettings>): Promise<CommandOutput>
    Pause services: `compose pause`.
  unpause(configure?: Configure<DockerComposeUnpauseSettings>): Promise<CommandOutput>
    Resume paused services: `compose unpause`.
  scale(configure?: Configure<DockerComposeScaleSettings>): Promise<CommandOutput>
    Set service replica counts: `compose scale`.
  wait(configure?: Configure<DockerComposeWaitSettings>): Promise<CommandOutput>
    Block until services stop: `compose wait`.

    Keeps the ordinary contract — a non-zero container status fails the
    target. Use {@link DockerComposeTasksApi.waitExitCode} when the status is
    the answer rather than a failure.
  cp(configure?: Configure<DockerComposeCpSettings>): Promise<CommandOutput>
    Copy between a service container and the local filesystem: `compose cp`.
  top(configure?: Configure<DockerComposeTopSettings>): Promise<CommandOutput>
    Show running processes: `compose top`.
  export(configure?: Configure<DockerComposeExportSettings>): Promise<CommandOutput>
    Export a container filesystem as a tar archive: `compose export`.
  commit(configure?: Configure<DockerComposeCommitSettings>): Promise<CommandOutput>
    Create an image from a container: `compose commit`.
  images(configure?: Configure<DockerComposeImagesSettings>): Promise<CommandOutput>
    List the images the containers use: `compose images`.
  volumes(configure?: Configure<DockerComposeVolumesSettings>): Promise<CommandOutput>
    List the project's volumes: `compose volumes`.
  ls(configure?: Configure<DockerComposeLsSettings>): Promise<CommandOutput>
    List Compose projects: `compose ls`.
  version(configure?: Configure<DockerComposeVersionSettings>): Promise<CommandOutput>
    Report the Compose version: `compose version`.
  port(configure?: Configure<DockerComposePortSettings>): Promise<CommandOutput>
    Print a published port binding: `compose port`.
  events(configure?: Configure<DockerComposeEventsSettings>): Promise<CommandOutput>
    Stream container events: `compose events`.
  waitExitCode(configure?: Configure<DockerComposeWaitSettings>): Promise<number>
    The exit status the waited-on container stopped with.

    `compose wait` exits with the container's own status, so every code is a
    legitimate answer and none is left to mean "compose broke". This hands the
    code back rather than failing the target, and still fails when compose
    never reached a container at all.
  servicePort(configure?: Configure<DockerComposePortSettings>): Promise<number>
    The host port a service's container port was published on.

    The point of letting Compose pick an ephemeral port is asking which one it
    picked, which is what this returns.
  composeVersion(configure?: Configure<DockerComposeVersionSettings>): Promise<DockerComposeVersion>
    The installed Compose version, parsed from `compose version --format json`.

interface DockerComposeVersion
  The version report `compose version --format json` emits.

  version: string
    The Compose version string, e.g. `v5.1.1`.

type ComposeProbe = (argv: readonly string[]) => Promise<boolean>
  Probes whether a candidate Compose invocation is runnable on this host.
  Receives the binary-and-prefix argv (`["docker", "compose"]` or
  `["docker-compose"]`) and resolves to `true` when it works. Injectable so
  detection can be unit-tested without a real Docker install.

type DockerComposePullPolicy = "always" | "missing" | "never"
  When `compose up` fetches images before starting: `always` on every start,
  `missing` only when the image is absent locally, `never` at all.
````

</details>

<!-- ZUKE:API:END -->
