# @zuke/docker

Typed [`docker`](https://docs.docker.com/reference/cli/docker/) task wrappers
for [Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { DockerTasks } from "jsr:@zuke/docker";

await DockerTasks.build((s) => s.tag("app:latest").file("Dockerfile"));
await DockerTasks.run((s) => s.rm().image("app:latest").commandArgs("test"));
await DockerTasks.push((s) => s.image("app:latest"));
```

Tasks, by what they do:

| Area              | Tasks                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Build             | `build`                                                                                   |
| Run               | `run`, `create`, `exec`                                                                   |
| Container life    | `start`, `stop`, `restart`, `kill`, `pause`, `unpause`, `rm`, `wait`, `rename`, `update`  |
| Container reports | `ps`, `logs`, `inspect`, `top`, `stats`, `port`, `diff`                                   |
| Moving content    | `cp`, `commit`, `export`                                                                  |
| Images            | `images`, `pull`, `push`, `tag`, `rmi`, `save`, `load`, `history`, `import`, `imagePrune` |
| Registry          | `login`, `logout`, `search`                                                               |
| Daemon            | `info`, `version`, `system`                                                               |
| Groups            | `volume`, `network`, `context`                                                            |

The swarm commands (`service`, `stack`, `node`, `secret`) are out of scope, and
`compose` has its own package,
[`@zuke/docker-compose`](https://jsr.io/@zuke/docker-compose).

## Global options

docker parses `--context`, `--host`, `--log-level`, `--config`, and `--debug`
_before_ the subcommand, so every task carries them and renders them in front:
`.dockerContext()`, `.host()`, `.logLevel()`, `.config()`, `.debug()`. That is
how a build talks to a remote daemon without exporting `DOCKER_HOST`.

`.dockerContext()` is spelled out because `docker build`'s trailing `PATH` is
also called a context, and `DockerBuildSettings.context()` already means that
one.

## Tasks that hand back values

```ts
const running = await DockerTasks.psEntries((s) => s.all()); // { id, image, names, status, state, ports }[]
const images = await DockerTasks.imageEntries(); // { id, repository, tag, size }[]
const volumes = await DockerTasks.volumeNames(); // string[]
const networks = await DockerTasks.networkNames(); // string[]
```

These pin `--format '{{json .}}'`, which emits one JSON object per line on every
docker version worth supporting — unlike `--format json`, which is recent-only.
Each line is narrowed behind a type guard, and a line that is not an object is
skipped, so a deprecation warning docker interleaves into the stream cannot lose
the whole listing.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/docker` — typed `DockerTasks` wrappers for the `docker` CLI.

```ts
import { DockerTasks } from "jsr:@zuke/docker";

await DockerTasks.build((s) => s.tag("app:latest"));
await DockerTasks.run((s) => s.rm().image("app:latest"));
const running = await DockerTasks.psEntries();
```

Typed tasks cover the everyday docker surface — building, running and
inspecting containers, moving images, the registry, and the `volume`,
`network`, `system`, and `context` groups. Four hand back parsed values
rather than raw output: `psEntries`, `imageEntries`, `volumeNames`, and
`networkNames`. The swarm commands (`service`, `stack`, `node`, `secret`)
and `compose` are out of scope; `compose` has its own package,
`@zuke/docker-compose`.
@module

const DockerTasks: DockerTasksApi
  Typed task functions for the `docker` CLI.

class DockerBuildSettings extends DockerSettings
  Settings for `docker build`.

  tag(reference: string): this
    Add an image tag (`-t`); repeatable.
  file(path: PathLike): this
    Use an explicit Dockerfile (`-f`).
  target(stage: string): this
    Build a specific stage (`--target`).
  platform(value: string): this
    Set the target platform(s) (`--platform`).
  buildArg(key: string, value: string): this
    Pass a build-time variable (`--build-arg KEY=value`); repeatable.
  noCache(): this
    Do not use the layer cache (`--no-cache`).
  pull(): this
    Always attempt to pull newer base images (`--pull`).
  push(): this
    Push the result to the registry after building (`--push`).
  context(path: PathLike): this
    The build context path or URL (default `.`).
  override protected subcommandArgs(): string[]
    Assemble the `docker build` argv.

class DockerCommitSettings extends DockerSettings
  Settings for `docker commit`.

  container(name: string): this
    The container to snapshot (required).
  reference(name: string): this
    The image name to give the snapshot (positional).
  message(text: string): this
    A commit message (`-m`/`--message`).
  author(value: string): this
    The author to record (`-a`/`--author`).
  change(...instructions: string[]): this
    Apply a Dockerfile instruction to the result (`-c`/`--change`); repeatable.
  noPause(): this
    Leave the container running while it is committed (`--pause=false`).
    docker pauses it by default, which is what makes the snapshot consistent.
  override protected subcommandArgs(): string[]
    Assemble the `docker commit` argv.

abstract class DockerContainerListSettings extends DockerSettings
  Base for the commands that act on one or more existing containers. The
  empty-list check is here so every one of them reports the same thing rather
  than letting docker print its usage.

  containers(...names: string[]): this
    Container names or ids to act on (required); repeatable.
  protected containerList(task: string): string[]
    The container list, after refusing an empty one.

abstract class DockerContainerSettings extends DockerProcessSettings
  Base for `run` and `create`, which configure a new container identically —
  docker's own `run` is `create` followed by `start`.

  image(reference: string): this
    The image to run (required).
  name(value: string): this
    Name the container (`--name`).
  rm(): this
    Remove the container when it exits (`--rm`).
  detach(): this
    Run in the background (`-d`).
  publish(host: string | number, container: string | number): this
    Publish a container port to the host (`-p`); repeatable.
  volume(source: PathLike, target: PathLike): this
    Mount a host path into the container (`-v`); repeatable.
  network(value: string): this
    Attach the container to a network (`--network`).
  entrypoint(command: string): this
    Override the image's entrypoint (`--entrypoint`).
  platform(value: string): this
    Run the image for a specific platform (`--platform`).
  pull(policy: "always" | "missing" | "never"): this
    When to pull the image (`--pull=<always|missing|never>`).
  restart(policy: string): this
    The restart policy (`--restart`), e.g. `unless-stopped`.
  label(key: string, value: string): this
    Attach metadata to the container (`--label`); repeatable.
  protected containerArgs(task: string): string[]
    Assemble everything after the subcommand: the flags, the image, and the
    command. `run` and `create` differ only in the token in front of this.

class DockerContextSettings extends DockerSettings
  Settings for `docker context`. Pick the subcommand with {@link create},
  {@link ls}, {@link use}, {@link inspect}, {@link remove}, or {@link show}.

  create(name: string): this
    Create a context (`context create <name>`).
  ls(): this
    List contexts (`context ls`), the default.
  use(name: string): this
    Make a context the default for later commands (`context use <name>`).
  inspect(...names: string[]): this
    Describe contexts (`context inspect [<name>...]`).
  remove(...names: string[]): this
    Remove contexts (`context rm <name>...`).
  show(): this
    Print the context in use (`context show`).
  dockerHost(address: string): this
    The daemon a created context points at (`--docker host=<address>`).
  description(text: string): this
    A human description for a created context (`--description`).
  from(name: string): this
    Copy an existing context (`--from <name>`).
  format(template: string): this
    Render each context through a Go template (`--format`).
  quietOutput(): this
    Only print context names (`-q`/`--quiet`).
  force(): this
    Remove even the context in use (`-f`/`--force`).
  override protected subcommandArgs(): string[]
    Assemble the `docker context` argv.

class DockerCpSettings extends DockerSettings
  Settings for `docker cp`. Either end may be a container path
  (`<container>:<path>`) — which is what makes this the way a build gets an
  artifact out of a container that has already stopped.

  from(path: PathLike): this
    The source, `<container>:<path>` or a host path (required).
  to(path: PathLike): this
    The destination, `<container>:<path>` or a host path (required).
  archive(): this
    Keep uid/gid rather than mapping to the current user (`-a`/`--archive`).
  followLink(): this
    Follow a symlink in the source (`-L`/`--follow-link`).
  override protected subcommandArgs(): string[]
    Assemble the `docker cp` argv.

class DockerCreateSettings extends DockerContainerSettings
  Settings for `docker create`.

  override protected subcommandArgs(): string[]
    Assemble the `docker create` argv.

class DockerDiffSettings extends DockerSettings
  Settings for `docker diff`.

  container(name: string): this
    The container whose filesystem changes to show (required).
  override protected subcommandArgs(): string[]
    Assemble the `docker diff` argv.

class DockerExecSettings extends DockerProcessSettings
  Settings for `docker exec`.

  container(name: string): this
    The container to run the command in (required).
  detach(): this
    Run the command in the background (`-d`).
  privileged(): this
    Give the command extended privileges (`--privileged`).
  override protected subcommandArgs(): string[]
    Assemble the `docker exec` argv.

class DockerExportSettings extends DockerSettings
  Settings for `docker export`.

  container(name: string): this
    The container whose filesystem to export (required).
  output(path: PathLike): this
    Write to a file rather than stdout (`-o`/`--output`).
  override protected subcommandArgs(): string[]
    Assemble the `docker export` argv.

class DockerHistorySettings extends DockerSettings
  Settings for `docker history`.

  image(reference: string): this
    The image whose layers to show (required).
  noTrunc(): this
    Print the full commands rather than eliding them (`--no-trunc`).
  quietOutput(): this
    Only show layer ids (`-q`/`--quiet`).
  format(template: string): this
    Render each layer through a Go template (`--format`).
  override protected subcommandArgs(): string[]
    Assemble the `docker history` argv.

class DockerImagePruneSettings extends DockerSettings
  Settings for `docker image prune`.

  all(): this
    Remove every unused image, not only the dangling ones (`--all`). This is
    the difference between reclaiming a little space and reclaiming a lot.
  force(): this
    Do not prompt for confirmation (`--force`), which a build always needs.
  filter(...expressions: string[]): this
    Limit what is pruned (`--filter`), e.g. `until=24h`; repeatable.
  override protected subcommandArgs(): string[]
    Assemble the `docker image prune` argv.

class DockerImagesSettings extends DockerSettings
  Settings for `docker images`.

  all(): this
    Show all images, including intermediate layers (`-a`).
  quietOutput(): this
    Only show image IDs (`-q`).
  filter(expression: string): this
    Filter the listing (`--filter`); repeatable.
  repository(name: string): this
    Restrict to a repository (positional argument).
  format(template: string): this
    Render each image through a Go template (`--format`), e.g.
    `{{json .}}` for one JSON object per line.
    {@link "./docker.ts".DockerTasks.imageEntries} pins that form.
  digests(): this
    Also show each image's digest (`--digests`).
  override protected subcommandArgs(): string[]
    Assemble the `docker images` argv.

class DockerImportSettings extends DockerSettings
  Settings for `docker import`.

  source(path: PathLike): this
    The tarball to import (required); `-` reads it from stdin, as docker's own
    `import` does.
  reference(name: string): this
    The image name to give the result (positional).
  message(text: string): this
    A commit message for the imported image (`-m`/`--message`).
  change(...instructions: string[]): this
    Apply a Dockerfile instruction to the result (`-c`/`--change`); repeatable.
  platform(value: string): this
    The platform to import for (`--platform`).
  override protected subcommandArgs(): string[]
    Assemble the `docker import` argv.

class DockerInfoSettings extends DockerSettings
  Settings for `docker info`.

  format(template: string): this
    Render through a Go template (`--format`), e.g. `{{json .}}`.
  override protected subcommandArgs(): string[]
    Assemble the `docker info` argv.

class DockerInspectSettings extends DockerSettings
  Settings for `docker inspect`.

  targets(...names: string[]): this
    The objects to inspect — containers, images, volumes (required).
  format(template: string): this
    Render through a Go template (`--format`), e.g. `{{.State.Status}}` for
    one field, or `{{json .}}` for the whole record as JSON.
  type(kind: string): this
    Only look for this kind of object (`--type`), e.g. `container`.
  size(): this
    Include the disk usage of a container (`-s`/`--size`).
  override protected subcommandArgs(): string[]
    Assemble the `docker inspect` argv.

class DockerKillSettings extends DockerContainerListSettings
  Settings for `docker kill`.

  signal(name: string): this
    The signal to send (`-s`/`--signal`); docker defaults to `SIGKILL`.
  override protected subcommandArgs(): string[]
    Assemble the `docker kill` argv.

class DockerLoadSettings extends DockerSettings
  Settings for `docker load`.

  input(path: PathLike): this
    Read from a tar archive instead of STDIN (`-i`).
  quietOutput(): this
    Suppress the load output (`-q`).
  override protected subcommandArgs(): string[]
    Assemble the `docker load` argv.

class DockerLoginSettings extends DockerSettings
  Settings for `docker login`.

  username(value: string): this
    The username (`-u`).
  password(value: string): this
    The password (`-p`). This lands directly in the process argv, where it
    can leak through `ps`/process listings, shell history, or CI job logs —
    {@link passwordStdin} is the safe choice in CI (and generally), since it
    pipes the secret through STDIN instead of putting it on the command line.
  passwordStdin(): this
    Read the password from STDIN (`--password-stdin`).
  registry(server: string): this
    The registry server (defaults to Docker Hub).
  override protected subcommandArgs(): string[]
    Assemble the `docker login` argv.

class DockerLogoutSettings extends DockerSettings
  Settings for `docker logout`.

  registry(server: string): this
    The registry to forget (positional); defaults to Docker Hub.
  override protected subcommandArgs(): string[]
    Assemble the `docker logout` argv.

class DockerLogsSettings extends DockerSettings
  Settings for `docker logs`.

  container(name: string): this
    The container whose logs to read (required).
  follow(): this
    Keep streaming (`-f`/`--follow`). A target that follows logs never
    returns on its own — pair it with `.killAfter(...)` from the tooling base,
    or with a container that exits.
  tail(lines: number | "all"): this
    Show only the last N lines (`--tail`), or `all`.
  since(when: string): this
    Only logs since this timestamp or relative time (`--since`), e.g. `10m`.
  until(when: string): this
    Only logs before this timestamp or relative time (`--until`).
  timestamps(): this
    Prefix each line with its timestamp (`-t`/`--timestamps`).
  details(): this
    Include the extra attributes docker records (`--details`).
  override protected subcommandArgs(): string[]
    Assemble the `docker logs` argv.

class DockerNetworkSettings extends DockerSettings
  Settings for `docker network`. Pick the subcommand with {@link create},
  {@link ls}, {@link remove}, {@link inspect}, {@link connect},
  {@link disconnect}, or {@link prune}.

  create(name: string): this
    Create a network (`network create <name>`).
  ls(): this
    List networks (`network ls`), the default.
  remove(...names: string[]): this
    Remove networks (`network rm <name>...`).
  inspect(...names: string[]): this
    Describe networks (`network inspect <name>...`).
  connect(network: string, container: string): this
    Attach a container to a network (`network connect <net> <container>`).
  disconnect(network: string, container: string): this
    Detach a container (`network disconnect <net> <container>`).
  prune(): this
    Remove the networks nothing uses (`network prune`).
  driver(name: string): this
    The network driver (`--driver`), e.g. `bridge`.
  subnet(cidr: string): this
    The subnet in CIDR form (`--subnet`).
  gateway(address: string): this
    The gateway address (`--gateway`).
  label(key: string, value: string): this
    Attach metadata (`--label`); repeatable.
  alias(name: string): this
    An extra name the container answers to on this network (`--alias`).
  filter(...expressions: string[]): this
    Filter a listing or a prune (`--filter`); repeatable.
  format(template: string): this
    Render each network through a Go template (`--format`).
    {@link "./docker.ts".DockerTasks.networkNames} pins `{{.Name}}`.
  quietOutput(): this
    Only print network ids (`-q`/`--quiet`).
  force(): this
    Do not prompt for confirmation (`--force`).
  override protected subcommandArgs(): string[]
    Assemble the `docker network` argv.

class DockerPauseSettings extends DockerContainerListSettings
  Settings for `docker pause`.

  override protected subcommandArgs(): string[]
    Assemble the `docker pause` argv.

class DockerPortSettings extends DockerSettings
  Settings for `docker port`.

  container(name: string): this
    The container whose port mappings to show (required).
  port(value: string | number): this
    A single private port to resolve, e.g. `8080/tcp`.
  override protected subcommandArgs(): string[]
    Assemble the `docker port` argv.

abstract class DockerProcessSettings extends DockerSettings
  Base for the commands that run a process — `run`, `create`, and `exec` —
  carrying the flags all three accept.

  interactive(): this
    Keep stdin open (`-i`).
  tty(): this
    Allocate a pseudo-TTY (`-t`).
  envVar(key: string, value: string): this
    Set an environment variable (`-e`); repeatable.
  envFile(...paths: PathLike[]): this
    Read environment variables from a file (`--env-file`); repeatable.
  workdir(path: PathLike): this
    Set the working directory inside the container (`-w`).
  user(value: string): this
    Run as this user or `uid:gid` (`-u`/`--user`).
  commandArgs(...args: Array<string | number>): this
    The command and arguments to run inside the container.
  protected ttyArgs(): string[]
    The `-i`/`-t` flags, which every one of these commands renders first.
  protected processArgs(): string[]
    The environment, working directory, and user flags.
  protected trailingCommand(): string[]
    The trailing command, after the container or image it runs in.

class DockerPsSettings extends DockerSettings
  Settings for `docker ps`.

  all(): this
    Show stopped containers too (`-a`).
  quietOutput(): this
    Only show container IDs (`-q`).
  filter(expression: string): this
    Filter the listing (`--filter`); repeatable.
  format(template: string): this
    Render each container through a Go template (`--format`), e.g.
    `{{json .}}` for one JSON object per line.
    {@link "./docker.ts".DockerTasks.psEntries} pins that form.
  latest(): this
    Show only the most recently created container (`-l`/`--latest`).
  noTrunc(): this
    Print ids and commands in full (`--no-trunc`).
  size(): this
    Include each container's disk usage (`-s`/`--size`).
  override protected subcommandArgs(): string[]
    Assemble the `docker ps` argv.

class DockerPullSettings extends DockerSettings
  Settings for `docker pull`.

  image(reference: string): this
    The image reference to pull (required).
  platform(value: string): this
    Pull a specific platform (`--platform`).
  quietOutput(): this
    Suppress verbose output (`-q`).
  override protected subcommandArgs(): string[]
    Assemble the `docker pull` argv.

class DockerPushSettings extends DockerSettings
  Settings for `docker push`.

  image(reference: string): this
    The image reference to push (required).
  allTags(): this
    Push every tag of the repository (`--all-tags`).
  override protected subcommandArgs(): string[]
    Assemble the `docker push` argv.

class DockerRenameSettings extends DockerSettings
  Settings for `docker rename`.

  container(name: string): this
    The container to rename (required).
  newName(name: string): this
    Its new name (required).
  override protected subcommandArgs(): string[]
    Assemble the `docker rename` argv.

class DockerRestartSettings extends DockerContainerListSettings
  Settings for `docker restart`.

  timeout(seconds: number): this
    Seconds to wait before killing the container (`-t`/`--time`).
  signal(name: string): this
    The signal to send first (`-s`/`--signal`).
  override protected subcommandArgs(): string[]
    Assemble the `docker restart` argv.

class DockerRmSettings extends DockerContainerListSettings
  Settings for `docker rm`.

  force(): this
    Force removal of a running container (`-f`).
  volumes(): this
    Also remove anonymous volumes (`-v`).
  override protected subcommandArgs(): string[]
    Assemble the `docker rm` argv.

class DockerRmiSettings extends DockerSettings
  Settings for `docker rmi`.

  images(...references: string[]): this
    The images to remove (at least one is required).
  force(): this
    Force removal (`-f`).
  override protected subcommandArgs(): string[]
    Assemble the `docker rmi` argv.

class DockerRunSettings extends DockerContainerSettings
  Settings for `docker run`.

  override protected subcommandArgs(): string[]
    Assemble the `docker run` argv.

class DockerSaveSettings extends DockerSettings
  Settings for `docker save`.

  images(...references: string[]): this
    The images to save (at least one is required).
  output(path: PathLike): this
    Write to a file instead of STDOUT (`-o`).
  override protected subcommandArgs(): string[]
    Assemble the `docker save` argv.

class DockerSearchSettings extends DockerSettings
  Settings for `docker search`.

  term(value: string): this
    What to search Docker Hub for (required).
  limit(count: number): this
    Cap the number of results (`--limit`).
  filter(...expressions: string[]): this
    Filter the results (`--filter`), e.g. `is-official=true`; repeatable.
  format(template: string): this
    Render each result through a Go template (`--format`).
  noTrunc(): this
    Print descriptions in full (`--no-trunc`).
  override protected subcommandArgs(): string[]
    Assemble the `docker search` argv.

abstract class DockerSettings extends ToolSettings
  Shared base for every `docker` subcommand: the binary and global options.

  override protected defaultTool(): string
    The invoked binary is `docker`.
  abstract protected subcommandArgs(): string[]
    The subcommand argv, after the global options.
  dockerContext(name: string): this
    Use a named docker context (`--context`), which is how a build talks to a
    remote daemon or a second local one without exporting `DOCKER_HOST`.

    Named `dockerContext` rather than `context` because `docker build`'s
    trailing `PATH` is also called a context, and
    {@link "./build.ts".DockerBuildSettings.context} already means that one.
  host(address: string): this
    The daemon socket to connect to (`--host`), e.g. `ssh://build@host`.
  logLevel(level: DockerLogLevel): this
    How much the client logs (`--log-level`).
  config(path: PathLike): this
    Where the client config lives (`--config`).
  debug(): this
    Enable client debug output (`--debug`).
  override protected buildArgs(): string[]
    Assemble the `docker` argv: the global options, then the subcommand.
    docker reads these before the subcommand, so the order is not cosmetic —
    `docker ps --context x` is an error, `docker --context x ps` is not.

class DockerStartSettings extends DockerContainerListSettings
  Settings for `docker start`.

  attach(): this
    Attach STDOUT/STDERR and forward signals (`-a`).
  override protected subcommandArgs(): string[]
    Assemble the `docker start` argv.

class DockerStatsSettings extends DockerSettings
  Settings for `docker stats`.

  containers(...names: string[]): this
    Limit the report to these containers; omit for all running ones.
  all(): this
    Include stopped containers (`-a`/`--all`).
  format(template: string): this
    Render through a Go template (`--format`).
  override protected subcommandArgs(): string[]
    Assemble the `docker stats` argv. `--no-stream` is always set: without it
    docker streams forever, and a build target that never returns is a hang,
    not a measurement.

class DockerStopSettings extends DockerContainerListSettings
  Settings for `docker stop`.

  time(seconds: number): this
    Seconds to wait before killing (`-t`).
  override protected subcommandArgs(): string[]
    Assemble the `docker stop` argv.

class DockerSystemSettings extends DockerSettings
  Settings for `docker system`. Pick the subcommand with {@link prune},
  {@link df}, or {@link info}.

  prune(): this
    Reclaim space (`system prune`).
  df(): this
    Report what is using disk (`system df`).
  info(): this
    Describe the daemon (`system info`).
  all(): this
    Prune every unused image, not only the dangling ones (`--all`) — the
    difference between reclaiming a little space and reclaiming a lot.
  force(): this
    Do not prompt for confirmation (`--force`), which a build always needs.
  volumes(): this
    Also remove unused volumes (`--volumes`), which a prune otherwise keeps.
  filter(...expressions: string[]): this
    Limit what is pruned (`--filter`), e.g. `until=24h`; repeatable.
  verbose(): this
    Break the `df` report down per object (`-v`/`--verbose`).
  format(template: string): this
    Render through a Go template (`--format`).
  override protected subcommandArgs(): string[]
    Assemble the `docker system` argv.

class DockerTagSettings extends DockerSettings
  Settings for `docker tag`.

  source(reference: string): this
    The existing image reference (required).
  target(reference: string): this
    The new image reference (required).
  override protected subcommandArgs(): string[]
    Assemble the `docker tag` argv.

class DockerTopSettings extends DockerSettings
  Settings for `docker top`.

  container(name: string): this
    The container whose processes to list (required).
  psArgs(...args: string[]): this
    Arguments passed through to `ps` inside the container.
  override protected subcommandArgs(): string[]
    Assemble the `docker top` argv.

class DockerUnpauseSettings extends DockerContainerListSettings
  Settings for `docker unpause`.

  override protected subcommandArgs(): string[]
    Assemble the `docker unpause` argv.

class DockerUpdateSettings extends DockerContainerListSettings
  Settings for `docker update`.

  memory(limit: string): this
    The memory limit (`--memory`), e.g. `512m`.
  cpus(count: string): this
    How many CPUs the container may use (`--cpus`).
  restart(policy: string): this
    The restart policy (`--restart`).
  override protected subcommandArgs(): string[]
    Assemble the `docker update` argv.

class DockerVersionSettings extends DockerSettings
  Settings for `docker version`.

  format(template: string): this
    Render through a Go template (`--format`), e.g. `{{.Server.Version}}` to
    read just the daemon's version.
  override protected subcommandArgs(): string[]
    Assemble the `docker version` argv.

class DockerVolumeSettings extends DockerSettings
  Settings for `docker volume`. Pick the subcommand with {@link create},
  {@link ls}, {@link remove}, {@link inspect}, or {@link prune}.

  create(name?: string): this
    Create a volume (`volume create [<name>]`).
  ls(): this
    List volumes (`volume ls`), the default.
  remove(...names: string[]): this
    Remove volumes (`volume rm <name>...`).
  inspect(...names: string[]): this
    Describe volumes (`volume inspect <name>...`).
  prune(): this
    Remove the volumes nothing uses (`volume prune`).
  driver(name: string): this
    The volume driver (`--driver`), for a created volume.
  label(key: string, value: string): this
    Attach metadata (`--label`); repeatable.
  opt(key: string, value: string): this
    A driver-specific option (`--opt`); repeatable.
  filter(...expressions: string[]): this
    Filter a listing or a prune (`--filter`); repeatable.
  format(template: string): this
    Render each volume through a Go template (`--format`).
    {@link "./docker.ts".DockerTasks.volumeNames} pins `{{.Name}}`.
  quietOutput(): this
    Only print volume names (`-q`/`--quiet`).
  force(): this
    Do not prompt, and remove even a volume in use where docker allows it (`--force`).
  all(): this
    Prune anonymous and named volumes (`--all`), not only anonymous ones.
  override protected subcommandArgs(): string[]
    Assemble the `docker volume` argv.

class DockerWaitSettings extends DockerContainerListSettings
  Settings for `docker wait` — blocking until the containers stop, then
  printing their exit codes, which is how a build gets a test container's
  result rather than the runner's.

  override protected subcommandArgs(): string[]
    Assemble the `docker wait` argv.

interface DockerContainerEntry
  One container of `docker ps --format '{{json .}}'`.

  id?: string
    The container id, as docker abbreviates it in a listing.
  image?: string
    The image it was created from.
  names?: string
    Its names, comma-separated as docker reports them.
  command?: string
    The command it runs.
  status?: string
    A human description of its state, e.g. `Up 3 minutes`.
  state?: string
    The bare state, e.g. `running` or `exited`.
  ports?: string
    The published ports, as docker formats them.

interface DockerImageEntry
  One image of `docker images --format '{{json .}}'`.

  id?: string
    The image id, as docker abbreviates it in a listing.
  repository?: string
    The repository, or `<none>` for an untagged image.
  tag?: string
    The tag, or `<none>` when the image carries none.
  createdSince?: string
    How docker describes the image's age, e.g. `2 days ago`.
  size?: string
    The on-disk size, as docker formats it.
  digest?: string
    The digest, when the listing was asked for one.

interface DockerTasksApi
  The shape of {@link DockerTasks}.

  build(configure?: Configure<DockerBuildSettings>): Promise<CommandOutput>
    Build an image: `docker build`.
  run(configure?: Configure<DockerRunSettings>): Promise<CommandOutput>
    Run a container: `docker run`.
  create(configure?: Configure<DockerCreateSettings>): Promise<CommandOutput>
    Create a container without starting it: `docker create`.
  exec(configure?: Configure<DockerExecSettings>): Promise<CommandOutput>
    Run a command in a container: `docker exec`.
  start(configure?: Configure<DockerStartSettings>): Promise<CommandOutput>
    Start containers: `docker start`.
  stop(configure?: Configure<DockerStopSettings>): Promise<CommandOutput>
    Stop containers: `docker stop`.
  restart(configure?: Configure<DockerRestartSettings>): Promise<CommandOutput>
    Restart containers: `docker restart`.
  kill(configure?: Configure<DockerKillSettings>): Promise<CommandOutput>
    Signal containers: `docker kill`.
  pause(configure?: Configure<DockerPauseSettings>): Promise<CommandOutput>
    Suspend a container's processes: `docker pause`.
  unpause(configure?: Configure<DockerUnpauseSettings>): Promise<CommandOutput>
    Resume them: `docker unpause`.
  rm(configure?: Configure<DockerRmSettings>): Promise<CommandOutput>
    Remove containers: `docker rm`.
  wait(configure?: Configure<DockerWaitSettings>): Promise<CommandOutput>
    Block until containers stop, then print their exit codes: `docker wait` —
    how a build gets a test container's result rather than the runner's.
  rename(configure?: Configure<DockerRenameSettings>): Promise<CommandOutput>
    Rename a container: `docker rename`.
  update(configure?: Configure<DockerUpdateSettings>): Promise<CommandOutput>
    Change a container's resource limits: `docker update`.
  ps(configure?: Configure<DockerPsSettings>): Promise<CommandOutput>
    List containers: `docker ps`.
  psEntries(configure?: Configure<DockerPsSettings>): Promise<DockerContainerEntry[]>
    The containers as parsed {@link DockerContainerEntry} values, from
    `docker ps --format '{{json .}}'`.
  logs(configure?: Configure<DockerLogsSettings>): Promise<CommandOutput>
    Read a container's logs: `docker logs`.
  inspect(configure?: Configure<DockerInspectSettings>): Promise<CommandOutput>
    Describe docker objects: `docker inspect`.
  top(configure?: Configure<DockerTopSettings>): Promise<CommandOutput>
    List a container's processes: `docker top`.
  stats(configure?: Configure<DockerStatsSettings>): Promise<CommandOutput>
    Sample resource usage once: `docker stats --no-stream`.
  port(configure?: Configure<DockerPortSettings>): Promise<CommandOutput>
    Show a container's port mappings: `docker port`.
  diff(configure?: Configure<DockerDiffSettings>): Promise<CommandOutput>
    Show a container's filesystem changes: `docker diff`.
  cp(configure?: Configure<DockerCpSettings>): Promise<CommandOutput>
    Copy files between a container and the host: `docker cp`.
  commit(configure?: Configure<DockerCommitSettings>): Promise<CommandOutput>
    Turn a container into an image: `docker commit`.
  export(configure?: Configure<DockerExportSettings>): Promise<CommandOutput>
    Export a container's filesystem: `docker export`.
  images(configure?: Configure<DockerImagesSettings>): Promise<CommandOutput>
    List images: `docker images`.
  imageEntries(configure?: Configure<DockerImagesSettings>): Promise<DockerImageEntry[]>
    The images as parsed {@link DockerImageEntry} values, from
    `docker images --format '{{json .}}'`.
  pull(configure?: Configure<DockerPullSettings>): Promise<CommandOutput>
    Pull an image: `docker pull`.
  push(configure?: Configure<DockerPushSettings>): Promise<CommandOutput>
    Push an image: `docker push`.
  tag(configure?: Configure<DockerTagSettings>): Promise<CommandOutput>
    Tag an image: `docker tag`.
  rmi(configure?: Configure<DockerRmiSettings>): Promise<CommandOutput>
    Remove images: `docker rmi`.
  save(configure?: Configure<DockerSaveSettings>): Promise<CommandOutput>
    Save images to a tar archive: `docker save`.
  load(configure?: Configure<DockerLoadSettings>): Promise<CommandOutput>
    Load images from a tar archive: `docker load`.
  history(configure?: Configure<DockerHistorySettings>): Promise<CommandOutput>
    Show an image's layers: `docker history`.
  import(configure?: Configure<DockerImportSettings>): Promise<CommandOutput>
    Create an image from a tarball: `docker import`.
  imagePrune(configure?: Configure<DockerImagePruneSettings>): Promise<CommandOutput>
    Remove unused images: `docker image prune`.
  login(configure?: Configure<DockerLoginSettings>): Promise<CommandOutput>
    Authenticate to a registry: `docker login`.
  logout(configure?: Configure<DockerLogoutSettings>): Promise<CommandOutput>
    Forget a registry's credentials: `docker logout`.
  search(configure?: Configure<DockerSearchSettings>): Promise<CommandOutput>
    Search Docker Hub: `docker search`.
  info(configure?: Configure<DockerInfoSettings>): Promise<CommandOutput>
    Describe the daemon: `docker info`.
  version(configure?: Configure<DockerVersionSettings>): Promise<CommandOutput>
    Report client and daemon versions: `docker version`.
  system(configure?: Configure<DockerSystemSettings>): Promise<CommandOutput>
    Reclaim space or report usage: `docker system prune|df|info`.
  volume(configure?: Configure<DockerVolumeSettings>): Promise<CommandOutput>
    Manage volumes: `docker volume create|ls|rm|inspect|prune`.
  volumeNames(configure?: Configure<DockerVolumeSettings>): Promise<string[]>
    The volume names, from `docker volume ls --format '{{.Name}}'`.
  network(configure?: Configure<DockerNetworkSettings>): Promise<CommandOutput>
    Manage networks: `docker network create|ls|rm|inspect|connect|…`.
  networkNames(configure?: Configure<DockerNetworkSettings>): Promise<string[]>
    The network names, from `docker network ls --format '{{.Name}}'`.
  context(configure?: Configure<DockerContextSettings>): Promise<CommandOutput>
    Manage the daemons to talk to: `docker context create|ls|use|…`.

type DockerLogLevel = "debug" | "info" | "warn" | "error" | "fatal"
  How verbose the docker client is (`--log-level`).
````

</details>

<!-- ZUKE:API:END -->
