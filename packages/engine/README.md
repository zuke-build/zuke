# @zuke/engine

The [Zuke](https://github.com/zuke-build/zuke#readme) engine for a build another
SDK hosts. The SDK is a **worker**: it describes the build's graph as a manifest
over a loopback socket and runs a target body when asked. Everything else —
scheduling, every subprocess, run records, resume, locks, caching, services, CI
generation, the MCP server — is `@zuke/core`, implemented once.

A project with no `zuke.ts` names its worker and the engine release that runs it
in `zuke.json`:

```json
{
  "name": "App",
  "sdk": { "command": ["uv", "run", "build.py"] },
  "engine": "1.0.0"
}
```

The `./zuke` launcher and the global `zuke` command then run
`deno run -A jsr:@zuke/engine@1.0.0 <args>` from the project root, so the whole
CLI — targets, `--list --json`, `graph`, `generate-ci`, `mcp`, `resume` — is the
engine's, with the worker serving the bodies.

The protocol is newline-delimited JSON-RPC 2.0 over loopback TCP; the engine
hands the worker its address and a per-run token in `ZUKE_ENGINE_ADDR`,
`ZUKE_ENGINE_TOKEN` and `ZUKE_PROTOCOL`. The cases under
[`conformance/`](./conformance/README.md) are the contract an SDK's worker must
satisfy, replayed here against a scripted worker.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/engine` — the engine for a build another process hosts. An SDK in
any language is a worker: it describes the build's graph as a manifest
over a loopback socket and runs a target body when asked, while scheduling,
every subprocess, run records, resume, locks, caching, services, CI
generation and the MCP server stay in `@zuke/core`.

A project with no `zuke.ts` names its worker and the engine release that
runs it in `zuke.json`:

```json
{ "name": "App", "sdk": { "command": ["uv", "run", "build.py"] }, "engine": "1.0.0" }
```

The `./zuke` launcher and the global `zuke` command then run
`deno run -A jsr:@zuke/engine@1.0.0 <args>` from the project root, so the
whole CLI — targets, `--list --json`, `graph`, `generate-ci`, `mcp`,
`resume` — is the engine's, with the worker serving the bodies.

Imported as a library, the module exports the host-mode pieces a
TypeScript program can drive itself: {@link WorkerHost} starts a worker
and speaks the protocol, {@link materialize} turns its manifest into a
`Build` subclass `run` accepts.
@module

function materialize(manifest: Manifest, runner: TargetRunner): new () => Build
  Build the class. Dependencies must be declared before the targets that use
  them, mirroring the forward-reference rule of a `zuke.ts` build; a violation
  throws from the constructor with the offending target named. The ordering
  hints, triggers, compensations and group members may name any target.

function parseManifest(value: unknown): Manifest
  Validate a `build.describe` result.

function sdkCommand(configText: string, where: string): string[]
  Read `sdk.command` from the `zuke.json` text, naming what is wrong if not.

const PROTOCOL_VERSION: 1
  The protocol version this engine speaks.

class WorkerHost
  The worker host. Start one with {@link WorkerHost.start}.

  private constructor(options: WorkerOptions, worker: Worker)
  get sdk(): string
    The SDK the worker announced itself as.
  static async start(options: WorkerOptions): Promise<WorkerHost>
    Spawn the worker and wait for its `hello`.
  async describe(): Promise<Manifest>
    Ask the worker to describe its build; a replacement must match it.
  async configure(params: ConfigureParams): Promise<void>
    Tell the worker the resolved parameters; a replacement gets the same.
  async hook(name: HookName, params: unknown): Promise<void>
    Call a build hook the manifest flagged and wait for it to settle.
  async condition(target: string): Promise<boolean>
    Ask whether the named target's condition holds.
  async settings(target: ManifestTarget): Promise<LateSettings>
    Ask for the late settings a target declared, once parameters resolved.
  async waitCheck(target: string): Promise<boolean>
    Ask whether a `resumeWhen` gate's predicate holds now.
  async validate(target: string, check: string): Promise<void>
    Run one of a target's `validateDuring` checks; rejects with its message.
  async cacheKey(target: string): Promise<string>
    Ask for the named target's extra cache key.
  async runTarget(name: string, ctx: TargetContext): Promise<void>
    Run one target's body in the worker, serving the calls it makes until it
    settles. Rejects with the worker's message when the body fails.
  async serviceStart(target: string): Promise<string>
    Start a service in the worker; its start phase may `exec`.
  async serviceReady(target: string, handle: string): Promise<boolean>
    Ask whether a started service is ready.
  async serviceStop(target: string, handle: string): Promise<void>
    Stop a started service; its stop phase may `exec`.
  async finish(code: number, suspended: boolean): Promise<void>
    Tell the worker the run is over, or suspended at a gate, wait for it to
    exit, release everything. The run ends, not the host: the next request
    (an MCP server runs build after build in one process) spawns a fresh
    worker, described and configured anew.
  async close(): Promise<void>
    End the host for good: a pre-warm in flight is awaited and its worker
    stopped with the current one, and none is spawned after. A one-shot run
    needs no call; it ends with its process.
  kill(): void
    Kill the worker outright, and whatever its service phases spawned.

interface ConfigureParams
  What `build.configure` tells the worker once the parameters have resolved,
  before `build.onStart` and before any body: each parameter's value in its
  CLI form, or null when unset. The run's id and dry-run flag travel with
  every `target.run` instead, since the build's own `onStart` has neither.

  readonly parameters: Readonly<Record<string, string | null>>
    Each parameter's resolved value in its CLI form, or null when unset.

interface LateSettings
  What `target.settings` answers for one target: the sections it declared.

  readonly lock?: LockSpec
    The lock, when the target declared one.
  readonly waitsFor?: WaitSpec
    The wait gate, when the target declared one.
  readonly validateDuring?: ValidateDuringSpec
    The interval checks, when the target declared them.

interface LockSpec
  A cross-run lock, as `LockSettings` configures it.

  readonly key: string
    The lock's key.
  readonly ttl?: Duration
    How long the lock may be held.
  readonly waitUpTo?: Duration
    How long to wait for a held lock before giving up.
  readonly pollEvery?: Duration
    How often to poll a held lock.
  readonly holdForRun: boolean
    Keep the lock until the run ends rather than until the target does.

interface Manifest
  The build as the worker describes it in reply to `build.describe`.

  readonly name: string
    The build's name.
  readonly targets: readonly ManifestTarget[]
    The targets, in declaration order.
  readonly parameters: readonly ManifestParameter[]
    The parameters, in declaration order.
  readonly groups: readonly ManifestGroup[]
    The groups.
  readonly hooks: ManifestHooks
    The hooks the worker implements.
  readonly config: ManifestConfig
    Build-wide settings.
  readonly ci: readonly ManifestCi[]
    The CI files the build declares, for `generate-ci`.

interface ManifestCi
  One CI file the build declares.

  readonly name: string
    The field the file is declared on, which names its default path:
    `releaseWorkflow` writes `.github/workflows/release.yml`.
  readonly provider?: CiProvider
    The provider to render for; GitHub when omitted.
  readonly path?: string
    The output path, overriding the one the name implies.
  readonly pipeline?: CiPipeline
    The pipeline-level fields, and the jobs unless `invokes` or `fanOut` supply them.
  readonly invokes?: readonly ManifestCiInvocation[]
    The targets to run as jobs, bare or with the runner's adjustments.
  readonly fanOut?: boolean | FanOutOptions
    One job per target in the graph; the options without a command, which stays the launcher.
  readonly pins?: Readonly<Record<string, CiUses>>
    Pinned action references by action name: what a `pins` resolver answers.

interface ManifestCiInvocation extends Omit<CiInvocation, "target" | "after">
  An invoked target as the manifest names it, and the targets it runs after.

  readonly target: string
    The target the job runs.
  readonly after?: readonly string[]
    Extra `needs:` edges, by target name.

interface ManifestConfig
  Build-wide settings.

  readonly deadline?: string | number
    The run's deadline, as a duration or milliseconds.
  readonly unforceable: readonly string[]
    Targets `--force` may never re-run.

interface ManifestGroup
  A parallel batch of targets.

  readonly name: string
    The group's field name.
  readonly members: readonly string[]
    The targets in it.

interface ManifestHooks
  Which build hooks the worker implements; the engine calls only those.

  readonly onStart: boolean
    `build.onStart`, before the first target.
  readonly onTargetStart: boolean
    `build.onTargetStart { target }`, before each target.
  readonly onTargetEnd: boolean
    `build.onTargetEnd { target, status }`, after each target settles.
  readonly onFinish: boolean
    `build.onFinish { ok }`, before `run.exit`.

interface ManifestParameterBase
  What is common to every parameter kind.

  readonly name: string
    The field name the build declares it under.
  readonly description: string
    The `--help` description.
  readonly required: boolean
    Whether a value must be supplied.
  readonly array: boolean
    Whether the value is a comma-separated list.
  readonly secret: boolean
    Whether the value is masked and redacted.
  readonly flag?: string
    The CLI flag, when it is not derived from the name.
  readonly env?: string
    The environment variable, when it is not derived from the name.

interface ManifestRetry
  Extra attempts after a failed body, and the pause between them.

  readonly times: number
    How many more times to run the body after it fails.
  readonly delayMs: number
    Milliseconds to wait between attempts.

interface ManifestTarget
  One target as the worker describes it.

  readonly name: string
    The target's name, also its CLI name.
  readonly kind: "target" | "service"
    A plain target with a body, or a service the engine starts and stops.
  readonly ready: boolean
    Whether the worker answers `service.ready` for this service.
  readonly readyTimeoutMs?: number
    How long the readiness probe may take before the service fails.
  readonly description: string
    The `--list` description.
  readonly dependsOn: readonly string[]
    Names of targets this one depends on; each must be declared earlier.
  readonly unlisted: boolean
    Hide from `--list` and `--help`.
  readonly inputs: readonly string[]
    Input paths whose contents key the cache.
  readonly outputs: readonly string[]
    Output paths that must exist for a cache hit.
  readonly produces: readonly string[]
    Artifact paths this target produces.
  readonly retry: ManifestRetry
    The retry policy.
  readonly timeoutMs?: number
    Per-attempt timeout in milliseconds, if any.
  readonly before: readonly string[]
    Soft ordering: run before these targets when both are planned.
  readonly after: readonly string[]
    Soft ordering: run after these targets when both are planned.
  readonly triggers: readonly string[]
    Targets pulled in and run after this one.
  readonly proceedAfterFailure: boolean
    Keep the build running after this target fails.
  readonly always: boolean
    Run even after the build has failed.
  readonly dryRunnable: boolean
    Run the body under `--dry-run` too.
  readonly requires: readonly string[]
    Parameters that must resolve before this target runs.
  readonly onCancel?: string
    The compensation target to run when the run is cancelled after this one succeeded.
  readonly onFailure?: string
    What this target's failure does: `fail`, `cancel-run`, or a compensation target.
  readonly condition: boolean
    Whether the engine must ask `target.condition` before running this target.
  readonly cacheKey: boolean
    Whether the engine must ask `target.cacheKey` when fingerprinting this target.
  readonly lock: boolean
    Whether `target.settings` answers a `lock` section for this target.
  readonly waitsFor: boolean
    Whether `target.settings` answers a `waitsFor` section for this target.
  readonly validateDuring: boolean
    Whether `target.settings` answers a `validateDuring` section for this target.

interface TargetRunner
  What a materialised build needs from its host.

  configure: WorkerHost["configure"]
    Tell the worker the resolved parameter values.
  hook: WorkerHost["hook"]
    Call a flagged build hook.
  condition: WorkerHost["condition"]
    Ask whether a target's condition holds.
  cacheKey: WorkerHost["cacheKey"]
    Ask for a target's extra cache key.
  settings: WorkerHost["settings"]
    Ask for a target's late settings.
  waitCheck: WorkerHost["waitCheck"]
    Ask whether a `resumeWhen` gate holds.
  validate: WorkerHost["validate"]
    Run one `validateDuring` check.
  serviceStart: WorkerHost["serviceStart"]
    Start a service; answers its handle.
  serviceReady: WorkerHost["serviceReady"]
    Ask whether a service is ready.
  serviceStop: WorkerHost["serviceStop"]
    Stop a service.
  runTarget: WorkerHost["runTarget"]
    Run the named target's body; reject when it fails.
  finish: WorkerHost["finish"]
    Tell the worker the run is over.

interface ValidateDuringSpec
  Checks run on an interval while the body runs, as `ValidateDuringSettings` configures them.

  readonly every?: Duration
    The interval.
  readonly checks: readonly string[]
    The checks' names, each answered by `target.validate`.

interface WaitSpec
  A wait gate, as `WaitSettings` configures it.

  readonly on: WaitTriggerSpec
    The trigger.
  readonly timeout?: Duration
    How long to wait before the timeout disposition applies.
  readonly onTimeout?: string
    `fail`, `cancel-run`, or a compensation target.

interface WorkerOptions
  How the host starts its worker.

  readonly command: readonly string[]
    The worker's argv, from `zuke.json`'s `sdk.command`.
  readonly cwd: string
    The directory to start the worker in.
  readonly connectTimeoutMs?: number
    How long to wait for the worker's `hello` before giving up.
  readonly graceMs?: number
    How long a cancelled body may take to settle before the worker is killed.
  readonly prewarm?: boolean
    Spawn and describe the next worker as soon as a run ends, so the next run
    of a long-lived host (the MCP server, which runs build after build in one
    process) finds one up instead of paying the spawn inside its request. Off
    by default: a one-shot run has no next run. A pre-warm that fails is
    dropped, and the next run spawns its own worker and meets the error.

type Duration = string | number
  A duration as the wrappers take it: `"5m"` or milliseconds.

type HookName = keyof ManifestHooks
  The hooks a worker may implement, named as the `build.*` methods are.

type ManifestParameter = ManifestParameterBase & ({ readonly kind: "string"; readonly default?: string; readonly options: readonly string[]; } | { readonly kind: "number"; readonly default?: number; } | { readonly kind: "boolean"; readonly default?: boolean; })
  One build parameter as the worker describes it, by kind.

type WaitTriggerSpec = { readonly kind: "externalSignal"; readonly name: string; } | { readonly kind: "resumeWhen"; readonly interval?: Duration; }
  What a wait gate waits on.
````

</details>

<!-- ZUKE:API:END -->
