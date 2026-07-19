# @zuke/core

Code-first, strongly-typed build automation for Deno. Define builds as
TypeScript classes; each target is a field wired to others by reference, forming
a dependency graph that Zuke sorts and runs.

```ts
import { Build, run, target } from "jsr:@zuke/core";

class MyBuild extends Build {
  hello = target()
    .description("Say hello")
    .executes(() => console.log("Hello from Zuke!"));
}

await run(MyBuild);
```

Also exports `jsr:@zuke/core/shell` (the injection-safe `$` runner) and
`jsr:@zuke/core/tooling` (the base for typed tool wrappers).

See [Zuke](https://github.com/zuke-build/zuke#readme) for the full guide.

## Stability

From `1.0.0`, `@zuke/core` follows semantic versioning: breaking changes to the
public API bump the major version, so you can depend on `^1` with confidence.

## Paths

`@zuke/core` exports `absolutePath` and the `PathLike` type. Across the Zuke
tool-wrapper packages, every path argument accepts either a string or an
`AbsolutePath`.

## Announcements

`AnnounceTasks` posts build status — "build passed", "package published",
"service deployed" — to Slack, Microsoft Teams, and Discord from a pipeline.
Each task takes a settings-lambda, like the tool wrappers, and posts either to
an incoming webhook or, in bot mode (`.bot().token(t).channel(c)`), through the
platform's API.

```ts
import { AnnounceTasks } from "jsr:@zuke/core";

await AnnounceTasks.slack((s) =>
  s.webhook(slackWebhookUrl)
    .title("Deploy")
    .text("Shipped api@1.4.0 to production.")
    .success()
    .field("Service", "api")
);
```

The webhook URL or bot token embeds a secret, so source it from a
`parameter().secret()` build input. See the
[authoring guide](https://github.com/zuke-build/zuke/blob/master/docs/authoring.md)
for Teams and Discord, bot/API modes, and the full settings API.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
Zuke — a code-first, strongly-typed build automation system for Deno.

Public API. Define a build by extending {@link Build}, declare targets with
the {@link target} fluent builder, and make the file runnable with
{@link run}:

```ts
import { Build, target, run } from "jsr:@zuke/core";
import { $ } from "jsr:@zuke/core/shell";

class MyBuild extends Build {
  test = target()
    .description("Run the test suite")
    .executes(async () => { await $`deno test -A`; });
}

await run(MyBuild);
```

The shell helper `$` lives in the `./shell` submodule
(`jsr:@zuke/core/shell`).
@module

function absolutePath(first: string, ...rest: string[]): AbsolutePath
  Build an {@link AbsolutePath} from one or more segments. The first segment
  (after joining) must be absolute — start with `/` or a drive letter, or build
  from an absolute base — otherwise an error is thrown.

  ```ts
  const root = absolutePath("/app");
  root("src", "main.ts").path;       // "/app/src/main.ts"
  root.join("..", "shared").path;    // "/shared"
  absolutePath("C:\\repo", "x").path; // "C:/repo/x"
  ```

  @param first
      The first path segment; must make the result absolute.

  @param rest
      Additional segments to append.

function affectedTargets(order: readonly TargetBuilder[], changed: readonly string[]): Set<TargetBuilder>
  Compute the set of targets in `order` affected by the given `changed` files.

  `order` must be a valid execution order (dependencies before dependents, as
  produced by {@link plan}/{@link planGraph}) so each target's dependencies are
  already decided when it is visited. A target is affected when its own inputs
  cover a changed file, when it declares no inputs (unprovable — treated as
  affected), when a dependency is affected, or when an affected target triggers
  it.

async function archiveOutputs(outputs: readonly string[], host: OutputHost): Promise<Uint8Array>
  Archive a target's `outputs` into a gzipped tar of their current contents.

function assert(condition: unknown, message: string): asserts condition
  Assert that `condition` is truthy, narrowing it for the rest of the scope.
  Throws an {@link AssertionError} with `message` otherwise.

async function assertDirectoryExists(path: PathLike): Promise<void>
  Assert that `path` exists and is a directory. Async (stats the filesystem).

function assertExists<T>(value: T, message: string): NonNullable<T>
  Assert that `value` is neither `null` nor `undefined`, returning it narrowed
  to its non-nullable type so it can be used inline.

  ```ts
  const token = assertExists(Deno.env.get("TOKEN"), "TOKEN is required");
  ```

async function assertFileExists(path: PathLike): Promise<void>
  Assert that `path` exists and is a file. Async (stats the filesystem).

async function cancelRun(build: Build, options: CancelOptions): Promise<CancelResult>
  Cancel the run `options.runId` for `build`: transition it to `cancelling`
  (exactly one canceller drives the walk; a live owning process observes the
  change and aborts), run the compensations of every succeeded target in reverse
  order, and settle the record as `cancelled`. Idempotent — cancelling an
  already-terminal run is a friendly no-op.

  @throws
      if no state store is configured, or the run does not exist.

function ciHost(): string
  A short identifier for the detected CI host, or `"local"` when not on CI.
  Recognises GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket Pipelines,
  and the generic `CI` convention.

  Prefer {@link detectCiHost} for new code: its values match {@link CiProvider}.
  This function is kept for compatibility and uses longer, host-specific names.

function cicd(spec: CiFileSpec): CiFile
  Declare a CI file as a build field. Running the build regenerates it (and the
  `generate-ci` command writes it on demand), so the committed configuration is
  generated from code rather than hand-maintained.

  The provider is the only required field: `cicd({ provider: "github" })`
  declares a workflow at `.github/workflows/ci.yml` that runs the build on
  push/PR to `main`. Override only what else you need.

  ```ts
  class MyBuild extends Build {
    ci = cicd({ provider: "github" }); // sensible default workflow
    // …or customise:
    gitlab = cicd({ provider: "gitlab", pipeline: { jobs: [{ steps: [...] }] } });
  }
  ```

async function createTarGzip(files: PathLike[], dest: PathLike, options: { cwd?: string; }): Promise<void>
  Read `files` (relative to `cwd`), pack them into a tar archive named by their
  path relative to `cwd`, gzip it, and write the result to `dest`.

function describeCli(build: Build): CliDescription
  Describe a build's full CLI surface — reserved commands, option flags, targets
  (with descriptions and dependencies), and declared parameters — as a plain
  object ready for JSON. This is the same data `zuke --list --json` prints, made
  available to tooling and agents that introspect a build in code.

  ```ts
  import { describeCli } from "jsr:@zuke/core";
  const surface = describeCli(new MyBuild());
  console.log(surface.targets.map((t) => t.name));
  ```

function detectCiHost(env: (name: string) => string | undefined): CiHost
  Detect the CI host from the environment. Recognises GitHub Actions
  (`GITHUB_ACTIONS`), GitLab CI (`GITLAB_CI`), Azure Pipelines (`TF_BUILD`), and
  Bitbucket Pipelines (`BITBUCKET_BUILD_NUMBER`); anything else is `"local"`.
  The reader is injectable so detection can be unit-tested hermetically.

function discoverGroups(build: Build): Map<string, Group>
  Discover all parallel {@link Group} batches declared on a build instance,
  binding each its property path (for labelling, e.g. in the graph). Groups
  that are not assigned to a build property simply stay unnamed.

function discoverParameters(build: object): Map<string, AnyParameter>
  Discover all parameters declared on a build instance: scan its fields
  (recursing into plain-object component bundles) for {@link Parameter} values,
  bind each its dotted property path, and return a name → parameter map
  preserving declaration order.

function discoverTargets(build: Build): Map<string, TargetBuilder>
  Discover all targets declared on a build instance.

  Scans the instance's fields (recursing into plain-object component bundles)
  for {@link TargetBuilder} values, assigns each its dotted property path, and
  returns a name → target map preserving declaration order.

  @throws
      if two properties reference the same builder instance under different
      names (a programming error that would corrupt naming).

function envCacheStore(readEnv: (name: string) => string | undefined): RemoteCacheStore | undefined
  Resolve a {@link RemoteCacheStore} from the environment, or `undefined` when
  none is configured. `ZUKE_REMOTE_CACHE_URL` (with an optional
  `ZUKE_REMOTE_CACHE_TOKEN`) selects an {@link HttpCacheStore}; otherwise
  `ZUKE_REMOTE_CACHE_DIR` selects a {@link FileSystemCacheStore}.

function envStateStore(readEnv: (name: string) => string | undefined, host: StateHost): StateStore | undefined
  Resolve a {@link StateStore} from the environment, or `undefined` when none is
  configured. `ZUKE_STATE_URL` (with an optional `ZUKE_STATE_TOKEN`) selects an
  {@link HttpStateStore}; otherwise `ZUKE_STATE_DIR` selects a
  {@link FileSystemStateStore}.

function envVarName(name: string): string
  The environment variable for a parameter: its path in SCREAMING_SNAKE_CASE.

function execSecret(configure: Configure<ExecSecretSettings>): SecretSource
  A {@link SecretSource} that runs a command and takes its standard output as
  the secret value. Configure it through an {@link ExecSecretSettings} lambda.

  ```ts
  parameter("Vault token").secret().from(
    execSecret((s) => s.command("vault").arg("kv", "get", "-field=token", "secret/ci")),
  );
  ```

async function execute(build: Build, root: TargetBuilder, options: ExecuteOptions): Promise<BuildResult>
  Execute the requested target and its transitive dependencies.

  Runs the build's `onStart`/`onFinish` lifecycle hooks around the plan. By
  default targets run sequentially in deterministic order; with `parallel`,
  independent targets run concurrently while dependencies still complete first.
  Stops launching after the first failure, marks unreached targets as skipped,
  and returns a failing result.

function executionSet(root: TargetBuilder): Set<TargetBuilder>
  Compute the execution set for a requested target: the target plus the
  transitive closure of its hard dependencies.

function externalSignal(name: string): WaitTrigger
  A trigger satisfied when a signal named `name` has been delivered to the run
  (via `zuke resume <id> --signal <name>`). The signal's payload is exposed to
  target bodies through {@link "./target.ts".TargetContext} `signals`.

async function extractTarGzip(src: PathLike, destDir: PathLike): Promise<void>
  Read the `.tar.gz` at `src`, gunzip and unpack it, and write each entry under
  `destDir` (creating parent directories as needed).

function fail(message: string): never
  Throw an {@link AssertionError} with `message`. Never returns.

function fanOutPipeline(targets: Map<string, TargetBuilder>, base: CiPipeline, options: FanOutOptions): CiPipeline
  Expand a build's target graph into a fanned-out pipeline: one CI job per
  runnable target, wired together with `needs:` edges that mirror the targets'
  `dependsOn` dependencies — so independent targets run in parallel and a
  target's job waits for its prerequisites. Each job runs just its own target;
  upstream outputs are shared through the {@link "./remote_cache.ts" | remote
  cache}, so configure one (e.g. `ZUKE_REMOTE_CACHE_*` on the jobs) to avoid
  rebuilding dependencies in every job.

  `base` contributes the pipeline-level fields (name, triggers, permissions,
  concurrency); its `jobs` are ignored in favour of the generated ones. Targets
  with no body, and (unless {@link FanOutOptions.includeUnlisted}) `unlisted`
  targets, are omitted, and `needs` edges to omitted targets are dropped.

function fileSecret(configure: Configure<FileSecretSettings>): SecretSource
  A {@link SecretSource} that reads a file and takes its content as the secret
  value — for a mounted Kubernetes/Docker secret or a CI-provided file.
  Configure it through a {@link FileSecretSettings} lambda.

  ```ts
  parameter("Registry password").secret().from(
    fileSecret((s) => s.path("/run/secrets/registry_password")),
  );
  ```

function findCycle(targets: Map<string, TargetBuilder>): string[] | null
  Detect a cycle in the hard-dependency (`dependsOn`) graph across all targets.

  @return
      the cycle as a path of names (e.g. `["a", "b", "a"]`) or `null`.

function generateCi(pipeline: CiPipeline, provider: CiProvider): string
  Render `pipeline` as the YAML configuration for `provider`:
  `.github/workflows/*.yml`, `.gitlab-ci.yml`, `azure-pipelines.yml`, or
  `bitbucket-pipelines.yml`. The pipeline may be empty (`{}`) to accept every
  default.

async function gitChangedFiles(base: string, run: (args: string[]) => Promise<string>): Promise<string[]>
  List the files changed since `base` (default `HEAD`) via git: tracked changes
  versus `base` plus untracked files not covered by `.gitignore`. `run` invokes
  git and returns stdout (defaults to a real `git` subprocess); override it to
  test without a repository.

async function glob(pattern: string, options: GlobOptions): Promise<string[]>
  Expand a glob pattern to the matching paths, relative to `cwd`, sorted for
  determinism. The walk starts at the pattern's static prefix, so anchor
  patterns (e.g. `src/**\/*.ts`) to avoid scanning the whole tree. Symlinked
  directories are not followed.

function globToRegExp(pattern: string): RegExp
  Compile a glob pattern into an anchored {@link RegExp} that matches a full
  path. Exposed (and pure) for testing and custom matching.

function group(): Group
  Create a parallel {@link Group}. Targets join it with
  {@link TargetBuilder.partOf}, and a downstream target can depend on the whole
  batch by passing the group to {@link TargetBuilder.dependsOn}.

  ```ts
  checks = group();
  lint = target().partOf(this.checks).executes(...);
  format = target().partOf(this.checks).executes(...);
  deploy = target().dependsOn(this.checks).executes(...);
  ```

async function gunzip(data: Uint8Array): Promise<Uint8Array>
  Gunzip-decompress `data` using the platform `DecompressionStream`.

async function gzip(data: Uint8Array): Promise<Uint8Array>
  Gzip-compress `data` using the platform `CompressionStream`.

function hostPlatform(): Platform
  The current host's {@link Platform} (from `Deno.build`, with the OS
  normalised) — the analogue of {@link "./host.ts".isCI} for "what machine am I
  running on". Its `os` is a Zuke {@link OperatingSystem} (`macos`, not
  `darwin`); use the `osLabel`/`archLabel` helpers to name it for a download URL.

  ```ts
  const p = hostPlatform();
  p.os;                                          // "linux" | "macos" | "windows"
  const cpu = p.archLabel({ x86_64: "amd64", aarch64: "arm64" });
  ```

async function httpDownload(url: string, dest: PathLike, options: HttpOptions): Promise<void>
  Download `url` to `dest`, streaming the response body to the file. Creates or
  truncates `dest`. Throws {@link HttpError} on a non-2xx status.

async function httpJson<T = unknown>(url: string, options: HttpOptions): Promise<T>
  Fetch `url` and parse its body as JSON. Throws {@link HttpError} on non-2xx.

async function httpText(url: string, options: HttpOptions): Promise<string>
  Fetch `url` and return its body as text. Throws {@link HttpError} on non-2xx.

async function installRelease(options: InstallReleaseOptions): Promise<AbsolutePath>
  Download and install a release binary, returning its {@link AbsolutePath}.
  The path is ready to hand to a wrapper's `.toolPath(...)` (or `CmdTasks`).

  With a {@link InstallReleaseOptions.checksum}, the download is verified before
  anything is installed, and a matching prior install is reused without
  downloading again — so pinning a checksum makes the install both hermetic
  (tamper-evident) and cached.

function isCI(): boolean
  Whether the build appears to be running in a CI environment.

function lockKey(...parts: Array<string | number>): string
  Join parts into a lock key that is safe to use as a filename and URL segment.
  Each part is sanitised (non-`[A-Za-z0-9._-]` runs become `_`) and empty parts
  are dropped, so `lockKey("deploy", repo)` is stable and injection-free.

function operatingSystem(os: typeof Deno.build.os): OperatingSystem
  The operating system as a Zuke {@link OperatingSystem}: `darwin` becomes
  `macos`, `windows` stays `windows`, and every other Unix (`linux`, the BSDs,
  `solaris`, …) is reported as `linux`. Pass a raw `Deno.build.os` value to
  normalise it; defaults to the running host — the platform analogue of
  {@link isCI}.

  ```ts
  import { operatingSystem } from "jsr:@zuke/core";
  if (operatingSystem() === "macos") { ... }
  ```

function parameter(description?: string): Parameter<string, string | undefined>
  Create a new build parameter (a `string` by default). Configure it fluently:
  `.number()`/`.boolean()` change the kind, `.options(...)` restricts a string,
  `.default(v)`/`.required()` set optionality, and `.env(name)` overrides the
  environment variable.

function parseDuration(value: string | number): number
  Parse a duration to milliseconds. Accepts a number (already milliseconds) or a
  string of a non-negative amount and a unit — `ms`, `s`, `m`, `h`, or `d`
  (e.g. `"90s"`, `"4h"`, `"1.5h"`). Throws a friendly error on anything else.

function plan(root: TargetBuilder, extra: readonly OrderingEdge[]): TargetBuilder[]
  Topologically sort the execution set for `root`, honouring hard dependencies
  and the soft `before`/`after` ordering hints (the latter only between nodes
  that are both in the set).

  @return
      target builders in a valid execution order.

  @throws {GraphError}
      if the planned graph contains a cycle (which can happen
      via soft edges even when the hard graph is acyclic).

function remoteCacheKey(name: string, fingerprint: string): string
  The store key for a target's outputs: its name and input `fingerprint`. The
  name is sanitised so the key is safe as a filename and a URL path segment.

function repoRoot(...segments: string[]): AbsolutePath
  The absolute path of the repository root — the directory containing
  {@link CONFIG_FILE} — with any `segments` appended. The returned value is an
  {@link AbsolutePath}, so it is itself callable for further joining.

  ```ts
  repoRoot();                  // <root>
  repoRoot("src", "main.ts");  // <root>/src/main.ts
  repoRoot().join("dist");     // <root>/dist
  ```

  The root is located by walking up from the current working directory, so the
  path is resolved at runtime and never hard-coded into a committed file.

  @throws
      if no {@link CONFIG_FILE} is found in the cwd or any ancestor.

function resolveRemoteStore(option: RemoteCacheStore | false | undefined, declared: RemoteCacheStore | undefined, readEnv: (name: string) => string | undefined): RemoteCacheStore | undefined
  Pick the remote store for a run by precedence: an explicit `option` wins
  (`false` disables the remote cache entirely), then a `declared` store (a
  build's `remoteCache()` override), then the {@link envCacheStore} environment
  fallback.

function resolveStateStore(option: StateStore | false | undefined, declared: StateStore | undefined, options: ResolveStateOptions): StateStore | undefined
  Pick the state store for a run by precedence: an explicit `option` wins
  (`false` disables state entirely), then a `declared` store (a build's
  `stateStore()` override), then the {@link envStateStore} environment
  fallback, then — only when {@link ResolveStateOptions.enableDefault} — a
  filesystem store under `<root>/.zuke/runs`. A plain build with no durable
  feature and no configuration gets `undefined`, so it carries zero overhead.

async function restoreOutputs(artifact: Uint8Array, host: OutputHost): Promise<string[]>
  Restore the files in `artifact` (a gzipped tar produced by
  {@link archiveOutputs}) to disk, returning the paths written. Entry names are
  validated first: an absolute path or one escaping the workspace (`..`) is
  rejected before anything is written, so a malicious archive can't plant files
  outside the current directory.

async function resumeCheck(build: Build, options: Omit<ResumeOptions, "runId" | "signal" | "data"> & { runId?: string; }): Promise<{ checked: number; failed: number; }>
  Re-attempt every suspended run in the store (or just `runId`): predicate-based
  waits are re-evaluated and expired waits time out. Signal-based waits with no
  new signal simply re-suspend. Returns the number of runs that ended in
  failure. This is the sweep a cron or webhook drives (`zuke resume --check`).

async function resumeRun(build: Build, options: ResumeOptions): Promise<BuildResult>
  Resume the suspended run `options.runId` for `build`. Transitions it to
  `running` (exactly one resumer wins), optionally delivers a signal, checks the
  graph still matches, and continues via {@link "./executor.ts".execute},
  re-running only the not-yet-succeeded targets.

  @throws {AlreadyResumedError}
      if another process already resumed it.

  @throws
      if the run does not exist, is not suspended, the build lacks its root
      target, or the graph drifted (unless {@link ResumeOptions.forceGraph}).

function resumeWhen(check: () => boolean | Promise<boolean>, options: ResumeWhenOptions): WaitTrigger
  A trigger satisfied when an async `check` predicate returns `true`. Zuke does
  not poll on its own — the predicate is evaluated when the target is reached
  and on each `zuke resume <id> --check`, so a cron or webhook nudging `--check`
  drives it. Use it to wait on state Zuke can query (a row, a file, an API).

async function run(BuildClass: new () => Build, options: RunOptions): Promise<void>
  Public entry point. Instantiate the build, parse arguments, run, and set the
  process exit code.

  Call it at the bottom of your build file — no `import.meta.main` guard
  needed. `run` acts only when its module is the program's entry point; when
  the file is imported instead (for example under test) it does nothing.

  ```ts
  await run(MyBuild);
  // …with plugins:
  await run(MyBuild, { plugins: [timing] });
  ```

function service(): ServiceBuilder
  Create a service target — a long-lived process kept running while its
  dependents execute. Configure it with {@link ServiceBuilder.start} /
  {@link ServiceBuilder.readyWhen} and depend on it from a {@link target}.

function tar(entries: TarEntry[]): Uint8Array
  Create a `ustar` archive from the given entries (in order).

function target(): TargetBuilder
  Create a new, empty target builder.

async function tcpReachable(address: string): Promise<boolean>
  Whether a TCP `host:port` is accepting connections — the usual readiness
  probe for a server. Resolves `true` once a connection succeeds (it is closed
  immediately), `false` while the port is still refused/unreachable, so it
  plugs straight into {@link ServiceBuilder.readyWhen}.

  ```ts
  .readyWhen(() => tcpReachable("localhost:5432"))
  ```

function toolchain(configure?: (t: Toolchain) => void): Toolchain
  Create a {@link Toolchain}. Configure it inline with a callback, or chain
  {@link Toolchain.tool} on the returned instance.

  ```ts
  const tools = toolchain((t) =>
    t.tool((s) => s.name("helm").url(helmUrl))
     .tool((s) => s.name("kubectl").url(kubectlUrl))
  );
  ```

function untar(archive: Uint8Array): TarEntry[]
  Extract the entries from a `ustar` archive (regular files only).

function validateGraph(targets: Map<string, TargetBuilder>): void
  Validate the whole graph: unknown references first, then cycles.

  @throws {GraphError}
      with a descriptive message including the cycle path.

const AnnounceTasks: AnnounceTasksApi
  Announcement task functions for posting build status to chat platforms.

const CONFIG_FILE: "zuke.json"
  The Zuke config file name; its presence marks a repository root.

const DEFAULT_POLL_INTERVAL_MS: 200
  How often {@link ServiceBuilder.readyWhen} is polled while waiting.

const DEFAULT_READY_TIMEOUT_MS: 30000
  The default time a service is given to become ready before it fails.

const DEFAULT_TOOLS_DIR: ".zuke/tools"
  The default directory a {@link Toolchain} (and {@link ToolTasks}) installs into.

const FileTasks: FileTasksApi
  Filesystem task functions for build scripts.

const REDACTED: "[redacted]"
  The placeholder a {@link Redactor} substitutes for each secret value.

const ToolTasks: ToolTasksApi
  Provision external CLIs from a build. `ToolTasks.install((s) => …)` fetches a
  single tool; group several with {@link toolchain}.

const defaultRenderer: Renderer
  The built-in renderer: Zuke's ruled headers and summary table.

const defaultStateHost: StateHost
  The real, `Deno`-backed {@link StateHost}.

class AlreadyResumedError extends Error
  Raised when a run has already been resumed by another process.

  constructor(readonly runId: string, readonly by: string, readonly at: string)
    Build the error from the run id and who is already running it.
  override name: string
    The error name.

class AnnounceError extends Error
  Raised when an announcement is run before it is fully configured.

  constructor(message: string)
    Build the error with an explanatory message.
  override name: string
    The error name.

abstract class AnnouncementSettings
  Fluent settings shared by every announcement: the message content (a body, an
  optional title, a {@link AnnouncementLevel | level}, repeatable detail fields
  and an action link), an optional display name, the webhook destination, and a
  `fetch` seam for tests. All chainers return `this`. Subclasses add any
  platform-specific configuration and render the payload.

  protected text_: string
    The main message body.
  protected title_?: string
    An optional heading shown above the body.
  protected level_: AnnouncementLevel
    The outcome level driving the accent colour and icon.
  protected readonly fields_: AnnouncementField[]
    Repeatable labelled detail fields.
  protected link_?: AnnouncementLink
    An optional action link rendered with the announcement.
  protected username_?: string
    An optional display name for the sender.
  protected webhookUrl_?: string
    The webhook destination URL.
  protected fetch_?: typeof fetch
    A `fetch` seam injected by tests.
  protected token_?: string
    An API/bot-mode token, when opted in with `.bot()`.
  protected channel_?: string
    The target channel in API/bot mode.
  text(text: string): this
    Set the main message body.
  title(title: string): this
    Set an optional heading shown above the body.
  level(level: AnnouncementLevel): this
    Set the outcome the message conveys (default `"info"`).
  success(): this
    Shorthand for `.level("success")`.
  failure(): this
    Shorthand for `.level("failure")`.
  warning(): this
    Shorthand for `.level("warning")`.
  info(): this
    Shorthand for `.level("info")`.
  field(name: string, value: string): this
    Add a labelled detail rendered beside the body. Repeatable.
  link(text: string, url: string): this
    Set an action link rendered with the message.
  username(name: string): this
    Override the display name the message is posted under. Honoured by Slack and
    Discord; ignored by Teams, which has no equivalent field.
  webhook(url: string): this
    Set the incoming-webhook URL to post to. The URL embeds the secret, so
    source it from a secret parameter.
  fetch(impl: typeof fetch): this
    The `fetch` implementation to use. Defaults to the global `fetch`; override
    it to unit-test without network access.
  bot(): this
    Post through the platform's API with a bot/access token instead of an
    incoming webhook. Pair with {@link token} and {@link channel}.
  token(token: string): this
    Set the bot/access token for {@link bot} mode (Slack `xoxb-…`, a Discord bot
    token, or a Microsoft Graph bearer token). Source it from a secret
    parameter; Zuke masks it in CI output. Implies {@link bot}.
  channel(channel: string): this
    Set the channel (id or name) to post to in {@link bot} mode.
  protected announcement(): Announcement
    The structured announcement assembled so far.
  protected requireWebhook(): string
    The webhook URL, or an {@link AnnounceError} if one was never set.
  protected botRequested(): boolean
    Whether the caller opted into bot mode via {@link bot} or {@link token}.
  protected requireToken(): string
    The bot/access token, or an {@link AnnounceError} if one was never set.
  protected requireChannel(): string
    The target channel, or an {@link AnnounceError} if one was never set.
  abstract protected payload(): Record<string, unknown>
    The platform-native JSON payload for a webhook post.
  abstract protected sendBot(): Promise<void>
    Post through the platform's API in {@link bot} mode.
  send(): Promise<void>
    Send the announcement: through the platform's API when {@link bot} mode was
    requested, otherwise by posting the {@link payload} to the webhook.

class AssertionError extends Error
  Raised by the assertion helpers when an expectation fails.

  override name: string
    The error name.

class Build
  Base class for user-defined builds. Provides no targets of its own; subclasses
  declare targets as properties. Optionally override the lifecycle hooks.

  onStart(): void | Promise<void>
    Called once before any target runs.
  onFinish(_result: BuildResult): void | Promise<void>
    Called once after the run completes (success or failure).
  onTargetStart(_name: string): void | Promise<void>
    Called just before a target's body executes (not for skipped/cached).
  onTargetEnd(_name: string, _status: TargetStatus): void | Promise<void>
    Called after each target settles, with its final status.
  recoverWith(): Remediation[]
    Remediations applied to every target, running after each target's own
    {@link "./target.ts".TargetBuilder.recoverWith} when its body fails. Override
    to attach a global AI fixer once instead of repeating it per target; the
    default is none. Both styles compose — a target's own remediations run
    first, then these.

    ```ts
    class CI extends Build {
      key = parameter("OpenAI API key").secret();
      override recoverWith() {
        return [aiFixer((f) => f.provider("openai").apiKey(this.key))];
      }
      lint = target().executes(() => DenoTasks.lint()); // healed globally
    }
    ```
  remoteCache(): RemoteCacheStore | undefined
    The {@link "./remote_cache.ts".RemoteCacheStore} that shares target
    {@link "./target.ts".TargetBuilder.outputs} across machines. Override to
    declare one in code; the default is none, and — unless overridden — the
    executor falls back to {@link "./remote_cache.ts".envCacheStore} (the
    `ZUKE_REMOTE_CACHE_*` environment variables). Applies to targets that
    declare both `inputs` and `outputs`.

    ```ts
    class CI extends Build {
      override remoteCache() {
        return new HttpCacheStore({ url: this.cacheUrl.value, token: this.cacheToken.value });
      }
      build = target().inputs("src").outputs("dist").executes(...);
    }
    ```
  stateStore(): StateStore | undefined
    The {@link "./state/store.ts".StateStore} that persists this build's run
    records. Override to declare one in code; the default is none, and — unless
    overridden — the executor falls back to the `ZUKE_STATE_URL` /
    `ZUKE_STATE_DIR` environment variables, then (only when the run opts into
    durable state) a filesystem store under `<root>/.zuke/runs`.

    ```ts
    class CD extends Build {
      override stateStore() {
        return new HttpStateStore({ url: this.stateUrl.value, token: this.stateToken.value });
      }
      deploy = target().executes(async (ctx) => { await ctx.state.set({ at: "sit-7" }); });
    }
    ```
  extraEdges(_targets: Map<string, TargetBuilder>): OrderingEdge[]
    Extra soft ordering edges to impose on the plan, beyond the `dependsOn`
    / `before` / `after` declared on targets. Override to feed an external graph
    — e.g. a monorepo's `dependency-graph.json` — into scheduling without wiring
    every edge by hand. Return `[before, after]` pairs from the passed
    `targets` map (keyed by dotted name); each means `before` runs before
    `after`. Edges whose endpoints are not both in a run's execution set are
    ignored, and a cycle is reported with the usual friendly error.

    These are execution-ordering edges. Like `.before()` / `.after()`, they
    are not reflected in CI generated by `cicd()` — a fan-out job's `needs:`
    mirrors hard `dependsOn` only — so an ordering that CI must also honour has
    to be expressed as a `dependsOn`, not a soft edge.

    ```ts
    class Monorepo extends Build {
      web = target().executes(...);
      api = target().executes(...);
      override extraEdges(t: Map<string, Target>) {
        // `api` must build before `web`, per the external dependency graph.
        const edges: OrderingEdge[] = [];
        const api = t.get("api"), web = t.get("web");
        if (api && web) edges.push([api, web]);
        return edges;
      }
    }
    ```

class CiFile
  A declared CI file. Assign one (via {@link cicd}) to a build field and Zuke
  keeps the file on disk in sync with the definition when the build runs.

  constructor(spec: CiFileSpec)
    Build the CI file from its spec, filling in the provider's default path.
  readonly provider: CiProvider
    The provider this file renders for.
  readonly path: string
    The output path.
  readonly pipeline: CiPipeline
    The base pipeline (pipeline-level fields, and the jobs unless fanning out).
  readonly fanOut?: FanOutOptions
    Fan-out options, when this file expands the build's targets into jobs.
  pipelineFor(targets: Map<string, TargetBuilder>): CiPipeline
    The pipeline this file renders. With fan-out, the build's `targets` are
    expanded into one job per target; otherwise the declared {@link pipeline}.
  render(): string
    Render the file's YAML content (the base pipeline; fan-out is resolved at discovery).

class DiscordAnnouncementSettings extends AnnouncementSettings
  Fluent settings for {@link AnnounceTasksApi.discord}. Bot mode
  (`.bot().token(t).channel(c)`) posts through the REST API with a bot token.

  override protected payload(): Record<string, unknown>
    Render the Discord webhook payload.
  override protected sendBot(): Promise<void>
    Post the announcement through the Discord REST API in bot mode.

class ExecSecretSettings
  Fluent settings for {@link execSecret}: a command whose standard output is
  the secret. Configure the binary with {@link ExecSecretSettings.command},
  arguments with {@link ExecSecretSettings.arg}, and optionally the environment
  and working directory. Output is trimmed of surrounding whitespace unless
  {@link ExecSecretSettings.trim} is turned off (some values are
  whitespace-sensitive).

  command(binary: PathLike): this
    The binary to run (e.g. `op`, `vault`, `gcloud`). Required.
  arg(...values: Array<string | number | AbsolutePath>): this
    Append one or more arguments to the command.
  env(record: Record<string, string>): this
    Merge additional environment variables for the process.
  cwd(path: PathLike): this
    Set the working directory for the process.
  trim(on: boolean): this
    Whether to trim surrounding whitespace from stdout (default `true`).
  async resolve_(): Promise<string>
    Run the command and return its captured stdout as the secret. Streaming is
    suppressed (`quiet`) so the value is never echoed to the terminal, and a
    non-zero exit throws a {@link SecretError} naming the command.

class FileSecretSettings
  Fluent settings for {@link fileSecret}: read a secret from a file. Set the
  path with {@link FileSecretSettings.path}; the content is trimmed of
  surrounding whitespace unless {@link FileSecretSettings.trim} is turned off.

  path(path: PathLike): this
    The file to read the secret from. Required.
  trim(on: boolean): this
    Whether to trim surrounding whitespace from the content (default `true`).
  async resolve_(): Promise<string>
    Read the file and return its content as the secret. A missing or
    unreadable file throws a {@link SecretError} naming the path.

class FileSystemCacheStore implements RemoteCacheStore
  A {@link RemoteCacheStore} backed by a shared or mounted directory.

  constructor(dir: string)
    Build the store over a directory.

    @param dir
        The directory archives are read from and written to.

  get(key: string): Promise<Uint8Array | null>
    Fetch the archived outputs stored under `key`, or `null` if there are none.
  async put(key: string, artifact: Uint8Array): Promise<void>
    Store `artifact` (a gzipped tar of a target's outputs) under `key`.

class FileSystemStateStore implements StateStore
  A {@link StateStore} that writes one `<id>.json` file per run under a
  directory.

  Security. `dir` is trusted configuration — the location you choose to
  store run state (from `ZUKE_STATE_DIR`, `--state`, or an explicit store), the
  same posture as {@link "../remote_cache.ts".FileSystemCacheStore}. The only
  untrusted value that reaches a path is the run id, which is validated at
  every point a path is built, so a traversal cannot be smuggled in through an
  id.

  constructor(dir: string, host: StateHost)
    Build the store over `dir` (created on first write). Filesystem access goes
    through `host`, which defaults to {@link defaultStateHost}.
  async getRun(id: string): Promise<{ record: RunRecord; version: string; } | null>
    Fetch a run and the content-hash version of its stored file.
  async putRun(record: RunRecord, expectedVersion: string | null): Promise<PutResult>
    Publish `record` under an exclusive lock, guarding the expected version.
  async listRuns(query: RunQuery): Promise<RunSummary[]>
    List runs matching `query`, newest first. Unreadable files are skipped.
  async acquireLock(key: string, holder: LockHolder, ttlMs: number): Promise<LockResult>
    Atomically acquire the lock `key` for `holder`, taking over if expired.
  async renewLock(key: string, token: string, ttlMs: number): Promise<boolean>
    Extend the lock `key` held under `token`; `false` if the token lost it.
  async releaseLock(key: string, token: string): Promise<void>
    Release the lock `key` if still held under `token`; a no-op otherwise.

class ForEachSettings
  Fluent configuration for {@link TargetBuilder.forEach}, in the settings-lambda
  style: `.forEach(items, factory, (s) => s.concurrency(3).continueOnItemFailure())`.
  Sets the {@link ForEachSettings.concurrency | concurrency} cap and whether one
  item's failure isolates it or stops the whole batch.

  concurrency_?: number
    Max item pipelines in flight at once; set by {@link concurrency}.
  continueOnItemFailure_: boolean
    Isolate a failed item from its siblings; set by {@link continueOnItemFailure}.
  concurrency(limit: number): this
    Cap how many item pipelines run concurrently (default: the host CPU count).
    Clamped to at least 1; `1` runs items one at a time.
  continueOnItemFailure(on: boolean): this
    Keep running the other items when one item's pipeline fails (the failed
    item's later stages are still skipped). The fan-out target still fails at
    the end if any item failed. Without this, the first item failure stops the
    batch — the default.

class GraphError extends Error
  Raised when the build graph is invalid (cycle or unknown dependency).

  override name: string
    The error name.

class Group
  A parallel batch of targets, created with {@link group}. Targets join it via
  {@link TargetBuilder.partOf}; its members run concurrently with one another
  (each still awaiting its own dependencies) regardless of the global parallel
  setting. Passing a group to {@link TargetBuilder.dependsOn} depends on every
  member at once.

  readonly members_: TargetBuilder[]
    Members that declared themselves part of this group, in declaration order.
  name_?: string
    Property name, assigned during discovery. Undefined until then.

class HttpCacheStore implements RemoteCacheStore
  A {@link RemoteCacheStore} backed by HTTP: `GET <url>/<key>` fetches an
  artifact (a `404` means a miss) and `PUT <url>/<key>` stores one. Works with
  any object store or cache server that speaks plain HTTP GET/PUT — an S3, GCS,
  or R2 bucket behind a URL, or a self-hosted cache endpoint.

  Security. The `url` (and `token`) are trusted configuration: outputs are
  uploaded to that host and archives are extracted from it, so point it only at
  a cache you control, and prefer a {@link "./params.ts" | secret parameter} or
  an environment variable over a hard-coded value. On CI, restrict egress to
  the cache host so a misconfigured or overridden URL can't exfiltrate
  artifacts. Restored archives are always confined to the workspace (see
  {@link restoreOutputs}), so a poisoned store cannot write outside it.

  constructor(options: HttpCacheStoreOptions)
    Build the store from its URL, optional token, and `fetch` seam.
  async get(key: string): Promise<Uint8Array | null>
    Fetch the archived outputs stored under `key`, or `null` if there are none.
  async put(key: string, artifact: Uint8Array): Promise<void>
    Store `artifact` (a gzipped tar of a target's outputs) under `key`.

class HttpError extends Error
  Raised when an HTTP request returns a non-2xx status.

  constructor(readonly status: number, readonly url: string)
    Build the error from the failing response's status and URL.
  override name: string
    The error name.

class HttpStateStore implements StateStore
  A {@link StateStore} backed by HTTP.

  Security. The `url` and `token` are trusted configuration — run
  records (which include resolved non-secret parameters and target metadata)
  are sent to that host, so point it only at a service you control and prefer a
  {@link "../params.ts" | secret parameter} or environment variable over a
  hard-coded value.

  constructor(options: HttpStateStoreOptions)
    Build the store from its URL, optional token, and `fetch` seam.
  async getRun(id: string): Promise<{ record: RunRecord; version: string; } | null>
    `GET /runs/:id` → record + `ETag`; a `404` is a miss.
  async putRun(record: RunRecord, expectedVersion: string | null): Promise<PutResult>
    `PUT /runs/:id` guarded by `If-Match` / `If-None-Match`; `412` → conflict.
  async listRuns(query: RunQuery): Promise<RunSummary[]>
    `GET /runs?status=&target=&since=` → an array of {@link RunSummary}.
  async acquireLock(key: string, holder: LockHolder, ttlMs: number): Promise<LockResult>
    `POST /locks/:key` → `201 { token }`, or `409` with the current holder.
  async renewLock(key: string, token: string, ttlMs: number): Promise<boolean>
    `PUT /locks/:key` renews; a `409`/`404` means the token lost the lock.
  async releaseLock(key: string, token: string): Promise<void>
    `DELETE /locks/:key` releases; a missing lock (`404`) is not an error.

class LockConflictError extends Error
  Raised when a target's lock is already held by another run. Its `message` is
  the rendered guidance (from the target's `onConflict`, else a default), so it
  surfaces verbatim in the CLI failure footer and the run record; `holder`
  carries the structured identity for programmatic surfaces (e.g. MCP).

  constructor(readonly holder: LockHolder, guidance: string)
    Build the error from the current holder and the rendered guidance.
  override name: string
    The error name.

class LockSettings
  Fluent configuration for {@link TargetBuilder.lock}, in the settings-lambda
  style: `.lock((s) => s.lockKey("deploy", repo).withTtl("4h"))`. Set the key
  (composed from sanitised parts with {@link LockSettings.lockKey}, or directly
  with {@link LockSettings.key}), the {@link LockSettings.withTtl | TTL}, and an
  optional {@link LockSettings.onConflict} message. The lambda runs after
  parameters resolve, so the key may read `this.<param>.value`.

  key_?: string
    The resolved lock key; set by {@link key} or {@link lockKey}.
  ttl_?: string | number
    The TTL (a duration string or milliseconds); set by {@link withTtl}.
  onConflict_?: (holder: LockHolder) => string
    The conflict-guidance renderer; set by {@link onConflict}.
  lockKey(...parts: Array<string | number>): this
    Set the lock key from parts, sanitised and joined via
    {@link "./state/lock.ts".lockKey} — e.g. `s.lockKey("deploy", repo)`.
  key(key: string): this
    Set the lock key directly (must be filename-safe; prefer {@link lockKey}).
  withTtl(ttl: string | number): this
    How long the lock survives a killed holder — a duration string like `"4h"`
    / `"30m"` (see the duration parser) or raw milliseconds. A live holder
    renews it while it runs, so it never expires under it.
  onConflict(render: (holder: LockHolder) => string): this
    Render the guidance shown to a run that loses the lock. Receives the
    current {@link "./state/lock.ts".LockHolder}; the returned string becomes
    the failure message. Defaults to a generic "held by … then retry" line.

class Parameter<K extends ParamValue = ParamValue, T extends K | K[] | undefined = K | undefined> implements AnyParameter
  A typed build parameter. Declare one with {@link parameter} and configure it
  with the fluent methods; each method returns a new parameter whose `value`
  type reflects the configuration (`string`, `number`, `boolean`, and whether
  it can be `undefined`).

  `K` is the underlying value kind; `T` is the exposed `value` type, which is
  `K` for required/defaulted parameters and `K | undefined` for optional ones.

  constructor(spec: ParamSpec<K, T>)
    Build a parameter from its resolved constructor spec.
  name_?: string
    Property name, assigned during discovery. Undefined until then.
  readonly description_?: string
    Human-readable description shown in `--help`/`--list`.
  readonly kind_: ParamKind
    The runtime value kind.
  readonly required_: boolean
    Whether a value must be supplied (no default).
  readonly options_?: readonly string[]
    The allowed string choices, if restricted with {@link Parameter.options}.
  readonly envName_?: string
    An explicit environment variable name override.
  readonly hasFallback_: boolean
    Whether the parameter has a declared default value.
  readonly secret_: boolean
    Whether the value is sensitive and should be masked in CI output.
  readonly array_: boolean
    Whether the value is a comma-separated / repeatable list (`.array()`).
  readonly source_?: SecretSource
    A provider that resolves the value when no flag/env supplied one.
  get value(): T
    The resolved value. Throws if read before the build resolves parameters.
  isSet_(): boolean
    Whether the parameter resolved to a defined value (used by `.requires()`).
  stringValue_(): string | undefined
    The resolved value as a string, or `undefined` if unset (for masking).
  secret(): Parameter<K, T>
    Mark the value as sensitive: it is masked in CI output (`::add-mask::`) and
    redacted from all of Zuke's reporter output. Pair with {@link Parameter.from}
    to resolve the value from a secret manager rather than the environment.
  from(source: SecretSource): Parameter<K, T>
    Resolve the value from a {@link SecretSource} (see {@link execSecret} /
    {@link fileSecret}) when neither a `--flag` nor an environment variable
    supplied one — the source is a fallback provider, consulted before the
    declared default. Typically paired with {@link Parameter.secret} so the
    resolved value is redacted.
  number(this: Parameter<string, string | undefined>): Parameter<number, number | undefined>
    Parse the value as a number (e.g. `--workers 4`).
  boolean(this: Parameter<string, string | undefined>): Parameter<boolean, boolean>
    Treat the parameter as a boolean flag (e.g. `--verbose`); defaults to false.
  options(this: Parameter<string, string | undefined>, ...values: string[]): Parameter<string, string | undefined>
    Restrict a string parameter to a fixed set of choices.
  default(this: Parameter<K, K | undefined>, value: K): Parameter<K, K>
    Provide a default, making `value` non-optional (`K`).
  required(this: Parameter<K, K | undefined>): Parameter<K, K>
    Require a value, making `value` non-optional (`K`); errors if unsupplied.
  env(name: string): Parameter<K, T>
    Override the environment variable read as a fallback for this parameter.
  array(this: Parameter<E, E | undefined>): Parameter<E, E[]>
    Accept a comma-separated list (or a repeated flag), exposing `value` as an
    array. `--tags a,b` and `--tags a --tags b` both yield `["a", "b"]`; blank
    entries are dropped, and an unsupplied list defaults to `[]`.

    Each element is parsed by this parameter's own element parser, so it
    composes: `.options("a", "b").array()` validates every element against
    the choices, and `.number().array()` yields a `number[]`, rejecting a
    non-numeric entry. (Apply `.options()`/`.number()` before `.array()`.)
  resolve_(raw: string | undefined): void
    Resolve from a raw input (or `undefined` when none was supplied).

class ParameterError extends Error
  Raised when a parameter value is invalid or read before resolution.

  override name: string
    The error name.

class Redactor
  Collects secret values and masks them in text. Register a value with
  {@link Redactor.add} and rewrite a line with {@link Redactor.redact}; empty
  strings are ignored (they would match everywhere) and duplicates are recorded
  once. Longer secrets are applied first so a secret that contains another is
  masked whole rather than partially.

  add(value: string): void
    Register a secret value to mask. Ignores empty strings and duplicates.
  redact(line: string): string
    Replace every registered secret in `line` with {@link REDACTED}.
  get size(): number
    The number of distinct secret values registered.

class SecretError extends Error
  Raised when a {@link SecretSource} cannot produce a value.

  override name: string
    The error name.

class ServiceBuilder extends TargetBuilder
  A long-lived {@link target}. Configure how it starts ({@link
  ServiceBuilder.start}), how to tell it is ready ({@link
  ServiceBuilder.readyWhen}), and — when the started handle is not
  self-stopping — how it stops ({@link ServiceBuilder.stop}). It inherits the
  ordering methods (`dependsOn`, `before`, `after`, `description`) from
  {@link TargetBuilder}; a service has no `.executes` body.

  start(fn: () => ServiceHandle | Promise<ServiceHandle>): this
    How to start the process. Return a {@link ServiceHandle} (e.g.
    `$\`…`.spawn()`) so the service can be stopped on teardown; provide a
    custom {@link ServiceBuilder.stop} if the handle is not self-stopping.
  readyWhen(fn: () => boolean | Promise<boolean>): this
    A readiness probe, polled until it returns `true` (or the timeout is hit).
    Without one, the service is considered ready the moment it starts. See
    {@link tcpReachable} for the common "is the port accepting connections?".
  readyTimeout(ms: number): this
    Override how long to wait for {@link ServiceBuilder.readyWhen} (default 30s).
  stop(fn: (handle: ServiceHandle) => void | Promise<void>): this
    Custom teardown, given the handle {@link ServiceBuilder.start} returned.
  async launch_(name: string): Promise<RunningService>
    INTERNAL: start the service and wait until it is ready, returning a handle
    the executor stops on teardown. Throws {@link ServiceError} if no start was
    configured, or if the service does not become ready in time (the
    just-started process is stopped first so it is not leaked).

class ServiceError extends Error
  Raised when a service cannot start or does not become ready in time.

  override name: string
    The error name.

class ServiceRegistry
  Holds the services started during a run and stops them in reverse order on
  teardown. Stopping never throws — a failure to stop one service is reported
  and the rest are still stopped.

  register(running: RunningService): void
    Record a started service to stop later.
  get size(): number
    The number of services currently held.
  async stopAll(report: (line: string) => void): Promise<void>
    Stop every registered service, newest first, reporting each outcome.

class SlackAnnouncementSettings extends AnnouncementSettings
  Fluent settings for {@link AnnounceTasksApi.slack}. Bot mode
  (`.bot().token(t).channel(c)`) posts through the Web API (`chat.postMessage`).

  override protected payload(): Record<string, unknown>
    Render the Slack webhook payload.
  override protected sendBot(): Promise<void>
    Post the announcement through the Slack Web API in bot mode.

class SlackApiError extends Error
  Raised when the Slack Web API accepts the request but reports a logical
  failure (`{ ok: false }`), carrying Slack's machine-readable error code (e.g.
  `channel_not_found`, `not_in_channel`, `invalid_auth`).

  constructor(readonly error: string)
    Build the error from Slack's machine-readable error code.
  override name: string
    The error name.

class TargetBuilder
  The fluent builder returned by {@link target}. All configuration methods are
  chainable and return `this`. A body (via {@link TargetBuilder.executes}) is
  required before a target can be executed.

  description_?: string
    Human-readable summary shown in `--list`.
  readonly dependsOn_: TargetBuilder[]
    Hard prerequisites: these run (transitively) before this target.
  readonly before_: TargetBuilder[]
    Soft ordering: this runs before the listed targets if both are planned.
  readonly after_: TargetBuilder[]
    Soft ordering: this runs after the listed targets if both are planned.
  fn_?: TargetFn
    The target body.
  name_?: string
    Property name, assigned during discovery. Undefined until then.
  group_?: Group
    The parallel batch this target belongs to, if any (set by {@link partOf}).
  readonly inputs_: string[]
    Input files/directories whose contents key the cache (set by {@link inputs}).
  readonly outputs_: string[]
    Output files/directories that must exist for a cache hit (set by {@link outputs}).
  readonly onlyWhen_: Condition[]
    Conditions gating execution; all must hold or the target is skipped.
  readonly triggers_: TargetBuilder[]
    Targets pulled in and run after this one (set by {@link triggers}).
  readonly requires_: AnyParameter[]
    Parameters that must be set for this target (set by {@link requires}).
  proceedAfterFailure_: boolean
    Continue the build if this target fails (set by {@link proceedAfterFailure}).
  always_: boolean
    Run even after the build has failed (set by {@link always}).
  unlisted_: boolean
    Hide this target from `--list`/`--help` (set by {@link unlisted}).
  readOnly_: boolean
    Advertise this target as query-only over MCP (set by {@link readOnly}).
  dryRunnable_: boolean
    Run this target's body under `--dry-run` with `$` echoed (set by {@link dryRunnable}).
  readonly cacheKeys_: Array<() => string | Promise<string>>
    Extra cache-key contributors beyond input files (set by {@link cacheKey}).
  readonly produces_: string[]
    Artifact paths this target produces (set by {@link produces}).
  skipDependencies_: boolean
    When skipped by a condition, also skip dependencies (set by {@link whenSkipped}).
  timeout_?: number
    Per-attempt timeout in milliseconds, if set by {@link timeout}.
  retries_: number
    Number of extra attempts on failure, set by {@link retry}.
  retryDelay_: number
    Delay between retry attempts in milliseconds.
  readonly validateBefore_: Validation[]
    Validations run before the body (set by {@link validateBefore}).
  readonly validateAfter_: Validation[]
    Validations run after the body (set by {@link validateAfter}).
  readonly recoverWith_: Remediation[]
    Remediations run after the body fails (set by {@link recoverWith}).
  recoverAttempts_: number
    Max fix-then-rerun cycles when the body fails (set by {@link recoverAttempts}).
  lock_?: Configure<LockSettings>
    Cross-run lock settings lambda, set by {@link lock} and run after params resolve.
  waitsFor_?: Configure<WaitSettings>
    External-event wait settings lambda, set by {@link waitsFor} and run when reached.
  forEach_?: ForEachSpec
    Fan-out spec, set by {@link forEach}: materialises per-item sub-target pipelines.
  onCancel_?: () => TargetBuilder
    Compensation thunk, set by {@link onCancel}: runs on cancel iff this target succeeded.
  description(text: string): this
    Set the human-readable description shown in `zuke --list`.
  dependsOn(...targets: Array<TargetBuilder | Group>): this
    Declare hard prerequisites. References sibling targets via `this.x`, or a
    {@link group} (which expands to every member that has joined it).
  partOf(group: Group): this
    Join a parallel {@link group}. Members of the same group run concurrently
    with one another (each still awaiting its own dependencies) even when the
    build is otherwise sequential. Declare the group before the targets that
    join it.
  inputs(...paths: PathLike[]): this
    Declare input files or directories (directories are hashed recursively).
    A target with inputs is incremental: it is skipped (reported `cached`)
    when its inputs are unchanged since the last successful run and all its
    {@link outputs} still exist. Repeatable.
  outputs(...paths: PathLike[]): this
    Declare output files or directories. A cache hit also requires every output
    to still exist, so deleting an output forces a rebuild. Repeatable.
  onlyWhen(condition: Condition): this
    Run only when `condition` holds; otherwise the target is skipped (and its
    dependents still run). The predicate may be async and can read resolved
    parameters or the environment. Repeatable — all conditions must hold.

    ```ts
    deploy = target()
      .onlyWhen(() => this.environment.value === "production")
      .executes(...);
    ```
  executes(fn: TargetFn): this
    Set the target body. May be async.
  before(...targets: TargetBuilder[]): this
    Run before the listed targets if both are in the plan (soft ordering).
  after(...targets: TargetBuilder[]): this
    Run after the listed targets if both are in the plan (soft ordering).
  triggers(...targets: TargetBuilder[]): this
    Pull the listed targets into the plan and run them after this one. The
    inverse of {@link dependsOn}: running this target triggers the others.
  dependentFor(...targets: TargetBuilder[]): this
    Declare this target as a prerequisite of the listed targets — the reverse
    of {@link dependsOn}: each listed target gains this one as a dependency,
    so this runs before them. Declare the listed targets above this one.
  requires(...params: AnyParameter[]): this
    Require that the given parameters resolve to a value before this target
    runs; otherwise the target fails with a message naming the missing one.
    Use it when a target needs a parameter that is optional build-wide.
  proceedAfterFailure(): this
    Keep running the rest of the build even if this target fails. The build
    still reports failure, and this target's own dependents are skipped.
  unlisted(): this
    Hide this target from `--list` and `--help` (it can still be run by name).
  readOnly(): this
    Mark this target query-only for MCP: its `run:` tool advertises MCP's
    `readOnlyHint` instead of the default `destructiveHint`, and it is exempt
    from `--confirm-destructive`. A hint about intent only — the target still
    runs its real body — so declare it on targets that inspect rather than
    mutate (a status check, a report).
  always(): this
    Run this target even after the build has failed — for cleanup/teardown that
    must happen regardless. It still waits for its own dependencies to complete;
    the build's overall result is unchanged. Repeatable conditions/inputs apply.
  dryRunnable(): this
    Run this target's body under `--dry-run` instead of skipping it, with the
    `$` shell in echo mode: each command (awaited or `.spawn()`ed) prints its
    resolved argv and returns an empty success without starting a process.
    Opt-in, because Zuke can only intercept `$`/{@link "./shell.ts".Command} —
    any other side effect a body performs (writing a file, calling an API
    directly) still happens under a dry run. Use it for bodies that are
    shell-command orchestration, to preview the exact commands a real run would
    execute. Without it, a dry run skips the body entirely (the default).

    Because an echoed command returns empty stdout and exit code 0, a body
    whose control flow or command arguments depend on a command's output
    (`await $\`git rev-parse HEAD`.text()`, a `.code()`loop) should branch on the {@link "./executor.ts".TargetContext}`dryRun` flag rather than trust the
    echoed result.
  cacheKey(fn: () => string | Promise<string>): this
    Contribute an extra value to this target's cache fingerprint, beyond its
    input files — e.g. a parameter value, tool version, or git commit. The
    target is up-to-date only when its inputs and every cache key are
    unchanged. The function may be async. Repeatable.

    ```ts
    compile = target()
      .inputs("src")
      .cacheKey(() => this.configuration.value)
      .executes(...);
    ```
  produces(...paths: PathLike[]): this
    Declare artifact files/directories this target produces (metadata).
  consumes(...targets: Array<TargetBuilder | Group>): this
    Depend on the listed targets and consume their artifacts: equivalent to
    {@link dependsOn} for ordering, expressing that this target uses what they
    {@link produces}.
  whenSkipped(behavior: "run-dependencies" | "skip-dependencies"): this
    When this target is skipped by an {@link onlyWhen} condition, also skip its
    dependencies that no other planned target needs. Because the dependencies
    would otherwise run first, the condition is evaluated up front, so it must
    not depend on state produced by other targets during the run.
  timeout(ms: number): this
    Fail the target if its body runs longer than `ms` milliseconds (per attempt).
  retry(times: number, delayMs: number): this
    Retry the target body up to `times` more attempts on failure, optionally
    pausing `delayMs` between attempts. Combined with {@link timeout}, each
    attempt is bounded by the timeout.
  validateBefore(...validations: Validation[]): this
    Run one or more {@link Validation}s before the target body. Each runs in
    declaration order; the first to throw fails the target and the body never
    runs. Repeatable. A cached/skipped target runs no validations.

    ```ts
    deploy = target()
      .validateBefore(this.securityReview) // gate before deploying
      .executes(...);
    ```
  validateAfter(...validations: Validation[]): this
    Run one or more {@link Validation}s after the target body completes
    successfully. Each runs in declaration order; the first to throw fails the
    target. Repeatable.
  recoverWith(...remediations: Remediation[]): this
    Attach one or more {@link Remediation}s that run only if the body fails.
    Each is given the failure; if any returns `{ retry: true }`, the executor
    re-runs the body and, when it now passes, the target succeeds. This is the
    hook the AI fixer in `@zuke/ai` uses for self-healing builds. Repeatable.

    ```ts
    test = target()
      .executes(() => DenoTasks.test((s) => s.allowAll()))
      .recoverWith(aiFixer((f) => f.provider("claude").apiKey(this.key)));
    ```
  recoverAttempts(times: number): this
    The maximum number of fix-then-rerun cycles attempted when the body fails
    and {@link recoverWith} remediations are configured (default 1). Each cycle
    runs every remediation, then re-runs the body once; the count bounds how
    many times that repeats before the failure is final. Clamped to at least 1.
  lock(configure: Configure<LockSettings>): this
    Hold a cross-run lock while this target runs: only one run may hold
    `key` at a time, so a second run that tries to acquire it fails with a
    {@link "./state/lock.ts".LockConflictError} naming the current holder. The
    lock is released when the target settles — success, failure, or
    cancellation — and expires after `options.ttl` as a backstop should the
    holder be killed (a live holder renews it as it runs).

    `key` may be a thunk, evaluated after parameters resolve, so it can depend
    on `this.<param>.value`; compose composite keys with
    {@link "./state/lock.ts".lockKey}. Requires a state store (a build that
    uses `.lock()` gets a `.zuke/runs` filesystem store by default).

    ```ts
    promote = target()
      .lock((s) =>
        s.lockKey("deploy", this.repo.value)
          .withTtl("4h")
          .onConflict((h) =>
            `${this.repo.value} is being deployed by ${h.actor} (run ${h.runId}).`))
      .executes(...);
    ```
  waitsFor(configure: Configure<WaitSettings>): this
    Suspend the run at this target until an external event occurs, then let the
    run be resumed later (in a different process) — a settings lambda in the
    same style as {@link lock}. The target is a gate (no body): when its
    trigger is already satisfied it passes and dependents run; otherwise the
    run's state is saved, the run is marked suspended, its independent branches
    finish, and the process exits 0. Requires a state store.

    ```ts
    awaitApproval = target()
      .dependsOn(this.deploy)
      .waitsFor((s) =>
        s.on(externalSignal("testing-approved"))
          .timeout("72h")
          .onTimeout(() => this.rollback));
    ```
  onCancel(compensation: OnCancel): this
    Register a compensation target that undoes this target's effect when the
    run is later cancelled (via `zuke cancel <run-id>`, an MCP `cancel_run`, or a
    timed-out wait). The compensation runs iff this target succeeded — a
    target that never ran, was skipped, or failed has nothing to undo. On
    cancellation, compensations run in reverse order of the targets that
    succeeded, so later work is unwound before the work it built on.

    `compensation` is a sibling target, or a thunk returning one (use the thunk
    form to reference a target declared below this one — class fields
    initialise top-to-bottom). The compensation body receives a normal
    {@link TargetContext} whose `state` exposes this target's persisted
    metadata, so a deploy that recorded `{ slot: "sit-7" }` in `ctx.state` can be
    rolled back from exactly that slot. Compensation failures are recorded but do
    not stop the walk (cleanup is maximal). Requires a state store.

    ```ts
    deploy = target()
      .executes((ctx) => ctx.state.set({ slot: "sit-7" }))
      .onCancel(() => this.rollback);
    rollback = target()
      .executes((ctx) => tearDown(ctx.state.get().slot)); // reads deploy's meta
    ```
  forEach(items: () => readonly Item[], factory: ForEachFactory<Item>, configure?: Configure<ForEachSettings>): this
    Fan out over a runtime list: for each item, build an ordered pipeline of
    sub-targets and run them with per-item failure isolation and bounded
    concurrency. `items` is a thunk (evaluated when the target runs, so it can
    read `this.<param>.value`); `factory` returns a record of sub-targets per
    item, each implicitly depending on the one before it. Items run
    concurrently, each item's stages sequentially — the pipeline model.

    The sub-targets are materialised at run time (named
    `parent[item].stage`) — `--list`/`graph` show only the one fan-out node —
    and each is a first-class target with its own status in the summary and the
    run record. The fan-out target fails if any item's pipeline fails.

    ```ts
    deployBatch = target()
      .forEach(
        () => this.repos.value, // string[]
        (repo) => ({
          checks: target().executes(() => checkDeployable(repo)),
          deploy: target().executes((ctx) => applyToSit(repo, ctx)),
        }),
        (s) => s.concurrency(3).continueOnItemFailure(),
      );
    ```

class TeamsAnnouncementSettings extends AnnouncementSettings
  Fluent settings for {@link AnnounceTasksApi.teams}. Bot mode
  (`.bot().token(t).team(id).channel(c)`) posts through Microsoft Graph with a
  bearer token.

  team(team: string): this
    Set the Teams team (group) id to post to in bot mode (Microsoft Graph).
  override protected payload(): Record<string, unknown>
    Render the Teams webhook payload.
  override protected sendBot(): Promise<void>
    Post the announcement through Microsoft Graph in bot mode.

class ToolInstallSettings
  Fluent settings for installing a release tool. Configure it in a
  settings-lambda (`(s) => s.name(...).url(...)`), the same shape as Zuke's tool
  wrappers. `name` and `url` are required; everything else is optional and
  mirrors {@link InstallReleaseOptions}.

  name_?: string
    The tool name, and the installed filename. Set by {@link name}.
  url_?: (platform: Platform) => string
    Resolves the per-platform download URL. Set by {@link url}.
  destDir_?: PathLike
    Install directory (overrides the toolchain's). Set by {@link destDir}.
  archive_?: "raw" | "tar.gz"
    Download format. Set by {@link archive}.
  binaryPath_?: string
    The binary's path within a `tar.gz`. Set by {@link binaryPath}.
  checksum_?: string | ((platform: Platform) => string)
    Expected SHA-256 (or a per-platform resolver). Set by {@link checksum}.
  platform_?: InstallPlatform
    The platform to resolve for. Set by {@link platform}.
  download_?: DownloadFn
    The download implementation. Set by {@link download}.
  name(name: string): this
    The tool name; also the installed binary's filename (`.exe` on Windows).
  url(resolve: (platform: Platform) => string): this
    Resolve the download URL for the target {@link Platform}.
  destDir(dir: PathLike): this
    The directory to install the binary into (created if missing).
  archive(format: "raw" | "tar.gz"): this
    Treat the download as a `"tar.gz"` (default `"raw"`, the bare binary).
  binaryPath(path: string): this
    For a `tar.gz`, the binary's path within the archive (defaults to the name).
  checksum(sha256: string | ((platform: Platform) => string)): this
    The expected SHA-256 (hex) of the downloaded artifact — verifies and caches
    the install. Pass a `({ os, arch }) => string` resolver to pin it per
    platform (see {@link InstallReleaseOptions.checksum}).
  platform(platform: InstallPlatform): this
    Resolve for a specific platform instead of the host (a foreign install).
  download(fn: DownloadFn): this
    Override the downloader (defaults to an HTTPS download; a test seam).
  options_(fallbackDestDir: PathLike): InstallReleaseOptions
    Build the {@link InstallReleaseOptions}, using `fallbackDestDir` when no
    {@link destDir} was set. Throws if a required field is missing.

class Toolchain
  A declared set of external tools. Add tools with {@link Toolchain.tool} (a
  {@link ToolInstallSettings} lambda) and fetch them all with
  {@link Toolchain.install}. Build one with {@link toolchain}.

  tool(configure: Configure<ToolInstallSettings>): this
    Add a tool, configured through a settings-lambda. Chainable.
  get tools(): readonly ToolInstallSettings[]
    The configured tools, in declaration order.
  async install(options: ToolchainInstallOptions): Promise<Map<string, AbsolutePath>>
    Install every declared tool concurrently — reusing a cached copy where a
    pinned checksum matches — and return a map of tool name to installed
    {@link AbsolutePath}.

class WaitSettings
  Fluent configuration for {@link TargetBuilder.waitsFor}:
  `.waitsFor((s) => s.on(externalSignal("approved")).timeout("72h"))`. Set the
  {@link WaitSettings.on | trigger}, an optional {@link WaitSettings.timeout},
  and an optional {@link WaitSettings.onTimeout} disposition. The lambda runs
  when the target is reached, so the trigger may read `this.<param>.value`.

  trigger_?: WaitTrigger
    The trigger deciding when the wait is satisfied; set by {@link on}.
  timeout_?: string | number
    The deadline duration (string or ms); set by {@link timeout}.
  onTimeout_?: OnTimeout
    The timeout disposition thunk; set by {@link onTimeout}.
  on(trigger: WaitTrigger): this
    Set the {@link "./wait.ts".WaitTrigger} the wait is satisfied by.
  timeout(duration: string | number): this
    Give the wait a deadline (a duration like `"72h"` or milliseconds).
  onTimeout(disposition: OnTimeout): this
    What to do when the deadline passes: a thunk returning a sibling
    compensation target (a thunk, so it can reference a target declared below
    this one), or the string `"fail"` / `"cancel-run"`. Defaults to `"fail"`.

interface AbsolutePath
  An immutable, absolute filesystem path with a fluent API.

  Build one with {@link absolutePath}. The value itself is callable —
  `path(...segments)` returns a new path with those segments appended — and the
  equivalent {@link AbsolutePath.join} method does the same. `toString()`
  yields the path string, so an `AbsolutePath` can be interpolated into the
  `$` shell helper and passed straight to tool `args()`.

  readonly path: string
    The normalised path string (forward slashes, `.`/`..` resolved).
  readonly name: string
    The final segment, e.g. `"main.ts"` (or `""` for a root).
  readonly stem: string
    The final segment without its extension, e.g. `"main"` (`".gitignore"` has none).
  readonly extension: string
    The extension including the dot, e.g. `".ts"` (or `""` if none).
  readonly isRoot: boolean
    Whether this path is a filesystem root (`"/"`, `"C:/"`).
  join(...segments: string[]): AbsolutePath
    Append path segments, returning a new path.
  parent(): AbsolutePath
    The parent directory; a root is its own parent.
  relativeTo(base: AbsolutePath | string): string
    This path expressed relative to `base` (e.g. `"src/main.ts"`, `"../lib"`).
  equals(other: AbsolutePath | string): boolean
    Whether `other` resolves to the same normalised path.
  toString(): string
    The normalised path string.

interface AffectedOptions
  Configure {@link ExecuteOptions.affected}: the base revision and diff seam.

  base?: string
    The git revision to diff against. Defaults to `HEAD` (uncommitted changes).
  changedFiles?: ChangedFilesFn
    How to list changed files. Defaults to {@link gitChangedFiles}.

interface AnnounceTasksApi
  The shape of {@link AnnounceTasks}.

  slack(configure?: Configure<SlackAnnouncementSettings>): Promise<void>
    Announce to Slack. Configure a {@link SlackAnnouncementSettings}: set a
    `.webhook(url)` (or `.bot().token(t).channel(c)` for the Web API) and the
    message content.
  teams(configure?: Configure<TeamsAnnouncementSettings>): Promise<void>
    Announce to Microsoft Teams. Configure a {@link TeamsAnnouncementSettings}:
    set a `.webhook(url)` (or `.bot().token(t).team(id).channel(c)` to post
    through Microsoft Graph) and the message content.
  discord(configure?: Configure<DiscordAnnouncementSettings>): Promise<void>
    Announce to Discord. Configure a {@link DiscordAnnouncementSettings}: set a
    `.webhook(url)` (or `.bot().token(t).channel(c)` to post through the REST
    API with a bot token) and the message content.

interface Announcement
  A structured announcement assembled by an {@link AnnouncementSettings}.

  text: string
    The main message body.
  title?: string
    An optional heading rendered above the message.
  level: AnnouncementLevel
    The outcome level driving the accent colour and icon.
  fields?: AnnouncementField[]
    Labelled details rendered beside the message.
  link?: AnnouncementLink
    A clickable action rendered with the announcement.

interface AnnouncementField
  A labelled detail rendered beside the message (e.g. a version or environment).

  name: string
    The field's label.
  value: string
    The field's value.

interface AnnouncementLink
  A clickable action rendered with the announcement (e.g. a link to a release).

  text: string
    The link's visible text.
  url: string
    The link's target URL.

interface AnyParameter
  The non-generic view of a parameter, used by discovery and resolution.

  name_?: string
    Property name, assigned during discovery. Undefined until then.
  readonly description_?: string
    Human-readable description shown in `--help`/`--list`.
  readonly kind_: ParamKind
    The runtime value kind.
  readonly required_: boolean
    Whether a value must be supplied (no default).
  readonly options_?: readonly string[]
    The allowed string choices, if restricted with {@link Parameter.options}.
  readonly envName_?: string
    An explicit environment variable name override.
  readonly hasFallback_: boolean
    Whether the parameter has a declared default value.
  readonly secret_: boolean
    Whether the value is sensitive and should be masked in CI output.
  readonly array_: boolean
    Whether the value is a comma-separated / repeatable list (`.array()`).
  readonly source_?: SecretSource
    A provider that resolves the value when no flag/env supplied one.
  resolve_(raw: string | undefined): void
    Resolve from a raw input (or `undefined` when none was supplied).
  isSet_(): boolean
    Whether the parameter resolved to a defined value (used by `.requires()`).
  stringValue_(): string | undefined
    The resolved value as a string, or `undefined` if unset (for masking).

interface BuildCache
  The incremental cache used by the executor to skip up-to-date targets.

  upToDate(target: TargetBuilder): Promise<boolean>
    Whether `target` is up-to-date: it declares inputs, their fingerprint
    matches the last successful run, and every declared output still exists.
  record(target: TargetBuilder): Promise<void>
    Record `target`'s current fingerprint after a successful run.
  save(): Promise<void>
    Persist the store if anything changed.

interface BuildResult
  Result passed to the {@link Build.onFinish} lifecycle hook.

  ok: boolean
    Whether every executed target succeeded (also `true` for a suspended run).
  executed: string[]
    Names of the targets that ran, in execution order.
  error?: unknown
    The error that aborted the run, if any.
  suspended?: boolean
    True when the run suspended at a `.waitsFor(...)` gate rather than
    finishing — its state is saved and it can be resumed later. The process
    still exits 0.
  cancelled?: boolean
    True when the run was cancelled (via `options.signal` / Ctrl-C, or by
    another process running `zuke cancel`) rather than failing on its own.
    Its compensations have run and the record is `cancelled`. `ok` is `false`.
  runId?: string
    The run's id, when a run identity was established (always, in practice —
    every {@link "./executor.ts".execute} generates one). Lets the caller point
    a follow-up (`zuke runs show`, `zuke cancel`) at this run.

interface CancelOptions
  Options for {@link cancelRun}.

  runId: string
    The id of the run to cancel.
  stateStore?: StateStore | false
    Durable store the run lives in. Defaults to the same resolution as a normal
    run (explicit → `stateStore()` override → env → `.zuke/runs`); cancel always
    needs one.
  actor?: string
    Who to attribute the cancellation to in the audit trail.
  readEnv?: (name: string) => string | undefined
    Reads an environment variable (secrets re-resolve from here for compensations).
  silent?: boolean
    Suppress progress output.
  reporter?: Reporter
    Custom reporter; overrides `silent`.
  also?: string[]
    Extra compensation target names to run first (a timed-out wait whose
    `onTimeout` names a specific compensation target routes through here).

interface CancelResult
  The outcome of {@link cancelRun}.

  runId: string
    The run that was cancelled.
  status: RunStatus
    The run's status after cancelling (`cancelled`, or the terminal status on a no-op).
  noop: boolean
    True when the run was already terminal and nothing was done.
  compensated: string[]
    Names of compensation targets whose bodies ran.
  failures: CompensationFailure[]
    Compensations that threw (recorded, non-fatal).

interface CiConcurrency
  A concurrency group: at most one run per group, optionally cancelling the prior one.

  group: string
    The group key (often interpolated, e.g. `ci-${{ github.ref }}`).
  cancelInProgress?: boolean
    Cancel an in-progress run in the same group when a new one starts.

interface CiFileSpec
  A CI configuration file declared on a build: a pipeline bound to a path.

  provider: CiProvider
    The provider to render for — the one field you must choose.
  path?: string
    The output path (relative to the working directory). Defaults to the
    provider's conventional location (`.github/workflows/ci.yml`,
    `.gitlab-ci.yml`, or `azure-pipelines.yml`).
  pipeline?: CiPipeline
    The pipeline to render. Defaults to a single `build` job that runs the build.
  fanOut?: boolean | FanOutOptions
    Fan the build's targets out into one CI job per target, wired by their
    dependencies (see {@link fanOutPipeline}). `true` uses the defaults; pass
    {@link FanOutOptions} to customise. When set, {@link pipeline} supplies the
    pipeline-level fields (name, triggers, …) and its `jobs` are ignored.

interface CiJob
  A job: a named unit of work with steps, optionally fanned out by a matrix.

  id?: string
    Stable identifier, used as the job key and as a dependency target. Defaults to `"build"`.
  name?: string
    Human-readable job name.
  runsOn?: string
    The runner. Interpreted per provider: a GitHub runner label and Azure
    `vmImage` (default `ubuntu-latest`), or a GitLab Docker image (runner
    default when omitted). Ignored when a matrix defines `os` on GitHub.
  needs?: string[]
    Other jobs (by {@link id}) that must finish before this one.
  matrix?: Record<string, Array<string | number>>
    A build matrix: each key fans out over its values.
  env?: Record<string, string>
    Environment variables for the job.
  if?: string
    A condition gating the job. A raw provider expression: GitHub `if:`, Azure
    `condition:`. Ignored on GitLab. Use it to e.g. skip forked pull requests.
  timeoutMinutes?: number
    Fail the job if it runs longer than this many minutes.
  steps?: CiStep[]
    The steps to run, in order. Defaults to a single step that runs the build.

interface CiPipeline
  A complete, provider-agnostic CI pipeline.

  name?: string
    The pipeline name. Defaults to `"CI"`.
  triggers?: CiTriggers
    When it runs. Defaults to push and pull request on `main`; pass an empty
    object (`{}`) for a pipeline triggered only by external means.
  permissions?: Record<string, string>
    Workflow-level token permissions (GitHub only), e.g.
    `{ contents: "read", "pull-requests": "write" }`. Ignored elsewhere.
  concurrency?: CiConcurrency
    Limit concurrent runs (GitHub only). Ignored elsewhere.
  jobs?: CiJob[]
    The jobs to run. Defaults to a single `build` job that runs the build.

interface CiStep
  A single step in a job.

  name?: string
    Human-readable step name.
  run?: string
    A shell command to run. Portable across all providers.
  uses?: string
    A GitHub Action reference (e.g. `actions/checkout@v4`). Rendered only for
    GitHub; skipped for GitLab and Azure.
  with?: Record<string, string>
    Inputs for a {@link uses} Action (GitHub only).
  env?: Record<string, string>
    Environment variables for this step. Rendered as `env:` on GitHub Actions
    and on Azure Pipelines `script` steps; ignored on GitLab (which sources
    variables from project settings, not the job YAML).

interface CiTriggers
  When the pipeline runs.

  push?: string[]
    Branches whose pushes trigger the pipeline. An empty array means every
    branch (no filter); omit the field to disable the push trigger.
  pullRequest?: string[]
    Branches whose pull/merge requests trigger the pipeline. An empty array
    means every branch (no filter); omit the field to disable the trigger.
  manual?: boolean
    Allow manual runs (workflow dispatch / web).

interface CliCommandInfo
  A reserved command (`graph`, `generate-ci`, `completions`).

  readonly name: string
    The command word.
  readonly description: string
    One-line summary.

interface CliDescription
  A build's full CLI surface, suitable for JSON serialization.

  readonly commands: CliCommandInfo[]
    The reserved positional commands.
  readonly flags: CliFlagInfo[]
    The built-in option flags.
  readonly targets: CliTargetInfo[]
    The build's targets, in declaration order.
  readonly parameters: CliParameterInfo[]
    The build's declared parameters, in declaration order.

interface CliFlagInfo
  A built-in option flag.

  readonly name: string
    The flag, with leading dashes.
  readonly description: string
    One-line summary.

interface CliParameterInfo
  A parameter declared on the build.

  readonly flag: string
    The CLI flag (without leading dashes), e.g. `environment`.
  readonly description: string
    The parameter's description, or `""` when none was set.
  readonly required: boolean
    Whether a value is required.
  readonly boolean: boolean
    Whether the flag is a value-less boolean.
  readonly array: boolean
    Whether repeated flags accumulate into a list.
  readonly options: string[]
    The allowed values, when the parameter is constrained to a set.

interface CliTargetInfo
  A target declared on the build.

  readonly name: string
    The target's name (its field name on the build).
  readonly description: string
    The target's description, or `""` when none was set.
  readonly dependsOn: string[]
    The names of its direct dependencies, in declaration order.
  readonly default: boolean
    Whether this is the conventional `default` target.
  readonly unlisted: boolean
    Whether the target is hidden from `--list` (still runnable by name).

interface CompensationFailure
  A compensation that threw during the cancel walk (recorded, non-fatal).

  target: string
    The compensation target that failed.
  forTarget: string
    The original target whose compensation this was.
  error: string
    The failure message.

interface CopyOptions
  Options for {@link FileTasksApi.copy}.

  overwrite?: boolean
    Overwrite an existing destination file (default `true`).

interface CreateDirectoryOptions
  Options for {@link FileTasksApi.createDirectory}.

  recursive?: boolean
    Create parent directories as needed (default `true`).

interface ExecuteOptions
  Options for {@link execute}.

  silent?: boolean
    Suppress all banner/summary output (used by tests).
  reporter?: Reporter
    Custom reporter; overrides `silent`.
  plugins?: Plugin[]
    Lifecycle observers invoked alongside the build's own hooks, in order.
    Lets third-party packages report/time/notify without subclassing the build.
  skip?: string[]
    Target names to skip even if they appear in the plan (CLI `--skip`).
  parallel?: boolean | number
    Run independent targets concurrently. `false`/omitted runs sequentially in
    deterministic order; `true` uses the host's CPU count; a number sets the
    maximum concurrency. Dependencies still complete before their dependents.
  cache?: boolean | BuildCache
    Incremental caching: skip targets whose declared {@link TargetBuilder.inputs}
    are unchanged since the last successful run (and whose outputs still exist).
    Defaults to on; pass `false` to disable (CLI `--no-cache`). A {@link
    BuildCache} may be supplied directly (used in tests).
  remoteCache?: RemoteCacheStore | false
    A {@link RemoteCacheStore} that shares target {@link TargetBuilder.outputs}
    across machines: a local cache miss restores outputs from it, and a
    successful run uploads them. `false` disables it (CLI `--no-remote-cache`).
    When omitted, the build's `remoteCache()` override is used, falling back to
    the `ZUKE_REMOTE_CACHE_*` environment variables. Ignored when `cache` is a
    supplied {@link BuildCache} or is `false`.
  params?: Record<string, string>
    Raw parameter values from the command line, keyed by parameter (property)
    name. Each declared {@link Parameter} is resolved from this map, then the
    environment, then its declared default before any target runs.
  readEnv?: (name: string) => string | undefined
    Reads an environment variable as a parameter fallback. Defaults to
    `Deno.env.get` (returning `undefined` when env access is unavailable);
    overridable so parameter resolution can be tested hermetically.
  prompt?: (flag: string, description: string | undefined) => string | undefined
    Prompt for a missing required parameter, returning the entered value (or
    `undefined` to leave it unset). Defaults to an interactive terminal prompt
    when stdin is a TTY and the build is not on CI; overridable for testing.
  dryRun?: boolean
    Plan only: resolve and print every target that would run (honouring
    `--skip` and `onlyWhen` conditions) without executing any body or touching
    the cache (CLI `--dry-run`).
  affected?: AffectedOptions
    Restrict the run to the targets affected by files changed since a base git
    revision (CLI `--affected[=<base>]`). A target is affected when a changed
    file falls inside its declared {@link TargetBuilder.inputs} or a dependency
    is affected; a target that declares no inputs is always considered affected.
    Unaffected targets are skipped. The base revision defaults to `HEAD`; supply
    `changedFiles` to inject the diff (used in tests).
  github?: boolean
    Force GitHub Actions output formatting on or off. Auto-detected from the
    `GITHUB_ACTIONS` environment variable when omitted.
  color?: boolean
    Force ANSI colour on or off. Auto-detected (a TTY with `NO_COLOR` unset,
    outside GitHub Actions) when omitted; off by default with a custom reporter.
  renderer?: Renderer
    Renderer for the per-target banners and the end-of-build summary. Defaults
    to Zuke's built-in {@link defaultRenderer}; `@zuke/console` exports an
    alternative a build can inject to restyle its output.
  signal?: AbortSignal
    Cancel the run when this signal aborts (wired to Ctrl-C/SIGTERM by the CLI,
    or fired by another process running `zuke cancel`). Every target body's
    {@link "./target.ts".TargetContext} `signal` mirrors it, and it is applied
    as the shell's ambient default so an in-flight `$` command is terminated
    (SIGTERM) on cancellation. When the run is cancelled, the compensations of
    every target that had succeeded run in reverse order (see
    {@link "./target.ts".TargetBuilder.onCancel}) and the result is a non-ok
    `cancelled` outcome. A body that ignores its signal still runs to
    completion, so promptly-cancellable work should pass `ctx.signal` to its
    shell commands.
  stateStore?: StateStore | false
    Durable run state (see {@link "./state/store.ts".StateStore}). A supplied
    store is used directly; `false` disables state entirely. When omitted, the
    build's `stateStore()` override is used, falling back to `ZUKE_STATE_URL` /
    `ZUKE_STATE_DIR`, and finally — only when {@link state} is set — a
    filesystem store under `<root>/.zuke/runs`.
  state?: boolean
    Opt a plain build into durable state (CLI `--state`): fall back to a
    `.zuke/runs` filesystem store when nothing else is configured. Ignored when
    a store is resolved from {@link stateStore}, the build, or the environment.
  actor?: string
    Who to attribute the run to in its state record (CLI `--actor`). Falls back
    to `ZUKE_ACTOR`, then the CI actor, then `"anonymous"`.
  resume?: ResumeState
    Continue a suspended run instead of starting a fresh one. Set by
    {@link "./resume.ts".resumeRun} after it has transitioned the run to
    `running`; carries the existing record, its store version, and the targets
    already succeeded (which are not re-run). Not for direct use — call
    `resumeRun`.

interface FanOutOptions
  Options for {@link fanOutPipeline}: how a build's targets become parallel CI
  jobs.

  command?: (target: string) => string
    The command a job runs for its target, given the target name. Defaults to
    the `./zuke <target>` launcher (which bootstraps Deno). Each job runs only
    its own target; its dependencies run in their own jobs and are shared via
    the {@link "./remote_cache.ts" | remote cache}, so pair fan-out with one.
  setupSteps?: CiStep[]
    Steps prepended to every job — checkout, tool setup, cache restore. Defaults
    to a single `actions/checkout` (rendered on GitHub; GitLab and Azure check
    out automatically). Provide `env` for `ZUKE_REMOTE_CACHE_*` here or via
    {@link env}.
  runsOn?: string
    The runner for every job (see {@link CiJob.runsOn}).
  includeUnlisted?: boolean
    Include targets hidden from `--list` via `.unlisted()`. Defaults to false.
  env?: Record<string, string>
    Environment variables set on every job (e.g. the remote-cache config).

interface FileTasksApi
  The shape of {@link FileTasks}.

  exists(path: PathLike): Promise<boolean>
    Whether `path` exists.
  homeDirectory(): string
    The current user's home directory, read from `$HOME` (falling back to
    `$USERPROFILE` on Windows). Throws a clear error when neither is set or
    environment access is unavailable, so callers get a path or a useful
    failure — never an `undefined` to thread through.
  createDirectory(path: PathLike, options?: CreateDirectoryOptions): Promise<void>
    Create the directory at `path`. Creates parents by default
    ({@link CreateDirectoryOptions.recursive}); a recursive create is a no-op
    when the directory already exists.
  cleanDirectory(path: PathLike): Promise<void>
    Remove everything inside the directory at `path`, leaving an empty
    directory. A no-op if `path` does not exist (it is not created).
  remove(path: PathLike, options?: RemoveOptions): Promise<boolean>
    Remove `path`, tolerating a missing target the way `rm -f` does: a
    `NotFound` resolves to `false` instead of throwing. Any other error (e.g. a
    non-empty directory removed without {@link RemoveOptions.recursive}) is
    rethrown.

    @return
        `true` if something was removed, `false` if `path` did not exist.

  copy(source: PathLike, destination: PathLike, options?: CopyOptions): Promise<void>
    Copy a file or directory tree from `source` to `destination` (directories
    are copied recursively).
  move(source: PathLike, destination: PathLike): Promise<void>
    Move (rename) `source` to `destination`.
  readText(path: PathLike): Promise<string>
    Read the UTF-8 text content of the file at `path`.
  writeText(path: PathLike, content: string): Promise<void>
    Write `content` to the file at `path`, creating or truncating it.
  readJson(path: PathLike): Promise<T>
    Read and parse the JSON file at `path`.

interface ForEachItem
  One materialised fan-out item: a unique label plus its pipeline stages.

  key: string
    A label unique within the fan-out, used to name the item's sub-targets.
  stages: Record<string, TargetBuilder>
    The item's ordered pipeline stages, keyed by stage name.

interface ForEachSpec
  The internal fan-out spec stored by {@link TargetBuilder.forEach}. Its
  {@link ForEachSpec.materialize} closure captures the item type, so the runtime
  list and factory are erased to concrete {@link ForEachItem}s the executor can
  run without knowing the item type.

  materialize: () => ForEachItem[]
    Produce the per-item sub-target pipelines from the runtime list.
  configure?: Configure<ForEachSettings>
    Optional fan-out settings (concurrency, per-item failure isolation).

interface GlobOptions
  Options for {@link glob}.

  cwd?: string
    Directory to resolve the pattern against (default: `Deno.cwd()`).

interface HttpCacheStoreOptions
  Configuration for an {@link HttpCacheStore}.

  url: string
    The base URL keys are appended to (any trailing slash is ignored).
  token?: string
    A bearer token sent as `Authorization: Bearer <token>`, if set.
  fetch?: typeof fetch
    The `fetch` implementation; defaults to the global. Overridable for tests.

interface HttpOptions
  Options shared by the HTTP helpers.

  headers?: Record<string, string>
    Extra request headers (e.g. an `Authorization` token).
  fetch?: typeof fetch
    The `fetch` implementation to use. Defaults to the global `fetch`;
    override it to unit-test without network access.

interface HttpStateStoreOptions
  Configuration for an {@link HttpStateStore}.

  url: string
    The base URL run endpoints are built under (any trailing slash is ignored).
  token?: string
    A bearer token sent as `Authorization: Bearer <token>`, if set.
  fetch?: typeof fetch
    The `fetch` implementation; defaults to the global. Overridable for tests.

interface InstallPlatform
  The host identity: a Zuke {@link OperatingSystem} and {@link Architecture}.

  os: OperatingSystem
    The operating system (normalised: `macos`, not `darwin`).
  arch: Architecture
    The CPU architecture.

interface InstallReleaseOptions
  Options for {@link installRelease}.

  name: string
    The tool name; also the installed binary's filename (`.exe` on Windows).
  url: (platform: Platform) => string
    Resolve the download URL for the target {@link Platform}.
  destDir: PathLike
    The directory to install the binary into (created if missing).
  archive?: "raw" | "tar.gz"
    The download format. `"raw"` (default) treats the download as the binary
    itself; `"tar.gz"` unpacks it and takes {@link binaryPath} from inside.
  binaryPath?: string
    For a `"tar.gz"` archive, the binary's path within the archive. Defaults to
    {@link name}.
  platform?: InstallPlatform
    The platform to resolve the URL for. Defaults to {@link hostPlatform}.
    Override it to install a foreign binary or to unit-test URL resolution.
  download?: DownloadFn
    The download implementation. Defaults to {@link httpDownload}; override it
    to unit-test without network access.
  checksum?: string | ((platform: Platform) => string)
    The expected SHA-256 (hex) of the downloaded artifact — the `.tar.gz`
    for an archive, or the binary itself for a `"raw"` download; this is what
    release pages publish as the checksum. When set, the download is verified
    against it (a mismatch throws and nothing is installed) and the checksum
    doubles as a cache key: a prior install whose recorded checksum matches
    is reused without downloading again. Omit it and the tool is downloaded
    every time and not verified.

    Because {@link url} resolves a different artifact per platform, each has its
    own hash — so pass a resolver `(platform) => string` (like `url`) to pin a
    checksum per platform, or a plain string when a single artifact is installed.

interface LockHolder
  Who holds a lock — surfaced to the loser of a conflict so it can act.

  actor: string
    The actor that acquired the lock.
  runId: string
    The run that holds it (`zuke cancel <runId>` releases it).
  since: string
    ISO-8601 timestamp when it was acquired.
  runUrl?: string
    A link to the holding run (e.g. its CI job), when known.

interface OpenCacheOptions
  Optional extras for {@link openCache}: a remote store and a warning sink.

  remote?: RemoteCacheStore
    A {@link RemoteCacheStore} to restore outputs from (on a local miss) and
    upload them to (after a successful run). Applies only to targets that
    declare {@link TargetBuilder.outputs}.
  warn?: (message: string) => void
    Report a non-fatal remote-cache error (a get/put failure never fails the build).

interface OutputHost
  Filesystem effects used to archive and restore a target's outputs.

  readFile(path: string): Promise<Uint8Array | null>
    File contents, or `null` if the path does not exist.
  stat(path: string): Promise<{ isDirectory: boolean; } | null>
    Whether a path exists and is a directory, or `null` if it is missing.
  readDir(path: string): Promise<string[]>
    The entry names within a directory.
  writeFile(path: string, bytes: Uint8Array): Promise<void>
    Write a file, creating parent directories as needed.

interface Platform extends InstallPlatform
  A platform with helpers to name it the way a tool's downloads do. `osLabel`
  and `archLabel` map the `os`/`arch` to a tool's own naming, falling back to
  the value itself for anything not in the alias map — so a `url` callback reads
  `p.osLabel({ macos: "darwin" })` (for a tool that spells macOS "darwin")
  instead of a hand-written `os === …` ternary. This is what the
  {@link InstallReleaseOptions.url} and {@link InstallReleaseOptions.checksum}
  callbacks receive.

  osLabel(aliases?: Partial<Record<OperatingSystem, string>>): string
    The OS named for downloads: `aliases[os]`, else the {@link InstallPlatform.os} itself.
  archLabel(aliases?: Partial<Record<Architecture, string>>): string
    The arch named for downloads: `aliases[arch]`, else the {@link InstallPlatform.arch} itself.

interface Plugin
  A lifecycle observer. Every hook is optional; implement only the ones you
  need. Hooks may be async — the executor awaits each before continuing.

  name?: string
    A name for diagnostics (optional).
  onStart?(run: RunInfo): void | Promise<void>
    Called once before any target runs, with the run's {@link RunInfo}.
  onTargetStart?(target: string, run: RunInfo): void | Promise<void>
    Called just before a target's body executes (not for skipped/cached), with
    the target name and the run's {@link RunInfo}.
  onTargetEnd?(target: string, status: TargetStatus, timing: TargetTiming): void | Promise<void>
    Called after each target settles, with its final status and its
    {@link TargetTiming} (run id + duration).
  onFinish?(result: BuildResult, run: RunInfo): void | Promise<void>
    Called once after the run completes (success or failure), with the result
    and the run's {@link RunInfo}.
  onRunStateChange?(record: RunRecord): void | Promise<void>
    Called on each run-level durable status change — the run going
    `running`, `suspended`, `succeeded`, `failed`, `cancelling`, or `cancelled`
    — with the current {@link "./state/types.ts".RunRecord}. It carries the full
    record (per-target timings, waits, the audit trail), so a metrics exporter
    can derive spans, wait durations, and counters from a single source.
    Only fires when a state store is configured (the record's home); a plain
    build with no store never produces one, and this hook stays silent.

    The record is the secret-free projection: `secret()` parameters are
    omitted, and `ctx.state` metadata, target errors, and audit arguments are
    run through the redactor before they reach it — the same data already
    persisted to the store and shown by `zuke runs show`. It is safe to export.

    A run cancelled in-process (Ctrl-C / its `signal`) is observed as
    `running` → `cancelling` → `cancelled`. When another process cancels the
    run (`zuke cancel`), this process observes it through `cancelling` and stops
    — the canceller's process owns the final `cancelled` — so treat `cancelling`
    as run-ended for the owning process.

interface Remediation
  A recovery step plugged into a target with {@link TargetBuilder.recoverWith}.
  It runs only after the target body fails, receives the failure, and may
  attempt to repair it — returning `{ retry: true }` to ask the executor to
  re-run the body (the real build command is the verifier). Implemented, for
  example, by the AI fixer in `@zuke/ai`, but any object with a `remediate`
  method qualifies.

  name?: string
    A name for diagnostics (optional).
  remediate(context: RemediationContext): RemediationResult | Promise<RemediationResult>
    Inspect (and optionally repair) the failure; report whether to retry.

interface RemediationContext
  Context passed to a {@link Remediation} after a target body fails.

  target: string
    The name of the failed target.
  attempt: number
    The 1-based recovery attempt (the body has already failed `attempt` times).
  error: unknown
    The failure being remediated. When a target fails through the shell this is
    a `CommandError` carrying the failed command and its captured `stderr`.

interface RemediationResult
  The outcome of one {@link Remediation} attempt.

  retry: boolean
    Re-run the target body after this remediation? `true` asks the executor to
    retry (the remediation changed something — e.g. applied a fix); `false`
    leaves the failure standing (e.g. a diagnose-only remediation that only
    explained the failure).
  summary?: string
    A one-line description of what was diagnosed or done, for diagnostics.

interface RemoteCacheStore
  A content-addressed store for archived target outputs, keyed by
  {@link remoteCacheKey}. Both operations are best-effort from the build's
  point of view: the executor never fails a build because the store is
  unreachable — it just rebuilds and, where it can, re-uploads.

  get(key: string): Promise<Uint8Array | null>
    Fetch the archived outputs stored under `key`, or `null` if there are none.
  put(key: string, artifact: Uint8Array): Promise<void>
    Store `artifact` (a gzipped tar of a target's outputs) under `key`.

interface RemoveOptions
  Options for {@link FileTasksApi.remove}.

  recursive?: boolean
    Remove a directory and its contents recursively, like `rm -r`.

interface Renderer
  How the executor renders a build's output. Each method is pure — it returns
  the lines to print rather than writing them — so a custom renderer stays
  unit-testable and the executor keeps control of the output streams.

  targetHeader(style: Style, name: string): string[]
    The banner that opens a target's section (a `::group::` under Actions).
  targetPassFooter(style: Style, name: string, ms: number): string[]
    The footer printed after a target body succeeds.
  targetFailFooter(style: Style, name: string, ms: number, error: unknown): { info: string[]; error: string[]; }
    The footer printed after a target body fails, split into `info` (stdout)
    and `error` (stderr) so the caller can fan the lines out correctly.
  targetDryRunFooter(style: Style, name: string): string[]
    The footer printed for a dry-run target that was never executed.
  summaryBlock(style: Style, reports: TargetReport[], totalMs: number, ok: boolean): string[]
    The end-of-build summary block: the aligned table and closing verdict.
  jobSummaryMarkdown(reports: TargetReport[], totalMs: number, ok: boolean): string
    The GitHub Actions job-summary Markdown mirroring the terminal summary.

interface Reporter
  Sink for executor output, defaulting to the console. Overridable in tests.

  info(line: string): void
    Write an informational line.
  error(line: string): void
    Write an error line.

interface ResolveStateOptions
  Inputs {@link resolveStateStore} needs to build the default filesystem store.

  readEnv: (name: string) => string | undefined
    Reads an environment variable (injectable for tests).
  host: StateHost
    Filesystem effects for the default/env filesystem store.
  defaultDir: string
    Directory the default filesystem store writes to (`<root>/.zuke/runs`).
  enableDefault: boolean
    Fall back to the default filesystem store when nothing else is configured.
    Set when the run opts into durable state (`--state`, or — from a later
    milestone — a durable feature like a lock or a wait).

interface ResumeOptions
  Options for {@link resumeRun}.

  runId: string
    The id of the suspended run to resume.
  stateStore?: StateStore | false
    Durable store the run lives in. Defaults to the same resolution as a normal
    run (explicit → `stateStore()` override → env → `.zuke/runs`); resume always
    needs one.
  signal?: string
    Deliver a signal by this name before resuming (satisfies `externalSignal`).
  data?: JsonValue
    The signal's JSON payload (defaults to `{}`); ignored without {@link signal}.
  params?: Record<string, string>
    Non-secret parameter overrides; the rest come from the record.
  readEnv?: (name: string) => string | undefined
    Reads an environment variable (secrets re-resolve from here).
  actor?: string
    Who to attribute the resumption to (stamped on the run).
  forceGraph?: boolean
    Continue even if the build graph changed since the run was suspended.
  silent?: boolean
    Suppress banner/summary output.
  reporter?: Reporter
    Custom reporter; overrides `silent`.
  plugins?: Plugin[]
    Lifecycle observers for the resumed run. Because a resume keeps the original
    run id, a plugin sees the continuation under the same identity — so an
    exporter's spans join one trace across the suspend/resume boundary.

interface ResumeState
  The continuation state {@link resumeRun} hands to {@link execute} on a resume.

  record: RunRecord
    The run being continued (already transitioned to `running`).
  version: string
    Its current store version, for the writer to continue from.
  done: ReadonlySet<string>
    Names of targets recorded `succeeded` — seeded as done, never re-run.

interface ResumeWhenOptions
  Options for {@link resumeWhen}.

  interval?: string | number
    How often `zuke resume --check` should re-evaluate the predicate.

interface RunEvent
  One entry in a run's audit trail: an MCP tool call, who made it, and how it
  ended. Appended (never mutated) so the trail is a chronological record. The
  MCP server records a {@link RunEvent} for every mutating or denied tool call;
  `zuke runs show` prints them.

  at: string
    ISO-8601 time the call was recorded.
  tool: string
    The tool called (e.g. `run:deploy`, `signal_run`).
  actor: string
    Who made the call (a resolved actor; see {@link "./record.ts".resolveActor}).
  outcome: RunEventOutcome
    Whether the call ran, was denied by authorization, or errored.
  args: Record<string, string>
    The call's arguments, redacted — secret values masked, tokens dropped.
  detail?: string
    A short, redacted human detail (e.g. a denial reason), when present.

interface RunGraphNode
  One entry of a run's graph-shape snapshot.

  name: string
    The target's dotted name.
  dependsOn: string[]
    The dotted names of its direct dependencies.

interface RunInfo
  Run identity passed to a plugin's lifecycle hooks, so an observer can group a
  run's events (e.g. under one trace id) — stable across a suspend/resume
  boundary, since a resumed run keeps the original id.

  readonly runId: string
    The run id, stable for every target in the run (and across a resume).
  readonly dryRun: boolean
    True when the run is a dry run (no target body executes).

interface RunOptions
  Options for {@link run}.

  args?: string[]
    Command-line arguments. Defaults to `Deno.args`.
  plugins?: Plugin[]
    Lifecycle observers to run alongside the build's own hooks.
  renderer?: Renderer
    Renderer for the per-target banners and end-of-build summary. Defaults to
    Zuke's built-in look; inject `consoleRenderer` from `@zuke/console` (or a
    custom {@link Renderer}) to restyle a build's output.

interface RunQuery
  Filters for {@link "./store.ts".StateStore.listRuns}; all fields are optional.

  status?: RunStatus
    Keep only runs with this status.
  target?: string
    Keep only runs whose graph contains a target with this dotted name.
  since?: string
    Keep only runs created at or after this ISO-8601 timestamp.

interface RunRecord
  A versioned snapshot of one run. Persisted as JSON; a store's opaque
  `version` (an ETag / content hash) drives compare-and-swap writes.

  id: string
    Unique run ID (matches {@link "../target.ts".TargetContext} `runId`).
  build: string
    The build class name.
  rootTarget: string
    The dotted name of the requested (root) target.
  status: RunStatus
    The run's lifecycle status.
  actor: string
    Who started the run (resolved from `--actor`, `ZUKE_ACTOR`, or CI env).
  createdAt: string
    ISO-8601 timestamp when the run was created.
  updatedAt: string
    ISO-8601 timestamp of the last write.
  graph: RunGraphNode[]
    The graph shape the run planned, in declaration order.
  params: Record<string, string>
    Resolved parameter values, keyed by name. Secrets are always omitted.
  targets: Record<string, TargetRunState>
    Per-target progress, keyed by dotted target name.
  signals: Record<string, SignalRecord>
    External signals received so far, keyed by name (see `.waitsFor(...)`).
  events: RunEvent[]
    Append-only audit trail of MCP tool calls against this run (see {@link RunEvent}).

interface RunSummary
  A compact run listing row, returned by {@link "./store.ts".StateStore.listRuns}.

  id: string
    The run ID.
  build: string
    The build class name.
  rootTarget: string
    The dotted name of the requested (root) target.
  status: RunStatus
    The run's lifecycle status.
  actor: string
    Who started the run.
  createdAt: string
    ISO-8601 creation timestamp.
  updatedAt: string
    ISO-8601 timestamp of the last write.

interface RunningService
  A started service the executor holds until it tears it down.

  readonly name: string
    The service's target name, for diagnostics.
  stop(): Promise<void>
    Stop the service; never rejects (failures are the registry's concern).

interface SecretSource
  A provider that resolves a secret's value on demand. Built by
  {@link execSecret} or {@link fileSecret} and attached to a parameter with
  `.from(source)`; the framework calls {@link SecretSource.resolve} during
  parameter resolution.

  resolve(): Promise<string>
    Produce the secret value, or throw {@link SecretError} on failure.

interface ServiceHandle
  A running service — whatever {@link ServiceBuilder.start} returns. Its
  {@link ServiceHandle.stop} tears it down; a {@link
  https://jsr.io/@zuke/core SpawnedProcess} is one, so
  `.start(() => $\`…`.spawn())` needs no explicit stop.

  stop(): void | Promise<void>
    Terminate the service. Called on teardown unless `.stop()` overrides it.

interface SignalRecord
  A payload received for an external signal (see {@link RunRecord.signals}).

  data: JsonValue
    The signal's JSON payload (`{}` when none was sent).
  receivedAt: string
    ISO-8601 timestamp when the signal was recorded.

interface StateHost
  Injected filesystem effects for {@link "./fs_store.ts".FileSystemStateStore},
  so it stays unit-testable. The default implementation is
  {@link defaultStateHost}.

  readText(path: string): Promise<string | null>
    File contents, or `null` when the file does not exist.
  writeText(path: string, content: string): Promise<void>
    Write a file's contents, creating parent directories as needed.
  rename(from: string, to: string): Promise<void>
    Rename a file (used to publish a temp file atomically).
  createExclusive(path: string): Promise<boolean>
    Create `path` exclusively: resolve `true` if it was created, `false` if it
    already existed. Used as an atomic lock marker.
  remove(path: string): Promise<void>
    Remove a file; a missing file is not an error.
  listDir(path: string): Promise<string[]>
    The entry names in a directory, or `[]` when the directory is absent.
  mkdirp(path: string): Promise<void>
    Create a directory and any missing parents.
  now(): number
    The current time in epoch milliseconds — the clock for lock expiry (injectable for tests).

interface StateStore
  Pluggable persistence for run records. `version` is an opaque token (an ETag
  or content hash) used for optimistic concurrency: a write only lands if the
  stored version still matches the one the writer last read, so two writers
  racing at the same version cannot both win.

  getRun(id: string): Promise<{ record: RunRecord; version: string; } | null>
    Fetch a run and its current version, or `null` if it does not exist.
  putRun(record: RunRecord, expectedVersion: string | null): Promise<PutResult>
    Write `record` only if the stored version equals `expectedVersion` (`null`
    meaning "must not exist yet"). Returns the new version, or a conflict when
    the stored version has moved on — the caller re-reads and retries.
  listRuns(query: RunQuery): Promise<RunSummary[]>
    List runs matching `query`, newest first (by `createdAt`, then `id`).
  acquireLock(key: string, holder: LockHolder, ttlMs: number): Promise<LockResult>
    Atomically acquire the lock `key` for `holder`, expiring after `ttlMs`. An
    expired lock is taken over. Returns a `token` on success, or the current
    holder when the lock is live.
  renewLock(key: string, token: string, ttlMs: number): Promise<boolean>
    Extend the lock `key` held under `token` by another `ttlMs`. Returns `false`
    if the token no longer owns it (expired and taken over), so a heartbeat can
    detect a lost lock.
  releaseLock(key: string, token: string): Promise<void>
    Release the lock `key` if still held under `token`; a no-op otherwise.

interface Style
  How a run renders its output.

  github: boolean
    Wrap target output in `::group::`/`::endgroup::` and emit `::error::`.
  color: boolean
    Emit ANSI colour codes (off when piped, under `NO_COLOR`, or in CI).
  width: number
    Width of horizontal rules and boxes, in characters.

interface TarEntry
  A single file entry within a tar archive.

  name: string
    The entry's path inside the archive (≤ 100 bytes).
  data: Uint8Array
    The file contents.

interface TargetContext
  The context passed to every target body. Optional to receive — an existing
  zero-argument `.executes(() => …)` stays valid, since a zero-argument
  function is assignable to this one-parameter type — but a body that wants the
  run's identity, a cancellation signal, or durable per-target state reads them
  here.

  readonly runId: string
    Unique ID of this run, stable for every target in the run.
  readonly target: string
    Dotted name of the executing target.
  readonly signal: AbortSignal
    Aborted when the run is cancelled (see {@link "./executor.ts".ExecuteOptions}
    `signal`). Pass it to a shell command's `.signal()` to have that command
    terminated on cancellation; the executor also applies it as the shell's
    ambient default, so a plain `$` in the body is terminated too.
  readonly state: TargetStateHandle
    Durable per-target metadata. Persisted to the run's state store when one is
    configured (see {@link "./state/store.ts".StateStore}), and an in-memory
    no-op otherwise. The carrier for state that must survive across a
    suspend/resume boundary — do not put secrets in it.
  readonly signals: ReadonlyMap<string, SignalRecord>
    Payloads of the external signals received so far, keyed by name (see
    `.waitsFor(...)` and {@link "./wait.ts".externalSignal}). Empty until a
    signal is delivered by `zuke resume <id> --signal <name>`.
  readonly dryRun: boolean
    True when the run is a dry run (bodies do not execute under a dry run).
  stateOf(target: string): TargetStateHandle
    The durable state handle of another target in this run — the seam a body
    reads a dependency's published metadata through (e.g. the result a
    `.waitsFor(githubWorkflow(...))` gate recorded to its state). `stateOf(this target)` is equivalent to {@link state}. It reads the run's current
    record, so it sees writes a dependency made earlier in the run — including
    across a suspend/resume, since the record is durable.

interface TargetReport
  One row of the end-of-build summary.

  name: string
    The target's name.
  status: TargetStatus
    The target's terminal status.
  ms: number
    The target's wall-clock duration in milliseconds.

interface TargetRunState
  The recorded progress of a single target.

  status: TargetRunStatus
    The target's current status within the run.
  meta: Record<string, JsonValue>
    Durable metadata written via {@link "../target.ts".TargetStateHandle}.
  startedAt?: string
    ISO-8601 timestamp when the body started, if it has.
  endedAt?: string
    ISO-8601 timestamp when the target settled, if it has.
  error?: string
    The failure message when `status` is `failed`.
  waitingFor?: WaitState
    The pending wait when `status` is `waiting` (set by `.waitsFor(...)`).

interface TargetStateHandle
  A target's durable, per-target metadata, surfaced on {@link TargetContext} as
  `state`. Writes are persisted to the run's state store (see
  {@link "./state/store.ts".StateStore}) and are visible to later runs — e.g. a
  resuming process reading what a suspended target recorded. When no store is
  configured, the handle is an in-memory no-op scoped to the current run.

  Never store a secret here — state is persisted in plain JSON and read
  back by later runs and by `zuke runs show`.

  set(patch: Record<string, JsonValue>): Promise<void>
    Merge a JSON patch into this target's persisted metadata (awaits the write).
  get(): Record<string, JsonValue>
    Read this target's persisted metadata (from prior attempts/runs too).

interface TargetTiming
  Timing for a settled target, passed to {@link Plugin.onTargetEnd}.

  readonly runId: string
    The run id (see {@link RunInfo}).
  readonly durationMs: number
    The target's wall-clock duration in milliseconds (0 for skipped/cached).

interface ToolTasksApi
  The task surface of {@link ToolTasks}.

  install(configure: Configure<ToolInstallSettings>): Promise<AbsolutePath>
    Install a single release tool, configured through a
    {@link ToolInstallSettings} lambda, and resolve to its installed path.
    Defaults the install directory to `.zuke/tools`.

interface ToolchainInstallOptions
  Options for {@link Toolchain.install}.

  destDir?: PathLike
    Where tools without their own `destDir` install. Defaults to `.zuke/tools`.
  download?: DownloadFn
    The download implementation for every tool (defaults per {@link installRelease}).

interface Validation
  A check plugged into a target with {@link TargetBuilder.validateBefore} or
  {@link TargetBuilder.validateAfter}. The target decides when it runs; the
  validation decides what it checks. Throw from {@link Validation.validate} to
  fail the target (and break the build). Implemented, for example, by the AI
  reviewers in `@zuke/ai`, but any object with a `validate` method qualifies.

  name?: string
    A name for diagnostics (optional).
  validate(context: ValidationContext): void | Promise<void>
    Run the check; throw to fail the target. May be async.

interface ValidationContext
  Context passed to a {@link Validation} when it runs.

  target: string
    The name of the target the validation is attached to.

interface WaitContext
  The durable context a {@link WaitTrigger} may use while deciding whether its
  event has occurred. Its {@link WaitContext.state} handle is the awaiting
  target's persisted metadata — it survives a suspend/resume, even across
  processes — so a stateful trigger (e.g. "dispatch a GitHub workflow, then poll
  it") can remember what it started and hand a result to the target's body. The
  built-in triggers ignore it.

  readonly state: TargetStateHandle
    The awaiting target's durable state handle (the same one its body receives
    as `ctx.state`). Reads and writes here persist with the run and are visible
    to a later resume in another process.
  readonly runId: string
    The run id — stable across a resume, so a natural correlation key.
  readonly target: string
    The awaiting target's dotted name.

interface WaitState
  The pending wait recorded on a suspended target (see {@link TargetRunState.waitingFor}).

  trigger: string
    A human-readable descriptor of what is awaited (e.g. `signal:approved`).
  deadline?: string
    ISO-8601 deadline after which {@link onTimeout} applies, if a timeout was set.
  onTimeout: WaitDisposition
    What happens when the deadline passes.

interface WaitTrigger
  Decides whether the event a target waits for has occurred. `descriptor` is a
  short, JSON-safe label recorded on the suspended target; `isSatisfied` is
  evaluated against the run's received signals (and a durable {@link
  WaitContext}) when the target is reached and again on each resume attempt.

  readonly descriptor: string
    A short label recorded on the wait (e.g. `signal:approved`).
  readonly pollIntervalMs?: number
    Poll interval hint (ms) for predicate triggers driven by `zuke resume --check`.
  isSatisfied(signals: ReadonlyMap<string, SignalRecord>, context: WaitContext): boolean | Promise<boolean>
    Whether the awaited event has occurred, given the run's received signals
    and a durable {@link WaitContext}. The context lets a trigger persist
    correlation state across a suspend/resume; a trigger that only inspects
    signals may ignore it (fewer parameters stay assignable).

type AnnouncementLevel = "success" | "failure" | "warning" | "info"
  The outcome an announcement conveys. It drives the accent colour and the icon
  prepended to the message; defaults to `"info"`.

type Architecture = "x86_64" | "aarch64"
  The CPU architectures Zuke recognises.

type ChangedFilesFn = (base: string) => Promise<string[]>
  Lists the files changed since `base` (a git revision), each path relative to
  the repository root. The seam behind {@link ExecuteOptions.affected}; defaults
  to {@link gitChangedFiles} and is overridable so the affected plan can be
  tested without a real git repository.

type CiHost = "github" | "gitlab" | "azure" | "bitbucket" | "local"
  The CI host a build is running on, or `"local"` when not on CI. The names
  match {@link CiProvider} so they compose with CI generation and per-host
  integrations (e.g. posting a review to the right pull-request API).

type CiProvider = "github" | "gitlab" | "azure" | "bitbucket"
  The CI providers {@link generateCi} can target.

type Condition = () => boolean | Promise<boolean>
  A predicate gating whether a target runs; may be synchronous or async.

type DownloadFn = (url: string, dest: PathLike) => Promise<void>
  A download function: fetch `url` into the file at `dest`.

type ForEachFactory<Item> = (item: Item, index: number) => Record<string, TargetBuilder>
  Builds one item's ordered pipeline of sub-targets for {@link TargetBuilder.forEach}.
  The returned record's keys are stage names and its values are targets; each
  stage implicitly depends on the one declared before it, so an item's stages
  run in insertion order.

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue; }
  A JSON-serialisable value — the only thing that may be persisted in a
  target's {@link TargetStateHandle}, since run state is stored as JSON.

type LockResult = { ok: true; token: string; } | { ok: false; holder: LockHolder; }
  The result of {@link StateStore.acquireLock}: a `token` proving ownership, or
  the current `holder` when the lock is already held.

type OnCancel = TargetBuilder | (() => TargetBuilder)
  A compensation registered with {@link TargetBuilder.onCancel}: either a
  sibling target directly, or a thunk returning one. The thunk form defers
  evaluation so a compensation declared below the target it cleans up (class
  fields initialise top-to-bottom) can still be referenced.

type OnTimeout = () => TargetBuilder | "fail" | "cancel-run"
  What a timed-out wait does — resolved from {@link WaitSettings.onTimeout}.

type OperatingSystem = "linux" | "macos" | "windows"
  The operating systems Zuke recognises — Deno's raw `Deno.build.os` values
  normalised to a friendly set (notably `darwin` → `macos`). Used across the
  ecosystem so builds branch on `"macos"` rather than the surprising `"darwin"`.

type OrderingEdge = readonly [TargetBuilder, TargetBuilder]
  A soft ordering edge `[before, after]`: `before` must run before `after`,
  with no data dependency. Returned by {@link "./build.ts".Build.extraEdges} to
  feed a consumer's dependency graph (e.g. a monorepo's `dependency-graph.json`)
  into planning; an edge whose endpoints are not both in the run's execution set
  is ignored, and cycles are reported like any other.

type ParamKind = "string" | "number" | "boolean"
  A parameter's runtime kind tag.

type ParamValue = string | number | boolean
  The value kinds a parameter can hold.

type PathLike = string | AbsolutePath
  A filesystem path accepted by Zuke APIs: either a plain string or an
  {@link AbsolutePath}. Anywhere a tool wrapper or build helper takes a path,
  it accepts a `PathLike` and coerces it to a string.

type PutResult = { ok: true; version: string; } | { ok: false; conflict: true; }
  The result of a {@link StateStore.putRun} compare-and-swap write.

type RunEventOutcome = "ok" | "denied" | "error"
  The outcome recorded for an audited MCP tool call (see {@link RunEvent}).

type RunStatus = "running" | "suspended" | "cancelling" | "succeeded" | "failed" | "cancelled"
  The lifecycle status of a whole run. `cancelling` is the transient state a
  cancellation moves through — the run has been asked to stop and its
  compensations are running — before it settles as `cancelled`.

type Target = TargetBuilder
  A configured target. Alias of {@link TargetBuilder} — the same object both
  builds and represents the target. Exposed as `Target` for use in signatures.

type TargetFn = (ctx: TargetContext) => void | Promise<void>
  The executable body of a target. May be synchronous or asynchronous.

type TargetRunStatus = "pending" | "running" | "waiting" | "succeeded" | "failed" | "skipped"
  The status of one target within a run record. `waiting` (a suspended
  external-event wait) is produced only from a later milestone; the executor
  records the others.

type TargetStatus = "passed" | "failed" | "skipped" | "cached" | "waiting"
  The outcome of a single target, reported in the summary and lifecycle hooks.
  `waiting` marks a `.waitsFor(...)` gate whose event has not occurred — the run
  suspends there.

type WaitDisposition = "fail" | "cancel-run" | { target: string; }
  What a timed-out wait does: fail, cancel the run, or run a compensation target.
````

</details>

<!-- ZUKE:API:END -->
