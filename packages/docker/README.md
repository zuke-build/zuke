# @zuke/docker

Typed `docker` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `build`, `run`,
`exec`, `push`, `pull`, `tag`, `login`, `images`, `ps`, `stop`, `start`, `rm`,
`rmi`, `save`, and `load` — in a fluent settings-lambda API. Arguments stay a
discrete argv array, so command construction is injection-free.

```ts
import { DockerTasks } from "jsr:@zuke/docker";

await DockerTasks.build((s) =>
  s.tag("app:1.0").file("Dockerfile").buildArg("VERSION", "1.0")
);
await DockerTasks.push((s) => s.image("app:1.0"));
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/docker` — typed `docker` CLI task wrappers for Zuke builds.

```ts
import { DockerTasks } from "jsr:@zuke/docker";

await DockerTasks.build((s) => s.tag("app:1.0").file("Dockerfile"));
await DockerTasks.push((s) => s.image("app:1.0"));
```
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
  override protected buildArgs(): string[]

class DockerExecSettings extends DockerSettings
  Settings for `docker exec`.

  container(name: string): this
    The target container (required).
  interactive(): this
    Keep STDIN open (`-i`).
  tty(): this
    Allocate a pseudo-TTY (`-t`).
  envVar(key: string, value: string): this
    Set an environment variable for the command (`-e KEY=value`).
  workdir(path: PathLike): this
    Working directory inside the container (`-w`).
  commandArgs(...args: Array<string | number>): this
    The command and arguments to execute.
  override protected buildArgs(): string[]

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
  override protected buildArgs(): string[]

class DockerLoadSettings extends DockerSettings
  Settings for `docker load`.

  input(path: PathLike): this
    Read from a tar archive instead of STDIN (`-i`).
  quietOutput(): this
    Suppress the load output (`-q`).
  override protected buildArgs(): string[]

class DockerLoginSettings extends DockerSettings
  Settings for `docker login`.

  username(value: string): this
    The username (`-u`).
  password(value: string): this
    The password (`-p`); prefer {@link passwordStdin} in CI.
  passwordStdin(): this
    Read the password from STDIN (`--password-stdin`).
  registry(server: string): this
    The registry server (defaults to Docker Hub).
  override protected buildArgs(): string[]

class DockerPsSettings extends DockerSettings
  Settings for `docker ps`.

  all(): this
    Show stopped containers too (`-a`).
  quietOutput(): this
    Only show container IDs (`-q`).
  filter(expression: string): this
    Filter the listing (`--filter`); repeatable.
  override protected buildArgs(): string[]

class DockerPullSettings extends DockerSettings
  Settings for `docker pull`.

  image(reference: string): this
    The image reference to pull (required).
  platform(value: string): this
    Pull a specific platform (`--platform`).
  quietOutput(): this
    Suppress verbose output (`-q`).
  override protected buildArgs(): string[]

class DockerPushSettings extends DockerSettings
  Settings for `docker push`.

  image(reference: string): this
    The image reference to push (required).
  allTags(): this
    Push every tag of the repository (`--all-tags`).
  override protected buildArgs(): string[]

class DockerRmSettings extends DockerSettings
  Settings for `docker rm`.

  containers(...names: string[]): this
    The containers to remove (at least one is required).
  force(): this
    Force removal of a running container (`-f`).
  volumes(): this
    Also remove anonymous volumes (`-v`).
  override protected buildArgs(): string[]

class DockerRmiSettings extends DockerSettings
  Settings for `docker rmi`.

  images(...references: string[]): this
    The images to remove (at least one is required).
  force(): this
    Force removal (`-f`).
  override protected buildArgs(): string[]

class DockerRunSettings extends DockerSettings
  Settings for `docker run`.

  image(reference: string): this
    The image to run (required).
  name(value: string): this
    Assign a container name (`--name`).
  rm(): this
    Remove the container when it exits (`--rm`).
  detach(): this
    Run the container in the background (`-d`).
  interactive(): this
    Keep STDIN open (`-i`).
  tty(): this
    Allocate a pseudo-TTY (`-t`).
  envVar(key: string, value: string): this
    Set a container environment variable (`-e KEY=value`); repeatable.
  publish(host: string | number, container: string | number): this
    Publish a container port to the host (`-p host:container`).
  volume(source: PathLike, target: PathLike): this
    Bind-mount or attach a volume (`-v source:target`).
  network(value: string): this
    Connect the container to a network (`--network`).
  commandArgs(...args: Array<string | number>): this
    The command and arguments to run inside the container.
  override protected buildArgs(): string[]

class DockerSaveSettings extends DockerSettings
  Settings for `docker save`.

  images(...references: string[]): this
    The images to save (at least one is required).
  output(path: PathLike): this
    Write to a file instead of STDOUT (`-o`).
  override protected buildArgs(): string[]

class DockerStartSettings extends DockerSettings
  Settings for `docker start`.

  containers(...names: string[]): this
    The containers to start (at least one is required).
  attach(): this
    Attach STDOUT/STDERR and forward signals (`-a`).
  override protected buildArgs(): string[]

class DockerStopSettings extends DockerSettings
  Settings for `docker stop`.

  containers(...names: string[]): this
    The containers to stop (at least one is required).
  time(seconds: number): this
    Seconds to wait before killing (`-t`).
  override protected buildArgs(): string[]

class DockerTagSettings extends DockerSettings
  Settings for `docker tag`.

  source(reference: string): this
    The existing image reference (required).
  target(reference: string): this
    The new image reference (required).
  override protected buildArgs(): string[]

interface DockerTasksApi
  The shape of {@link DockerTasks}.

  build(configure?: Configure<DockerBuildSettings>): Promise<CommandOutput>
    Build an image: `docker build`.
  run(configure?: Configure<DockerRunSettings>): Promise<CommandOutput>
    Run a container: `docker run`.
  exec(configure?: Configure<DockerExecSettings>): Promise<CommandOutput>
    Run a command in a container: `docker exec`.
  push(configure?: Configure<DockerPushSettings>): Promise<CommandOutput>
    Push an image: `docker push`.
  pull(configure?: Configure<DockerPullSettings>): Promise<CommandOutput>
    Pull an image: `docker pull`.
  tag(configure?: Configure<DockerTagSettings>): Promise<CommandOutput>
    Tag an image: `docker tag`.
  login(configure?: Configure<DockerLoginSettings>): Promise<CommandOutput>
    Authenticate to a registry: `docker login`.
  images(configure?: Configure<DockerImagesSettings>): Promise<CommandOutput>
    List images: `docker images`.
  ps(configure?: Configure<DockerPsSettings>): Promise<CommandOutput>
    List containers: `docker ps`.
  stop(configure?: Configure<DockerStopSettings>): Promise<CommandOutput>
    Stop containers: `docker stop`.
  start(configure?: Configure<DockerStartSettings>): Promise<CommandOutput>
    Start containers: `docker start`.
  rm(configure?: Configure<DockerRmSettings>): Promise<CommandOutput>
    Remove containers: `docker rm`.
  rmi(configure?: Configure<DockerRmiSettings>): Promise<CommandOutput>
    Remove images: `docker rmi`.
  save(configure?: Configure<DockerSaveSettings>): Promise<CommandOutput>
    Save images to a tar archive: `docker save`.
  load(configure?: Configure<DockerLoadSettings>): Promise<CommandOutput>
    Load images from a tar archive: `docker load`.
````

</details>

<!-- ZUKE:API:END -->
