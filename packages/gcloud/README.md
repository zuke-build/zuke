# @zuke/gcloud

Typed [`gcloud`](https://cloud.google.com/sdk/gcloud) (Google Cloud SDK) task
wrapper for [Zuke](https://github.com/zuke-build/zuke#readme) builds, in a
fluent settings-lambda API. `gcloud` is vast, so this is a flexible command
builder: name the command with `.command(...)`, set the common global flags
fluently, and pass anything else with `.flag(...)`. Arguments stay a discrete
argv array, so command construction is injection-free.

```ts
import { GcloudTasks } from "@zuke/gcloud";

await GcloudTasks.run((s) =>
  s.command("run", "deploy", "api")
    .project("my-project")
    .flag("region", "us-central1")
    .flag("source", ".")
    .noPrompt()
);

await GcloudTasks.run((s) => s.command("auth", "list").format("json"));
```

Typed methods cover the ugliest shells directly — cross-registry image tagging
and Cloud SQL:

```ts
await GcloudTasks.run((s) =>
  s.containerImagesAddTag("gcr.io/p/img:sha", "eu.gcr.io/p/img:prod")
);
await GcloudTasks.run((s) => s.sqlInstancesDescribe("prod-db").format("json"));
await GcloudTasks.run((s) => s.sqlOperationsWait("op-123"));
```

## GCS and Secret Manager (REST)

Two REST task groups reach Google Cloud Storage and Secret Manager **without a
Google SDK** — auth is a bearer token from an injected provider (default:
`gcloud auth print-access-token`), and the transport is an injectable `fetch`,
so both are testable without network:

```ts
import { GcsTasks, SecretManagerTasks } from "@zuke/gcloud";

// GCS: read/write/list JSON blobs.
await GcsTasks.writeJson("my-bucket", "state/deploy.json", { slot: "sit-7" });
const state = await GcsTasks.readJson<{ slot: string }>(
  "my-bucket",
  "state/deploy.json",
);
const keys = await GcsTasks.list("my-bucket", { prefix: "state/" });

// Secret Manager: create-if-absent, then add a version (idempotent).
await SecretManagerTasks.addVersion("db-password", pw, { project: "my-proj" });
const secret = await SecretManagerTasks.access("db-password", {
  project: "my-proj",
});
```

`access` returns the plaintext secret — route it into a `.secret()` parameter or
the run's redactor; never log it.

## Cloud Logging and Cloud Monitoring

Typed tasks cover the GA `gcloud logging` and `gcloud monitoring` commands:
`loggingRead`, `loggingLogsList`, `monitoringPoliciesList`,
`monitoringPoliciesDescribe`, `monitoringDashboardsList` and
`monitoringUptimeListConfigs`. A log filter is built from typed parts — each
value quoted and escaped as the Logging query language says, so a value cannot
end its string and widen the filter — plus any raw `.filter(...)` text, joined
with `AND`:

```ts
import { GcloudTasks } from "@zuke/gcloud";

await GcloudTasks.loggingRead((s) =>
  s.resourceType("cloud_run_revision").resourceLabel("service_name", "api")
    .minSeverity("ERROR").freshness("1h").limit(20).format("json")
    .project("my-proj").quiet() // log entries can carry secrets
);

// How many entries match — reading only each entry's id, so no payload
// reaches the build. Counts at most .limit(n) (default 1000) and fails when
// more match, rather than return a truncated count as exact. Without
// .since(...) or .freshness(...) it counts the last day.
const errors = await GcloudTasks.logEntryCount((s) =>
  s.resourceType("cloud_run_revision").minSeverity("ERROR").freshness("15m")
    .limit(500).project("my-proj")
);
```

gcloud has no command that reads a metric's time series, on any release track,
so `CloudMonitoringTasks` reads them over the Cloud Monitoring REST API
(`projects.timeSeries.list`) with the same gcloud-based auth as the GCS and
Secret Manager groups. The filter is built from typed parts too; a value holding
a `"` or `\` is refused, since the Monitoring filter language documents no
escape for one. Every page is read, up to `.maxPages(n)` (default 100); a read
with pages left over fails rather than return part of the answer. The deprecated
MQL method, `projects.timeSeries.query`, is not wrapped.

```ts
import { CloudMonitoringTasks } from "@zuke/gcloud";

const series = await CloudMonitoringTasks.timeSeriesList((s) =>
  s.project("my-proj").metricType("run.googleapis.com/request_count")
    .resourceType("cloud_run_revision")
    .metricLabel("response_code_class", "5xx")
    .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
    .crossSeriesReducer("REDUCE_SUM").groupByFields(
      "resource.labels.revision_name",
    )
    .window("15m")
);

// One number: the latest value (summed across series), or the sum, average,
// maximum or minimum of every point in the window.
const total5xx = await CloudMonitoringTasks.metricValue((s) =>
  s.project("my-proj").metricType("run.googleapis.com/request_count")
    .metricLabel("response_code_class", "5xx")
    .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
    .crossSeriesReducer("REDUCE_SUM")
    .window("15m").aggregate("sum").missingDataAs(0)
);
```

`.freshness(...)` is sent as an explicit `timestamp>=` in the filter, measured
from `.now(...)`, not as gcloud's `--freshness`: gcloud silently drops that
whenever the filter's text contains the word `timestamp`, or the order is `asc`,
and the read then spans the whole retention period.

Points are typed: an `INT64` (which the API sends as a string) becomes a
`number` with the exact string beside it, a `DISTRIBUTION` carries its count and
mean, and a non-finite `DOUBLE` arrives as `NaN` or `±Infinity`. A window with
an alignment period ends at the last period boundary, so the period still being
written is not read; `.delay(...)` ends it earlier still, for a metric that
takes time to become visible.

`metricValue`'s `"latest"` sums each series' own newest point. A `DISTRIBUTION`
reads as its mean: `"average"` weights the means by their sample counts, and
`"sum"` — or `"latest"` over several distribution series — is refused, since
means cannot be added. A `CUMULATIVE` metric is refused unless `ALIGN_DELTA` or
`ALIGN_RATE` turns its running totals into increases, and a `NaN` point is
refused rather than skipped. Output a reader cannot use is a
`GcloudOutputError`, which never quotes it.

### `cloudMonitoring(...)` canary analysis

`cloudMonitoring` judges a Cloud Monitoring metric — or, with
`.logEntries(...)`, a log-entry count — over a recent window, for
[`@zuke/canary`](https://jsr.io/@zuke/canary), and fails with the same words as
`prometheus(...)`. `.cloudRunCandidate(service, region)` narrows it to the
revision a `cloudRunCanary` rollout staged, read in the analysis's project. The
window ends two minutes back by default (`.delay(...)`), since Cloud Run's
request metrics take up to 120 seconds to become visible. With
`.missingDataAs(0)`, no data passes — so a candidate with no traffic passes too;
see the canary guide for what to pair it with.

```ts
import { canary } from "@zuke/canary";
import { cloudMonitoring, cloudRunCanary } from "@zuke/gcloud";

rollout = canary((c) =>
  c.platform(
    cloudRunCanary((r) =>
      r.service("api").region("europe-west1").image(this.image.value)
        .gcloud((g) => g.project("my-proj"))
    ),
  )
    .steps(10, 50)
    .analysis(cloudMonitoring((m) =>
      m.name("canary 5xx").project("my-proj")
        .metricType("run.googleapis.com/request_count")
        .resourceType("cloud_run_revision")
        .cloudRunCandidate("api", "europe-west1")
        .metricLabel("response_code_class", "5xx")
        .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
        .crossSeriesReducer("REDUCE_SUM")
        .window("5m").max(5).missingDataAs(0)
    ))
);
```

See
[docs/canary.md](https://github.com/zuke-build/zuke/blob/master/docs/canary.md#cloud-monitoring).

## Cloud Run canary platform

`cloudRunCanary` is a Cloud Run service as a platform for
[`@zuke/canary`](https://jsr.io/@zuke/canary). This package does not depend on
`@zuke/canary`: the object it returns has the platform's shape, so
`c.platform(...)` accepts it as it is.

```ts
import { canary } from "@zuke/canary";
import { cloudRunCanary } from "@zuke/gcloud";

rollout = canary((c) =>
  c.platform(
    cloudRunCanary((r) =>
      r.service("api").region("europe-west1").image(this.image.value)
        .stable("api-00041-xyz") // where a hand-run rollout.abort goes back to
        .gcloud((g) => g.project("my-project"))
    ),
  )
    .steps(10, 25, 50)
    .bake("10m")
);
```

- **`stage`** deploys the image as a tagged revision with no traffic
  (`run services update … --tag canary --no-traffic`).
- **`expose`** moves traffic through that tag
  (`update-traffic --to-tags canary=<n>`).
- **`promote`** checks that the latest revision is still the candidate, then
  runs `--to-latest`.
- **`abort`** sets the tag back to 0 % mid-rollout. Run by hand, it sends all
  traffic to the `.stable(...)` revision.

`stage` records the service, region, tag and `.gcloud(...)` flags, and the
service's `metadata.uid`. Every later call — in a resumed process or a
`zuke cancel` too — compares its configuration with that record before any
command, and the live uid with the recorded one before changing anything, so a
configuration that now reaches another service (another name, region or project,
or one deleted and created again) is refused rather than acted on. The refusal
stops the run, its rollback refuses the same way, and it gives the gcloud
commands, built from the record, that check the service and take the candidate's
traffic back.

See
[docs/canary.md](https://github.com/zuke-build/zuke/blob/master/docs/canary.md#cloud-run).

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/gcloud` — typed Google Cloud tooling for Zuke builds: the `gcloud`
(Google Cloud SDK) CLI wrapper, plus GCS, Secret Manager and Cloud
Monitoring REST task groups that share `gcloud`-based auth (no Google SDK
dependency), and canary support for Cloud Run rollouts gated on Cloud
Monitoring.

```ts
import {
  CloudMonitoringTasks,
  GcloudTasks,
  GcsTasks,
  SecretManagerTasks,
} from "@zuke/gcloud";

await GcloudTasks.run((s) => s.containerImagesAddTag(src, dst)); // CLI
await GcsTasks.writeJson("bucket", "state.json", { slot: "sit-7" }); // REST
const pw = await SecretManagerTasks.access("db-password", { project }); // REST
const errors = await CloudMonitoringTasks.metricValue((s) =>
  s.metricType("run.googleapis.com/request_count").window("15m")
); // REST
```

The CLI wrapper builds a discrete argv array (never a shell string), and the
REST groups take an injectable `fetch`, so both are testable without network
or a real cluster.
@module

function cloudMonitoring(configure: Configure<CloudMonitoringAnalysisSettings>): CloudMonitoringAnalysis
  An analysis that reads a Cloud Monitoring metric — or counts log entries
  — over a recent window and fails the canary when any point is out of
  bounds, or when there is no data, unless
  {@link CloudMonitoringAnalysisSettings.missingDataAs} says what no data
  means.

  The lambda runs on each check, so it may read resolved parameters, and
  every failure message — one from the lambda included — passes through the
  run's redactor.

function cloudRunCanary(configure: Configure<CloudRunCanarySettings>): CloudRunCanary
  A Cloud Run service as a canary platform, for `@zuke/canary`:

  ```ts
  c.platform(cloudRunCanary((r) =>
    r.service("api").region("europe-west1").image(this.image.value)
      .gcloud((g) => g.project("my-project"))
  ))
  ```

  The lambda runs on every call, so it may read resolved parameters.

  - stage — reads the service's `metadata.uid`, runs `run services update <service> --image <image> --tag canary --no-traffic`, then records the
    service, region, tag, gcloud flags and uid, and the new revision.
  - expose — `run services update-traffic <service> --to-tags canary=<n>`.
  - promote — checks the latest revision is still the candidate, then
    `update-traffic --to-latest`.
  - abort — `update-traffic --to-tags canary=0` mid-rollout; run by hand,
    `--to-revisions <stable>=100` to the revision set with `.stable(...)`.

  Every call after `stage` that has its record — expose, promote, and abort
  mid-rollout — first compares the configured service, region, tag and
  gcloud flags with the record, then reads the service's uid again, and
  refuses on any difference before changing anything. A hand-run abort has no
  record and uses the configuration as it is.

async function gcloudAccessToken(run: GcloudRunner): Promise<string>
  The default {@link AccessTokenProvider}: the one line
  `gcloud auth print-access-token` prints, run with `--quiet` so the token
  never streams to the build log. A failed exit is an error even when the
  runner's settings say `.noThrow()`, and an empty, multi-line or truncated
  answer is refused — each would otherwise be sent as a broken token. `run` defaults to {@link "./gcloud.ts".GcloudTasks}
  `.run` and is injectable for tests.

async function resolveAccessToken(options: { token?: string; tokenProvider?: AccessTokenProvider; }): Promise<string>
  Resolve a bearer token from an explicit `token` or, when it is omitted, the
  `tokenProvider` (defaulting to {@link gcloudAccessToken}). Shared by the REST
  task groups so every call resolves auth the same way. The token is returned
  trimmed of the whitespace a header drops anyway.

  An empty token is refused, and so is one holding a control character after
  that trim — a line break inside it, or a `\v` or `\f` at either end. It
  cannot be an OAuth token, it is not quoted here, and the runtime's own
  refusal of such a header value would quote the whole value, token and all,
  into the error.

const CloudMonitoringTasks: CloudMonitoringTasksApi
  Typed Cloud Monitoring reads.

const DEFAULT_COUNT_LIMIT: 1000
  The most entries the count reader reads when no `.limit(...)` is set.

const GcloudTasks: GcloudTasksApi
  Typed task functions for the `gcloud` CLI.

const GcsTasks: GcsTasksApi
  Typed Google Cloud Storage JSON operations.

const RUN_SERVICE_URL_FORMAT: "value(status.url)"
  The `--format` the service-URL reader pins, so gcloud does the extraction.

const SecretManagerTasks: SecretManagerTasksApi
  Typed Google Secret Manager operations.

class CloudMonitoringAnalysisSettings extends CloudMonitoringTimeSeriesSettings
  Settings for {@link cloudMonitoring}: the metric — with the same setters
  as a `CloudMonitoringTasks.timeSeriesList` read, which these extend — or a
  log filter, and the bounds.

  name_?: string
    What the metric is called in a failure (set by {@link name}).
  min_?: number
    The lowest acceptable value (set by {@link min}).
  max_?: number
    The highest acceptable value (set by {@link max}).
  missingData_?: number
    The value to judge when there is no data (set by {@link missingDataAs}).
  logEntries_?: Configure<GcloudLoggingReadSettings>
    The log filter of the log-count mode (set by {@link logEntries}).
  cloudRunCandidate_?: CloudRunService
    The service whose candidate revision is judged (set by {@link cloudRunCandidate}).
  cloudRunCandidate(service: string, region?: string): this
    Judge only the canary revision of a Cloud Run service: before each
    check, read the service's latest created revision — the one
    `cloudRunCanary(...)` staged — with the `.gcloud(...)` flags, and narrow
    the metric (or the log filter) to `resource.labels.service_name` and
    `resource.labels.revision_name`. Pair it with
    `.resourceType("cloud_run_revision")`. A revision deployed by someone
    else mid-rollout would be read instead; `cloudRunCanary`'s promote
    refuses that case before moving traffic.
  name(name: string): this
    What to call the metric when it is out of bounds.
  min(value: number): this
    Fail when any point is below `value`, a finite number.
  max(value: number): this
    Fail when any point is above `value`, a finite number.
  missingDataAs(value: number): this
    Judge `value` when the window has no points, instead of failing. Cloud
    Monitoring writes no point for a period with no events, so for a count
    of errors no data means `0`; for a latency it usually means the metric,
    resource or labels are wrong, which is why that is a failure by default.
  logEntries(configure: Configure<GcloudLoggingReadSettings>): this
    Judge the number of log entries a Cloud Logging filter matches over the
    window, instead of a metric — `(l) => l.resourceType("cloud_run_revision") .resourceLabel("revision_name", rev).minSeverity("ERROR")`. The window is
    added to the filter as `timestamp` bounds, and the read runs with the
    `.gcloud(...)` flags. It counts at most `.limit(n)` entries (default
    1000) and fails when more match, since the exact count is then unknown.
    Only each entry's id is read: no payload reaches the build. A
    {@link project} set on the analysis is the read's `--project` too.

class CloudMonitoringMetricValueSettings extends CloudMonitoringTimeSeriesSettings
  Settings for `CloudMonitoringTasks.metricValue`: a time-series read, and
  how to turn it into one number. The view is always `FULL` — the reader
  needs the points.

  aggregate_: CloudMonitoringAggregate
    How to turn the points into one number (set by {@link aggregate}).
  missingData_?: number
    The value to return when there are no points (set by {@link missingDataAs}).
  aggregate(how: CloudMonitoringAggregate): this
    How to turn the points into one number, across every series the answer
    holds. `"latest"` (the default) sums each series' own newest point, so a
    metric split by a label reads as its total. The others combine every
    point in the window: a `"sum"` of per-minute `ALIGN_SUM` points is the
    window's total.

    A `DISTRIBUTION` point reads as its mean. `"average"` weights each mean
    by its sample count; `"maximum"` and `"minimum"` are of the means.
    Means cannot be added, so `"sum"` refuses distributions, and `"latest"`
    refuses more than one distribution series — collapse them with
    `.crossSeriesReducer(...)`, or align them to a number with
    `ALIGN_PERCENTILE_99`, `ALIGN_MEAN` and the like.
  missingDataAs(value: number): this
    Return `value` when there are no points, instead of failing. Cloud
    Monitoring writes no point for a period with no events, so for a count
    of errors no data does mean `0`; for a latency it usually means the
    filter is looking in the wrong place.

class CloudMonitoringTimeSeriesSettings
  Settings for a Cloud Monitoring time-series read, configured through
  `CloudMonitoringTasks.timeSeriesList((s) => …)`.

  ```ts
  s.project("my-proj")
    .metricType("run.googleapis.com/request_count")
    .resourceType("cloud_run_revision")
    .resourceLabel("service_name", "api")
    .metricLabel("response_code_class", "5xx")
    .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
    .crossSeriesReducer("REDUCE_SUM")
    .window("15m")
  ```

  project_?: string
    The project read from (set by {@link project}).
  metricType_?: string
    The metric type (set by {@link metricType}).
  resourceType_?: string
    The monitored-resource type (set by {@link resourceType}).
  readonly resourceLabels_: Array<[string, string]>
    Resource labels the series must carry (set by {@link resourceLabel}).
  readonly metricLabels_: Array<[string, string]>
    Metric labels the series must carry (set by {@link metricLabel}).
  readonly filters_: string[]
    Raw filter parts (set by {@link filter}).
  window_: number
    How far back to read, in ms (set by {@link window}).
  interval_?: { start: Date; end: Date; }
    An explicit interval, instead of the window (set by {@link interval}).
  alignmentPeriod_?: number
    The alignment period, in ms (set by {@link alignmentPeriod}).
  perSeriesAligner_?: CloudMonitoringAligner
    The per-series aligner (set by {@link perSeriesAligner}).
  crossSeriesReducer_?: CloudMonitoringReducer
    The cross-series reducer (set by {@link crossSeriesReducer}).
  readonly groupByFields_: string[]
    The labels the reducer keeps series apart by (set by {@link groupByFields}).
  view_: CloudMonitoringView
    How much of each series to return (set by {@link view}).
  pageSize_?: number
    The page size to ask for (set by {@link pageSize}).
  maxPages_?: number
    The most pages to read before failing (set by {@link maxPages}); 100 when unset.
  delay_?: number
    How far before now the window ends, in ms (set by {@link delay}).
  token_?: string
    A pre-resolved OAuth token (set by {@link token}).
  tokenProvider_?: AccessTokenProvider
    Resolves the token (set by {@link tokenProvider}).
  gcloud_: Configure<GcloudSettings>
    Global gcloud flags for the default token read (set by {@link gcloud}).
  fetch_?: typeof fetch
    The `fetch` the API is called through (set by {@link fetch}).
  readEnv_?: (name: string) => string | undefined
    Reads an environment variable for the project (set by {@link readEnv}).
  now_: () => Date
    The clock the window is read against (set by {@link now}).
  project(id: string): this
    The project to read from; when omitted, `GOOGLE_CLOUD_PROJECT` (then
    `GCLOUD_PROJECT`).
  metricType(type: string): this
    The metric to read: `metric.type = "<type>"`, e.g.
    `"run.googleapis.com/request_count"`. The API reads exactly one metric
    type per call.
  resourceType(type: string): this
    Only series on this monitored-resource type: `resource.type = "<type>"`.
  resourceLabel(key: string, value: string): this
    Only series whose resource label `key` is `value`; repeatable.
  metricLabel(key: string, value: string): this
    Only series whose metric label `key` is `value`; repeatable.
  filter(expression: string): this
    Raw text in the Monitoring filter language, joined with the typed parts
    by `AND`; repeatable. It is the caller's own text and is not escaped —
    never build it from an untrusted value. With no {@link metricType}, it
    must name the metric itself.
  window(duration: string | number): this
    How far back to read (`"15m"`, or ms; default five minutes), ending now
    — or, with an {@link alignmentPeriod}, at the last period boundary, so
    the period still being written is not read. The window must be at least
    one period long.
  interval(start: Date, end: Date): this
    Read exactly this interval instead of a window ending now.
  now(clock: () => Date): this
    The clock the window is read against — the seam a test pins it with.
  alignmentPeriod(duration: string | number): this
    What each aligned point covers (`aggregation.alignmentPeriod`) —
    `"60s"`, `"5m"`, or ms; whole seconds, at least 60, as the API requires.
  perSeriesAligner(aligner: CloudMonitoringAligner): this
    How each series is aligned (`aggregation.perSeriesAligner`).
  crossSeriesReducer(reducer: CloudMonitoringReducer): this
    How aligned series are combined (`aggregation.crossSeriesReducer`).
  groupByFields(...fields: string[]): this
    The labels the reducer keeps series apart by
    (`aggregation.groupByFields`), e.g. `"resource.labels.revision_name"`.
  view(view: CloudMonitoringView): this
    `FULL` (the default) returns points; `HEADERS` only each series' labels.
  pageSize(count: number): this
    The most results per page (`pageSize`; the API's default is 100,000).
  maxPages(count: number): this
    The most pages to read (default 100). A read that still has a next page
    after that many fails — a partial answer is never returned as a whole.
  delay(duration: string | number): this
    End the window this long before now (`"2m"`, or ms) — for the time a
    metric takes to become readable. Google's metrics list gives it per
    metric: Cloud Run's `request_count` and `request_latencies` are "not
    visible for up to 120 seconds" after sampling. Without it the newest
    points may not exist yet, or hold only part of their period. Default
    `0` for a read; the `cloudMonitoring(...)` analysis defaults to two
    minutes.
  token(value: string): this
    A pre-resolved OAuth access token.
  tokenProvider(provider: AccessTokenProvider): this
    Resolves the access token, when no {@link token} is set.
  gcloud(configure: Configure<GcloudSettings>): this
    Global gcloud flags for the default token read,
    `gcloud auth print-access-token` — `(g) => g.account("ci@p.iam…")`, or a
    `.runner(...)`, the seam a test answers through. Unused when a
    {@link token} or {@link tokenProvider} is set.
  fetch(implementation: typeof fetch): this
    The `fetch` the API is called through; the global by default.
  readEnv(reader: (name: string) => string | undefined): this
    Reads an environment variable for the project; `Deno.env.get` by default.

class CloudRunCanary
  A Cloud Run service as a canary platform. Create one with
  {@link cloudRunCanary}; hand it to `@zuke/canary`'s `c.platform(...)`.

  Exposure is a share of requests, set exactly, in whole percents.

  constructor(configure: Configure<CloudRunCanarySettings>)
    A platform whose settings `configure` produces, afresh on every call.
  readonly exposure: "traffic"
    Cloud Run splits requests, so exposure is a traffic share.
  describe(): string
    `"Cloud Run service api"`, for the build summary.
  async stage(ctx: CloudRunCanaryContext): Promise<void>
    Read the service's uid, deploy the candidate image as a new revision
    carrying the tag and no traffic, then record the service, region, tag,
    gcloud flags and uid every later call is checked against, and which
    revision the candidate is. `services update` never creates a service, so a
    misspelt name fails here rather than standing up a second service. A stage
    run again over a record that shows the candidate tagged is checked against
    that record first, as every later call is.
  async expose(percent: number, ctx: CloudRunCanaryContext): Promise<number>
    Send `percent` of the requests to the candidate, through its tag. gcloud
    spreads the rest over the revisions already serving, in proportion and in
    whole percents, so a split the service had before the canary keeps its
    shape only approximately — a revision whose share rounds to 0 drops out.
    First the configuration is compared with what `stage` recorded, then the
    service's uid is read again; on any difference this refuses, changing
    nothing.
  async promote(ctx: CloudRunCanaryContext): Promise<void>
    Send all traffic to the latest revision — after checking that it is
    still the candidate this rollout staged, so a revision someone deployed in
    the meantime is not promoted in its place. The check and the traffic move
    are two gcloud calls, so a deploy landing in the seconds between them is
    not caught. Before either, the configuration is compared with what
    `stage` recorded and the service's uid is read again; on any difference
    this refuses, changing nothing. Idempotent.
  async abort(ctx: CloudRunCanaryContext): Promise<void>
    Take the candidate's traffic back. Idempotent. What it does depends on
    what this rollout recorded:

    - The candidate is tagged (a rollback mid-rollout): once the
      configuration and the service's uid match what `stage` recorded, the
      tag goes to 0 % and gcloud returns that share to the revisions already
      serving. The candidate revision stays, with no traffic. On a mismatch
      this refuses, changing nothing.
    - `stage` failed before tagging it: nothing has any traffic to take
      back, so nothing runs.
    - Any other stage marker: the record is damaged, and this refuses.
    - Nothing recorded (`rollout.abort` run by hand, a fresh run): all
      traffic goes to the revision set with
      {@link CloudRunCanarySettings.stable}. Without one this refuses, since
      claiming a rollback it cannot do would be worse.

class CloudRunCanarySettings
  How {@link cloudRunCanary} reaches the service, configured through its
  lambda.

  service_?: string
    The Cloud Run service (set by {@link service}).
  region_?: string
    The region the service runs in (set by {@link region}).
  image_?: string
    The candidate's container image (set by {@link image}).
  tag_: string
    The tag that routes the candidate's traffic (set by {@link tag}).
  stable_?: string
    The revision a hand-run rollback returns to (set by {@link stable}).
  gcloud_?: Configure<GcloudSettings>
    Global gcloud flags for every command (set by {@link gcloud}).
  runner_: GcloudSettingsRunner
    How each command is run (set by {@link runner}).
  service(name: string): this
    The Cloud Run service to roll out to. It must already exist.
  region(value: string): this
    The region the service runs in (`--region`).
  image(reference: string): this
    The candidate's container image, deployed by `stage`.
  tag(name: string): this
    The tag the candidate revision carries, and that every traffic move routes
    through (default `canary`). Lowercase letters, digits and hyphens,
    starting with a letter.
  stable(revision: string): this
    The revision to send all traffic back to when `rollout.abort` is run by
    hand. Such a run is fresh, with no record of a rollout, so it has nothing
    else to go on — and the release it is undoing has usually been promoted
    already. A rollback the engine runs mid-rollout does not use it: that one
    takes the candidate's tag back to 0 % instead.
  gcloud(configure: Configure<GcloudSettings>): this
    Global flags for every gcloud command the platform runs —
    `(g) => g.project("p").account("deploy@p.iam.gserviceaccount.com")`, or a
    `.toolPath(...)` to a specific gcloud.
  runner(run: GcloudSettingsRunner): this
    Replace how each prepared command is run. The default runs it; this is
    for a test, or for a build that executes gcloud through something else.

class GcloudArtifactsImagesDeleteSettings extends GcloudSettings
  Settings for `gcloud artifacts docker images delete`.

  image(reference: string): this
    The image or version to delete (positional).
  deleteTags(): this
    Delete the version even though tags point at it (`--delete-tags`), which
    gcloud otherwise refuses.
  override protected leadingTokens(): string[]
    Emit `artifacts docker images delete` with its operand.

class GcloudArtifactsImagesListSettings extends GcloudSettings
  Settings for `gcloud artifacts docker images list`.

  repository(path: string): this
    The repository or image to list (positional).
  includeTags(): this
    Include each version's tags (`--include-tags`).
  limit(value: number): this
    Return at most this many images (`--limit`).
  filter(expression: string): this
    Restrict the listing (`--filter`).
  override protected leadingTokens(): string[]
    Emit `artifacts docker images list` with its operand and flags.

class GcloudArtifactsRepositoriesDescribeSettings extends GcloudSettings
  Settings for `gcloud artifacts repositories describe`.

  repository(name: string): this
    The repository to describe (positional).
  location(value: string): this
    The location it lives in (`--location`).
  override protected leadingTokens(): string[]
    Emit `artifacts repositories describe` with its operand.

class GcloudArtifactsRepositoriesListSettings extends GcloudSettings
  Settings for `gcloud artifacts repositories list`.

  location(value: string): this
    The location to list from (`--location`).
  limit(value: number): this
    Return at most this many repositories (`--limit`).
  override protected leadingTokens(): string[]
    Emit `artifacts repositories list` with its flags.

class GcloudAuthActivateServiceAccountSettings extends GcloudSettings
  Settings for `gcloud auth activate-service-account`.

  serviceAccount(email: string): this
    The service account to activate (positional); optional beside a key file.
  keyFile(path: string): this
    The JSON key to activate it from (`--key-file`).
  override protected leadingTokens(): string[]
    Emit `auth activate-service-account` and its operand.

class GcloudAuthConfigureDockerSettings extends GcloudSettings
  Settings for `gcloud auth configure-docker`.

  registries(...values: string[]): this
    The registries to add a credential helper for (positional, comma
    separated), e.g. `"us-central1-docker.pkg.dev"`; repeatable.
  override protected leadingTokens(): string[]
    Emit `auth configure-docker` and the registries.

class GcloudAuthListSettings extends GcloudSettings
  Settings for `gcloud auth list`.

  filterAccount(email: string): this
    Only the named account (`--filter-account`).
  override protected leadingTokens(): string[]
    Emit `auth list` and its filter.

class GcloudAuthPrintAccessTokenSettings extends GcloudSettings
  Settings for `gcloud auth print-access-token`.

  forAccount(email: string): this
    Print the token for this account rather than the active one (positional).
  override protected leadingTokens(): string[]
    Emit `auth print-access-token` and its operand.

class GcloudAuthPrintIdentityTokenSettings extends GcloudSettings
  Settings for `gcloud auth print-identity-token`.

  forAccount(email: string): this
    Print the token for this account rather than the active one (positional).
  audiences(...values: string[]): this
    The audiences the token is minted for (`--audiences`); repeatable.

    A Cloud Run service invoked service-to-service is the usual reason: the
    receiving service's URL is the audience, and a token minted without one is
    rejected there.
  includeEmail(): this
    Include the service account email in the token (`--include-email`).
  override protected leadingTokens(): string[]
    Emit `auth print-identity-token` with its operand and flags.

class GcloudAuthRevokeSettings extends GcloudSettings
  Settings for `gcloud auth revoke`.

  accounts(...values: string[]): this
    The accounts to revoke (positional); repeatable.
  all(): this
    Revoke every credentialed account (`--all`).
  override protected leadingTokens(): string[]
    Emit `auth revoke` with its operands.

class GcloudBuildsDescribeSettings extends GcloudSettings
  Settings for `gcloud builds describe`.

  build(id: string): this
    The build to describe (positional).
  region(value: string): this
    The region it ran in (`--region`).
  override protected leadingTokens(): string[]
    Emit `builds describe` with its operand.

class GcloudBuildsListSettings extends GcloudSettings
  Settings for `gcloud builds list`.

  limit(value: number): this
    Return at most this many builds (`--limit`).
  filter(expression: string): this
    Restrict the listing (`--filter`), e.g. `"status=SUCCESS"`.
  region(value: string): this
    The region to list from (`--region`).
  ongoing(): this
    Only builds that have not finished (`--ongoing`).
  override protected leadingTokens(): string[]
    Emit `builds list` with its flags.

class GcloudBuildsLogSettings extends GcloudSettings
  Settings for `gcloud builds log`.

  build(id: string): this
    The build whose log to read (positional).
  stream(): this
    Follow the log until the build finishes (`--stream`), which makes the task
    block for the build's duration rather than returning what exists now.
  region(value: string): this
    The region it ran in (`--region`).
  override protected leadingTokens(): string[]
    Emit `builds log` with its operand.

class GcloudBuildsSubmitSettings extends GcloudSettings
  Settings for `gcloud builds submit`.

  source(path: string): this
    The source to build (positional), e.g. `"."` or a `gs://` archive.
  tag(image: string): this
    Build a container and push it to this tag (`--tag`).
  config(path: string): this
    Build from a config file (`--config`), e.g. `cloudbuild.yaml`.
  pack(spec: string): this
    Build with buildpacks (`--pack`), e.g. `"image=gcr.io/p/i"`.
  timeout(value: string): this
    Fail the build after this long (`--timeout`), e.g. `"600s"`.
  machineType(value: string): this
    The machine type to build on (`--machine-type`).
  substitutions(...pairs: string[]): this
    Substitution values for the config (`--substitutions`); repeatable.
  async(): this
    Return as soon as the build is queued (`--async`).
  gcsSourceStagingDir(uri: string): this
    Stage the source under this bucket path (`--gcs-source-staging-dir`).
  ignoreFile(path: string): this
    Exclude files matching this ignore file (`--ignore-file`).
  region(value: string): this
    The region to build in (`--region`).
  override protected leadingTokens(): string[]
    Emit `builds submit` with its source and flags.

class GcloudClustersDescribeSettings extends GcloudSettings
  Settings for `gcloud container clusters describe`.

  cluster(name: string): this
    The cluster to describe (positional).
  location(value: string): this
    The cluster's location (`--location`).
  region(value: string): this
    The cluster's region (`--region`).
  zone(value: string): this
    The cluster's zone (`--zone`).
  override protected leadingTokens(): string[]
    Emit `container clusters describe` with its operand.

class GcloudClustersGetCredentialsSettings extends GcloudSettings
  Settings for `gcloud container clusters get-credentials`.

  cluster(name: string): this
    The cluster to fetch credentials for (positional).
  location(value: string): this
    The cluster's location (`--location`).
  region(value: string): this
    The cluster's region (`--region`).
  zone(value: string): this
    The cluster's zone (`--zone`).
  internalIp(): this
    Use the internal endpoint (`--internal-ip`), for a private cluster.
  dnsEndpoint(): this
    Use the DNS endpoint (`--dns-endpoint`).
  override protected leadingTokens(): string[]
    Emit `container clusters get-credentials` with its operand.

class GcloudClustersListSettings extends GcloudSettings
  Settings for `gcloud container clusters list`.

  location(value: string): this
    Restrict to a location (`--location`).
  region(value: string): this
    Restrict to a region (`--region`).
  zone(value: string): this
    Restrict to a zone (`--zone`).
  filter(expression: string): this
    Restrict the listing (`--filter`).
  override protected leadingTokens(): string[]
    Emit `container clusters list` with its flags.

class GcloudConfigGetValueSettings extends GcloudSettings
  Settings for `gcloud config get-value`.

  property(name: string): this
    The property to read (positional).
  override protected leadingTokens(): string[]
    Emit `config get-value` with the property.

class GcloudConfigListSettings extends GcloudSettings
  Settings for `gcloud config list`.

  all(): this
    Include properties left at their defaults (`--all`).
  override protected leadingTokens(): string[]
    Emit `config list`.

class GcloudConfigSetSettings extends GcloudSettings
  Settings for `gcloud config set`.

  property(name: string): this
    The property to set (positional), e.g. `"project"` or `"run/region"`.
  value(text: string): this
    The value to set it to (positional).
  override protected leadingTokens(): string[]
    Emit `config set` with the property and value.

class GcloudConfigUnsetSettings extends GcloudSettings
  Settings for `gcloud config unset`.

  property(name: string): this
    The property to clear (positional).
  override protected leadingTokens(): string[]
    Emit `config unset` with the property.

class GcloudFunctionsDeploySettings extends GcloudSettings
  Settings for `gcloud functions deploy`.

  function(name: string): this
    The function to deploy (positional).
  runtime(value: string): this
    The language runtime (`--runtime`), e.g. `"nodejs20"`.
  region(value: string): this
    The region to deploy into (`--region`).
  entryPoint(value: string): this
    The exported symbol to invoke (`--entry-point`).
  source(path: string): this
    Where the source lives (`--source`).
  triggerHttp(): this
    Trigger on HTTP requests (`--trigger-http`).
  triggerTopic(name: string): this
    Trigger on a Pub/Sub topic (`--trigger-topic`).
  triggerBucket(name: string): this
    Trigger on a Cloud Storage bucket (`--trigger-bucket`).
  triggerEventFilters(...filters: string[]): this
    Trigger on matching Eventarc events (`--trigger-event-filters`).
  serviceAccount(email: string): this
    The identity the function runs as (`--service-account`).
  setEnvVars(...pairs: string[]): this
    Environment variables (`--set-env-vars`), as `KEY=value`; repeatable.
  memory(value: string): this
    Memory per instance (`--memory`).
  timeout(value: string): this
    Execution timeout (`--timeout`).
  gen2(): this
    Deploy as a 2nd-generation function (`--gen2`).
  override protected leadingTokens(): string[]
    Emit `functions deploy` with its operand and flags.

class GcloudFunctionsDescribeSettings extends GcloudSettings
  Settings for `gcloud functions describe`.

  function(name: string): this
    The function to describe (positional).
  region(value: string): this
    The region it runs in (`--region`).
  gen2(): this
    Look it up as a 2nd-generation function (`--gen2`).
  override protected leadingTokens(): string[]
    Emit `functions describe` with its operand.

class GcloudLoggingEntryCountSettings extends GcloudLoggingReadSettings
  Settings for `GcloudTasks.logEntryCount`: a `gcloud logging read` whose
  matches are counted. `.limit(n)` is the most entries counted; a count
  above it fails as "more than n".

  override protected owner(): string
    Who this reader's error messages name.

class GcloudLoggingLogsListSettings extends GcloudSettings
  Settings for `gcloud logging logs list`: the logs that hold entries.

  logView(bucket: string, location: string, view: string): this
    List the logs of a log view (`--bucket`, `--location`, `--view`).
  filter(expression: string): this
    Keep only matching logs (`--filter`), gcloud's own list filter.
  limit(count: number): this
    List at most this many logs (`--limit`).
  sortBy(...fields: string[]): this
    Sort by these fields (`--sort-by`); prefix one with `~` to descend.
  override protected leadingTokens(): string[]
    Emit `logging logs list` with its flags.

class GcloudLoggingReadSettings extends GcloudSettings
  Settings for `gcloud logging read`: which entries (the filter), from where
  (project, folder, organization, billing account, or a log view), and how
  many.

  limit_?: number
    The most entries to read (set by {@link limit}).
  freshness_?: number
    How long back `.freshness(...)` reaches, in ms (set by {@link freshness}).
  since_?: GcloudLogTime
    The earliest time `.since(...)` admits (set by {@link since}).
  now_: () => Date
    The clock `.freshness(...)` is measured from (set by {@link now}).
  protected owner(): string
    Who this command's error messages name.
  filter(expression: string): this
    Raw filter text in the Logging query language, joined with every other
    part by `AND`; repeatable. It is the caller's own text and is not
    escaped — never build it from an untrusted value; use the typed setters
    for those.
  resourceType(type: string): this
    Only entries from this monitored-resource type: `resource.type="…"`.
  resourceLabel(key: string, value: string): this
    Only entries whose resource label `key` is `value`; repeatable.
  label(key: string, value: string): this
    Only entries whose own label `key` is `value`; repeatable.
  minSeverity(severity: GcloudLogSeverity): this
    Only entries at `severity` or above: `severity>=ERROR`.
  since(time: GcloudLogTime): this
    Only entries at or after `time`: `timestamp>="…"`.
  until(time: GcloudLogTime): this
    Only entries before `time`: `timestamp<"…"`.
  freshness(duration: string | number): this
    Only entries newer than this — `"1h"`, `"90s"`, or ms — sent as an
    explicit `timestamp>="<now − duration>"` in the filter, measured from
    {@link now}. gcloud's own `--freshness` is not used: gcloud silently
    drops it whenever the filter's text contains the word `timestamp`
    anywhere, or the order is `asc`, and the read then spans the whole
    retention period.
  now(clock: () => Date): this
    The clock {@link freshness} is measured from — the seam a test pins it
    with. Either may be set first.
  order(order: "asc" | "desc"): this
    Newest first (`desc`, gcloud's default) or oldest first (`--order`).
  limit(count: number): this
    Read at most this many entries (`--limit`; gcloud's default is unlimited).
  organization(id: string): this
    Read from an organization's logs (`--organization`). gcloud takes one of
    `--organization`, `--folder`, `--billing-account` and `--project`.
  folder(id: string): this
    Read from a folder's logs (`--folder`).
  billingAccount(id: string): this
    Read from a billing account's logs (`--billing-account`).
  logView(bucket: string, location: string, view: string): this
    Read through a log view (`--bucket`, `--location`, `--view`).
  resourceNames(...names: string[]): this
    Read from these resources instead (`--resource-names`): a project,
    folder or organization name, or a full log-view path. gcloud takes these
    or a log view, not both.
  override protected leadingTokens(): string[]
    Emit `logging read` with its filter and flags.

class GcloudMonitoringDashboardsListSettings extends GcloudMonitoringListSettings
  Settings for `gcloud monitoring dashboards list`.

  override protected listCommand(): string[]
    `monitoring dashboards list`.
  override protected taskName(): string
    The task name used in this listing's error messages.

abstract class GcloudMonitoringListSettings extends GcloudSettings
  The list flags every `gcloud monitoring … list` command takes: `--filter`,
  `--limit`, `--page-size`, `--sort-by` and `--uri`. Each listing extends it
  and names its own command path.

  abstract protected listCommand(): string[]
    The command path, e.g. `["monitoring", "policies", "list"]`.
  abstract protected taskName(): string
    The task name used in this listing's error messages.
  filter(expression: string): this
    Keep only matching items (`--filter`), gcloud's own list filter.
  limit(count: number): this
    List at most this many items (`--limit`).
  pageSize(count: number): this
    How many items to request per page (`--page-size`).
  sortBy(...fields: string[]): this
    Sort by these fields (`--sort-by`); prefix one with `~` to descend.
  uri(): this
    Print each item's resource URI instead (`--uri`).
  override protected leadingTokens(): string[]
    Emit the listing's command path with its flags.

class GcloudMonitoringPoliciesDescribeSettings extends GcloudSettings
  Settings for `gcloud monitoring policies describe`.

  policy(idOrName: string): this
    The policy to describe (positional): its id, or its full name
    `projects/<project>/alertPolicies/<id>`.
  override protected leadingTokens(): string[]
    Emit `monitoring policies describe` with its operand.

class GcloudMonitoringPoliciesListSettings extends GcloudMonitoringListSettings
  Settings for `gcloud monitoring policies list`: the alerting policies.

  override protected listCommand(): string[]
    `monitoring policies list`.
  override protected taskName(): string
    The task name used in this listing's error messages.

class GcloudMonitoringUptimeListConfigsSettings extends GcloudMonitoringListSettings
  Settings for `gcloud monitoring uptime list-configs`: the uptime checks and
  synthetic monitors.

  override protected listCommand(): string[]
    `monitoring uptime list-configs`.
  override protected taskName(): string
    The task name used in this listing's error messages.

class GcloudOutputError extends Error
  gcloud or a Google API succeeded but returned something a reader cannot
  use: output that is not JSON, JSON of an unexpected shape, or a capture
  that was truncated.

  The message never quotes the output itself. A log read can return any
  payload an application logged, and an error that echoed it would put a
  secret in the build log.

  constructor(readonly task: string, readonly detail: string)
    Build the error from the reader that failed and what was wrong.
  override name: string
    The error name.

class GcloudRunDeploySettings extends GcloudSettings
  Settings for `gcloud run deploy`.

  service(name: string): this
    The service to deploy (positional).
  image(reference: string): this
    The container image to deploy (`--image`).
  source(path: string): this
    Build and deploy from source instead of an image (`--source`).
  region(value: string): this
    The region to deploy into (`--region`).
  platform(value: string): this
    The platform to target (`--platform`), e.g. `"managed"`.
  allowUnauthenticated(): this
    Let unauthenticated callers invoke the service (`--allow-unauthenticated`).
  noAllowUnauthenticated(): this
    Require authentication to invoke it (`--no-allow-unauthenticated`).
  serviceAccount(email: string): this
    The identity the service runs as (`--service-account`).
  setEnvVars(...pairs: string[]): this
    Environment variables (`--set-env-vars`), as `KEY=value`; repeatable.
  setSecrets(...pairs: string[]): this
    Secret Manager mounts (`--set-secrets`); repeatable.
  memory(value: string): this
    Memory per instance (`--memory`), e.g. `"512Mi"`.
  cpu(value: string): this
    CPU per instance (`--cpu`).
  concurrency(value: number): this
    Requests served concurrently per instance (`--concurrency`).
  maxInstances(value: number): this
    Upper bound on instances (`--max-instances`).
  minInstances(value: number): this
    Lower bound on instances (`--min-instances`).
  port(value: number): this
    The port the container listens on (`--port`).
  timeout(value: string): this
    Request timeout (`--timeout`).
  tag(value: string): this
    Tag this revision (`--tag`), so it is addressable without traffic.
  noTraffic(): this
    Deploy without moving traffic to the new revision (`--no-traffic`).
  override protected leadingTokens(): string[]
    Emit `run deploy` with its operand and flags.

class GcloudRunServicesDescribeSettings extends GcloudSettings
  Settings for `gcloud run services describe`.

  service(name: string): this
    The service to describe (positional).
  region(value: string): this
    The region it runs in (`--region`).
  platform(value: string): this
    The platform it runs on (`--platform`).
  override protected leadingTokens(): string[]
    Emit `run services describe` with its operand.

class GcloudRunServicesListSettings extends GcloudSettings
  Settings for `gcloud run services list`.

  region(value: string): this
    The region to list from (`--region`).
  platform(value: string): this
    The platform to list from (`--platform`).
  filter(expression: string): this
    Restrict the listing (`--filter`).
  override protected leadingTokens(): string[]
    Emit `run services list` with its flags.

class GcloudRunServicesUpdateSettings extends GcloudSettings
  Settings for `gcloud run services update` — amending a service that already
  exists.

  Distinct from {@link GcloudRunDeploySettings} on purpose. `run deploy`
  creates the service when it is absent and resets settings the invocation does
  not name; `run services update` only ever amends an existing one. A deploy
  that points a live service at a freshly built image wants the second
  guarantee, and getting the first by accident — a service quietly created, or
  scaling config quietly dropped — is a worse failure than an error.

  service(name: string): this
    The service to update (positional).
  region(value: string): this
    The region it runs in (`--region`).
  platform(value: string): this
    The platform it runs on (`--platform`).
  image(reference: string): this
    The container image to point the service at (`--image`).
  updateEnvVars(...pairs: string[]): this
    Set or overwrite environment variables (`--update-env-vars`), as
    `KEY=value`; repeatable. Variables the call does not name are left alone —
    which is the difference from `run deploy`'s `--set-env-vars`.
  removeEnvVars(...names: string[]): this
    Remove environment variables by name (`--remove-env-vars`); repeatable.
  clearEnvVars(): this
    Remove every environment variable the service has (`--clear-env-vars`).
  updateSecrets(...pairs: string[]): this
    Set or overwrite Secret Manager mounts (`--update-secrets`), as
    `KEY=secret:version`; repeatable.
  memory(value: string): this
    Memory per instance (`--memory`), e.g. `"512Mi"`.
  cpu(value: string): this
    CPU per instance (`--cpu`).
  concurrency(value: number): this
    Requests served concurrently per instance (`--concurrency`).
  maxInstances(value: number): this
    Upper bound on instances (`--max-instances`).
  minInstances(value: number): this
    Lower bound on instances (`--min-instances`).
  tag(value: string): this
    Tag the revision this update creates (`--tag`).
  noTraffic(): this
    Create the revision without moving traffic to it (`--no-traffic`).
  override protected leadingTokens(): string[]
    Emit `run services update` with its operand and flags.

class GcloudRunUpdateTrafficSettings extends GcloudSettings
  Settings for `gcloud run services update-traffic`.

  service(name: string): this
    The service whose traffic to move (positional).
  region(value: string): this
    The region it runs in (`--region`).
  toLatest(): this
    Send all traffic to the newest revision (`--to-latest`).
  toRevisions(...splits: string[]): this
    Split traffic across revisions (`--to-revisions`), as `rev=percent`.
  toTags(...splits: string[]): this
    Split traffic across tags (`--to-tags`), as `tag=percent`.
  override protected leadingTokens(): string[]
    Emit `run services update-traffic` with its operand and target.

class GcloudSecretsVersionsAccessSettings extends GcloudSettings
  Settings for `gcloud secrets versions access`.

  version(value: string): this
    The version to read (positional); defaults to `latest`.
  secret(name: string): this
    The secret to read it from (`--secret`).
  override protected leadingTokens(): string[]
    Emit `secrets versions access` with its operand.

class GcloudSettings extends SubcommandSettings
  Settings for a `gcloud` invocation.

  override protected defaultTool(): string
    The default executable name (`gcloud`).
  containerImagesAddTag(source: string, ...destinations: string[]): this
    Add tags to a container image across registries:
    `gcloud container images add-tag <source> <destination…>`. Each argument is
    a discrete argv token, so an image reference can't inject flags. Runs with
    `--quiet` (the re-tag is non-interactive automation; `add-tag` otherwise
    prompts for confirmation).
  sqlInstancesDescribe(instance: string): this
    Describe a Cloud SQL instance:
    `gcloud sql instances describe <instance>`. Add `.format("json")` to get a
    machine-readable body to parse from the command's stdout.
  sqlOperationsWait(operation: string): this
    Block until a Cloud SQL operation completes:
    `gcloud sql operations wait <operation>` — the typed form of the
    poll-an-operation shell loop.
  project(id: string): this
    Target Google Cloud project (`--project`).
  account(email: string): this
    Account to run as (`--account`).
  configuration(name: string): this
    Named gcloud configuration to use (`--configuration`).
  format(value: string): this
    Output format, e.g. `json`, `yaml`, `value(name)` (`--format`).
  verbosity(level: string): this
    Logging verbosity: `debug`, `info`, `warning`, `error`, … (`--verbosity`).
  noPrompt(): this
    Disable interactive prompts, accepting defaults (gcloud's `--quiet`). Named
    `noPrompt` to avoid clashing with the base `.quiet()`, which suppresses
    Zuke's own output streaming.
  runner(run: GcloudSettingsRunner): this
    Replace how this command is run. The default spawns gcloud; this is the
    seam a test answers commands through, and the way a build executes gcloud
    through something else. The runner reads the argv from the settings it is
    handed and must not call their `run()` — that is the call it replaces.
  override async run(): Promise<CommandOutput>
    Run the command — through the {@link runner} when one is set, otherwise
    by spawning gcloud. Either way the output is reported to the settings'
    output hook and a non-zero exit throws a `CommandError` unless
    `.noThrow()` was called.
  override protected middleTokens(): string[]
    Emit gcloud's common global flags between the command path and the flags.

class GcloudStorageCpSettings extends GcloudSettings
  Settings for `gcloud storage cp`.

  sources(...paths: string[]): this
    The sources to copy (positional); repeatable.
  destination(path: string): this
    Where to copy them (positional).
  recursive(): this
    Copy directories and their contents (`--recursive`).
  noClobber(): this
    Skip objects that already exist (`--no-clobber`).
  contentType(value: string): this
    Set the uploaded objects' content type (`--content-type`).
  cacheControl(value: string): this
    Set the uploaded objects' cache control (`--cache-control`).
  override protected leadingTokens(): string[]
    Emit `storage cp` with its operands and flags.

class GcloudStorageLsSettings extends GcloudSettings
  Settings for `gcloud storage ls`.

  paths(...values: string[]): this
    The paths to list (positional); repeatable.
  recursive(): this
    Recurse into prefixes (`--recursive`).
  long(): this
    Include size and creation time (`--long`).
  override protected leadingTokens(): string[]
    Emit `storage ls` with its operands.

class GcloudStorageRmSettings extends GcloudSettings
  Settings for `gcloud storage rm`.

  paths(...values: string[]): this
    The objects or prefixes to remove (positional); repeatable.
  recursive(): this
    Remove prefixes and everything under them (`--recursive`).
  override protected leadingTokens(): string[]
    Emit `storage rm` with its operands.

class GcloudStorageRsyncSettings extends GcloudSettings
  Settings for `gcloud storage rsync`.

  source(path: string): this
    The source tree (positional).
  destination(path: string): this
    The destination tree (positional).
  recursive(): this
    Recurse into directories (`--recursive`).
  deleteUnmatchedDestinationObjects(): this
    Delete objects at the destination that the source does not have
    (`--delete-unmatched-destination-objects`), which makes the destination a
    mirror rather than a superset.
  exclude(pattern: string): this
    Skip paths matching this pattern (`--exclude`).
  override protected leadingTokens(): string[]
    Emit `storage rsync` with its operands and flags.

interface CloudMonitoringAnalysis
  A health check run against a canary, in the shape `@zuke/canary`'s
  `c.analysis(...)` accepts: throw to fail it, which rolls the rollout back.

  readonly name: string
    `"cloudMonitoring"`, for diagnostics.
  validate(context: CloudMonitoringAnalysisContext): Promise<void>
    Read the metric and throw when a point is out of bounds.

interface CloudMonitoringAnalysisContext
  The part of the canary engine's context the analysis uses: the run's
  redactor, applied to every failure message. The engine hands a richer
  context; this is the narrow view.

  readonly signal?: AbortSignal
    Aborted when the run is cancelled; stops the check between steps.
  redact(text: string): string
    Mask every resolved `secret` parameter in `text`.

interface CloudMonitoringLabelled
  A type and its labels: a metric, or a monitored resource.

  type: string
    The metric type or resource type.
  labels: Record<string, string>
    Its labels.

interface CloudMonitoringPoint
  One point of a time series: the interval it covers, and its value.

  start?: Date
    The start of the interval; absent for a `GAUGE` point.
  end: Date
    The end of the interval — the time the point is for.
  value: CloudMonitoringValue
    The value.

interface CloudMonitoringTasksApi
  The shape of {@link CloudMonitoringTasks}.

  timeSeriesList(configure?: Configure<CloudMonitoringTimeSeriesSettings>): Promise<CloudMonitoringTimeSeries[]>
    Read the time series the settings describe, every page of them. A
    series can arrive split across two pages; each part is returned as the
    API sent it. Fails when the read still has a next page after
    `.maxPages(n)` pages, rather than return part of the answer.
  metricValue(configure?: Configure<CloudMonitoringMetricValueSettings>): Promise<number>
    One number from the time series the settings describe: the latest
    value, or an aggregate of every point in the window.

interface CloudMonitoringTimeSeries
  One time series: what it measures, on what, and its points, newest first.

  metric: CloudMonitoringLabelled
    The metric and its labels.
  resource: CloudMonitoringLabelled
    The monitored resource and its labels.
  metricKind?: string
    `GAUGE`, `DELTA` or `CUMULATIVE`, as the API reports it.
  valueType?: string
    `BOOL`, `INT64`, `DOUBLE`, `STRING` or `DISTRIBUTION`.
  unit?: string
    The unit of the points, when the API reports one.
  points: CloudMonitoringPoint[]
    The points, newest first. Empty for a `HEADERS` view.

interface CloudRunCanaryContext
  The part of the canary engine's context the Cloud Run platform uses: the
  rollout's durable state, where the staged revision is recorded, and the
  build summary. The engine hands a richer context; this is the narrow view.

  readonly state: TargetStateHandle
    The rollout's durable platform state, shared by every call.
  reportSummary(pairs: SummaryPairs): void
    Add key/value pairs to the calling target's row in the build summary.

interface CloudRunService
  A Cloud Run service, and the region it runs in when one is named.

  service: string
    The service's name.
  region?: string
    Its region (`--region`); gcloud's `run/region` when omitted.

interface GcloudTasksApi
  The shape of {@link GcloudTasks}.

  run(configure?: Configure<GcloudSettings>): Promise<CommandOutput>
    Run a `gcloud` command.
  authActivateServiceAccount(configure?: Configure<GcloudAuthActivateServiceAccountSettings>): Promise<CommandOutput>
    Activate a service account: `gcloud auth activate-service-account`.
  authPrintAccessToken(configure?: Configure<GcloudAuthPrintAccessTokenSettings>): Promise<CommandOutput>
    Print an OAuth access token: `gcloud auth print-access-token`.
  accessToken(configure?: Configure<GcloudAuthPrintAccessTokenSettings>): Promise<string>
    The OAuth access token itself, read back as a string.
  authPrintIdentityToken(configure?: Configure<GcloudAuthPrintIdentityTokenSettings>): Promise<CommandOutput>
    Print an identity token: `gcloud auth print-identity-token`.
  identityToken(configure?: Configure<GcloudAuthPrintIdentityTokenSettings>): Promise<string>
    The identity token itself, read back as a string.
  authConfigureDocker(configure?: Configure<GcloudAuthConfigureDockerSettings>): Promise<CommandOutput>
    Register gcloud as a Docker credential helper: `gcloud auth configure-docker`.
  authList(configure?: Configure<GcloudAuthListSettings>): Promise<CommandOutput>
    List credentialed accounts: `gcloud auth list`.
  authRevoke(configure?: Configure<GcloudAuthRevokeSettings>): Promise<CommandOutput>
    Revoke credentials: `gcloud auth revoke`.
  configSet(configure?: Configure<GcloudConfigSetSettings>): Promise<CommandOutput>
    Set a property: `gcloud config set`.
  configUnset(configure?: Configure<GcloudConfigUnsetSettings>): Promise<CommandOutput>
    Clear a property: `gcloud config unset`.
  configGetValue(configure?: Configure<GcloudConfigGetValueSettings>): Promise<CommandOutput>
    Read a property: `gcloud config get-value`.
  configValue(configure?: Configure<GcloudConfigGetValueSettings>): Promise<string>
    A configured property's value, read back as a string.
  configList(configure?: Configure<GcloudConfigListSettings>): Promise<CommandOutput>
    List the active configuration: `gcloud config list`.
  buildsSubmit(configure?: Configure<GcloudBuildsSubmitSettings>): Promise<CommandOutput>
    Submit a Cloud Build: `gcloud builds submit`.
  buildsList(configure?: Configure<GcloudBuildsListSettings>): Promise<CommandOutput>
    List builds: `gcloud builds list`.
  buildsDescribe(configure?: Configure<GcloudBuildsDescribeSettings>): Promise<CommandOutput>
    Describe a build: `gcloud builds describe`.
  buildsLog(configure?: Configure<GcloudBuildsLogSettings>): Promise<CommandOutput>
    Read a build's log: `gcloud builds log`.
  runDeploy(configure?: Configure<GcloudRunDeploySettings>): Promise<CommandOutput>
    Deploy to Cloud Run: `gcloud run deploy`.
  runServicesDescribe(configure?: Configure<GcloudRunServicesDescribeSettings>): Promise<CommandOutput>
    Describe a Cloud Run service: `gcloud run services describe`.
  runServiceUrl(configure?: Configure<GcloudRunServicesDescribeSettings>): Promise<string>
    The URL Cloud Run assigned a service, read back as a string. Pins
    `--format` to gcloud's own value projection, so gcloud extracts the field.
  runServicesList(configure?: Configure<GcloudRunServicesListSettings>): Promise<CommandOutput>
    List Cloud Run services: `gcloud run services list`.
  runServicesUpdate(configure?: Configure<GcloudRunServicesUpdateSettings>): Promise<CommandOutput>
    Amend an existing Cloud Run service: `gcloud run services update`. Unlike
    {@link runDeploy}, it never creates the service and never resets settings
    the call does not name.
  runUpdateTraffic(configure?: Configure<GcloudRunUpdateTrafficSettings>): Promise<CommandOutput>
    Move traffic between revisions: `gcloud run services update-traffic`.
  artifactsImagesList(configure?: Configure<GcloudArtifactsImagesListSettings>): Promise<CommandOutput>
    List images in Artifact Registry: `gcloud artifacts docker images list`.
  artifactsImagesDelete(configure?: Configure<GcloudArtifactsImagesDeleteSettings>): Promise<CommandOutput>
    Delete an image: `gcloud artifacts docker images delete`.
  artifactsRepositoriesList(configure?: Configure<GcloudArtifactsRepositoriesListSettings>): Promise<CommandOutput>
    List repositories: `gcloud artifacts repositories list`.
  artifactsRepositoriesDescribe(configure?: Configure<GcloudArtifactsRepositoriesDescribeSettings>): Promise<CommandOutput>
    Describe a repository: `gcloud artifacts repositories describe`.
  storageCp(configure?: Configure<GcloudStorageCpSettings>): Promise<CommandOutput>
    Copy to or from Cloud Storage: `gcloud storage cp`.
  storageRsync(configure?: Configure<GcloudStorageRsyncSettings>): Promise<CommandOutput>
    Sync a tree to or from Cloud Storage: `gcloud storage rsync`.
  storageLs(configure?: Configure<GcloudStorageLsSettings>): Promise<CommandOutput>
    List objects: `gcloud storage ls`.
  storageRm(configure?: Configure<GcloudStorageRmSettings>): Promise<CommandOutput>
    Remove objects: `gcloud storage rm`.
  clustersGetCredentials(configure?: Configure<GcloudClustersGetCredentialsSettings>): Promise<CommandOutput>
    Write a kubeconfig entry for a GKE cluster:
    `gcloud container clusters get-credentials`.
  clustersList(configure?: Configure<GcloudClustersListSettings>): Promise<CommandOutput>
    List GKE clusters: `gcloud container clusters list`.
  clustersDescribe(configure?: Configure<GcloudClustersDescribeSettings>): Promise<CommandOutput>
    Describe a GKE cluster: `gcloud container clusters describe`.
  functionsDeploy(configure?: Configure<GcloudFunctionsDeploySettings>): Promise<CommandOutput>
    Deploy a Cloud Function: `gcloud functions deploy`.
  functionsDescribe(configure?: Configure<GcloudFunctionsDescribeSettings>): Promise<CommandOutput>
    Describe a Cloud Function: `gcloud functions describe`.
  secretsAccess(configure?: Configure<GcloudSecretsVersionsAccessSettings>): Promise<CommandOutput>
    Read a secret version: `gcloud secrets versions access`.
  secretValue(configure?: Configure<GcloudSecretsVersionsAccessSettings>): Promise<string>
    A secret version's payload, read back as a string.
  loggingRead(configure?: Configure<GcloudLoggingReadSettings>): Promise<CommandOutput>
    Read log entries: `gcloud logging read`. What it reads is printed, as
    gcloud prints it — into the build log unless `.quiet()` is set, and log
    entries can carry secrets.
  logEntryCount(configure?: Configure<GcloudLoggingEntryCountSettings>): Promise<number>
    How many log entries a `gcloud logging read` filter matches, counting at
    most `.limit(n)` (default 1000) and failing when more match. Reads only
    each entry's id, quietly, so no payload reaches the build.
  loggingLogsList(configure?: Configure<GcloudLoggingLogsListSettings>): Promise<CommandOutput>
    List the logs that hold entries: `gcloud logging logs list`.
  monitoringPoliciesList(configure?: Configure<GcloudMonitoringPoliciesListSettings>): Promise<CommandOutput>
    List alerting policies: `gcloud monitoring policies list`.
  monitoringPoliciesDescribe(configure?: Configure<GcloudMonitoringPoliciesDescribeSettings>): Promise<CommandOutput>
    Describe an alerting policy: `gcloud monitoring policies describe`.
  monitoringDashboardsList(configure?: Configure<GcloudMonitoringDashboardsListSettings>): Promise<CommandOutput>
    List dashboards: `gcloud monitoring dashboards list`.
  monitoringUptimeListConfigs(configure?: Configure<GcloudMonitoringUptimeListConfigsSettings>): Promise<CommandOutput>
    List uptime checks and synthetic monitors:
    `gcloud monitoring uptime list-configs`.

interface GcpRestOptions
  Common options for a Google REST call: the bearer token and an injectable `fetch`.

  token: string
    The OAuth access token (see {@link "./auth.ts".gcloudAccessToken}).
  fetch?: typeof fetch
    The `fetch` implementation; defaults to the global. Overridable for tests.

interface GcsListOptions extends GcsOptions
  Options for {@link GcsTasksApi.list}: the auth/transport plus an object-name prefix.

  prefix?: string
    Keep only objects whose name starts with this prefix.

interface GcsOptions
  Auth + transport options common to every {@link GcsTasks} call.

  token?: string
    A pre-resolved OAuth token; when omitted, {@link tokenProvider} supplies one.
  tokenProvider?: AccessTokenProvider
    Resolves the token when `token` is omitted (default: {@link "./auth.ts".gcloudAccessToken}).
  fetch?: typeof fetch
    The `fetch` implementation; defaults to the global. Overridable for tests.

interface GcsTasksApi
  The shape of {@link GcsTasks}.

  readJson(bucket: string, object: string, options?: GcsOptions): Promise<T>
    Read object `object` from `bucket` and parse its body as JSON.
  writeJson(bucket: string, object: string, data: unknown, options?: GcsOptions): Promise<void>
    Write `data` (JSON-serialised) as object `object` in `bucket`.
  list(bucket: string, options?: GcsListOptions): Promise<string[]>
    List object names in `bucket` (optionally filtered by `prefix`).

interface SecretManagerAccessOptions extends SecretManagerOptions
  Options for {@link SecretManagerTasksApi.access}: the common options plus a version.

  version?: string
    The version to access; defaults to `"latest"`.

interface SecretManagerOptions
  Auth + transport + project options common to every {@link SecretManagerTasks} call.

  project?: string
    The Google Cloud project id; when omitted, resolved from the environment.
  token?: string
    A pre-resolved OAuth token; when omitted, {@link tokenProvider} supplies one.
  tokenProvider?: AccessTokenProvider
    Resolves the token when `token` is omitted (default: {@link "./auth.ts".gcloudAccessToken}).
  fetch?: typeof fetch
    The `fetch` implementation; defaults to the global. Overridable for tests.
  readEnv?: (name: string) => string | undefined
    Reads an environment variable for project resolution; defaults to `Deno.env.get`.

interface SecretManagerTasksApi
  The shape of {@link SecretManagerTasks}.

  access(name: string, options?: SecretManagerAccessOptions): Promise<string>
    Access secret `name`'s payload as a string (version defaults to `"latest"`).
  addVersion(name: string, value: string, options?: SecretManagerOptions): Promise<string>
    Add a new version holding `value` to secret `name`, creating the secret
    first if it does not exist (an already-exists `409` is ignored) — the
    write-before-create idempotency a deploy relies on. Returns the new version's
    resource name.

type AccessTokenProvider = () => Promise<string>
  Supplies a Google Cloud OAuth access token for a REST call.

type CloudMonitoringAggregate = "latest" | "sum" | "average" | "maximum" | "minimum"
  How {@link CloudMonitoringMetricValueSettings} turns the points into one
  number: the newest, or the sum, average, maximum or minimum of all of them.

type CloudMonitoringAligner = "ALIGN_NONE" | "ALIGN_DELTA" | "ALIGN_RATE" | "ALIGN_INTERPOLATE" | "ALIGN_NEXT_OLDER" | "ALIGN_MIN" | "ALIGN_MAX" | "ALIGN_MEAN" | "ALIGN_COUNT" | "ALIGN_SUM" | "ALIGN_STDDEV" | "ALIGN_COUNT_TRUE" | "ALIGN_COUNT_FALSE" | "ALIGN_FRACTION_TRUE" | "ALIGN_PERCENTILE_99" | "ALIGN_PERCENTILE_95" | "ALIGN_PERCENTILE_50" | "ALIGN_PERCENTILE_05" | "ALIGN_PERCENT_CHANGE"
  How each series' points are aligned into one value per alignment period
  (`aggregation.perSeriesAligner`).

type CloudMonitoringReducer = "REDUCE_NONE" | "REDUCE_MEAN" | "REDUCE_MIN" | "REDUCE_MAX" | "REDUCE_SUM" | "REDUCE_STDDEV" | "REDUCE_COUNT" | "REDUCE_COUNT_TRUE" | "REDUCE_COUNT_FALSE" | "REDUCE_FRACTION_TRUE" | "REDUCE_PERCENTILE_99" | "REDUCE_PERCENTILE_95" | "REDUCE_PERCENTILE_50" | "REDUCE_PERCENTILE_05"
  How aligned series are combined into fewer (`aggregation.crossSeriesReducer`).

type CloudMonitoringValue = { kind: "double"; value: number; } | { kind: "int64"; value: number; raw: string; } | { kind: "bool"; value: boolean; } | { kind: "string"; value: string; } | { kind: "distribution"; count: number; mean: number; }
  One point's value, by the metric's value type. A 64-bit integer is
  returned as a `number` — exact up to 2^53, beyond which it rounds — with
  the decimal string it arrived as beside it.

type CloudMonitoringView = "FULL" | "HEADERS"
  How much of each series the API returns: its points, or only its labels.

type GcloudLogSeverity = "DEFAULT" | "DEBUG" | "INFO" | "NOTICE" | "WARNING" | "ERROR" | "CRITICAL" | "ALERT" | "EMERGENCY"
  A Cloud Logging severity, lowest to highest.

type GcloudLogTime = Date | string
  A time a log filter compares `timestamp` with.

type GcloudRunner = (configure?: Configure<GcloudSettings>) => Promise<CommandOutput>
  Runs a `gcloud` command — the seam {@link gcloudAccessToken} resolves the
  token through. Defaults to {@link "./gcloud.ts".GcloudTasks} `.run`; injectable
  so the default provider is unit-testable without invoking `gcloud`.

type GcloudSettingsRunner = (settings: GcloudSettings) => Promise<CommandOutput>
  Runs one prepared `gcloud` command and returns what the process produced.
  The default spawns gcloud; a test, or a build that executes gcloud some
  other way, injects its own with {@link GcloudSettings.runner}. The runner
  only produces the output: the exit code is judged afterwards exactly as for
  a spawned process, so a non-zero `code` still raises a `CommandError`
  unless the settings say `.noThrow()`.
````

</details>

<!-- ZUKE:API:END -->
