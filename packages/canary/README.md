# @zuke/canary

Canary releases for [Zuke](https://github.com/zuke-build/zuke#readme) builds.
`canary(...)` turns a settings lambda into a rollout's targets:

1. Stage the candidate at 0 %.
2. Step its exposure up, baking each step while analyses watch it.
3. Optionally wait for an approval signal.
4. Promote.

Every way the rollout can go wrong runs the same single `abort`: a failed
analysis, a failed step, `zuke cancel`, or an approval that times out.

```ts
import { Build, run, target } from "@zuke/core";
import { canary, httpProbe, prometheus } from "@zuke/canary";

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(myPlatform) // a CanaryPlatform: Cloud Run, Kubernetes, your own
      .steps(10, 25, 50)
      .bake("10m")
      .analysis(
        httpProbe((h) => h.url("https://api.example.com/healthz").samples(30)),
        prometheus((p) =>
          p.url("https://prometheus.internal").query(ERROR_RATIO).max(0.01)
        ),
      )
      .approval("canary-approved")
      .lock((l) => l.lockKey("deploy", "api").withTtl("24h"))
  );

  ship = target().dependsOn(this.rollout.promote).executes(() => {});
}

await run(Deploy);
```

The targets are named under the field: `rollout.stage`, `rollout.step1.expose`,
`rollout.step1.bake`, `rollout.step1.analyze`, …, `rollout.approve`,
`rollout.promote` and `rollout.abort`. A canary needs a state store, because
rolling back means knowing what succeeded. The engine talks to the platform only
through the small `CanaryPlatform` interface (`stage`, `expose`, `promote`,
`abort`), so any platform works; a platform without an adapter is a hand-written
object in the build.

See
[the canary guide](https://github.com/zuke-build/zuke/blob/master/docs/canary.md)
for bakes (inline or durable), analyses, the lock, approvals, and what a
rollback run by hand can and cannot know.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
Canary releases for Zuke builds. `canary(...)` turns a settings lambda into
a rollout's targets: stage the candidate at 0 %, step its exposure up while
analyses watch each bake, optionally wait for an approval, and promote — with
one rollback, `abort`, on every path that goes wrong.

```ts
import { Build, run, target } from "@zuke/core";
import { canary, httpProbe } from "@zuke/canary";

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(myPlatform)
      .steps(10, 50)
      .bake("10m")
      .analysis(httpProbe((h) => h.url("https://api.example.com/healthz")))
      .lock((l) => l.lockKey("deploy", "api").withTtl("24h"))
  );
  ship = target().dependsOn(this.rollout.promote).executes(() => {});
}

await run(Deploy);
```

The engine drives the platform only through {@link CanaryPlatform}, so the
same rollout runs on Cloud Run, Kubernetes, Docker or a hand-written
platform object.
@module

function canary(configure: Configure<CanarySettings>): Canary
  Declare a canary rollout. The lambda runs when the build is constructed and
  decides which targets exist; a misconfigured one throws there, naming the
  fix.

  ```ts
  class Deploy extends Build {
    rollout = canary((c) =>
      c.platform(myPlatform)
        .steps(10, 50)
        .bake("10m")
        .analysis(httpProbe((h) => h.url("https://api.example.com/healthz")))
        .lock((l) => l.lockKey("deploy", "api").withTtl("24h"))
    );
    ship = target().dependsOn(this.rollout.promote).executes(() => {});
  }
  ```

function httpProbe(configure: Configure<HttpProbeSettings>): CanaryAnalysis
  An analysis that requests a URL a number of times and fails the canary when
  more than `maxFailures` of them fail — a status outside the expected ones, a
  timeout, or a connection error:

  ```ts
  httpProbe((h) => h.url("https://api.example.com/healthz").samples(30))
  ```

  The lambda runs on each check, so it may read resolved parameters. The
  failure message passes through the run's redactor.

function metricThreshold(configure: Configure<MetricThresholdSettings>): CanaryAnalysis
  An analysis that reads a number and fails the canary when it is out of
  bounds:

  ```ts
  metricThreshold((m) =>
    m.name("error ratio").read(() => readErrorRatio()).max(0.01)
  )
  ```

  The lambda runs on each check, so a reader may use resolved parameters.

function prometheus(configure: Configure<PrometheusSettings>): CanaryAnalysis
  An analysis that runs an instant PromQL query and fails the canary when any
  sample is out of bounds:

  ```ts
  prometheus((p) =>
    p.url("https://prometheus.internal")
      .query('sum(rate(http_errors_total{rev="canary"}[5m])) or vector(0)')
      .max(0.01)
  )
  ```

  The lambda runs on each check, so it may read resolved parameters. Failure
  messages pass through the run's redactor, so a secret parameter in the URL
  or the query is masked.

class CanarySettings
  How a canary rolls out, configured through `canary((c) => …)`:

  ```ts
  rollout = canary((c) =>
    c.platform(myPlatform)
      .steps(10, 25, 50)
      .bake("10m")
      .analysis(httpProbe((h) => h.url(HEALTHZ)))
      .approval("canary-approved")
      .lock((l) => l.lockKey("deploy", "api").withTtl("24h"))
  );
  ```

  The lambda runs once, when the build is constructed, because it decides
  which targets exist. Anything that reads a parameter — an image tag, a URL —
  belongs inside the platform's or the analysis's own lambda, which runs when
  the target does.

  platform_?: CanaryPlatform
    Where the canary runs (set by {@link platform}).
  steps_: number[]
    The exposure after each step, in percent (set by {@link steps}).
  bake_?: string | number
    How long each step bakes by default (set by {@link bake}).
  readonly bakeAt_: Map<number, string | number>
    Per-step bake overrides, by 1-based step (set by {@link bakeStep}).
  readonly analyses_: CanaryAnalysis[]
    The analyses each step runs (set by {@link analysis}).
  analysisInterval_?: string | number
    How often a bake runs its analyses in flight (set by {@link analysisInterval}).
  approval_?: string
    The signal the approval gate waits for (set by {@link approval}).
  approvalTimeout_?: string | number
    How long the approval gate waits (set by {@link approvalTimeout}).
  lock_?: Configure<LockSettings>
    The rollout's lock, held for the whole run (set by {@link lock}).
  durable_: boolean
    Whether bakes suspend the run instead of sleeping (set by {@link durable}).
  platform(platform: CanaryPlatform): this
    Where the canary runs: a platform adapter, or a hand-written object.
  steps(...percents: number[]): this
    The exposure after each step, in percent and increasing — `steps(10, 25, 50)` exposes 10 %, then 25 %, then 50 %, and promotion takes it to 100 %.
    A `"channel"` platform has no percentage and declares no steps.
  bake(duration: string | number): this
    How long every step bakes before its final analysis (`"10m"`, or ms).
  bakeStep(step: number, duration: string | number): this
    How long one step (1-based) bakes, overriding {@link bake} for it.
  analysis(...analyses: CanaryAnalysis[]): this
    Health checks run against each step: on an interval while it bakes (inline
    bakes only) and once when it ends. Any core `Validation` works.
  analysisInterval(duration: string | number): this
    How often an inline bake runs its analyses (default `"1m"`).
  approval(signal: string): this
    Wait for an external signal before promoting —
    `zuke resume <run-id> --signal <name>` delivers it.
  approvalTimeout(duration: string | number): this
    How long the approval gate waits before rolling the canary back.
  lock(configure: Configure<LockSettings>): this
    Lock the rollout for the whole run, from staging to promotion or rollback
    — a core lock settings lambda, held with `holdForRun()`. Set its TTL to
    cover the longest the run can stay parked at a gate.
  durable(): this
    Bake by suspending the run instead of sleeping in the process: each bake
    becomes a gate that `zuke resume --check` reopens once its time is up.
    Needs a state store. In-flight analyses do not run (no process is there to
    run them); each step's final analysis does.

class HttpProbeSettings
  Settings for {@link httpProbe}: what to request, how often, how strictly.

  url_?: string
    The URL to request (set by {@link url}).
  samples_: number
    How many requests to make (set by {@link samples}).
  maxFailures_: number
    How many failed requests are tolerated (set by {@link maxFailures}).
  readonly expectStatus_: number[]
    The statuses that count as healthy; any 2xx when empty (set by {@link expectStatus}).
  timeout_: number
    How long one request may take, in ms (set by {@link timeout}).
  interval_: number
    The pause between requests, in ms (set by {@link interval}).
  readonly headers_: Record<string, string>
    Request headers (set by {@link header}).
  fetch_: typeof fetch
    The `fetch` to use (set by {@link fetch}); the global one by default.
  url(url: string): this
    The URL to request.
  samples(count: number): this
    How many requests to make (default 10).
  maxFailures(count: number): this
    How many failed requests are tolerated before the probe fails (default 0).
  expectStatus(...statuses: number[]): this
    The statuses that count as healthy; any 2xx when none are set.
  timeout(duration: string | number): this
    How long one request may take (`"5s"`, or ms; default 5 s).
  interval(duration: string | number): this
    The pause between requests (`"1s"`, or ms; default 1 s).
  header(name: string, value: string): this
    Add a request header.
  fetch(fetcher: typeof fetch): this
    The `fetch` to use — the seam a test answers requests through.

class MetricThresholdSettings
  Settings for {@link metricThreshold}: a name, a reader, and the bounds the
  value must stay within.

  name_: string
    What the metric is called in a failure (set by {@link name}).
  read_?: MetricReader
    How to read the value (set by {@link read}).
  min_?: number
    The lowest acceptable value (set by {@link min}).
  max_?: number
    The highest acceptable value (set by {@link max}).
  name(name: string): this
    What to call the metric when it is out of bounds.
  read(reader: MetricReader): this
    How to read the value — handed where the rollout stands.
  min(value: number): this
    Fail when the value is below `value`.
  max(value: number): this
    Fail when the value is above `value`.

class PrometheusSettings
  Settings for {@link prometheus}: where, what to ask, and the bounds.

  name_: string
    What the query is called in a failure (set by {@link name}).
  url_?: string
    The Prometheus base URL (set by {@link url}).
  query_?: string
    The PromQL expression (set by {@link query}).
  min_?: number
    The lowest acceptable sample (set by {@link min}).
  max_?: number
    The highest acceptable sample (set by {@link max}).
  readonly headers_: Record<string, string>
    Request headers, such as `Authorization` (set by {@link header}).
  timeout_: number
    The request timeout in ms (set by {@link timeout}).
  fetch_: typeof fetch
    The `fetch` to use (set by {@link fetch}); the global one by default.
  name(name: string): this
    What to call the query when it fails.
  url(url: string): this
    The Prometheus base URL, such as `https://prometheus.internal`.
  query(promql: string): this
    The PromQL expression. It must return a vector or a scalar; an empty
    vector fails, so write `… or vector(0)` when no data means healthy.
  min(value: number): this
    Fail when any sample is below `value`.
  max(value: number): this
    Fail when any sample is above `value`.
  header(name: string, value: string): this
    Add a request header — `header("Authorization", `Bearer ${token}`)`.
  timeout(duration: string | number): this
    How long the query may take (`"10s"`, or ms; default 30 s).
  fetch(fetcher: typeof fetch): this
    The `fetch` to use — the seam a test answers queries through.

interface Canary
  The targets `canary(...)` creates. Assigned to a build field — `rollout = canary(…)` — they are named under it: `rollout.stage`, `rollout.step1.expose`,
  `rollout.promote`, `rollout.abort`. Depend on `this.rollout.promote` to run
  after a successful rollout.

  stage: TargetBuilder
    Puts the candidate in place at 0 % and takes the rollout's lock.
  approve?: TargetBuilder
    The external-signal gate before promotion, when one is configured.
  promote: TargetBuilder
    Sends all traffic to the candidate. Re-driven by a resume.
  abort: TargetBuilder
    The rollback: every failure path runs it, and it can be run by hand.
  soak?: CanaryPhaseTargets
    The single phase of a stepless canary, when it bakes or analyses.
  [step: `step${number}`]: CanaryPhaseTargets

interface CanaryAnalysis
  A health check run against a canary: throw to fail it, which rolls the
  rollout back. Any core `Validation` is one, since a function that accepts a
  plain {@link ValidationContext} accepts this richer context too.

  name?: string
    A name for diagnostics (optional).
  validate(context: CanaryAnalysisContext): void | Promise<void>
    Run the check; throw to fail it.

interface CanaryAnalysisContext extends ValidationContext
  What an analysis is handed: everything a core
  {@link ValidationContext} carries — the target's name, the run's redactor,
  and a `signal` — plus where the rollout stands.

  readonly step: number
    The 1-based step being analysed; `0` for a canary with no steps.
  readonly requested: number
    The exposure this step asked for, in percent.
  readonly exposure: number
    The exposure the platform reported achieving, in percent.

interface CanaryContext
  What the engine hands a {@link CanaryPlatform} on each call.

  `state` is the one place a platform keeps the handles a later call needs —
  the revision it staged, the stable one to return to. Every call of one
  rollout gets the same durable state, so `abort` can read what `stage`
  wrote, even in another process after a resume. Never put a secret in it: it
  is persisted in plain JSON and shown by `zuke runs show`.

  readonly state: TargetStateHandle
    The rollout's durable platform state, shared by every call.
  readonly signal: AbortSignal
    Aborted when the run is cancelled. Pass it to any network call. A
    compensation (`abort` during a rollback) is handed one that never aborts:
    the rollback is finished, not interrupted.
  reportSummary(pairs: SummaryPairs): void
    Add key/value pairs to the calling target's row in the build summary.

interface CanaryPhaseTargets
  The targets of one phase of a rollout.

  expose?: TargetBuilder
    Sets the step's exposure; absent for the soak of a stepless canary.
  bake?: TargetBuilder
    Waits out the bake; absent when the phase does not bake.
  analyze?: TargetBuilder
    Runs the analyses once at the end; absent when there are none.

interface CanaryPlatform
  A place a canary runs. The engine stages the candidate, moves its exposure
  step by step, and then promotes it or aborts it — through these calls only.

  Rules the engine relies on:

  - `expose` is absolute (set exposure to `percent`, not add to it) and
    returns the exposure actually achieved, which may differ on a `"replicas"`
    platform. A repeated call with the same value is harmless — a resumed run
    repeats one that was interrupted.
  - `promote` and `abort` are idempotent: either can run twice.
  - `abort` must also work with empty state. A rollback reads the state
    `stage` wrote, but `zuke <rollout>.abort` run by hand is a fresh run that
    has none, so `abort` falls back to what its own configuration says the
    stable version is.

  readonly exposure: ExposureKind
    How this platform measures exposure.
  describe(): string
    A short description for the build summary (`"Cloud Run service api"`).
  stage(ctx: CanaryContext): Promise<void>
    Put the candidate in place at 0 % exposure; record handles in `ctx.state`.
  expose(percent: number, ctx: CanaryContext): Promise<number>
    Set exposure to `percent` (0–100) and return the exposure achieved.
  promote(ctx: CanaryContext): Promise<void>
    Send all traffic to the candidate and retire the old version.
  abort(ctx: CanaryContext): Promise<void>
    Return all traffic to the stable version and remove the candidate.

interface ThresholdBounds
  Inclusive bounds a metric must stay within; either side may be open.

  min?: number
    The lowest acceptable value, if any.
  max?: number
    The highest acceptable value, if any.

type ExposureKind = "traffic" | "replicas" | "channel"
  How a platform exposes a candidate:

  - `"traffic"` — a share of requests, set exactly (a traffic split).
  - `"replicas"` — a share of instances, quantised to whole replicas, so the
    achieved exposure can differ from the one requested.
  - `"channel"` — a release channel (a dist-tag, a pre-release); there is no
    percentage, so a canary on it declares no steps.

type MetricReader = (context: CanaryAnalysisContext) => number | Promise<number>
  Reads the metric a {@link metricThreshold} judges.
````

</details>

<!-- ZUKE:API:END -->
