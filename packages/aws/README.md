# @zuke/aws

Typed [`aws`](https://aws.amazon.com/cli/) (AWS CLI v2) task wrapper for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Typed settings cover a deploy path's commands — STS, S3,
ECR, ECS, Lambda, CloudFormation, Secrets Manager, SSM, EKS, CloudWatch and
CloudWatch Logs — with the CLI's own subcommand and flag names; a general
builder covers everything else. Arguments stay a discrete argv array, so command
construction is injection-free.

## Usage

```ts
import { Build, run, target } from "@zuke/core";
import { AwsTasks } from "@zuke/aws";
import { DockerTasks } from "@zuke/docker";

class Deploy extends Build {
  push = target().executes(async () => {
    const account = await AwsTasks.accountId();
    const registry = `${account}.dkr.ecr.eu-west-1.amazonaws.com`;
    const password = await AwsTasks.ecrLoginPassword((s) =>
      s.region("eu-west-1")
    );
    await DockerTasks.login((s) =>
      s.username("AWS").passwordStdin(password).registry(registry)
    );
  });

  roll = target().dependsOn(this.push).executes(async () => {
    await AwsTasks.ecsUpdateService((s) =>
      s.cluster("prod").service("api").taskDefinition("api:42")
    );
    await AwsTasks.ecsWaitServicesStable((s) =>
      s.cluster("prod").services("api")
    );
  });
}

await run(Deploy);
```

Anything without a typed task goes through `run` and the general builder —
`.command(service, operation, ...operands)`, the global options, and
`.flag(name, value?)` / `.args(...)`:

```ts
await AwsTasks.run((s) =>
  s.command("sns", "publish")
    .flag("topic-arn", topic).flag("message", "deployed")
    .profile("deploy").region("eu-west-1")
);
```

The global options mirror the CLI's: `profile`, `region`, `output`, `query`,
`endpointUrl`, `noCliPager`, `noVerifySsl`, `noSignRequest`, `caBundle`,
`cliReadTimeout`, `cliConnectTimeout` and `debug`. Every command runs with
`AWS_PAGER` set to the empty string and `AWS_CLI_AUTO_PROMPT` set to `off` in
its environment, so neither CLI v2's pager nor its auto-prompt can sit waiting
for a keypress in a build.

Every typed option is sent as one `--flag=value` token, so a value that starts
with `-` stays a value. A positional operand or an element of a list-valued
option is a token of its own, so one that starts with `-` is refused rather than
letting the CLI read it as an option — `--endpoint-url=…` among them. Free-text
setters (descriptions, payloads, queries, `externalId`, `policy`) refuse a value
starting with `file://` or `fileb://`, which the CLI would replace with that
file's contents. `.flag(...)` and `.args(...)` are the escape hatches and guard
neither, so never give them an untrusted value.

## Readers

A reader returns a value instead of the command's output. It pins `--query` and
`--output` after your lambda, so the CLI does the extraction, and runs quietly:

| Reader                                             | Runs                                                   | Returns                                                        |
| -------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| `accountId()`                                      | `sts get-caller-identity --query Account`              | the account id                                                 |
| `ecrLoginPassword()`                               | `ecr get-login-password`                               | the registry password                                          |
| `secretString((s) => s.secretId(id))`              | `secretsmanager get-secret-value --query SecretString` | the secret, exactly — multi-line values included               |
| `parameterValue((s) => s.name(n))`                 | `ssm get-parameter --query Parameter.Value`            | the value (add `.withDecryption()` for a `SecureString`)       |
| `stackOutput(stack, key)`                          | `cloudformation describe-stacks` with a projection     | one stack output                                               |
| `lambdaPublishedVersion((s) => s.functionName(f))` | `lambda publish-version --query Version`               | the published version number                                   |
| `metricValue((s) => …)`                            | `cloudwatch get-metric-data`                           | the latest datapoint, or a `sum`/`average`/`maximum`/`minimum` |
| `alarmState(name)`                                 | `cloudwatch describe-alarms`                           | `"OK"`, `"ALARM"` or `"INSUFFICIENT_DATA"`                     |
| `logsInsightsQuery((q) => …)`                      | `logs start-query`, then `logs get-query-results`      | the rows, once the query is `Complete`                         |

```ts
const errors = await AwsTasks.metricValue((s) =>
  s.metricStat("errors", (m) =>
    m.namespace("AWS/Lambda").metricName("Errors")
      .dimension("FunctionName", "api").stat("Sum")).window("15m").aggregate(
      "sum",
    ).missingDataAs(0)
);

const rows = await AwsTasks.logsInsightsQuery((q) =>
  q.logGroupNames("/ecs/api").window("30m")
    .queryString("filter @message like /ERROR/ | stats count(*) as errors")
    .timeout("2m").aws((a) => a.region("eu-west-1"))
);
```

Output a reader cannot use — not JSON, the wrong shape, empty, several lines
where one was expected, or a truncated capture — raises an `AwsOutputError`,
whose message never quotes the output. A Logs Insights query that ends `Failed`,
`Cancelled` or `Timeout`, or outlasts the reader's own timeout (it is then
stopped), raises an `AwsLogsQueryError`. A command that fails surfaces as core's
usual `CommandError`.

## Secrets

The commands that print a credential — `sts assume-role`,
`ecr get-login-password`, `secretsmanager get-secret-value`,
`ssm get-parameter`, and `configure get` of `aws_secret_access_key` or
`aws_session_token` — always run quietly, and what they return is registered
with the run's redactor, so the value is masked if the build later prints it.
The output is searched by core's shared rules (`markSecretsInOutput` in
`@zuke/core/tooling`): the value under its usual key, any credential-named field
(`password`, `apiKey`, `client_secret`, …), and — when a `--query` may have
moved it — the answer whole and every value eight or more characters long. A
secret's own parts are masked on their own too: the fields of a secret that is a
JSON object, the password in a connection string or a `scheme://user:pass@host`
URL, and the decoded text of a base64 credential — so a password parsed out of a
database secret stays masked by itself.

Where the CLI offers a way to keep a secret off the command line, the wrapper
uses it: `ssmPutParameter((s) => s.valueFile(path))` sends
`--value=file://<path>`, so the CLI reads the value and it never reaches the
process table. A literal `.value(...)` for a `SecureString` is registered with
the redactor, which masks Zuke's output but not the process table, and a value
starting with `file://` or `fileb://` is refused, because the CLI would read
that file instead of storing the text. Hand `ecrLoginPassword()` to
`docker login --password-stdin`, never to `-p`.

## CloudWatch canary analysis

`cloudwatch(...)` is an analysis for a `@zuke/canary` rollout: it reads a metric
over a recent window and fails the canary when any datapoint is out of bounds.

```ts
import { canary } from "@zuke/canary";
import { cloudwatch } from "@zuke/aws";

rollout = canary((c) =>
  c.platform(platform).steps(10, 50)
    .analysis(cloudwatch((m) =>
      m.name("canary 5xx").namespace("AWS/ApplicationELB")
        .metricName("HTTPCode_Target_5XX_Count")
        .dimension("TargetGroup", "targetgroup/api-canary/0a1b")
        .stat("Sum").window("5m").max(5).missingDataAs(0)
        .aws((a) => a.region("eu-west-1"))
    ))
);
```

`@zuke/aws` does not depend on `@zuke/canary`: the analysis has the shape
`c.analysis(...)` accepts. See
[docs/canary.md](https://github.com/zuke-build/zuke/blob/master/docs/canary.md#cloudwatch).

## Testing a build's AWS steps

Every settings class takes `.runner(fn)`, which replaces the spawn: the function
receives the prepared settings (read the argv with `.argv()`) and returns a
`CommandOutput`. The exit code is still judged as for a real run, so a build's
AWS steps can be tested without an account or the CLI.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/aws` — typed AWS CLI tasks for Zuke builds, readers and a canary analysis.

The `aws` CLI wrapper has typed settings for the deploy path (STS, S3, ECR,
ECS, Lambda, CloudFormation, Secrets Manager, SSM, EKS), CloudWatch and
CloudWatch Logs monitoring, readers that return a value, and a
`cloudwatch(...)` analysis for `@zuke/canary` rollouts.

```ts
import { AwsTasks, cloudwatch } from "@zuke/aws";

const account = await AwsTasks.accountId((s) => s.profile("deploy"));
await AwsTasks.s3Sync((s) => s.source("dist").destination("s3://site"));
const errors = await AwsTasks.metricValue((s) =>
  s.metricStat("errors", (m) =>
    m.namespace("AWS/Lambda").metricName("Errors")
      .dimension("FunctionName", "api").stat("Sum")
  ).window("15m").aggregate("sum").missingDataAs(0)
);
```

The wrapper builds a discrete argv array (never a shell string), and every
settings class takes a `.runner(...)`, so a build's AWS steps are testable
without an account or the CLI.
@module

function cloudwatch(configure: Configure<AwsCloudwatchAnalysisSettings>): AwsCloudwatchAnalysis
  An analysis that reads a CloudWatch metric over a recent window and fails
  the canary when any datapoint is out of bounds — or when there is no data,
  unless {@link AwsCloudwatchAnalysisSettings.missingDataAs} says what no
  data means. Each datapoint covers one period, so a `.max(5)` on a
  per-minute `Sum` means "no minute with more than five".

  The lambda runs on each check, so it may read resolved parameters, and
  every failure message — one from the lambda included — passes through the
  run's redactor.

const AwsTasks: AwsTasksApi
  Typed task functions for the `aws` CLI.

class AwsCloudformationDeleteStackSettings extends AwsSettings
  Settings for `aws cloudformation delete-stack`.

  stackName(name: string): this
    The stack to delete (`--stack-name`).
  roleArn(arn: string): this
    The role CloudFormation assumes to delete (`--role-arn`).
  retainResources(...ids: string[]): this
    Logical ids to keep when a delete is retried (`--retain-resources`).
  override protected leadingTokens(): string[]
    Emit `cloudformation delete-stack` with its options.

class AwsCloudformationDeploySettings extends AwsSettings
  Settings for `aws cloudformation deploy`.

  templateFile(path: string): this
    The template to deploy (`--template-file`).
  stackName(name: string): this
    The stack to create or update (`--stack-name`).
  parameterOverride(key: string, value: string): this
    Set a template parameter (`--parameter-overrides Key=Value`); repeatable.
  capabilities(...values: string[]): this
    Acknowledge what the template creates (`--capabilities`), e.g. `"CAPABILITY_IAM"`.
  tag(key: string, value: string): this
    Tag the stack and its resources (`--tags Key=Value`); repeatable.
  noExecuteChangeset(): this
    Create the change set without executing it (`--no-execute-changeset`).
  noFailOnEmptyChangeset(): this
    Exit 0 when there is nothing to change (`--no-fail-on-empty-changeset`).
  roleArn(arn: string): this
    The role CloudFormation assumes to deploy (`--role-arn`).
  s3Bucket(name: string): this
    The bucket a large template is uploaded to (`--s3-bucket`).
  s3Prefix(prefix: string): this
    The key prefix for that upload (`--s3-prefix`).
  kmsKeyId(id: string): this
    The KMS key that encrypts that upload (`--kms-key-id`).
  override protected leadingTokens(): string[]
    Emit `cloudformation deploy` with its options.

class AwsCloudformationDescribeStacksSettings extends AwsSettings
  Settings for `aws cloudformation describe-stacks`.

  stackName(name: string): this
    The stack to describe (`--stack-name`); every stack when omitted.
  override protected leadingTokens(): string[]
    Emit `cloudformation describe-stacks` with its options.

class AwsCloudformationWaitSettings extends AwsSettings
  Settings for `aws cloudformation wait <waiter>`: block until the stack
  reaches the waiter's state. The CLI polls every 30 seconds and exits
  non-zero after 120 attempts, or as soon as the stack lands in a failed
  state — which surfaces as a `CommandError`.

  waiter(name: AwsCloudformationStackWaiter): this
    The state to wait for, e.g. `"stack-update-complete"`.
  stackName(name: string): this
    The stack to wait on (`--stack-name`).
  override protected leadingTokens(): string[]
    Emit `cloudformation wait <waiter>` with the stack.

class AwsCloudwatchAnalysisSettings extends AwsCloudwatchMetricStatSettings
  Settings for {@link cloudwatch}: the metric, the window and the bounds.

  The metric itself — `namespace`, `metricName`, `dimension`, `stat`,
  `period`, `unit` — is set with the same setters as a `get-metric-data`
  query, which these settings extend; it is queried as `m1`.

  name_?: string
    What the metric is called in a failure (set by {@link name}).
  readonly metricStats_: Array<[string, Configure<AwsCloudwatchMetricStatSettings>]>
    Further metrics an expression reads, by id (set by {@link metricStat}).
  expression_?: string
    The metric-math expression judged instead of the metric (set by {@link expression}).
  window_: number
    How far back to read, in ms (set by {@link window}).
  min_?: number
    The lowest acceptable value (set by {@link min}).
  max_?: number
    The highest acceptable value (set by {@link max}).
  missingData_?: number
    The value to judge when there are no datapoints (set by {@link missingDataAs}).
  aws_: Configure<AwsSettings>
    Global options for the command (set by {@link aws}).
  now_: () => Date
    The clock the window is read against (set by {@link now}).
  name(name: string): this
    What to call the metric when it is out of bounds.
  metricStat(id: string, configure: Configure<AwsCloudwatchMetricStatSettings>): this
    Add a metric for {@link expression} to read, under `id`. The metric set
    with {@link namespace} and {@link metricName} is `m1`.
  expression(expression: string): this
    Judge a metric-math expression over the metrics instead of a metric —
    `"100 * errors / requests"`, with `errors` and `requests` added by
    {@link metricStat}.
  window(duration: string | number): this
    How far back to read (`"10m"`, or ms; default 5 minutes). The window
    ends at the last period boundary, so the period still being written is
    not judged.

    CloudWatch publishes a datapoint a little after its period ends, so the
    newest period in the window may still be short of some data. That only
    lowers a `Sum` or a `SampleCount`: harmless for a `max`, but a `min` on
    such a statistic can fail on a lag rather than on the candidate.
  min(value: number): this
    Fail when any datapoint is below `value`.
  max(value: number): this
    Fail when any datapoint is above `value`.
  missingDataAs(value: number): this
    Judge `value` when the window has no datapoints, instead of failing.
    CloudWatch publishes nothing for a period with no events, so for a count
    of errors no data means `0`; for a latency it usually means the metric or
    its dimensions are wrong, which is why that is a failure by default.
  aws(configure: Configure<AwsSettings>): this
    Global options for the `get-metric-data` command —
    `(a) => a.profile("prod").region("eu-west-1")`, a `.toolPath(...)`, or a
    `.runner(...)`, the seam a test answers through. `--output` and `--query`
    are the analysis's own and are set after it.
  now(clock: () => Date): this
    The clock the window is read against — the seam a test pins it with.

class AwsCloudwatchDescribeAlarmsSettings extends AwsSettings
  Settings for `aws cloudwatch describe-alarms`.

  alarmNames(...names: string[]): this
    Only these alarms (`--alarm-names`); repeatable.
  alarmNamePrefix(prefix: string): this
    Only alarms whose name starts with this (`--alarm-name-prefix`).
  stateValue(state: AwsCloudwatchAlarmState): this
    Only alarms in this state (`--state-value`).
  alarmTypes(...types: AwsCloudwatchAlarmType[]): this
    The kinds of alarm to return (`--alarm-types`): metric, composite or log
    alarms; replaces any set before. Without it the CLI returns metric
    alarms only.
  override protected leadingTokens(): string[]
    Emit `cloudwatch describe-alarms` with its options.

class AwsCloudwatchExpressionSettings
  Settings for one metric-math expression in a `get-metric-data` request.

  label_?: string
    A label for the series (set by {@link label}).
  period_?: number
    The period in seconds, for an expression that needs one (set by {@link period}).
  returnData_: boolean
    Whether the response carries this series (set by {@link returnData}).
  label(text: string): this
    A label for the series in the response.
  period(seconds: number): this
    The period in seconds, for an expression that has no metric to take it from.
  returnData(value: boolean): this
    Whether the response carries this series (default `true`).

class AwsCloudwatchGetMetricDataSettings extends AwsSettings
  Settings for `aws cloudwatch get-metric-data`.

  protected taskName(): string
    The task name used in this command's error messages.
  metricStat(id: string, configure: Configure<AwsCloudwatchMetricStatSettings>): this
    Add a metric to the request, under `id`, configured by `configure`.
  expression(id: string, expression: string, configure: Configure<AwsCloudwatchExpressionSettings>): this
    Add a metric-math expression over the request's other ids, e.g.
    `("ratio", "100 * errors / requests")`.
  startTime(time: AwsTime): this
    The start of the range (`--start-time`).
  endTime(time: AwsTime): this
    The end of the range (`--end-time`).
  window(duration: string | number, end: Date): this
    The `duration` (`"15m"`, or milliseconds) up to `end` — now, unless
    given — as `--start-time` and `--end-time`.
  scanBy(order: "TimestampDescending" | "TimestampAscending"): this
    The order of the datapoints (`--scan-by`); newest first by default.
  protected readsEveryPage(): boolean
    Whether this request must read every page. A reader that turns the
    datapoints into one value does: a value computed from part of a window
    looks just like a value computed from all of it. Overridden by the
    settings behind `AwsTasks.metricValue`.
  maxDatapoints(count: number): this
    The most datapoints to return (`--max-datapoints`). Setting it turns off
    the CLI's automatic pagination — the CLI treats it as a page size and
    returns one page with a `NextToken` — so the answer may hold only part
    of the window. `AwsTasks.metricValue` refuses it for that reason.
  override protected leadingTokens(): string[]
    Emit `cloudwatch get-metric-data` with its options.

class AwsCloudwatchGetMetricStatisticsSettings extends AwsSettings
  Settings for `aws cloudwatch get-metric-statistics`.

  namespace(value: string): this
    The metric's namespace (`--namespace`).
  metricName(value: string): this
    The metric's name (`--metric-name`).
  dimension(name: string, value: string): this
    A dimension that picks the series (`--dimensions`); repeatable.
  startTime(time: AwsTime): this
    The start of the range (`--start-time`).
  endTime(time: AwsTime): this
    The end of the range (`--end-time`).
  window(duration: string | number, end: Date): this
    The `duration` up to `end` — now, unless given — as the time range.
  period(seconds: number): this
    The aggregation period in seconds (`--period`).
  statistics(...values: Array<"SampleCount" | "Average" | "Sum" | "Minimum" | "Maximum">): this
    The basic statistics to return (`--statistics`), e.g. `"Sum"`.
  extendedStatistics(...values: string[]): this
    Percentiles and other extended statistics (`--extended-statistics`), e.g. `"p99"`.
  unit(value: string): this
    Only datapoints published in this unit (`--unit`).
  override protected leadingTokens(): string[]
    Emit `cloudwatch get-metric-statistics` with its options.

class AwsCloudwatchMetricStatSettings
  Settings for one metric in a `get-metric-data` request (a `MetricStat` query).

  namespace_?: string
    The metric's namespace, e.g. `AWS/ApplicationELB` (set by {@link namespace}).
  metricName_?: string
    The metric's name (set by {@link metricName}).
  readonly dimensions_: Array<{ Name: string; Value: string; }>
    The dimensions that pick the series, in order (set by {@link dimension}).
  period_: number
    The aggregation period in seconds (set by {@link period}).
  stat_?: AwsCloudwatchStatistic
    The statistic (set by {@link stat}).
  unit_?: string
    The unit to filter on (set by {@link unit}).
  label_?: string
    A label for the series (set by {@link label}).
  returnData_: boolean
    Whether the response carries this series (set by {@link returnData}).
  namespace(value: string): this
    The metric's namespace, e.g. `"AWS/ApplicationELB"`.
  metricName(value: string): this
    The metric's name, e.g. `"HTTPCode_Target_5XX_Count"`.
  dimension(name: string, value: string): this
    A dimension that picks the series, e.g. `("LoadBalancer", "app/web/1f2e")`; repeatable.
  period(seconds: number): this
    The aggregation period in seconds (default 60). CloudWatch accepts 1, 5,
    10, 20, 30, or a multiple of 60.
  stat(value: AwsCloudwatchStatistic): this
    The statistic: `"Sum"`, `"Average"`, `"Maximum"`, `"p99"`, …
  unit(value: string): this
    Only datapoints published in this unit, e.g. `"Count"`.
  label(text: string): this
    A label for the series in the response.
  returnData(value: boolean): this
    Whether the response carries this series (default `true`). Pass `false`
    for a metric that only feeds an expression.

class AwsCloudwatchMetricValueSettings extends AwsCloudwatchGetMetricDataSettings
  Settings for `AwsTasks.metricValue`: a `get-metric-data` request, and how to read it.

  id_?: string
    The series to read (set by {@link id}); the only one when unset.
  aggregate_: AwsCloudwatchAggregate
    How to turn the series into one number (set by {@link aggregate}).
  missingData_?: number
    The value to return when the series is empty (set by {@link missingDataAs}).
  override protected taskName(): string
    The task name used in this reader's error messages.
  override protected readsEveryPage(): boolean
    The reader computes one value from the window, so it reads every page.
  id(queryId: string): this
    The series to read, by query id. Needed only when the request returns
    more than one — hide the inputs of an expression with
    `.returnData(false)` and it is not.
  aggregate(how: AwsCloudwatchAggregate): this
    How to turn the series into one number (default `"latest"`, the newest
    datapoint). An aggregate combines the datapoints the window holds: a
    `"sum"` of per-minute `Sum`s is the window's total.
  missingDataAs(value: number): this
    Return `value` when the series has no datapoints, instead of failing.
    CloudWatch publishes nothing for a period with no events, so for a count
    of errors, no data does mean `0`; for a latency or a CPU reading it
    usually means the query is looking in the wrong place.

class AwsConfigureGetSettings extends AwsSettings
  Settings for `aws configure get`.

  Reading a credential — `aws_secret_access_key`, `aws_session_token`, in any
  profile — runs quietly and registers what it printed with the run's
  redactor.

  varname(name: string): this
    The setting to read (positional), e.g. `"region"`.
  override protected onOutput(output: CommandOutput): void
    Register a credential setting's value as a secret.
  override protected leadingTokens(): string[]
    Emit `configure get` with the setting.

class AwsConfigureSetSettings extends AwsSettings
  Settings for `aws configure set`.

  `aws configure set` takes the value on its command line, where every user
  on the host can read it from the process table. Setting
  `aws_secret_access_key` or `aws_session_token` this way registers the value
  with the run's redactor so Zuke's own output masks it, but that does not
  hide it from the process table — prefer the `AWS_*` environment variables
  or a role for credentials.

  varname(name: string): this
    The setting to write (positional), e.g. `"region"`.
  value(text: string): this
    The value to write (positional).
  override protected leadingTokens(): string[]
    Emit `configure set` with the setting and value.

class AwsEcrBatchDeleteImageSettings extends AwsSettings
  Settings for `aws ecr batch-delete-image`.

  repositoryName(name: string): this
    The repository to delete from (`--repository-name`).
  registryId(id: string): this
    The registry's account id, when not the caller's (`--registry-id`).
  imageTag(tag: string): this
    Delete the image with this tag (`--image-ids`); repeatable.
  imageDigest(digest: string): this
    Delete the image with this digest (`--image-ids`); repeatable.
  override protected leadingTokens(): string[]
    Emit `ecr batch-delete-image` with its options.

class AwsEcrDescribeImagesSettings extends AwsSettings
  Settings for `aws ecr describe-images`.

  repositoryName(name: string): this
    The repository to describe (`--repository-name`).
  registryId(id: string): this
    The registry's account id, when not the caller's (`--registry-id`).
  imageTag(tag: string): this
    Describe the image with this tag (`--image-ids`); repeatable.
  imageDigest(digest: string): this
    Describe the image with this digest (`--image-ids`); repeatable.
  tagStatus(status: "TAGGED" | "UNTAGGED" | "ANY"): this
    Only images with this tag status (`--filter tagStatus=…`).
  override protected leadingTokens(): string[]
    Emit `ecr describe-images` with its options.

class AwsEcrDescribeRepositoriesSettings extends AwsSettings
  Settings for `aws ecr describe-repositories`.

  repositoryNames(...names: string[]): this
    Only these repositories (`--repository-names`); all when omitted.
  registryId(id: string): this
    The registry's account id, when not the caller's (`--registry-id`).
  override protected leadingTokens(): string[]
    Emit `ecr describe-repositories` with its options.

class AwsEcrGetLoginPasswordSettings extends AwsSettings
  Settings for `aws ecr get-login-password`.

  The password is a registry credential, so the command always runs quietly
  and the password is registered with the run's redactor once it returns.
  Hand it to `docker login --password-stdin` (`DockerTasks.login` with
  `.passwordStdin(...)`), never to `-p`.

  constructor()
    Settings that capture the password instead of streaming it.
  override protected onOutput(output: CommandOutput): void
    Register the printed password as a secret.
  override protected leadingTokens(): string[]
    Emit `ecr get-login-password`.

class AwsEcsDescribeServicesSettings extends AwsSettings
  Settings for `aws ecs describe-services`.

  cluster(name: string): this
    The cluster the services run in (`--cluster`).
  services(...names: string[]): this
    The services to describe (`--services`); repeatable.
  override protected leadingTokens(): string[]
    Emit `ecs describe-services` with its options.

class AwsEcsRegisterTaskDefinitionSettings extends AwsSettings
  Settings for `aws ecs register-task-definition`.

  Either hand the whole definition over with {@link cliInputJson} — the usual
  form, a `file://` path to a JSON document — or set the family and its
  container definitions. Environment values in a container definition land
  on the command line; keep secrets in the definition's `secrets` (Secrets
  Manager or SSM references) rather than its `environment`.

  cliInputJson(value: string): this
    The whole request as JSON (`--cli-input-json`): a `file://` path to the
    document, or the document itself.
  family(name: string): this
    The task definition family (`--family`).
  containerDefinitions(json: string): this
    The container definitions, as a JSON array or a `file://` path (`--container-definitions`).
  taskRoleArn(arn: string): this
    The role the task's containers assume (`--task-role-arn`).
  executionRoleArn(arn: string): this
    The role ECS uses to pull images and read secrets (`--execution-role-arn`).
  networkMode(mode: string): this
    The Docker networking mode (`--network-mode`), e.g. `"awsvpc"`.
  requiresCompatibilities(...types: string[]): this
    The launch types the definition must suit (`--requires-compatibilities`).
  cpu(value: string): this
    CPU units for the task (`--cpu`), e.g. `"256"`.
  memory(value: string): this
    Memory for the task in MiB (`--memory`), e.g. `"512"`.
  override protected leadingTokens(): string[]
    Emit `ecs register-task-definition` with its options.

class AwsEcsRunTaskSettings extends AwsSettings
  Settings for `aws ecs run-task`.

  cluster(name: string): this
    The cluster to run the task in (`--cluster`).
  taskDefinition(value: string): this
    The task definition to run (`--task-definition`).
  count(value: number): this
    How many copies to start (`--count`).
  launchType(value: string): this
    The launch type (`--launch-type`): `"FARGATE"`, `"EC2"` or `"EXTERNAL"`.
  networkConfiguration(json: string): this
    The `awsvpc` network configuration, as JSON (`--network-configuration`).
  overrides(json: string): this
    Container overrides, as JSON (`--overrides`).
  startedBy(value: string): this
    A label for who started the task (`--started-by`).
  group(name: string): this
    The task group name (`--group`).
  override protected leadingTokens(): string[]
    Emit `ecs run-task` with its options.

class AwsEcsUpdateServiceSettings extends AwsSettings
  Settings for `aws ecs update-service`.

  cluster(name: string): this
    The cluster the service runs in (`--cluster`); the default cluster when omitted.
  service(name: string): this
    The service to update (`--service`).
  taskDefinition(value: string): this
    The task definition to run, as `family:revision` or an ARN (`--task-definition`).
  desiredCount(count: number): this
    How many tasks to keep running (`--desired-count`).
  forceNewDeployment(): this
    Start a new deployment even when nothing changed (`--force-new-deployment`).
  healthCheckGracePeriodSeconds(seconds: number): this
    Seconds to ignore failing health checks after a task starts (`--health-check-grace-period-seconds`).
  override protected leadingTokens(): string[]
    Emit `ecs update-service` with its options.

class AwsEcsWaitServicesStableSettings extends AwsSettings
  Settings for `aws ecs wait services-stable`: block until every named
  service has its desired count running on one deployment. The CLI polls
  every 15 seconds and gives up after 40 attempts with a non-zero exit, which
  surfaces as a `CommandError`.

  cluster(name: string): this
    The cluster the services run in (`--cluster`).
  services(...names: string[]): this
    The services to wait for (`--services`); repeatable.
  override protected leadingTokens(): string[]
    Emit `ecs wait services-stable` with its options.

class AwsEksDescribeClusterSettings extends AwsSettings
  Settings for `aws eks describe-cluster`.

  name(cluster: string): this
    The cluster (`--name`).
  override protected leadingTokens(): string[]
    Emit `eks describe-cluster` with the cluster.

class AwsEksUpdateKubeconfigSettings extends AwsSettings
  Settings for `aws eks update-kubeconfig`.

  name(cluster: string): this
    The cluster (`--name`).
  kubeconfig(path: string): this
    The kubeconfig file to write (`--kubeconfig`); `~/.kube/config` by default.
  alias(name: string): this
    The context's name (`--alias`); the cluster ARN by default.
  userAlias(name: string): this
    The user entry's name (`--user-alias`).
  roleArn(arn: string): this
    A role to assume when authenticating to the cluster (`--role-arn`).
  dryRun(): this
    Print the configuration instead of writing it (`--dry-run`).
  override protected leadingTokens(): string[]
    Emit `eks update-kubeconfig` with its options.

class AwsLambdaGetFunctionSettings extends AwsSettings
  Settings for `aws lambda get-function`.

  functionName(name: string): this
    The function's name or ARN (`--function-name`).
  qualifier(value: string): this
    A version or alias to describe instead of `$LATEST` (`--qualifier`).
  override protected leadingTokens(): string[]
    Emit `lambda get-function` with its options.

class AwsLambdaInvokeSettings extends AwsSettings
  Settings for `aws lambda invoke`.

  The function's response is written to the {@link outfile}; what the CLI
  prints is the invocation's status. A function that throws still exits 0:
  the CLI reports it in the printed `FunctionError` field, so read that (or
  the outfile) before treating an invocation as a success.

  functionName(name: string): this
    The function's name or ARN (`--function-name`).
  payload(json: string): this
    The event to send, as JSON text (`--payload`). AWS CLI v2 reads a payload
    as base64 unless told otherwise, so this also passes
    `--cli-binary-format raw-in-base64-out` to send the text as it is.
  invocationType(value: "RequestResponse" | "Event" | "DryRun"): this
    Wait for the response, queue the event, or only check access (`--invocation-type`).
  logType(value: "None" | "Tail"): this
    `"Tail"` returns the last 4 KB of the execution log, base64-encoded (`--log-type`).
  qualifier(value: string): this
    A version or alias to invoke (`--qualifier`).
  outfile(path: string): this
    The file the function's response is written to (positional).
  override protected leadingTokens(): string[]
    Emit `lambda invoke` with its options and the outfile.

class AwsLambdaPublishVersionSettings extends AwsSettings
  Settings for `aws lambda publish-version`.

  functionName(name: string): this
    The function's name or ARN (`--function-name`).
  description(text: string): this
    A description of the version (`--description`).
  codeSha256(hash: string): this
    Publish only if the code still has this SHA-256 (`--code-sha256`).
  revisionId(id: string): this
    Publish only if the function is still at this revision (`--revision-id`).
  override protected leadingTokens(): string[]
    Emit `lambda publish-version` with its options.

class AwsLambdaUpdateAliasSettings extends AwsSettings
  Settings for `aws lambda update-alias`.

  functionName(name: string): this
    The function's name or ARN (`--function-name`).
  name(alias: string): this
    The alias to move (`--name`), e.g. `"live"`.
  functionVersion(version: string): this
    The version the alias points at (`--function-version`).
  description(text: string): this
    A description of the alias (`--description`).
  additionalVersionWeight(version: string, weight: number): this
    Send a share of the alias's traffic to another version
    (`--routing-config AdditionalVersionWeights`), as a fraction from 0 to 1;
    repeatable. The rest goes to {@link functionVersion}.
  clearRouting(): this
    Clear the alias's weighted routing, sending all traffic to its version
    (`--routing-config` with no additional weights).
  override protected leadingTokens(): string[]
    Emit `lambda update-alias` with its options.

class AwsLambdaUpdateFunctionCodeSettings extends AwsSettings
  Settings for `aws lambda update-function-code`.

  functionName(name: string): this
    The function's name or ARN (`--function-name`).
  zipFile(path: string): this
    The deployment package on disk (`--zip-file`). The CLI reads the file
    when the path carries its `fileb://` prefix, which this adds unless the
    path already has it.
  s3Bucket(name: string): this
    The bucket holding the deployment package (`--s3-bucket`).
  s3Key(key: string): this
    The package's key in that bucket (`--s3-key`).
  s3ObjectVersion(version: string): this
    The package object's version (`--s3-object-version`).
  imageUri(uri: string): this
    The container image, for an image-packaged function (`--image-uri`).
  publish(): this
    Publish a new version once the code is updated (`--publish`).
  dryRun(): this
    Validate the request without updating the function (`--dry-run`).
  revisionId(id: string): this
    Update only if the function is still at this revision (`--revision-id`).
  architectures(...values: string[]): this
    The instruction set architectures (`--architectures`), e.g. `"arm64"`.
  override protected leadingTokens(): string[]
    Emit `lambda update-function-code` with its options.

class AwsLambdaUpdateFunctionConfigurationSettings extends AwsSettings
  Settings for `aws lambda update-function-configuration`.

  functionName(name: string): this
    The function's name or ARN (`--function-name`).
  environment(variables: Record<string, string>): this
    The function's environment variables (`--environment`). This replaces
    the whole set — a variable left out is removed — and the values travel on
    the command line, so keep secrets in Secrets Manager or SSM and pass their
    names instead.
  timeout(seconds: number): this
    The longest an invocation may run, in seconds (`--timeout`).
  memorySize(mib: number): this
    Memory for the function in MiB (`--memory-size`).
  handler(name: string): this
    The handler entry point (`--handler`), e.g. `"index.handler"`.
  runtime(name: string): this
    The runtime (`--runtime`), e.g. `"nodejs22.x"`.
  role(arn: string): this
    The execution role's ARN (`--role`).
  description(text: string): this
    A description of the function (`--description`).
  layers(...arns: string[]): this
    The layers to attach, by version ARN (`--layers`); replaces the set.
  override protected leadingTokens(): string[]
    Emit `lambda update-function-configuration` with its options.

class AwsLogsFilterLogEventsSettings extends AwsSettings
  Settings for `aws logs filter-log-events`.

  logGroupName(name: string): this
    The log group to search (`--log-group-name`).
  logStreamNames(...names: string[]): this
    Only these streams (`--log-stream-names`); repeatable.
  logStreamNamePrefix(prefix: string): this
    Only streams whose name starts with this (`--log-stream-name-prefix`).
  filterPattern(pattern: string): this
    A CloudWatch Logs filter pattern (`--filter-pattern`), e.g. `"ERROR"`.
  startTime(time: Date): this
    The start of the range (`--start-time`, sent as epoch milliseconds).
  endTime(time: Date): this
    The end of the range (`--end-time`, sent as epoch milliseconds).
  window(duration: string | number, end: Date): this
    The `duration` up to `end` — now, unless given — as the time range.
  override protected leadingTokens(): string[]
    Emit `logs filter-log-events` with its options.

class AwsLogsGetQueryResultsSettings extends AwsSettings
  Settings for `aws logs get-query-results`.

  queryId(id: string): this
    The id `start-query` returned (`--query-id`).
  nextToken(token: string): this
    The page after the one that returned this token (`--next-token`).
  override protected leadingTokens(): string[]
    Emit `logs get-query-results` with the query id.

class AwsLogsInsightsQuerySettings
  Settings for `AwsTasks.logsInsightsQuery`: the query, and how long to wait for it.

  readonly logGroupNames_: string[]
    The log groups to query (set by {@link logGroupNames}).
  queryString_?: string
    The Logs Insights query (set by {@link queryString}).
  start_?: Date
    The start of the range (set by {@link startTime} or {@link window}).
  end_?: Date
    The end of the range (set by {@link endTime} or {@link window}).
  limit_?: number
    The most rows to return (set by {@link limit}).
  timeout_: number
    How long to wait for the query, in ms (set by {@link timeout}).
  pollInterval_: number
    The pause between polls, in ms (set by {@link pollInterval}).
  aws_: Configure<AwsSettings>
    Global options for every command (set by {@link aws}).
  signal_?: AbortSignal
    Cancels the wait and stops the query (set by {@link signal}).
  logGroupNames(...names: string[]): this
    The log groups to query (`--log-group-names`); repeatable.
  queryString(query: string): this
    The Logs Insights query (`--query-string`).
  startTime(time: Date): this
    The start of the range.
  endTime(time: Date): this
    The end of the range.
  window(duration: string | number, end: Date): this
    The `duration` up to `end` — now, unless given — as the time range.
  limit(rows: number): this
    The most rows to return (`--limit`).
  timeout(duration: string | number): this
    How long to wait for the query to finish (`"2m"`, or ms; default 5
    minutes). A query still running then is stopped, and the reader fails.
  pollInterval(duration: string | number): this
    The pause between polls for the results (`"2s"`, or ms; default 1 second).
  aws(configure: Configure<AwsSettings>): this
    Global options for every command the query runs —
    `(a) => a.profile("prod").region("eu-west-1")`, a `.toolPath(...)`, or a
    `.runner(...)`.
  signal(signal: AbortSignal): this
    Cancel the query with `signal`: the poll stops at once, the query is
    stopped, and the reader fails with the signal's reason. Pass a target's
    `ctx.signal` here — core's own run signal reaches each `aws` command
    already, but not the pause between two polls.

class AwsLogsQueryError extends Error
  A CloudWatch Logs Insights query did not complete: the service reported it
  `Failed`, `Cancelled` or `Timeout`, or it was still running when the
  reader's own timeout ran out.

  constructor(readonly queryId: string, readonly status: string, message: string)
    Build the error from the query, its last status and an explanation.
  override name: string
    The error name.

class AwsLogsStartQuerySettings extends AwsSettings
  Settings for `aws logs start-query`.

  logGroupNames(...names: string[]): this
    The log groups to query (`--log-group-names`); repeatable.
  queryString(query: string): this
    The Logs Insights query (`--query-string`).
  startTime(time: Date): this
    The start of the range (`--start-time`, sent as epoch seconds).
  endTime(time: Date): this
    The end of the range (`--end-time`, sent as epoch seconds).
  window(duration: string | number, end: Date): this
    The `duration` up to `end` — now, unless given — as the time range.
  limit(rows: number): this
    The most rows to return (`--limit`).
  override protected leadingTokens(): string[]
    Emit `logs start-query` with its options.

class AwsLogsStopQuerySettings extends AwsSettings
  Settings for `aws logs stop-query`.

  queryId(id: string): this
    The id `start-query` returned (`--query-id`).
  override protected leadingTokens(): string[]
    Emit `logs stop-query` with the query id.

class AwsLogsTailSettings extends AwsSettings
  Settings for `aws logs tail`. With {@link follow} the command never ends on
  its own — bound it with `.killAfter(ms)`.

  groupName(name: string): this
    The log group to tail (positional).
  since(value: string): this
    How far back to start (`--since`), e.g. `"10m"` or an ISO timestamp.
  follow(): this
    Keep printing new events as they arrive (`--follow`).
  filterPattern(pattern: string): this
    A CloudWatch Logs filter pattern (`--filter-pattern`).
  format(value: "detailed" | "short" | "json"): this
    How each event is printed (`--format`).
  logStreamNames(...names: string[]): this
    Only these streams (`--log-stream-names`); repeatable.
  logStreamNamePrefix(prefix: string): this
    Only streams whose name starts with this (`--log-stream-name-prefix`).
  override protected leadingTokens(): string[]
    Emit `logs tail` with the group and its options.

class AwsOutputError extends Error
  The AWS CLI succeeded but printed something a reader cannot use: output
  that is not JSON, JSON of an unexpected shape, an empty or multi-line answer
  where one value was expected, or a capture that was truncated.

  The message never quotes the output itself. Several readers return
  credentials and secret payloads, and an error that echoed what the CLI
  printed would put the secret in the build log it was read to stay out of.

  constructor(readonly task: string, readonly detail: string)
    Build the error from the reader that failed and what was wrong.
  override name: string
    The error name.

class AwsS3CpSettings extends AwsSettings
  Settings for `aws s3 cp`.

  source(path: string): this
    The local path or `s3://` URI to copy from (positional).
  destination(path: string): this
    The local path or `s3://` URI to copy to (positional).
  recursive(): this
    Copy every file under a directory or prefix (`--recursive`).
  exclude(pattern: string): this
    Skip files matching the pattern (`--exclude`); repeatable, order kept.
  include(pattern: string): this
    Copy files matching the pattern despite an earlier exclude (`--include`).
  dryrun(): this
    Print what would be copied without copying it (`--dryrun`).
  acl(value: string): this
    A canned ACL for the uploaded objects (`--acl`), e.g. `"private"`.
  contentType(value: string): this
    The uploaded objects' content type (`--content-type`).
  cacheControl(value: string): this
    The uploaded objects' `Cache-Control` (`--cache-control`).
  storageClass(value: string): this
    The storage class for the uploaded objects (`--storage-class`).
  sse(value: string): this
    Server-side encryption (`--sse`): `"AES256"` or `"aws:kms"`.
  sseKmsKeyId(id: string): this
    The KMS key for `aws:kms` server-side encryption (`--sse-kms-key-id`).
  onlyShowErrors(): this
    Print only errors and warnings (`--only-show-errors`).
  noProgress(): this
    Leave out the file-transfer progress lines (`--no-progress`).
  override protected leadingTokens(): string[]
    Emit `s3 cp` with its operands and options.

class AwsS3LsSettings extends AwsSettings
  Settings for `aws s3 ls`.

  path(uri: string): this
    The `s3://` URI to list (positional); the buckets when omitted.
  recursive(): this
    List every object under the prefix (`--recursive`).
  humanReadable(): this
    Print sizes as KiB, MiB, … (`--human-readable`).
  summarize(): this
    Print the object count and total size (`--summarize`).
  override protected leadingTokens(): string[]
    Emit `s3 ls` with its operand and options.

class AwsS3MbSettings extends AwsSettings
  Settings for `aws s3 mb`.

  bucket(uri: string): this
    The bucket to make, as an `s3://` URI (positional).
  override protected leadingTokens(): string[]
    Emit `s3 mb` with the bucket.

class AwsS3PresignSettings extends AwsSettings
  Settings for `aws s3 presign`.

  A presigned URL is a bearer credential for the object until it expires:
  anyone holding it can read the object, and when the build runs on
  temporary credentials it also carries the session token itself
  (`X-Amz-Security-Token`), which is good for far more than one object. So
  the command always runs quietly — the URL is captured, never streamed — and
  the URL and that token are registered with the run's redactor.

  constructor()
    Settings that capture the URL instead of streaming it.
  override protected onOutput(output: CommandOutput): void
    Register the URL, and the session token it carries, as secrets.
  path(uri: string): this
    The `s3://` object to presign (positional).
  expiresIn(seconds: number): this
    How long the URL stays valid, in seconds (`--expires-in`; default 3600).
  override protected leadingTokens(): string[]
    Emit `s3 presign` with the object and its lifetime.

class AwsS3RmSettings extends AwsSettings
  Settings for `aws s3 rm`.

  path(uri: string): this
    The `s3://` object or prefix to remove (positional).
  recursive(): this
    Remove every object under the prefix (`--recursive`).
  exclude(pattern: string): this
    Keep objects matching the pattern (`--exclude`); repeatable, order kept.
  include(pattern: string): this
    Remove objects matching the pattern despite an earlier exclude (`--include`).
  dryrun(): this
    Print what would be removed without removing it (`--dryrun`).
  override protected leadingTokens(): string[]
    Emit `s3 rm` with its operand and options.

class AwsS3SyncSettings extends AwsSettings
  Settings for `aws s3 sync`.

  source(path: string): this
    The local directory or `s3://` prefix to sync from (positional).
  destination(path: string): this
    The local directory or `s3://` prefix to sync to (positional).
  delete(): this
    Delete files at the destination that the source does not have
    (`--delete`), which makes the destination a mirror rather than a superset.
  exclude(pattern: string): this
    Skip files matching the pattern (`--exclude`); repeatable, order kept.
  include(pattern: string): this
    Sync files matching the pattern despite an earlier exclude (`--include`).
  dryrun(): this
    Print what would change without changing it (`--dryrun`).
  exactTimestamps(): this
    Treat same-size files with different timestamps as changed (`--exact-timestamps`).
  sizeOnly(): this
    Compare by size alone, ignoring timestamps (`--size-only`).
  acl(value: string): this
    A canned ACL for the uploaded objects (`--acl`).
  contentType(value: string): this
    The uploaded objects' content type (`--content-type`).
  cacheControl(value: string): this
    The uploaded objects' `Cache-Control` (`--cache-control`).
  storageClass(value: string): this
    The storage class for the uploaded objects (`--storage-class`).
  onlyShowErrors(): this
    Print only errors and warnings (`--only-show-errors`).
  noProgress(): this
    Leave out the file-transfer progress lines (`--no-progress`).
  override protected leadingTokens(): string[]
    Emit `s3 sync` with its operands and options.

class AwsSecretsmanagerGetSecretValueSettings extends AwsSettings
  Settings for `aws secretsmanager get-secret-value`.

  The response is the secret, so the command always runs quietly — captured,
  never streamed — with `--output json` pinned, and the `SecretString` or
  `SecretBinary` it returns is registered with the run's redactor.

  constructor()
    Settings that capture the secret instead of streaming it.
  secretId(id: string): this
    The secret's name or ARN (`--secret-id`).
  versionId(id: string): this
    A specific version, by id (`--version-id`).
  versionStage(label: string): this
    A specific version, by staging label (`--version-stage`); `AWSCURRENT` by default.
  override protected pinnedOutput(): AwsOutputFormat
    Pin `--output json`, the form the returned secrets can be found in.
  override protected onOutput(output: CommandOutput): void
    Register the returned `SecretString` or `SecretBinary` as a secret.
  override protected leadingTokens(): string[]
    Emit `secretsmanager get-secret-value` with its options.

class AwsSettings extends SubcommandSettings
  Settings for an `aws` invocation.

  Every instance sets two variables in the child's environment so the CLI
  can never sit waiting for a keypress in a build: `AWS_PAGER` to the empty
  string (CLI v2 pipes output through `less` by default) and
  `AWS_CLI_AUTO_PROMPT` to `off` (a profile's `cli_auto_prompt` would
  otherwise open the interactive prompt). Setting them there keeps the argv
  exactly what the settings say; override either with `.env({...})`, or add
  the explicit flag with {@link noCliPager}.

  constructor()
    Settings with the CLI's pager and auto-prompt off in the child's environment.
  override protected defaultTool(): string
    The default executable name (`aws`).
  profile(name: string): this
    The named profile from the shared config and credentials files (`--profile`).
  region(name: string): this
    The AWS Region to send the request to (`--region`), e.g. `"eu-west-1"`.
  output(format: AwsOutputFormat): this
    The output format (`--output`): `json`, `text`, `table`, `yaml` or `yaml-stream`.
  query(expression: string): this
    A JMESPath expression that filters the response (`--query`).
  endpointUrl(url: string): this
    Send the request to this URL instead of the service's default endpoint (`--endpoint-url`).
  noCliPager(): this
    Pass `--no-cli-pager` explicitly. The pager is already off through
    `AWS_PAGER` (see {@link AwsSettings}); the flag is for a build that wants
    it on the command line as well. AWS CLI v2 only.
  noVerifySsl(): this
    Skip TLS certificate verification (`--no-verify-ssl`). This disables the
    check that the endpoint is who it claims to be — meant for a local
    emulator, never for a real account; prefer {@link caBundle}.
  noSignRequest(): this
    Send the request unsigned, without loading credentials (`--no-sign-request`).
  caBundle(path: string): this
    The CA certificate bundle to verify TLS against (`--ca-bundle`).
  cliReadTimeout(seconds: number): this
    The socket read timeout in seconds; `0` blocks forever (`--cli-read-timeout`).
  cliConnectTimeout(seconds: number): this
    The socket connect timeout in seconds; `0` blocks forever (`--cli-connect-timeout`).
  debug(): this
    Turn on the CLI's debug logging (`--debug`), written to stderr.

    The debug log carries credentials: request headers with the session
    token, and response bodies — a secret's value among them. The access key,
    secret key and session token in the environment are registered with the
    run's redactor when this is called, but a credential the CLI loads from a
    profile, an SSO cache or a role is not known here and is not masked. Keep
    it for a local investigation, never a shared CI log.
  override flag(name: string, value?: string | number): this
    Add an arbitrary option: `--name value`, or the bare `--name`.

    Two hazards come with the escape hatch, which the typed setters guard and
    this does not: a value that starts with `-` is read by the CLI as the next
    option, and a value that starts with `file://` or `fileb://` is replaced
    by that file's contents — which then leave the machine in the request.
    Never pass an untrusted value here.
  protected pinnedOutput(): AwsOutputFormat | undefined
    The `--output` a command insists on, whatever the settings or the user's
    config say; `undefined` leaves it to them. A credential-bearing command
    pins `json`, which is the form its secrets can be found in.
  protected get queried(): boolean
    Whether a `--query` was set — by the caller, or pinned by a reader. A
    credential-bearing command then registers every long scalar it printed,
    since the query may have moved the secret away from its usual key.
  runner(run: AwsSettingsRunner): this
    Replace how this command is run. The default spawns the CLI; this is the
    seam a test answers commands through, and the way a build executes `aws`
    through something else. The runner reads the argv from the settings it is
    handed and must not call their `run()` — that is the call it replaces.
  override async run(): Promise<CommandOutput>
    Run the command — through the {@link runner} when one is set, otherwise
    by spawning the CLI. Either way the output is reported to the settings'
    output hook and a non-zero exit throws a `CommandError` unless
    `.noThrow()` was called.
  override protected middleTokens(): string[]
    Emit the AWS CLI's global options after the command.

class AwsSsmGetParameterSettings extends AwsSettings
  Settings for `aws ssm get-parameter`.

  A parameter may be a `SecureString`, so the command always runs quietly —
  captured, never streamed — with `--output json` pinned, and the value it
  returns is registered with the run's redactor.

  constructor()
    Settings that capture the value instead of streaming it.
  name(value: string): this
    The parameter's name or ARN (`--name`).
  withDecryption(): this
    Return a `SecureString` decrypted (`--with-decryption`). Without it, a
    `SecureString` comes back as ciphertext.
  override protected pinnedOutput(): AwsOutputFormat
    Pin `--output json`, the form the returned secrets can be found in.
  override protected onOutput(output: CommandOutput): void
    Register the returned value as a secret.
  override protected leadingTokens(): string[]
    Emit `ssm get-parameter` with its options.

class AwsSsmPutParameterSettings extends AwsSettings
  Settings for `aws ssm put-parameter`.

  `--value` is a command-line argument, which every user on the host can read
  from the process table. For a `SecureString`, write the value to a file
  with owner-only permissions and use {@link valueFile}: the CLI reads it, so
  it never appears in the argv. A literal {@link value} given to a
  `SecureString` is registered with the run's redactor, which masks Zuke's
  own output but not the process table.

  name(value: string): this
    The parameter's name (`--name`).
  value(text: string): this
    The value, given literally (`--value`). Refuses a value starting with
    `file://` or `fileb://`: the CLI would read the named file rather than
    store the text — use {@link valueFile} when that is the intent.
  valueFile(path: string): this
    Read the value from a file (`--value=file://<path>`), which keeps it off
    the command line. The CLI stores the file's contents exactly, trailing
    newline included.
  type(value: AwsSsmParameterType): this
    The parameter's type (`--type`).
  overwrite(): this
    Replace an existing parameter (`--overwrite`).
  keyId(id: string): this
    The KMS key that encrypts a `SecureString` (`--key-id`).
  description(text: string): this
    A description of the parameter (`--description`).
  tier(value: "Standard" | "Advanced" | "Intelligent-Tiering"): this
    The storage tier (`--tier`).
  dataType(value: string): this
    The data type (`--data-type`), e.g. `"aws:ec2:image"`.
  override protected leadingTokens(): string[]
    Emit `ssm put-parameter` with its options.

class AwsStsAssumeRoleSettings extends AwsSettings
  Settings for `aws sts assume-role`.

  The response carries a secret access key and a session token, so the
  command always runs quietly — its output is captured, never streamed — with
  `--output json` pinned whatever the settings or the user's config say, and
  both values are registered with the run's redactor once it returns.

  constructor()
    Settings that capture the credentials instead of streaming them.
  roleArn(arn: string): this
    The role to assume (`--role-arn`).
  roleSessionName(name: string): this
    An identifier for the session, shown in CloudTrail (`--role-session-name`).
  durationSeconds(seconds: number): this
    How long the credentials last, in seconds (`--duration-seconds`).
  externalId(id: string): this
    The external id the role's trust policy requires (`--external-id`).
  policy(json: string): this
    An inline session policy, as a JSON document (`--policy`).
  serialNumber(serial: string): this
    The MFA device's serial number or ARN (`--serial-number`).
  tokenCode(code: string): this
    The code the MFA device shows (`--token-code`).
  override protected pinnedOutput(): AwsOutputFormat
    Pin `--output json`, the form the returned secrets can be found in.
  override protected onOutput(output: CommandOutput): void
    Register the returned secret access key and session token as secrets.
  override protected leadingTokens(): string[]
    Emit `sts assume-role` with its options.

class AwsStsGetCallerIdentitySettings extends AwsSettings
  Settings for `aws sts get-caller-identity`.

  override protected leadingTokens(): string[]
    Emit `sts get-caller-identity`.

interface AwsCloudwatchAnalysis
  A health check run against a canary, in the shape `@zuke/canary`'s
  `c.analysis(...)` accepts: throw to fail it, which rolls the rollout back.

  readonly name: string
    `"cloudwatch"`, for diagnostics.
  validate(context: AwsCloudwatchAnalysisContext): Promise<void>
    Read the metric and throw when a datapoint is out of bounds.

interface AwsCloudwatchAnalysisContext
  The part of the canary engine's context the analysis uses: the run's
  redactor, applied to every failure message. The engine hands a richer
  context; this is the narrow view.

  redact(text: string): string
    Mask every resolved `secret` parameter in `text`.

interface AwsTasksApi
  The shape of {@link AwsTasks}.

  run(configure?: Configure<AwsSettings>): Promise<CommandOutput>
    Run any `aws` command, built with `.command(service, operation, …)`.
  stsGetCallerIdentity(configure?: Configure<AwsStsGetCallerIdentitySettings>): Promise<CommandOutput>
    Who the build runs as: `aws sts get-caller-identity`.
  accountId(configure?: Configure<AwsStsGetCallerIdentitySettings>): Promise<string>
    The AWS account id the build runs as, read back as a string. Pins
    `--query Account --output text`.
  stsAssumeRole(configure?: Configure<AwsStsAssumeRoleSettings>): Promise<CommandOutput>
    Take on a role's temporary credentials: `aws sts assume-role` (captured, never streamed).
  configureGet(configure?: Configure<AwsConfigureGetSettings>): Promise<CommandOutput>
    Read a CLI setting: `aws configure get`.
  configureSet(configure?: Configure<AwsConfigureSetSettings>): Promise<CommandOutput>
    Write a CLI setting: `aws configure set`.
  s3Cp(configure?: Configure<AwsS3CpSettings>): Promise<CommandOutput>
    Copy a file or tree to, from or within S3: `aws s3 cp`.
  s3Sync(configure?: Configure<AwsS3SyncSettings>): Promise<CommandOutput>
    Sync a tree to, from or within S3: `aws s3 sync`.
  s3Ls(configure?: Configure<AwsS3LsSettings>): Promise<CommandOutput>
    List buckets or objects: `aws s3 ls`.
  s3Rm(configure?: Configure<AwsS3RmSettings>): Promise<CommandOutput>
    Remove objects: `aws s3 rm`.
  s3Mb(configure?: Configure<AwsS3MbSettings>): Promise<CommandOutput>
    Make a bucket: `aws s3 mb`.
  s3Presign(configure?: Configure<AwsS3PresignSettings>): Promise<CommandOutput>
    Print a presigned URL for an object: `aws s3 presign`.
  ecrGetLoginPassword(configure?: Configure<AwsEcrGetLoginPasswordSettings>): Promise<CommandOutput>
    Print a registry password: `aws ecr get-login-password` (captured, never streamed).
  ecrLoginPassword(configure?: Configure<AwsEcrGetLoginPasswordSettings>): Promise<string>
    The ECR registry password, read back as a string, for
    `docker login --password-stdin`.
  ecrDescribeImages(configure?: Configure<AwsEcrDescribeImagesSettings>): Promise<CommandOutput>
    Describe a repository's images: `aws ecr describe-images`.
  ecrDescribeRepositories(configure?: Configure<AwsEcrDescribeRepositoriesSettings>): Promise<CommandOutput>
    Describe repositories: `aws ecr describe-repositories`.
  ecrBatchDeleteImage(configure?: Configure<AwsEcrBatchDeleteImageSettings>): Promise<CommandOutput>
    Delete images: `aws ecr batch-delete-image`.
  ecsUpdateService(configure?: Configure<AwsEcsUpdateServiceSettings>): Promise<CommandOutput>
    Roll a service onto a task definition: `aws ecs update-service`.
  ecsDescribeServices(configure?: Configure<AwsEcsDescribeServicesSettings>): Promise<CommandOutput>
    Describe services: `aws ecs describe-services`.
  ecsWaitServicesStable(configure?: Configure<AwsEcsWaitServicesStableSettings>): Promise<CommandOutput>
    Block until services are stable: `aws ecs wait services-stable`.
  ecsRegisterTaskDefinition(configure?: Configure<AwsEcsRegisterTaskDefinitionSettings>): Promise<CommandOutput>
    Register a task definition: `aws ecs register-task-definition`.
  ecsRunTask(configure?: Configure<AwsEcsRunTaskSettings>): Promise<CommandOutput>
    Start a one-off task: `aws ecs run-task`.
  lambdaUpdateFunctionCode(configure?: Configure<AwsLambdaUpdateFunctionCodeSettings>): Promise<CommandOutput>
    Ship new code: `aws lambda update-function-code`.
  lambdaUpdateFunctionConfiguration(configure?: Configure<AwsLambdaUpdateFunctionConfigurationSettings>): Promise<CommandOutput>
    Change a function's settings: `aws lambda update-function-configuration`.
  lambdaPublishVersion(configure?: Configure<AwsLambdaPublishVersionSettings>): Promise<CommandOutput>
    Publish a version: `aws lambda publish-version`.
  lambdaPublishedVersion(configure?: Configure<AwsLambdaPublishVersionSettings>): Promise<string>
    Publish a new version of the function — `aws lambda publish-version`,
    which changes the account — and return the number it was given. Pins
    `--query Version --output text`. Not a lookup: every call publishes.
  lambdaUpdateAlias(configure?: Configure<AwsLambdaUpdateAliasSettings>): Promise<CommandOutput>
    Move an alias: `aws lambda update-alias`.
  lambdaGetFunction(configure?: Configure<AwsLambdaGetFunctionSettings>): Promise<CommandOutput>
    Describe a function: `aws lambda get-function`.
  lambdaInvoke(configure?: Configure<AwsLambdaInvokeSettings>): Promise<CommandOutput>
    Invoke a function: `aws lambda invoke`.
  cloudformationDeploy(configure?: Configure<AwsCloudformationDeploySettings>): Promise<CommandOutput>
    Create or update a stack: `aws cloudformation deploy`.
  cloudformationDescribeStacks(configure?: Configure<AwsCloudformationDescribeStacksSettings>): Promise<CommandOutput>
    Describe stacks: `aws cloudformation describe-stacks`.
  stackOutput(stack: string, key: string, configure?: Configure<AwsCloudformationDescribeStacksSettings>): Promise<string>
    One output of a stack, read back as a string. Pins a `--query` projecting
    that output and `--output json`; fails when the stack has no such output.
  cloudformationDeleteStack(configure?: Configure<AwsCloudformationDeleteStackSettings>): Promise<CommandOutput>
    Delete a stack: `aws cloudformation delete-stack`.
  cloudformationWait(configure?: Configure<AwsCloudformationWaitSettings>): Promise<CommandOutput>
    Block until a stack reaches a state: `aws cloudformation wait <waiter>`.
  secretsmanagerGetSecretValue(configure?: Configure<AwsSecretsmanagerGetSecretValueSettings>): Promise<CommandOutput>
    Read a secret: `aws secretsmanager get-secret-value` (captured, never streamed).
  secretString(configure?: Configure<AwsSecretsmanagerGetSecretValueSettings>): Promise<string>
    A secret's `SecretString`, read back exactly — multi-line values and
    surrounding whitespace included. Pins `--query SecretString --output json`; fails for a binary secret.
  ssmGetParameter(configure?: Configure<AwsSsmGetParameterSettings>): Promise<CommandOutput>
    Read a parameter: `aws ssm get-parameter` (captured, never streamed).
  parameterValue(configure?: Configure<AwsSsmGetParameterSettings>): Promise<string>
    A parameter's value, read back exactly. Pins `--query Parameter.Value --output json`; add `.withDecryption()` for a `SecureString`.
  ssmPutParameter(configure?: Configure<AwsSsmPutParameterSettings>): Promise<CommandOutput>
    Write a parameter: `aws ssm put-parameter`.
  eksUpdateKubeconfig(configure?: Configure<AwsEksUpdateKubeconfigSettings>): Promise<CommandOutput>
    Write a kubeconfig entry for a cluster: `aws eks update-kubeconfig`.
  eksDescribeCluster(configure?: Configure<AwsEksDescribeClusterSettings>): Promise<CommandOutput>
    Describe a cluster: `aws eks describe-cluster`.
  cloudwatchGetMetricData(configure?: Configure<AwsCloudwatchGetMetricDataSettings>): Promise<CommandOutput>
    Read metric datapoints: `aws cloudwatch get-metric-data`.
  metricValue(configure: Configure<AwsCloudwatchMetricValueSettings>): Promise<number>
    One number from CloudWatch: the latest datapoint of a series, or an
    aggregate over the window. Pins `--query MetricDataResults --output json`; fails on no data unless `.missingDataAs(value)` says what it
    means.
  cloudwatchGetMetricStatistics(configure?: Configure<AwsCloudwatchGetMetricStatisticsSettings>): Promise<CommandOutput>
    Read metric statistics: `aws cloudwatch get-metric-statistics`.
  cloudwatchDescribeAlarms(configure?: Configure<AwsCloudwatchDescribeAlarmsSettings>): Promise<CommandOutput>
    Describe alarms: `aws cloudwatch describe-alarms`.
  alarmState(name: string, configure?: Configure<AwsCloudwatchDescribeAlarmsSettings>): Promise<AwsCloudwatchAlarmState>
    The state of one metric, composite or log alarm: `OK`, `ALARM` or `INSUFFICIENT_DATA`.
  logsStartQuery(configure?: Configure<AwsLogsStartQuerySettings>): Promise<CommandOutput>
    Start a Logs Insights query: `aws logs start-query`.
  logsGetQueryResults(configure?: Configure<AwsLogsGetQueryResultsSettings>): Promise<CommandOutput>
    Read a Logs Insights query's results: `aws logs get-query-results`.
  logsStopQuery(configure?: Configure<AwsLogsStopQuerySettings>): Promise<CommandOutput>
    Stop a running Logs Insights query: `aws logs stop-query`.
  logsInsightsQuery(configure: Configure<AwsLogsInsightsQuerySettings>): Promise<AwsLogsInsightsRow[]>
    Run a Logs Insights query to the end and return its rows: start it, poll
    `get-query-results` until it is `Complete`, and fail with an
    `AwsLogsQueryError` when it ends otherwise or outlasts the timeout.
  logsFilterLogEvents(configure?: Configure<AwsLogsFilterLogEventsSettings>): Promise<CommandOutput>
    Search a log group's events: `aws logs filter-log-events`.
  logsTail(configure?: Configure<AwsLogsTailSettings>): Promise<CommandOutput>
    Print a log group's recent events: `aws logs tail`.

type AwsCloudformationStackWaiter = "stack-create-complete" | "stack-update-complete" | "stack-delete-complete" | "stack-import-complete" | "stack-rollback-complete" | "stack-exists"
  The waiters `aws cloudformation wait` offers for a stack.

type AwsCloudwatchAggregate = "latest" | "sum" | "average" | "maximum" | "minimum"
  How {@link AwsCloudwatchMetricValueSettings} turns a series into one number:
  its newest datapoint, or the sum, average, maximum or minimum of all of
  them.

type AwsCloudwatchAlarmState = "OK" | "ALARM" | "INSUFFICIENT_DATA"
  The states a CloudWatch alarm can be in.

type AwsCloudwatchAlarmType = "MetricAlarm" | "CompositeAlarm" | "LogAlarm"
  The kinds of alarm `describe-alarms` can return.

type AwsCloudwatchStatistic = "SampleCount" | "Average" | "Sum" | "Minimum" | "Maximum" | "IQM" | `p${number}` | `${"tm" | "wm" | "tc" | "ts"}${string}` | `${"TM" | "WM" | "TC" | "TS" | "PR"}(${string})`
  A CloudWatch statistic: one of the five basic statistics, the interquartile
  mean `IQM`, or a percentile (`p99`, `p99.9`) or other extended statistic
  (`tm90`, `TM(10%:90%)`, `PR(100:2000)`, …).

type AwsLogsInsightsRow = Record<string, string>
  One row of a Logs Insights result: each field the query returned, by name.

type AwsOutputFormat = "json" | "text" | "table" | "yaml" | "yaml-stream" | "off"
  The values the AWS CLI's `--output` option accepts.

type AwsSettingsRunner = (settings: AwsSettings) => Promise<CommandOutput>
  Runs one prepared `aws` command and returns what the process produced. The
  default spawns the CLI; a test, or a build that executes the CLI some other
  way, injects its own with {@link AwsSettings.runner}. The runner only
  produces the output: the exit code is judged afterwards exactly as for a
  spawned process, so a non-zero `code` still raises a `CommandError` unless
  the settings say `.noThrow()`.

type AwsSsmParameterType = "String" | "StringList" | "SecureString"
  The kinds of parameter Parameter Store keeps.

type AwsTime = Date | string
  A time given as a `Date` or as a string the CLI parses (ISO 8601).
````

</details>

<!-- ZUKE:API:END -->
