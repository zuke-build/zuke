# @zuke/prometheus

A typed client for the
[Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/),
for [Zuke](https://github.com/zuke-build/zuke#readme) builds. Read a metric to
gate a release, check a target is up before a smoke test, or list the alerts
firing after a deploy — without hand-rolling the HTTP call, the auth header, the
error envelope or the result shape.

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { PrometheusTasks } from "@zuke/prometheus";

class Release extends Build {
  token = parameter("Prometheus token").secret().required();

  gate = target()
    .description("Fail when the 5xx ratio is above 1 %")
    .executes(async () => {
      const result = await PrometheusTasks.query((s) =>
        s.url("https://prometheus.internal").bearerToken(this.token.value)
          .query(
            'sum(rate(http_requests_total{code=~"5.."}[5m])) / ' +
              "sum(rate(http_requests_total[5m]))",
          )
      );
      const ratio = PrometheusTasks.value(result);
      if (!(ratio <= 0.01)) throw new Error(`5xx ratio is ${ratio}`);
    });
}

await run(Release);
```

## Tasks

One method per endpoint, each taking a settings lambda that sets the connection
and the call's own parameters (named as the API names them):

| Task          | Endpoint                            | Answers                                   |
| ------------- | ----------------------------------- | ----------------------------------------- |
| `query`       | `/api/v1/query`                     | vector, matrix, scalar or string          |
| `queryRange`  | `/api/v1/query_range`               | matrix                                    |
| `series`      | `/api/v1/series`                    | label sets                                |
| `labels`      | `/api/v1/labels`                    | label names                               |
| `labelValues` | `/api/v1/label/<label_name>/values` | label values                              |
| `metadata`    | `/api/v1/metadata`                  | metadata by metric                        |
| `targets`     | `/api/v1/targets`                   | active and dropped targets                |
| `rules`       | `/api/v1/rules`                     | rule groups, alerting and recording rules |
| `alerts`      | `/api/v1/alerts`                    | active alerts                             |
| `buildInfo`   | `/api/v1/status/buildinfo`          | the server's version                      |
| `healthy`     | `/-/healthy`                        | `true` on 2xx, `false` on 503             |
| `ready`       | `/-/ready`                          | `true` on 2xx, `false` on 503             |
| `value`       | — (reader)                          | the one number an instant query returned  |
| `samples`     | — (reader)                          | every float sample, with its labels       |

`query`, `queryRange`, `series` and `labels` are sent as a `POST` form, which
the API accepts so a long PromQL expression is not bound by a URL length limit;
`httpMethod("GET")` sends them in the URL for a proxy that only passes `GET`.

Every answer carries the envelope's `warnings` and `infos`. Sample values are
numbers — `"NaN"`, `"+Inf"` and `"-Inf"` included — and native histograms are
typed (`histogram` on a vector sample, `histograms` on a matrix series). The
readers take float samples only and refuse a histogram by name: reduce it in the
query with `histogram_quantile(...)` or `histogram_count(...)`.

## Connection and authentication

- `url(...)` — the base URL; a path or query string it carries (a proxy prefix,
  a tenant parameter) is kept. It must be `https:` unless it is loopback, or
  `ZUKE_ALLOW_INSECURE_URL` is set. Userinfo in it is sent as basic auth.
- `bearerToken(...)`, `basicAuth(...)`, `header(...)` — the built-in
  credentials.
- `credentials(source)` — any function handed the outgoing request (method, full
  URL, headers so far, exact body bytes) and the connection's seams (`readEnv`,
  `readTextFile`, `now`, `fetch`, `signal`), returning the headers to add. This
  is the extension point for a request signer or a token source with its own
  cache.
- `requestTimeout(...)`, `maxResponseBytes(...)`, `signal(...)`, `fetch(...)`.

Redirects are not followed: one could lead to a plaintext URL the `https:` rule
never saw, with the credential attached.

## Errors

A refusal — a non-2xx status, or an envelope with `status: "error"` — is a
`PrometheusApiError` carrying `status`, Prometheus's `errorType` and the message
as `detail`. No usable answer — a network failure, a timeout, an answer over the
size cap, a body that is not a Prometheus envelope — is a
`PrometheusRequestError`. Neither ever carries a credential: every header a
credential source added (eight characters or longer) is masked, and every URL
loses its userinfo and credential-bearing parameters.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
A typed client for the Prometheus HTTP API, for Zuke builds. `PrometheusTasks`
has one method per endpoint — instant and range queries, series, labels,
metadata, targets, rules, alerts, build information and the health probes —
each configured by a settings lambda, and readers that turn a query result
into a plain number for a gate:

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { PrometheusTasks } from "@zuke/prometheus";

class Release extends Build {
  token = parameter("Prometheus token").secret().required();
  gate = target().executes(async () => {
    const result = await PrometheusTasks.query((s) =>
      s.url("https://prometheus.internal").bearerToken(this.token.value)
        .query('sum(rate(http_requests_total{code=~"5.."}[5m])) or vector(0)')
    );
    const errors = PrometheusTasks.value(result);
    if (errors > 0.01) throw new Error(`error rate ${errors} is too high`);
  });
}

await run(Release);
```

Sample values arrive as numbers (`NaN` and the infinities included), native
histograms are typed, and Prometheus's `warnings` and `infos` come back with
every result. A refusal is a {@link PrometheusApiError} carrying the status
and `errorType`; no answer at all is a {@link PrometheusRequestError}; and
neither ever carries a credential. Authentication is pluggable through
{@link PrometheusCredentials}: bearer, basic, a header, or any function of
the outgoing request.
@module

const PrometheusTasks: PrometheusTasksApi
  The Prometheus HTTP API as tasks
  (https://prometheus.io/docs/prometheus/latest/querying/api/).

class PrometheusApiError extends Error
  Prometheus, or an HTTP layer in front of it, refused the call: a non-2xx
  status, or an envelope whose `status` is `"error"`.

  ```ts
  try {
    await PrometheusTasks.query((s) => s.url(url).query("rate(x[5m]"));
  } catch (error) {
    if (error instanceof PrometheusApiError && error.errorType === "bad_data") {
      // the expression did not parse
    }
  }
  ```

  constructor(method: string, path: string, status: number, errorType: string | undefined, detail: string | undefined)
    Build the error from the failing call and what the server said.
  override name: string
    The error name.
  readonly method: string
    The HTTP method of the failing call.
  readonly path: string
    The endpoint path, such as `/api/v1/query` (never the base URL).
  readonly status: number
    The HTTP status of the answer.
  readonly errorType: string | undefined
    Prometheus's `errorType` (`bad_data`, `execution`, `timeout`, …), when sent.
  readonly detail: string | undefined
    What went wrong: the envelope's `error` text, or — for an answer that was
    not a Prometheus envelope, such as a gateway's error page — the start of
    the body. Scrubbed of credentials and capped in length.

class PrometheusConnectionSettings
  The connection half of every Prometheus call's settings.

  url_?: string
    The Prometheus base URL (set by {@link url}).
  readonly credentials_: PrometheusCredentials[]
    The credential sources, in the order they run (set by the auth setters).
  requestTimeout_: number
    The client-side timeout in ms (set by {@link requestTimeout}).
  maxResponseBytes_: number
    The response size cap in bytes (set by {@link maxResponseBytes}).
  signal_?: AbortSignal
    A caller's signal that cancels the call (set by {@link signal}).
  fetch_: typeof fetch
    The `fetch` to use (set by {@link fetch}); the global one by default.
  readEnv_: (name: string) => string | undefined
    The environment reader (set by {@link readEnv}).
  readTextFile_: (path: string) => Promise<string>
    The text-file reader credential sources use (set by {@link readTextFile}).
  now_: () => number
    The clock, in epoch ms (set by {@link now}).
  url(url: string): this
    The Prometheus base URL, such as `https://prometheus.internal`. A path or
    query string it carries — a proxy prefix, a tenant parameter — is kept,
    and the endpoint path is appended. It must be `https:` unless it is
    loopback, or `ZUKE_ALLOW_INSECURE_URL` is set: the answers decide whether
    a release proceeds, and a plaintext request lets anyone on the path both
    read the credential and choose the answer. Userinfo in the URL
    (`https://user:pass@host`) is taken off the URL and sent as basic auth.
  bearerToken(token: string): this
    Authenticate with `Authorization: Bearer <token>`.
  basicAuth(username: string, password: string): this
    Authenticate with HTTP basic auth (`Authorization: Basic …`).
  header(name: string, value: string): this
    Send a fixed header, such as a tenant id (`X-Scope-OrgID`) or an API key.
    Its value is masked in errors like any credential (when eight or more
    characters long).
  credentials(source: PrometheusCredentials): this
    Add a credential source: a function handed the outgoing request — method,
    full URL, headers so far, body bytes — and the connection's seams, that
    returns the headers to add. Sources run in the order configured, so put a
    request signer last.

    ```ts
    s.credentials(async (_request, { readTextFile }) => ({
      authorization: `Bearer ${(await readTextFile("/run/secrets/prom")).trim()}`,
    }))
    ```
  requestTimeout(duration: string | number): this
    How long the call may take, end to end (`"10s"`, or ms; default 30 s).
    Client-side: the query's own `timeout` parameter is separate.
  maxResponseBytes(bytes: number): this
    The largest response body to read, in bytes (default 64 MiB). A larger
    one fails the call rather than being buffered whole.
  signal(signal: AbortSignal): this
    A signal that cancels the call — a run's or a bake's own.
  fetch(fetcher: typeof fetch): this
    The `fetch` to use — the seam a test answers calls through.
  readEnv(reader: (name: string) => string | undefined): this
    The environment reader: consulted for `ZUKE_ALLOW_INSECURE_URL` and handed
    to credential sources.
  readTextFile(reader: (path: string) => Promise<string>): this
    The text-file reader handed to credential sources.
  now(clock: () => number): this
    The clock handed to credential sources, in epoch milliseconds.

class PrometheusExpressionSettings extends PrometheusConnectionSettings
  What an instant and a range query share: the expression and its limits.

  query_?: string
    The PromQL expression (set by {@link query}).
  timeout_?: string
    The evaluation timeout parameter (set by {@link timeout}).
  limit_?: string
    The series limit parameter (set by {@link limit}).
  lookbackDelta_?: string
    The lookback-delta parameter (set by {@link lookbackDelta}).
  httpMethod_: PrometheusHttpMethod
    The HTTP method (set by {@link httpMethod}); `POST` by default.
  query(promql: string): this
    The PromQL expression (`query`).
  timeout(duration: PrometheusDuration): this
    The evaluation timeout (`timeout`), such as `"30s"` — capped by the
    server's `-query.timeout`. The client-side limit is `requestTimeout`.
  limit(series: number): this
    The most series to return (`limit`); `0` means no limit.
  lookbackDelta(duration: PrometheusDuration): this
    Override the lookback period for this query (`lookback_delta`).
  httpMethod(method: PrometheusHttpMethod): this
    Send the parameters as a `POST` form (the default) or in a `GET` URL.

class PrometheusLabelValuesSettings extends PrometheusSelectionSettings
  Settings for one label's values (`/api/v1/label/<label_name>/values`).

  labelName_?: string
    The label whose values to list (set by {@link labelName}).
  labelName(name: string): this
    The label whose values to list. Any name is accepted: one outside the
    classic `[a-zA-Z_:][a-zA-Z0-9_:]*` form (a UTF-8 name such as
    `http.status_code`) is sent in the API's `U__` value-encoding escape, so
    nothing in the name can reach the URL path as a separator.

class PrometheusLabelsSettings extends PrometheusSelectionSettings
  Settings for listing label names (`/api/v1/labels`).

  httpMethod_: PrometheusHttpMethod
    The HTTP method (set by {@link httpMethod}); `POST` by default.
  httpMethod(method: PrometheusHttpMethod): this
    Send the parameters as a `POST` form (the default) or in a `GET` URL.

class PrometheusMetadataSettings extends PrometheusConnectionSettings
  Settings for metric metadata (`/api/v1/metadata`).

  limit_?: string
    The metric limit (set by {@link limit}).
  limitPerMetric_?: string
    The per-metric limit (set by {@link limitPerMetric}).
  metric_?: string
    The metric to filter for (set by {@link metric}).
  limit(metrics: number): this
    The most metrics to return (`limit`).
  limitPerMetric(entries: number): this
    The most metadata entries per metric (`limit_per_metric`).
  metric(name: string): this
    Only this metric's metadata (`metric`).

class PrometheusQueryRangeSettings extends PrometheusExpressionSettings
  Settings for a range query (`/api/v1/query_range`).

  start_?: string
    The range's start (set by {@link start}).
  end_?: string
    The range's end (set by {@link end}).
  step_?: string
    The resolution step (set by {@link step}).
  start(time: PrometheusTime): this
    The inclusive start (`start`): a `Date`, Unix seconds, or RFC 3339 text.
  end(time: PrometheusTime): this
    The inclusive end (`end`): a `Date`, Unix seconds, or RFC 3339 text.
  step(duration: PrometheusDuration): this
    The resolution step (`step`): `"15s"`, or a number of seconds.

class PrometheusQuerySettings extends PrometheusExpressionSettings
  Settings for an instant query (`/api/v1/query`).

  time_?: string
    The evaluation time (set by {@link time}); the server's now when unset.
  time(time: PrometheusTime): this
    The evaluation time (`time`): a `Date`, Unix seconds, or RFC 3339 text.

class PrometheusRequestError extends Error
  A Prometheus call produced no usable answer: the request could not be sent
  or timed out, a credential source failed, or the answer was too large, not
  JSON, or not shaped as the API reference describes.

  constructor(method: string, path: string, status: number | undefined, reason: string)
    Build the error from the failing call and the (scrubbed) reason.
  override name: string
    The error name.
  readonly method: string
    The HTTP method of the failing call.
  readonly path: string
    The endpoint path, such as `/api/v1/query` (never the base URL).
  readonly status: number | undefined
    The HTTP status, when an answer arrived; `undefined` when none did.

class PrometheusRulesSettings extends PrometheusConnectionSettings
  Settings for the loaded rules (`/api/v1/rules`).

  type_?: PrometheusRuleType
    The `type` filter (set by {@link type}).
  readonly ruleName_: string[]
    Rule names to keep (set by {@link ruleName}), as `rule_name[]`.
  readonly ruleGroup_: string[]
    Rule groups to keep (set by {@link ruleGroup}), as `rule_group[]`.
  readonly file_: string[]
    Rule files to keep (set by {@link file}), as `file[]`.
  readonly match_: string[]
    Label selectors rules must match (set by {@link match}), as `match[]`.
  excludeAlerts_: boolean
    Whether to leave out active alerts (set by {@link excludeAlerts}).
  groupLimit_?: string
    The group page size (set by {@link groupLimit}).
  groupNextToken_?: string
    The pagination token (set by {@link groupNextToken}).
  type(type: PrometheusRuleType): this
    Only alerting (`"alert"`) or only recording (`"record"`) rules (`type`).
  ruleName(...names: string[]): this
    Only rules with these names (`rule_name[]`).
  ruleGroup(...groups: string[]): this
    Only rules in these groups (`rule_group[]`).
  file(...paths: string[]): this
    Only rules from these files (`file[]`).
  match(...selectors: string[]): this
    Only rules whose configured labels match these selectors (`match[]`).
  excludeAlerts(on: boolean): this
    Leave out each rule's active alerts (`exclude_alerts=true`).
  groupLimit(groups: number): this
    At most this many rule groups per page (`group_limit`).
  groupNextToken(token: string): this
    Continue from a previous page's `groupNextToken` (`group_next_token`).

class PrometheusSelectionSettings extends PrometheusConnectionSettings
  What the series, label-name and label-value endpoints share.

  readonly match_: string[]
    The series selectors (set by {@link match}), sent as repeated `match[]`.
  start_?: string
    The start time (set by {@link start}).
  end_?: string
    The end time (set by {@link end}).
  limit_?: string
    The result limit (set by {@link limit}).
  match(...selectors: string[]): this
    Add series selectors (`match[]`), such as `up` or `{job="api"}`.
  start(time: PrometheusTime): this
    The start time (`start`): a `Date`, Unix seconds, or RFC 3339 text.
  end(time: PrometheusTime): this
    The end time (`end`): a `Date`, Unix seconds, or RFC 3339 text.
  limit(count: number): this
    The most results to return (`limit`); `0` means no limit.

class PrometheusSeriesSettings extends PrometheusSelectionSettings
  Settings for finding series by matchers (`/api/v1/series`).

  httpMethod_: PrometheusHttpMethod
    The HTTP method (set by {@link httpMethod}); `POST` by default.
  httpMethod(method: PrometheusHttpMethod): this
    Send the parameters as a `POST` form (the default) or in a `GET` URL.

class PrometheusTargetsSettings extends PrometheusConnectionSettings
  Settings for the target overview (`/api/v1/targets`).

  state_?: PrometheusTargetState
    The `state` filter (set by {@link state}).
  state(state: PrometheusTargetState): this
    Only active or only dropped targets (`state`); both by default.

interface PrometheusActiveTarget
  A target Prometheus is scraping.

  readonly discoveredLabels: PrometheusLabels
    The labels service discovery found, before relabelling.
  readonly labels: PrometheusLabels
    The labels after relabelling.
  readonly scrapePool: string
    The scrape pool (the job) the target belongs to.
  readonly scrapeUrl: string
    The URL scraped.
  readonly globalUrl?: string
    The URL as seen from outside, when the server reports it.
  readonly lastError?: string
    The last scrape's error, `""` when it succeeded.
  readonly lastScrape?: string
    When the last scrape happened (RFC 3339).
  readonly lastScrapeDuration?: number
    How long the last scrape took, in seconds.
  readonly health: string
    `up`, `down` or `unknown`.
  readonly scrapeInterval?: string
    The scrape interval, such as `"1m"`.
  readonly scrapeTimeout?: string
    The scrape timeout, such as `"10s"`.

interface PrometheusAlert
  An alert, active or pending, as the rules and alerts endpoints report it.

  readonly labels: PrometheusLabels
    The alert's labels, `alertname` among them.
  readonly annotations: PrometheusLabels
    The alert's annotations.
  readonly state: string
    `firing` or `pending` (or `inactive` where a server reports it).
  readonly activeAt?: string
    When the alert became active (RFC 3339).
  readonly value: number
    The expression's value when the alert last evaluated.
  readonly keepFiringSince?: string
    Until when it keeps firing after resolving, if `keep_firing_for` is set.

interface PrometheusAlertingRule extends PrometheusRuleFields
  An alerting rule.

  readonly type: "alerting"
    The rule kind.
  readonly duration: number
    The `for` duration, in seconds.
  readonly annotations: PrometheusLabels
    The rule's annotations.
  readonly alerts?: readonly PrometheusAlert[]
    The rule's active alerts; absent when `excludeAlerts` was set.
  readonly state?: string
    The rule's state: `firing`, `pending` or `inactive`.

interface PrometheusAlerts
  The active alerts.

  readonly alerts: readonly PrometheusAlert[]
    Every active alert.

interface PrometheusBuildInfo
  The server's build information. `version` is always present; the API notes
  the other properties may change between versions, so they are optional.

  readonly version: string
    The Prometheus version, such as `"3.5.0"`.
  readonly revision?: string
    The VCS revision it was built from.
  readonly branch?: string
    The branch it was built from.
  readonly buildUser?: string
    Who built it.
  readonly buildDate?: string
    When it was built.
  readonly goVersion?: string
    The Go version it was built with.

interface PrometheusCredentialsContext
  The seams a credential source reads the outside world through, so a source
  that reads an environment variable, a key file, the clock or a token
  endpoint is testable without any of them. Each is set on the connection
  settings (`readEnv`, `readTextFile`, `now`, `fetch`).

  readonly readEnv: (name: string) => string | undefined
    Read an environment variable; `undefined` when unset or not permitted.
  readonly readTextFile: (path: string) => Promise<string>
    Read a text file — a mounted token, a key, a credentials file.
  readonly now: () => number
    The current time in epoch milliseconds, for signing and token expiry.
  readonly fetch: typeof fetch
    The `fetch` the call itself uses, for a source that exchanges tokens.
  readonly signal: AbortSignal
    Aborts when the call times out or the caller's signal fires.

interface PrometheusDroppedTarget
  A target relabelling dropped.

  readonly discoveredLabels: PrometheusLabels
    The labels service discovery found.
  readonly scrapePool?: string
    The scrape pool, when the server reports it.

interface PrometheusFloatSample
  An instant-vector element whose sample is a float (the API's `value` key).

  readonly metric: PrometheusLabels
    The series' labels.
  readonly timestamp: number
    The sample's time, in Unix seconds (fractional).
  readonly value: number
    The sample value; `NaN`, `Infinity` and `-Infinity` are kept as such.

interface PrometheusHistogram
  A native histogram value, the API's `<histogram>` placeholder.

  readonly count: number
    The count of observations.
  readonly sum: number
    The sum of observations.
  readonly buckets: readonly PrometheusHistogramBucket[]
    The populated buckets; empty when the server sent none.

interface PrometheusHistogramBucket
  One bucket of a native histogram: `[<boundary_rule>, "<left>", "<right>", "<count>"]`.

  readonly boundaryRule: 0 | 1 | 2 | 3
    Which boundaries are inclusive: `0` open left, `1` open right, `2` open
    both, `3` closed both — the API's `<boundary_rule>`.
  readonly lower: number
    The bucket's left boundary.
  readonly upper: number
    The bucket's right boundary.
  readonly count: number
    The number of observations in the bucket.

interface PrometheusHistogramPoint
  One native-histogram sample at a point in time: `[<unix_time>, <histogram>]`.

  readonly timestamp: number
    The sample's time, in Unix seconds (fractional).
  readonly histogram: PrometheusHistogram
    The histogram.

interface PrometheusHistogramSample
  An instant-vector element whose sample is a native histogram (`histogram`).

  readonly metric: PrometheusLabels
    The series' labels.
  readonly timestamp: number
    The sample's time, in Unix seconds (fractional).
  readonly histogram: PrometheusHistogram
    The histogram.

interface PrometheusMatrix
  A range vector: `resultType: "matrix"`.

  readonly resultType: "matrix"
    The result type.
  readonly result: readonly PrometheusSeries[]
    One entry per series.

interface PrometheusMetricMetadata
  One metadata entry for a metric, as scraped from a target.

  readonly type: string
    The metric type: `counter`, `gauge`, `histogram`, `summary`, `unknown`, …
  readonly help: string
    The `# HELP` text.
  readonly unit: string
    The unit, or `""`.

interface PrometheusOutgoingRequest
  The outgoing request a {@link PrometheusCredentials} source authenticates —
  exactly what will be sent, so a signature computed over it verifies.

  readonly method: "GET" | "POST"
    The HTTP method: `GET`, or `POST` for a form-encoded call.
  readonly url: string
    The absolute URL, including the query string: the base URL's own path and
    parameters, the endpoint path, and — on a `GET` — the call's parameters,
    percent-encoded as sent.
  readonly headers: PrometheusHeaders
    The headers set so far, with lower-case names: the transport's own
    (`accept`, and `content-type` on a `POST`) plus whatever the sources
    configured before this one added. A source may only add headers — naming
    one already present fails the call — so a signer configured last signs
    every header that is sent.
  readonly body: Uint8Array
    The exact body bytes — the `application/x-www-form-urlencoded` form on a
    `POST`, empty on a `GET`. A copy: changing it changes nothing that is sent.

interface PrometheusPoint
  One float sample at a point in time: a `[<unix_time>, "<value>"]` pair.

  readonly timestamp: number
    The sample's time, in Unix seconds (fractional).
  readonly value: number
    The sample value; `NaN`, `Infinity` and `-Infinity` are kept as such.

interface PrometheusRecordingRule extends PrometheusRuleFields
  A recording rule.

  readonly type: "recording"
    The rule kind.

interface PrometheusResponse<T>
  A successful API answer: the endpoint's typed `data`, plus the `warnings`
  and `infos` annotations Prometheus attaches to a result it still returned.

  Both arrays are always present — empty when the server sent none — so a gate
  can fail on `warnings.length > 0` without first checking for the key.

  readonly data: T
    The endpoint's `data`, parsed into its typed shape.
  readonly warnings: readonly string[]
    Problems that did not stop the request (`warnings` in the envelope).
  readonly infos: readonly string[]
    Info-level annotations about possible query issues (`infos`).

interface PrometheusRuleFields
  Fields every rule carries.

  readonly name: string
    The rule's name: the alert name or the recorded series.
  readonly query: string
    The PromQL expression.
  readonly labels: PrometheusLabels
    The rule's configured labels.
  readonly health: string
    `ok`, `err` or `unknown`.
  readonly lastError?: string
    The last evaluation's error, when it failed.
  readonly evaluationTime?: number
    How long the last evaluation took, in seconds.
  readonly lastEvaluation?: string
    When the rule last evaluated (RFC 3339).

interface PrometheusRuleGroup
  A rule group.

  readonly name: string
    The group's name.
  readonly file: string
    The file it was loaded from.
  readonly interval: number
    The evaluation interval, in seconds.
  readonly rules: readonly PrometheusRule[]
    The group's rules.
  readonly limit?: number
    The group's alert/series limit, when the server reports it.
  readonly evaluationTime?: number
    How long the group's last evaluation took, in seconds.
  readonly lastEvaluation?: string
    When the group last evaluated (RFC 3339).

interface PrometheusRules
  The loaded rules.

  readonly groups: readonly PrometheusRuleGroup[]
    The rule groups.
  readonly groupNextToken?: string
    The token for the next page, when `groupLimit` cut the list short.

interface PrometheusScalar
  A scalar: `resultType: "scalar"`.

  readonly resultType: "scalar"
    The result type.
  readonly result: PrometheusPoint
    The scalar and the time it was evaluated at.

interface PrometheusSeries
  One series of a range vector. The API gives a series `values`, `histograms`,
  or both; whichever is absent is an empty array here.

  readonly metric: PrometheusLabels
    The series' labels.
  readonly values: readonly PrometheusPoint[]
    The float samples, in time order.
  readonly histograms: readonly PrometheusHistogramPoint[]
    The native-histogram samples, in time order.

interface PrometheusStringResult
  A string: `resultType: "string"`.

  readonly resultType: "string"
    The result type.
  readonly result: { readonly timestamp: number; readonly value: string; }
    The string and the time it was evaluated at.

interface PrometheusTargets
  The target overview: active and dropped targets.

  readonly activeTargets: readonly PrometheusActiveTarget[]
    The targets being scraped.
  readonly droppedTargets: readonly PrometheusDroppedTarget[]
    The targets relabelling dropped (subject to `keep_dropped_targets`).

interface PrometheusTasksApi
  The operations {@link PrometheusTasks} exposes.

  query(configure: Configure<PrometheusQuerySettings>): Promise<PrometheusResponse<PrometheusQueryData>>
    Evaluate an instant query (`/api/v1/query`).

    ```ts
    const result = await PrometheusTasks.query((s) =>
      s.url("https://prometheus.internal").bearerToken(token)
        .query('sum(rate(http_requests_total{code=~"5.."}[5m]))')
    );
    ```
  queryRange(configure: Configure<PrometheusQueryRangeSettings>): Promise<PrometheusResponse<PrometheusMatrix>>
    Evaluate a range query (`/api/v1/query_range`); the answer is a matrix.
  series(configure: Configure<PrometheusSeriesSettings>): Promise<PrometheusResponse<PrometheusLabels[]>>
    Find the series matching selectors (`/api/v1/series`).
  labels(configure: Configure<PrometheusLabelsSettings>): Promise<PrometheusResponse<string[]>>
    List label names (`/api/v1/labels`).
  labelValues(configure: Configure<PrometheusLabelValuesSettings>): Promise<PrometheusResponse<string[]>>
    List one label's values (`/api/v1/label/<label_name>/values`).
  metadata(configure: Configure<PrometheusMetadataSettings>): Promise<PrometheusResponse<Readonly<Record<string, readonly PrometheusMetricMetadata[]>>>>
    Read metric metadata (`/api/v1/metadata`), keyed by metric name.
  targets(configure: Configure<PrometheusTargetsSettings>): Promise<PrometheusResponse<PrometheusTargets>>
    Read target discovery state (`/api/v1/targets`).
  rules(configure: Configure<PrometheusRulesSettings>): Promise<PrometheusResponse<PrometheusRules>>
    Read the loaded alerting and recording rules (`/api/v1/rules`).
  alerts(configure: Configure<PrometheusConnectionSettings>): Promise<PrometheusResponse<PrometheusAlerts>>
    Read the active alerts (`/api/v1/alerts`).
  buildInfo(configure: Configure<PrometheusConnectionSettings>): Promise<PrometheusResponse<PrometheusBuildInfo>>
    Read the server's build information (`/api/v1/status/buildinfo`).
  healthy(configure: Configure<PrometheusConnectionSettings>): Promise<boolean>
    Probe `/-/healthy`: `true` on 2xx, `false` on 503, and a
    `PrometheusApiError` on any other status — a 401 is a credential
    problem, not an unhealthy server.
  ready(configure: Configure<PrometheusConnectionSettings>): Promise<boolean>
    Probe `/-/ready`: `true` once the server serves queries, `false` while it
    answers 503, and a `PrometheusApiError` on any other status.
  value(response: PrometheusResponse<PrometheusQueryData>): number
    The single number an instant query returned — a scalar, or a vector of
    exactly one float sample — failing clearly on an empty or multi-sample
    vector, a matrix, a string or a native histogram.

    ```ts
    const ratio = PrometheusTasks.value(await PrometheusTasks.query((s) => …));
    ```
  samples(response: PrometheusResponse<PrometheusQueryData>): PrometheusFloatSample[]
    Every float sample of an instant query, with its labels: a vector's
    elements, or a scalar as one unlabelled sample. An empty vector is an
    empty list; a matrix, string or native histogram fails.

interface PrometheusVector
  An instant vector: `resultType: "vector"`.

  readonly resultType: "vector"
    The result type.
  readonly result: readonly PrometheusVectorSample[]
    One element per series.

type PrometheusCredentials = (request: PrometheusOutgoingRequest, context: PrometheusCredentialsContext) => PrometheusHeaders | Promise<PrometheusHeaders>
  A credential source: given the outgoing request and the context's seams,
  return the headers that authenticate it.

  Sources run in the order they were configured, each seeing the headers the
  earlier ones added, and may not replace a header that is already present.
  Every returned value is treated as a secret and masked in errors (values
  shorter than eight characters excepted — see {@link registerSecrets}). A
  source that throws fails the call with a
  {@link "./errors.ts".PrometheusRequestError} whose message is scrubbed the
  same way. A source that caches (a token until its expiry) keeps that state
  in its own closure; it is called once per request.

type PrometheusDuration = string | number
  A duration an API parameter accepts: Prometheus duration text such as
  `"5m"`, or a number of seconds (the API's float form).

type PrometheusHeaders = Readonly<Record<string, string>>
  Header names to values, as a credential source returns them.

type PrometheusHttpMethod = "GET" | "POST"
  The HTTP method for an endpoint the API serves on both `GET` and `POST`.

type PrometheusLabels = Readonly<Record<string, string>>
  A label set: label name to label value, as the API's `metric` object.

type PrometheusQueryData = PrometheusVector | PrometheusMatrix | PrometheusScalar | PrometheusStringResult
  The `data` of an expression query, discriminated on `resultType` exactly as
  the API sends it.

type PrometheusRule = PrometheusAlertingRule | PrometheusRecordingRule
  A rule, discriminated on `type`.

type PrometheusRuleType = "alert" | "record"
  The rule kinds `/api/v1/rules` filters on: the API's `type` parameter.

type PrometheusTargetState = "active" | "dropped" | "any"
  Which targets `/api/v1/targets` returns: the API's `state` parameter.

type PrometheusTime = Date | number | string
  A time an API parameter accepts: a `Date`, Unix seconds, or RFC 3339 text.

type PrometheusVectorSample = PrometheusFloatSample | PrometheusHistogramSample
  One element of an instant vector. The API gives each element a `value` or a
  `histogram`, never both — narrow with `"value" in sample`.
````

</details>

<!-- ZUKE:API:END -->
