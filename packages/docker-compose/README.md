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
import { DockerComposeTasks } from "@zuke/docker-compose";

await DockerComposeTasks.up((s) => s.file("compose.yml").detach().build());
await DockerComposeTasks.logs((s) => s.follow().tail(100));
await DockerComposeTasks.down((s) => s.volumes());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

## Docker Compose canary platform

`dockerComposeCanary` is a Compose project as a platform for
[`@zuke/canary`](https://jsr.io/@zuke/canary). This package does not depend on
`@zuke/canary`: the object it returns has the platform's shape, so
`c.platform(...)` accepts it as it is.

The project runs two services, a stable one and a canary one, behind a proxy
that balances requests across the containers of both. Exposure is the canary's
share of a fixed number of replicas, so it comes in whole replicas: with four
replicas a step reaches 25, 50 or 75 %. Compose has no command that sets an
image, so each service's `image:` must be a whole variable. The platform sets
that variable on each command it runs:

```yaml
services:
  app: &app
    image: ${APP_IMAGE}
    scale: 4 # the platform's .replicas(...)
    networks:
      default:
        aliases: [backend] # the proxy balances over every "backend" container
  app-canary:
    <<: *app # the same service in every way but the image and the scale
    image: ${APP_CANARY_IMAGE:-${APP_IMAGE}}
    scale: 0
```

```ts
import { canary } from "@zuke/canary";
import { dockerComposeCanary } from "@zuke/docker-compose";

rollout = canary((c) =>
  c.platform(
    dockerComposeCanary((d) =>
      d.service("app").canaryService("app-canary").replicas(4)
        .image(this.image.value)
        .stableImageVariable("APP_IMAGE")
        .canaryImageVariable("APP_CANARY_IMAGE")
        .stable("registry.example.com/app:1.4.0") // where a hand-run rollout.abort goes back to
        .compose((s) => s.file("compose.yml").projectName("shop"))
    ),
  )
    .steps(25, 50)
    .bake("10m")
    .lock((l) => l.lockKey("deploy", "shop").withTtl("24h"))
);
```

Every move is `up -d --no-deps --scale <service>=<n> <service>`, with `--wait`
when `n` is not 0:

- **`stage`** reads the image the stable replicas run (`ps --format {{.Image}}`)
  and its ID (`images --quiet`), pulls the candidate if it is not present
  (`pull --policy missing`), and records the rollout: the two services, the
  replicas, the two variables, the two images, the stable image's ID, the
  project's global flags and the project Compose reports the stable replicas in
  (its containers' `com.docker.compose.project` label; below). Every later call
  acts on that record, whatever the lambda resolves to then, and every command
  that may create a stable replica sets the stable variable to `sha256:<id>`,
  not the tag, so a tag moved by a local pull or build mid-rollout cannot bring
  a release nobody analysed into the stable service. It then puts the stable
  service at every replica and the canary service at none.
- **`expose`** puts the canary service at its share and the stable service at
  the rest, scaling whichever grows first, and checks with `ps` that the canary
  runs the candidate. The first step that runs a canary replica pins the
  candidate's image ID (`images --quiet`); later steps run the canary by that ID
  and refuse one that resolves to another, as when the candidate tag moved.
  Existing replicas are never recreated (`--no-recreate`).
- **`promote`** puts the canary service at every replica, recreates the stable
  service on the pinned candidate ID, so a candidate tag moved after the
  analysis cannot promote an image nobody judged, checks with `images --quiet`
  that every stable replica resolves to it, then takes the canary service to
  none. A stable `image:` that does not read the variable (a literal, or
  `repo:${TAG}`) is refused rather than reported as promoted.
- **`abort`** reads what the stable replicas run, by ID (`images --quiet`): a
  tag `ps` shows means whatever the tag names now, so it is not evidence. If
  they all resolve to exactly the recorded ID (mid-rollout they do), it scales
  the stable service back to every replica without recreating anything.
  Otherwise (after a promotion, finished or part-way) Compose would recreate
  every stable replica at once, so it mirrors a promotion: the canary service to
  every replica on the stable image, the stable service recreated on it, then
  the canary service to none. Either way it then reads the stable replicas again
  (by ID, or by reference when run by hand) and refuses, leaving the canary
  serving, if they are not on the stable image, as with a literal stable
  `image:`; it does not report a rollback that changed nothing. Run by hand, the
  stable image is the `.stable(...)` one, compared by the reference `ps` shows,
  and it refuses without one. After a `stage` that changed nothing, nothing
  runs.

**The project is part of the record.** Service names mean something only inside
a Compose project, so `stage` records the global flags `.compose(...)` gives
(`-f`, `-p`, `--profile`, `--project-directory`, `--env-file`) as argv, never
what its `.env(...)` passes. `expose`, `promote` and a recorded `abort` refuse
before running any command, reads included, unless the lambda gives exactly
those flags again, in the same order: a resumed or cancelling process whose
`.projectName(this.env.value)` resolves to another value would otherwise move
same-named services in a project the rollout never staged. Flags are not all
that selects a project, so after that check each of those calls reads
`ps -a --format '{{.Label "com.docker.compose.project"}}' <stable> <canary>`,
before any other command, and refuses unless Compose reports the services in
exactly the project `stage` saw; it refuses too when Compose reports no
container of either, running or stopped (a live rollout always has some). A
record without the flags or the project is refused as damaged. The engine then
leaves the run cancelled, so a resume or `zuke cancel` will not roll it back;
the refusal names the recovery that does. Set the configuration and environment
back to what the rollout started with, check with `docker compose ps` that it
reaches the staged project, then run `zuke rollout.abort` by hand with
`.stable("sha256:<id>")` set to the stable image ID the message names (or its
tag, only if that still resolves to the ID). A hand-run abort has no record, so
it acts on whatever project the lambda selects. The lambda runs once per command
as well, and a command it gives other flags than the call resolved at its start
is refused before it runs.

The check compares the project Compose itself reports, so it covers whatever
selects the project: the flags, `COMPOSE_PROJECT_NAME` in the environment, a
`.env` or `--env-file` that sets it, the lambda's `.env(...)` and `.cwd(...)`,
and the working directory a default name comes from. `-a` counts stopped
containers, so a daemon restart that stopped them does not block the rollback.
What it does not cover: another daemon or Docker context (`DOCKER_HOST`,
`DOCKER_CONTEXT`, a `.toolPath(...)`) running the same project name with the
same services on the same images is not told apart; a change that keeps the
project but changes the services' definitions is not compared — another
`COMPOSE_FILE`, an env file, or, with an explicit `-p` and no `-f`, a working
directory or `.cwd(...)` that loads another `compose.yml`; and the lambda's
`.env(...)` and `.cwd(...)` are checked only at each call's project read, while
later commands re-check only its flags, so it must give the same ones every time
it runs. The recorded image IDs are a partial guard against another daemon:
after `stage` every move passes `--pull never`, so one that creates a container
fails on a daemon that lacks its image (the recorded stable ID, or the
candidate), while one that only removes containers needs no image and goes
ahead; and the reads compare IDs, so a rollback finds stable replicas on another
image and a later step a canary on another candidate.

Every move that sets a variable to an image ID passes `--pull never`, which
overrides a service's `pull_policy: always`: an ID cannot be pulled, and a
container already ran it, so it is local. `images` counts stopped replicas and
one-off `docker compose run` containers as well as running ones, so one left on
another image makes `stage` refuse until it is removed (`docker compose rm`; use
`run --rm`).

A command that exits non-zero fails the call even under `.noThrow()`, and
trailing `.args(...)` in `.compose(...)` are refused, since they would follow
the service operand. That refusal guards against accidents; it is not a security
boundary, since the lambda is the build's own code. Image variables may not be
names Docker, Compose or the process read as settings (`DOCKER_*`, `COMPOSE_*`,
`BUILDKIT_*`, `BUILDX_*`, `XDG_*`, `LD_*`, `DYLD_*`, `*_PROXY`, `PATH`,
`PATHEXT`, `HOME`, `USERPROFILE`, `SystemRoot`, `TMPDIR`, `TEMP`, `TMP`,
`SSH_AUTH_SOCK`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, in any case), and the two must
differ in more than case.

**Give the stable service `scale:` equal to `.replicas(...)`.** A plain
`docker compose up` sets every service back to its `scale:`, so any other value
changes the replica count behind the platform. Compose v2 (`docker compose`) is
required: the v1 `docker-compose` binary has no `--wait`, `pull --policy` or
`ps --format`.

**A promotion is not durable on its own.** The image variable is set only for
the commands the platform runs. Until the candidate is written where `APP_IMAGE`
comes from (the `.env` file, or the environment of whatever runs Compose next),
a plain `docker compose up` puts the stable service back on the old image. A
rollback is an override in the same way. The build summary says so after a
promotion, naming the ID the reference must still resolve to
(`Persist: set APP_IMAGE=<image> (which must resolve to sha256:<id>) and keep scale: <replicas>`),
and after a hand-run rollback. See
[docs/canary.md](https://github.com/zuke-build/zuke/blob/master/docs/canary.md)
for the details and the other limits.

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
import { DockerComposeTasks } from "@zuke/docker-compose";

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

function dockerComposeCanary(configure: Configure<DockerComposeCanarySettings>): DockerComposeCanary
  A Compose project as a canary platform, for `@zuke/canary`:

  ```ts
  c.platform(dockerComposeCanary((d) =>
    d.service("app").canaryService("app-canary").replicas(4)
      .image(this.image.value)
      .stableImageVariable("APP_IMAGE")
      .canaryImageVariable("APP_CANARY_IMAGE")
      .compose((s) => s.file("compose.yml").projectName("shop"))
  ))
  ```

  The lambda runs on every call, so it may read resolved parameters; after
  `stage`, the services, replicas and variables are the ones it recorded, and
  every call refuses unless `d.compose(...)` gives the global flags `stage`
  recorded and Compose reports the two services in the project `stage` saw.
  Every move is `up -d --no-deps --scale <service>=<n> <service>` (with
  `--wait` when `n` is not 0), run with the image variables set:

  - stage — `ps --format {{.Image}} <stable>` reads the stable image,
    `images --quiet <stable>` its ID and
    `ps -a --format '{{.Label "com.docker.compose.project"}}' <stable>` its
    one project, `pull --policy missing <canary>`,
    the rollout is recorded, then the stable service to every replica
    (`--no-recreate`) and the canary service to none. From here on, the
    stable variable is the recorded `sha256:<id>` on every command that may
    create a stable replica, and every move that sets an ID adds
    `--pull never`, since an ID cannot be pulled.
  - expose, promote, abort with a record — first
    `ps -a --format '{{.Label "com.docker.compose.project"}}' <stable> <canary>`, which must report exactly the recorded project.
  - expose — the canary service (`--no-recreate`) to its share and the
    stable service (`--no-recreate`) to the rest, the growing one first;
    `ps` checks the canary runs the candidate and `images --quiet` pins its
    ID on the first step, which later steps and promote then use.
  - promote — the canary service to every replica, the stable service
    recreated on the pinned candidate ID and checked with `images --quiet`,
    the canary service to none. Not durable until the candidate is written
    where the stable variable comes from.
  - abort — `images --quiet` reads the stable replicas' IDs (run by
    hand, `ps` their references). If they are all on the stable image, the
    stable service back to every replica (`--no-recreate`); otherwise the
    canary service to every replica on the stable image, the stable service
    recreated on it. The stable replicas are then read again and must be
    on the stable image, before the canary service goes to none. Run by
    hand, the stable image is the one set with `.stable(...)`.

  The stable service's `scale:` in the Compose file must equal
  `.replicas(...)`, and Compose v2 (`docker compose`) is required.

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

class DockerComposeCanary
  A Compose project as a canary platform. Create one with
  {@link dockerComposeCanary}; hand it to `@zuke/canary`'s `c.platform(...)`.

  Exposure is the canary's share of the replicas, so it is quantised.

  constructor(configure: Configure<DockerComposeCanarySettings>)
    A platform whose settings `configure` produces, afresh on every call.
  readonly exposure: "replicas"
    Compose runs replicas, so exposure is a share of instances.
  describe(): string
    `"Compose service app"`, for the build summary.
  async stage(ctx: DockerComposeCanaryContext): Promise<void>
    Read the image the stable replicas run, make sure the candidate image is
    available (pulled unless it is already present), record the rollout — the
    two services, the replicas, the two variables, the two images and the
    stable replicas' image ID (`images --quiet`), which every later call acts
    on whatever the lambda says then, and the project — its global flags
    and the project Compose reports the stable replicas in, which every
    later call refuses to run without — and bring the
    project to exactly 0 %: the stable service at every replica, the canary
    service at none. The stable replicas are only added or removed, never
    recreated.

    Each call runs `d.compose(...)` once to resolve the global flags, and
    then once per command; a command it gives any other flags (a lambda that
    reads a clock, or changes what it closes over) is refused before it runs.
    A stage always starts afresh, so a re-run one records the flags it runs
    with.

    What the project check does not cover: the Docker daemon is not recorded,
    and the recorded image IDs are only a partial guard against another one.
    After `stage` every move passes `--pull never`, so one that creates a
    container fails on a daemon that lacks its image — the recorded stable ID,
    or the candidate — while one that only removes containers needs no image
    and goes ahead; and the reads compare IDs, so a rollback finds stable
    replicas on another image and a later step a canary on another candidate. A
    daemon or context (`DOCKER_HOST`, `DOCKER_CONTEXT`, a `.toolPath(...)`)
    that runs the same project name, with the same services on the same images,
    is not told apart. Nor is a change that keeps the project but changes the
    services' definitions: another `COMPOSE_FILE`, an env file that changes
    what they interpolate, or — with an explicit `-p` and no `-f` — a working
    directory or `.cwd(...)` that loads another `compose.yml` under the same
    project name. And the lambda's `.env(...)` and `.cwd(...)` are checked only
    through the project read at the start of each call; every later command
    re-checks only its flags, so the lambda must give the same `.env(...)` and
    `.cwd(...)` every time it runs.
  async expose(percent: number, ctx: DockerComposeCanaryContext): Promise<number>
    Run the canary service at `percent` of the replicas and the stable
    service at the rest, and return the share actually reached. Any share
    between 0 and 100 exclusive keeps at least one replica on each side, so a
    step never rounds to an untested 0 % or a premature 100 %. Whichever
    service grows is scaled first, so the total never dips below the
    replicas. Once the canary service has replicas, `ps` must show every one
    of them on the candidate — a canary whose `image:` does not read its
    variable is refused rather than analysed — and `images --quiet` must
    resolve them to one image ID. The first step records that ID, as the
    image the analysis judges; every later step and promote set the canary
    variable to it rather than the tag, and refuse a canary that resolves to
    another. The stable replicas are never recreated. The services and
    replicas are the ones `stage` recorded, and the call refuses before any
    command unless `d.compose(...)` still gives the global flags `stage`
    recorded, and before any other unless the project read (`ps -a` with
    the project label) reports the two services in the project `stage` saw.
  async promote(ctx: DockerComposeCanaryContext): Promise<void>
    Hand the stable service to the candidate: the canary service goes to
    every replica, the stable service is recreated with the stable variable
    set to the candidate's recorded image ID — the image the analysis judged,
    whatever the candidate tag names by now — `images --quiet` must then
    resolve every stable replica to that ID — or the call refuses, before it
    is recorded as promoted, since a stable `image:` that does not read the
    variable would have changed nothing — and the canary service goes back
    to none. The
    total never dips below the replicas; for a moment it is twice that.
    Idempotent. Like every call after `stage`, it refuses before any command
    unless `d.compose(...)` still gives the global flags `stage` recorded,
    and before any other unless the project read (`ps -a` with the project
    label) reports the two services in the project `stage` saw.

    This is not durable on its own. Compose has no state of its own to
    change: the variable is set for these commands only. Until the
    candidate is written where the stable variable comes from — the `.env`
    file, or the environment of whatever runs `docker compose up` next — a
    plain `docker compose up` puts the stable service back on the image that
    source still names, and at the replica count its `scale:` names, which
    is why that must equal {@link DockerComposeCanarySettings.replicas}. The
    build summary says so: `Persist: set APP_IMAGE=<candidate> (which must resolve to sha256:<id>) and keep scale: <replicas>`.
  async abort(ctx: DockerComposeCanaryContext): Promise<void>
    Put every replica back on the stable image, in the stable service, with
    the canary service at none. Idempotent. Which image, services and
    replicas depends on what this rollout recorded:

    - `stage` recorded them (a rollback mid-rollout, or after a
      promotion that failed part-way): the ones `stage` saw, whatever the
      lambda says now — in the project `stage` saw, too: unless
      `d.compose(...)` still gives the global flags `stage` recorded, this
      refuses before any command, and unless the project read (`ps -a`
      with the project label) then reports the two services in the
      project `stage` saw, before any other. Since the engine then leaves the run cancelled, the refusal
      names the recovery: the configuration and environment set back, and
      `rollout.abort` run by hand with
      `d.stable('sha256:<the recorded stable image ID>')`.
    - `stage` failed before recording them: nothing had changed, so
      nothing runs — and the settings are not even read.
    - Nothing recorded (`rollout.abort` run by hand, a fresh run): the
      settings, with the image set by
      {@link DockerComposeCanarySettings.stable}. Without one this refuses,
      since claiming a rollback it cannot do would be worse.

    Every command sets the stable variable to the image ID `stage` recorded,
    not to the reference, so a tag moved since cannot bring in an image
    nobody analysed; run by hand, there is only the reference.

    First it reads what the stable replicas run: on a recorded rollout,
    `images --quiet` must resolve them to exactly the recorded ID — a tag
    `ps` shows means whatever the tag names now, so it is not evidence; run
    by hand, `ps` must show every one on the `.stable(...)` reference. When
    they do — mid-rollout they do — the stable service is only
    scaled back to every replica (`--no-recreate`). Otherwise — after a
    promotion, run by hand or part-way — the stable replicas must be
    recreated, which Compose does to all of them at once, so the rollback
    mirrors a promotion: the canary service first goes to every replica on
    the stable image, then the stable service is recreated on it, then the
    canary service goes to none. Capacity never dips. Either way, before
    the canary goes to none, the stable replicas are read again — by ID on a
    recorded rollout, by reference run by hand — and a stable `image:` that
    does not read its variable is refused, leaving the canary serving,
    rather than reported as rolled back.

    Like a promotion, the image is an override for these commands, so it
    lasts until a plain `docker compose up` reads the variable from wherever
    the project keeps it. A hand-run rollback — the one that undoes a
    promotion someone persisted — says so in the build summary, as promote
    does: `Persist: set APP_IMAGE=<stable> and keep scale: <replicas>`.

class DockerComposeCanarySettings
  How {@link dockerComposeCanary} reaches the project, configured through its
  lambda.

  service_?: string
    The service that serves the stable release (set by {@link service}).
  canaryService_?: string
    The service that runs the candidate (set by {@link canaryService}).
  replicas_?: number
    The replicas the two services share (set by {@link replicas}).
  image_?: string
    The candidate's image (set by {@link image}).
  stableImageVariable_?: string
    The variable the stable service's image reads (set by {@link stableImageVariable}).
  canaryImageVariable_?: string
    The variable the canary service's image reads (set by {@link canaryImageVariable}).
  stable_?: string
    The image a hand-run rollback returns to (set by {@link stable}).
  compose_?: Configure<DockerComposeSettings>
    Global Compose flags for every command (set by {@link compose}).
  runner_: DockerComposeSettingsRunner
    How each command is run (set by {@link runner}).
  service(name: string): this
    The service that serves the stable release, e.g. `app`. It must already
    be running: `stage` reads the image its replicas run, which is what a
    rollback returns them to.
  canaryService(name: string): this
    The service that runs the candidate, e.g. `app-canary` — a second
    service in the same project, behind the same proxy, whose `image:` is
    `${<canaryImageVariable>}`. Give it `scale: 0` in the Compose file so a
    plain `docker compose up` does not start it.
  replicas(total: number): this
    How many replicas the stable and canary services share between them. A
    step sets the canary to its share of this and the stable service to the
    rest; `stage` and a rollback set the stable service to all of it. From 2
    to 10000. Give the stable service the same `scale:` in the Compose file:
    a plain `docker compose up` sets every service back to its `scale:`.
  image(reference: string): this
    The candidate's image reference, which `stage` puts on the canary service.
  stableImageVariable(name: string): this
    The environment variable the stable service's `image:` is — the whole
    reference, as in `image: ${APP_IMAGE}`, not just a tag. Every command the
    platform runs sets it, so the project's `.env` need not: to the image the
    stable replicas ran when `stage` looked, to the candidate on promotion.
    Not a name Docker, Compose or the process reads as a setting —
    `DOCKER_*`, `COMPOSE_*`, `BUILDKIT_*`, `BUILDX_*`, `XDG_*`, `LD_*`,
    `DYLD_*`, `*_PROXY`, `PATH`, `PATHEXT`, `HOME`, `USERPROFILE`,
    `SystemRoot`, `TMPDIR`, `TEMP`, `TMP`, `SSH_AUTH_SOCK`, `SSL_CERT_FILE`
    or `SSL_CERT_DIR`, in any case — and not the canary's variable in
    another case.
  canaryImageVariable(name: string): this
    The environment variable the canary service's `image:` is, as in
    `image: ${APP_CANARY_IMAGE:-${APP_IMAGE}}`. Every command that brings up
    the canary sets it to the candidate.
  stable(image: string): this
    The image to put the stable service back on when `rollout.abort` is run
    by hand — a reference with no whitespace or control characters. Such a
    run is fresh, with no record of a rollout, so it has nothing else to go
    on — and the release it is undoing has usually been promoted already. A
    rollback the engine runs mid-rollout does not use it: that one returns to
    the image ID `stage` saw the stable replicas running.
  compose(configure: Configure<DockerComposeSettings>): this
    Global flags for every Compose command the platform runs —
    `(s) => s.file("compose.yml").projectName("shop")`, or `.usePlugin()` to
    skip detection. Compose v2 (`docker compose`) is required: the v1
    `docker-compose` binary has no `--wait`, `pull --policy` or
    `ps --format`. Trailing `.args(...)` are refused, since they would land
    after the service each command names — a guard against an accident, not
    a security boundary: this lambda is the build's own code and can run
    Compose however it likes. A non-zero exit fails the call even with
    `.noThrow()`.

    The flags it gives select the project, so `stage` records them (as argv:
    what `.env(...)` passes is never recorded) and every later call refuses
    unless they are the same, in the same order. It also records the
    project Compose reports the stable replicas in, and every later call
    refuses unless Compose still reports the services there — which covers
    whatever else resolves the project: `COMPOSE_PROJECT_NAME` in the
    environment, a `.env` or `--env-file`, `.env(...)` and `.cwd(...)` here,
    the working directory. Not covered: a Docker context, `DOCKER_HOST` or
    `.toolPath(...)` that reaches another daemon running the same project
    with the same services on the same images; a `COMPOSE_FILE` or env file
    that keeps the project but changes the services' definitions, or — with
    an explicit `-p` and no `-f` — a working directory or `.cwd(...)` that
    loads another `compose.yml` under the same name. And `.env(...)` and
    `.cwd(...)` are checked only at each call's project read, while later
    commands re-check only the flags, so this lambda must give the same ones
    every time it runs.
  runner(run: DockerComposeSettingsRunner): this
    Replace how each prepared command is run. The default runs it; this is
    for a test, or for a build that executes Compose through something else.

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
  format(value: string): this
    Output format (`--format`): `table`, `json`, or a Go template such as
    `{{.Image}}`, which prints one line per container.
  services(...names: string[]): this
    Restrict to specific services (positional); optional.
  override protected composeArgs(): string[]
    Assemble the `compose ps` argv.

class DockerComposePullSettings extends DockerComposeSettings
  Settings for `compose pull`.

  ignorePullFailures(): this
    Continue past services whose pull fails (`--ignore-pull-failures`).
  policy(value: Exclude<DockerComposePullPolicy, "never">): this
    Which images to pull (`--policy`): `missing` skips an image already
    present locally — so a locally built image is not looked up in a
    registry — and `always` fetches every one.
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
  noRecreate(): this
    Leave containers that already exist as they are, even when their
    configuration changed (`--no-recreate`). Scaling a service with it only
    adds or removes replicas; the ones already running keep their image.
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

interface DockerComposeCanaryContext
  The part of the canary engine's context the Compose platform uses: the
  rollout's durable state, where the images are recorded, and the build
  summary. The engine hands a richer context; this is the narrow view.

  readonly state: TargetStateHandle
    The rollout's durable platform state, shared by every call.
  reportSummary(pairs: SummaryPairs): void
    Add key/value pairs to the calling target's row in the build summary.

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

type DockerComposeSettingsRunner = (settings: DockerComposeSettings, env: Readonly<Record<string, string>>) => Promise<CommandOutput>
  Runs one prepared Compose command and returns its output. `env` holds the
  image variables the platform already applied to `settings` — handed over
  as well so a runner that executes Compose some other way, or a test, sees
  them. The default runs the settings; inject another with
  {@link DockerComposeCanarySettings.runner}. An output with a non-zero exit
  code fails the call, as a rejection does.
````

</details>

<!-- ZUKE:API:END -->
