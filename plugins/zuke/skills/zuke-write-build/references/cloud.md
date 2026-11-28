# Cloud, mobile and signing wrappers

gcloud, AWS, Azure, Kubernetes, Apple, Google Play and Windows signing.

> Confirm exact signatures against the version the project has installed: on
> Node, `node_modules/@zuke/<package>/README.md` (its `## API` section) and the
> `.d.ts` files; on Deno, `deno doc jsr:@zuke/<package>`. For breadth, use
> `llms-full.txt`
> (<https://raw.githubusercontent.com/zuke-build/zuke/master/llms-full.txt>,
> which tracks `master`). This file is a summary, not the source of truth.

## In brief

- **AWS (`@zuke/aws`):** `AwsTasks` types the deploy path with the CLI's own
  names — `s3Sync`, `ecrLoginPassword`, `ecsUpdateService` +
  `ecsWaitServicesStable`, `lambdaUpdateFunctionCode`, `cloudformationDeploy`,
  `eksUpdateKubeconfig`, … — and readers hand back values: `accountId`,
  `secretString`, `parameterValue`, `stackOutput(stack, key)`,
  `lambdaPublishedVersion`, `metricValue` (CloudWatch, `.missingDataAs(0)` for
  no data), `alarmState`, `logsInsightsQuery` (polls to `Complete`). Credential
  commands run quietly and register what they return as secrets; every settings
  class takes `.runner(fn)` so tests never spawn `aws`. For canaries,
  `cloudwatch((m) => m.namespace(…).metricName(…).stat("Sum").max(5))` is an
  analysis. Detail below.
- **Azure (`@zuke/az`):** `AzTasks` types the deploy path with the CLI's own
  names — `login` (federated token, certificate or managed identity),
  `acrBuild`, `containerappUpdate` + `containerappIngressTrafficSet`,
  `webappDeploy`, `deploymentGroupCreate`, `aksGetCredentials`, … — and readers
  hand back values: `subscriptionId`, `accessToken`, `secretValue`, `acrToken`,
  `containerappFqdn`, `webappHostName`, `deploymentOutput(group, name, key)`,
  `metricValue` (Azure Monitor, `.missingDataAs(0)` for no data),
  `logAnalyticsQuery`. Secrets reach the CLI on stdin, credential commands run
  quietly and register what they return, a typed value the CLI would read as an
  `@file` is refused, and every settings class takes `.runner(fn)`. For
  canaries, `azureMonitor((m) => m.resource(id).metric(…).aggregation("Count")
  .max(5))` is an analysis. Detail below.
- **iOS app builds (`@zuke/apple`):** `XcodebuildTasks.archive((s) =>
  s.workspace(w).scheme(scheme).configuration("Release")
  .destination("generic/platform=iOS").archivePath(a))`, then
  `writeExportOptions(plist, (o) => o.method("app-store-connect").teamId(t))`
  and `exportArchive((s) => s.archivePath(a).exportPath(dir)
  .exportOptionsPlist(plist))`; `.destination("upload")` in the export options
  uploads to App Store Connect. Also `build`, `test`, `clean`,
  `resolvePackageDependencies`, `showBuildSettings`. Wrap the signing steps in
  `ProvisioningProfileTasks.temporary((s) => s.base64(profile), async ({ profile
  }) => …)` to install the profile and always remove it
  (`profile.uuid`/`bundleId` feed the export options), then
  `TestFlightTasks.distribute((s) => s.issuerId(i).keyId(k).privateKey(p8)
  .bundleId(b).buildNumber(n).usesNonExemptEncryption(false).group("QA"))` waits
  for App Store Connect to process the build and distributes it.
  `AltoolTasks.uploadApp` wraps the deprecated `altool`. Detail below.
- **Google Play (`@zuke/google`):** `GooglePlayTasks.upload((s) =>
  s.serviceAccount(keyJson)
  .packageName(p).bundle(aab).track("internal").status("completed")
  .releaseNotes(t, "en-US"))` signs in as the service account, uploads the
  bundle in one edit, releases its `versionCode` on the track and commits (the
  edit is deleted on failure). `.status("draft")` for an app that has never had
  a release, `.changesNotSentForReview()` where Google requires it. Detail
  below.
- **Apple signing (`@zuke/apple`):** `CodesignTasks.sign`/`verify`/`display`,
  `DittoTasks.archive` (the zip notarization wants — `ditto -c -k
  --keepParent`), `NotarytoolTasks.submit`/`info`/`log`/`history` (always
  `--output-format json`, parsed; with `.wait()` anything but `Accepted` throws
  a `NotarizationError` listing the log's issues) and `SecurityTasks` named
  after the `security` subcommands. For CI, wrap signing in
  `SecurityTasks.temporaryKeychain((s) => s.certificate(p12Base64)
  .certificatePassword(pw), async ({ keychain, identity }) => …)`: it creates,
  unlocks and imports into a throwaway keychain and always deletes it and
  restores the search list, even when the callback throws. Passwords are masked
  in every rendering and error. Detail below.
- **Windows signing (`@zuke/signpath`):** `SignPathTasks.submit((s) =>
  s.organizationId(org).apiToken(token).projectSlug(p).signingPolicySlug(q)
  .gitHubOrigin((g) => g.artifactId(id)).output(path))` submits to SignPath
  (GitHub-origin verified, or `.artifact(path)` to upload), waits (`.timeout()`,
  `.pollInterval()`), throws `SignPathSigningError` / `SignPathTimeoutError`
  naming the request and its web URL, and downloads the signed file;
  `status`/`download` take an existing id. `SigntoolTasks.verify` wraps
  `signtool verify /pa /v`. Tokens are scrubbed from every error. Detail below.

git's **exit status**, where a `1` is a legitimate "no" rather than a failure.
They read it back as a boolean, and still raise when git fails for a different
reason — a revision that names no object, say — so a mistyped ref never comes
back as a confident `false`. `mergesCleanly` tests a merge without touching the
index or working tree, which is how a build checks mergeability without a
checkout.

`merge`, `rebase`, `cherryPick`, and `revert` share `.continue()`, `.abort()`,
`.skip()`, `.quit()` for an operation a conflict left in progress.

### Google Cloud — `GcloudTasks`

The deploy path is typed, so a build never string-builds it:

| Area        | Tasks                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Auth        | `authActivateServiceAccount`, `authConfigureDocker`, `authList`, `authRevoke`                  |
| Config      | `configSet`, `configUnset`, `configGetValue`, `configList`                                     |
| Cloud Build | `buildsSubmit`, `buildsList`, `buildsDescribe`, `buildsLog`                                    |
| Cloud Run   | `runDeploy`, `runServicesUpdate`, `runServicesDescribe`, `runServicesList`, `runUpdateTraffic` |
| Registry    | `artifactsImagesList`, `artifactsImagesDelete`, `artifactsRepositoriesList/Describe`           |
| Storage     | `storageCp`, `storageRsync`, `storageLs`, `storageRm`                                          |
| GKE         | `clustersGetCredentials`, `clustersList`, `clustersDescribe`                                   |
| Functions   | `functionsDeploy`, `functionsDescribe`                                                         |
| Secrets     | `secretsAccess`                                                                                |
| Logging     | `loggingRead`, `loggingLogsList`                                                               |
| Monitoring  | `monitoringPoliciesList/Describe`, `monitoringDashboardsList`, `monitoringUptimeListConfigs`   |

`runDeploy` and `runServicesUpdate` are not interchangeable: `run deploy`
creates the service when it is absent and resets settings the call does not
name, while `run services update` only ever amends an existing one. Reach for
the second when a pipeline points a live service at a new image.

`GcloudTasks.run` with `.command(...)` remains the escape hatch for the rest of
gcloud, which is vast — but reaching for it where a typed task exists discards
the flags and the refusals.

Some tasks hand back **values**:

```ts
const token = await GcloudTasks.accessToken();
const idToken = await GcloudTasks.identityToken((s) => s.audiences(serviceUrl));
const project = await GcloudTasks.configValue((s) => s.property("project"));
const url = await GcloudTasks.runServiceUrl((s) =>
  s.service("api").region("us-central1")
);
const secret = await GcloudTasks.secretValue((s) => s.secret("api-key"));
```

They pin gcloud's own `value(...)` projection where a field has to be picked
out, so **gcloud** does the extraction and nothing here parses a JSON document.
Each refuses an empty answer rather than returning `""` — an unset property and
a missing field both look like that, and an empty token or URL fails far from
its cause. They run quiet, so a token never reaches the build log.

`clustersGetCredentials` is the bridge to `@zuke/kubectl`: it writes the
kubeconfig entry every kubectl task then works against.

A log filter is built from typed parts — `resourceType`, `resourceLabel`,
`label`, `minSeverity`, `since`, `until` — each value quoted and escaped, plus
raw `.filter(...)` text, joined with `AND`. `logEntryCount` counts the matches,
reading only each entry's id (no payload reaches the build), and fails rather
than return a truncated count when more than `.limit(n)` (default 1000) match.
`.freshness(...)` becomes an explicit `timestamp>=` bound (gcloud's own
`--freshness` is silently dropped when the filter mentions `timestamp`), and a
count with no bound counts the last day:

```ts
const errors = await GcloudTasks.logEntryCount((s) =>
  s.resourceType("cloud_run_revision").minSeverity("ERROR").freshness("15m")
);
```

gcloud cannot read a metric's time series, so `CloudMonitoringTasks` reads them
over the REST API with the same gcloud-based token. The filter is typed too
(`metricType`, `resourceType`, `resourceLabel`, `metricLabel`, raw `.filter`);
every page is read up to `.maxPages(n)`, and a read with pages left over fails.
`metricValue`'s `"latest"` sums each series' newest point; distribution means
are averaged by count and never summed; a `CUMULATIVE` metric needs
`ALIGN_DELTA`/`ALIGN_RATE`; `.delay(...)` ends the window early for ingestion
lag:

```ts
const series = await CloudMonitoringTasks.timeSeriesList((s) =>
  s.project("p").metricType("run.googleapis.com/request_count")
    .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
    .crossSeriesReducer("REDUCE_SUM").window("15m")
);
const fiveXx = await CloudMonitoringTasks.metricValue((s) =>
  s.project("p").metricType("run.googleapis.com/request_count")
    .metricLabel("response_code_class", "5xx")
    .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
    .crossSeriesReducer("REDUCE_SUM")
    .window("15m").aggregate("sum").missingDataAs(0)
);
```

### AWS — `AwsTasks`

The deploy path is typed, with the CLI's own subcommand and flag names:

| Area           | Tasks                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STS            | `stsGetCallerIdentity`, `stsAssumeRole`                                                                                                                                           |
| Config         | `configureGet`, `configureSet`                                                                                                                                                    |
| S3             | `s3Cp`, `s3Sync`, `s3Ls`, `s3Rm`, `s3Mb`, `s3Presign`                                                                                                                             |
| ECR            | `ecrGetLoginPassword`, `ecrDescribeImages`, `ecrDescribeRepositories`, `ecrBatchDeleteImage`                                                                                      |
| ECS            | `ecsRegisterTaskDefinition`, `ecsUpdateService`, `ecsWaitServicesStable`, `ecsDescribeServices`, `ecsRunTask`                                                                     |
| Lambda         | `lambdaUpdateFunctionCode`, `lambdaUpdateFunctionConfiguration`, `lambdaPublishVersion`, `lambdaGetAlias`, `lambdaUpdateAlias`, `lambdaGetFunction`, `lambdaWait`, `lambdaInvoke` |
| CloudFormation | `cloudformationDeploy`, `cloudformationDescribeStacks`, `cloudformationDeleteStack`, `cloudformationWait`                                                                         |
| Secrets        | `secretsmanagerGetSecretValue`, `ssmGetParameter`, `ssmPutParameter`                                                                                                              |
| EKS            | `eksUpdateKubeconfig`, `eksDescribeCluster`                                                                                                                                       |
| CloudWatch     | `cloudwatchGetMetricData`, `cloudwatchGetMetricStatistics`, `cloudwatchDescribeAlarms`                                                                                            |
| Logs           | `logsStartQuery`, `logsGetQueryResults`, `logsStopQuery`, `logsFilterLogEvents`, `logsTail`                                                                                       |

`AwsTasks.run((s) => s.command("sns", "publish").flag("topic-arn", arn))` is the
escape hatch for the rest. Global options on every settings class: `profile`,
`region`, `output`, `query`, `endpointUrl`, `noCliPager`, `noVerifySsl`,
`noSignRequest`, `caBundle`, `cliReadTimeout`, `cliConnectTimeout`, `debug`.
`AWS_PAGER=""` and `AWS_CLI_AUTO_PROMPT=off` are always set for the child, so
the CLI never waits for a keypress. Typed options go as one `--flag=value`
token; a positional or list element starting with `-` is refused (it would be
read as an option, `--endpoint-url=…` included), and free-text setters refuse
`file://`/`fileb://` (the CLI would send that file). `.flag()`/`.args()` guard
neither.

Some tasks hand back **values**:

```ts
const account = await AwsTasks.accountId((s) => s.profile("deploy"));
const password = await AwsTasks.ecrLoginPassword((s) => s.region("eu-west-1"));
const dbUrl = await AwsTasks.secretString((s) => s.secretId("prod/db"));
const flag = await AwsTasks.parameterValue((s) => s.name("/api/flag"));
const url = await AwsTasks.stackOutput("api", "ServiceUrl");
const version = await AwsTasks.lambdaPublishedVersion((s) =>
  s.functionName("api")
);
const errors = await AwsTasks.metricValue((s) =>
  s.metricStat("errors", (m) =>
    m.namespace("AWS/Lambda").metricName("Errors")
      .dimension("FunctionName", "api").stat("Sum")).window("15m").aggregate(
      "sum",
    ).missingDataAs(0)
);
const state = await AwsTasks.alarmState("api-5xx"); // "OK" | "ALARM" | "INSUFFICIENT_DATA"
const rows = await AwsTasks.logsInsightsQuery((q) =>
  q.logGroupNames("/ecs/api").queryString("stats count(*)").window("30m")
    .timeout("2m").aws((a) => a.region("eu-west-1"))
);
```

- Readers pin `--query` / `--output` after your lambda and run quietly. A value
  that may be absent or multi-line (secret, parameter, stack output) is read as
  JSON, so a binary secret or a missing output fails instead of returning
  `None`. Unusable output is an `AwsOutputError` (never quoting the output); a
  Logs Insights query ending `Failed`/`Cancelled`/`Timeout`, or outlasting
  `.timeout(...)` (then stopped), is an `AwsLogsQueryError`.
- `metricValue` fails on no datapoints unless `.missingDataAs(0)`; with several
  series name one with `.id(...)`; it refuses `.maxDatapoints(...)`, which turns
  off the CLI's pagination. `logsInsightsQuery` follows `nextToken` pages and
  takes `.signal(ctx.signal)` to cancel the wait (the query is stopped).
- Secrets: `stsAssumeRole`, `ecrGetLoginPassword`,
  `secretsmanagerGetSecretValue`, `ssmGetParameter`, `s3Presign` and a
  credential `configureGet` always run quietly and register what they return
  with the redactor (the JSON ones with `--output json` pinned).
  `lambdaPublishedVersion` **publishes** a version — it is not a lookup. Write a
  `SecureString` with `.valueFile(path)` (`file://`, off the command line);
  `.value(...)` refuses a `file://`/`fileb://` prefix. Feed `ecrLoginPassword()`
  to `DockerTasks.login((s) => s.passwordStdin(pw))`.
- Every settings class takes `.runner((settings) => Promise<CommandOutput>)` —
  the seam a test answers through instead of spawning `aws`; the exit code is
  still judged.

### Azure — `AzTasks`

The deploy path is typed, with the CLI's own subcommand and flag names:

| Area           | Tasks                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in        | `login` (service principal + `.federatedToken` / `.certificate` / `.password`, or `.identity()`), `logout`                                           |
| Account        | `accountShow`, `accountSet`, `accountList`, `accountGetAccessToken`                                                                                  |
| Groups         | `groupCreate`, `groupShow`, `groupDelete` (`.yes()`), `groupExists`                                                                                  |
| ACR            | `acrLogin`, `acrBuild`, `acrRepositoryShowTags`, `acrRepositoryDelete`                                                                               |
| AKS            | `aksGetCredentials`, `aksShow`                                                                                                                       |
| Container Apps | `containerappUpdate`, `containerappShow`, `containerappRevisionList`, `containerappRevisionActivate` / `Deactivate`, `containerappIngressTrafficSet` |
| App Service    | `webappDeploy`, `webappShow`, `webappConfigAppsettingsSet`, `webappDeploymentSlotSwap`, `functionappDeploymentSourceConfigZip`                       |
| Key Vault      | `keyvaultSecretShow`, `keyvaultSecretSet` (`.file(path)` or `.value(...)` on stdin)                                                                  |
| Deployments    | `deploymentGroupCreate`, `deploymentGroupWhatIf`, `deploymentGroupShow` (always `--no-prompt=true`)                                                  |
| Storage        | `storageBlobUpload`, `storageBlobDownload`, `storageBlobUploadBatch` (prefer `.authMode("login")`)                                                   |
| Monitor        | `monitorMetricsList`, `monitorMetricsListDefinitions`, `monitorMetricsAlertList` / `Show`, `monitorActivityLogList`, `monitorLogAnalyticsQuery`      |

`AzTasks.run((s) => s.command("network", "front-door", "purge").flag(...))` is
the escape hatch for the rest. Global options on every settings class:
`subscription`, `output`, `query`, `onlyShowErrors`, `verbose`, `debug`.
`AZURE_EXTENSION_USE_DYNAMIC_INSTALL=no`, `AZURE_CORE_LOGIN_EXPERIENCE_V2=off`
and `AZURE_CORE_NO_COLOR=true` are always set for the child, so the CLI never
prompts for or silently installs an extension — add extensions (e.g.
`log-analytics`) up front; a missing one fails as "misspelled or not recognized"
(the log-analytics tasks name the extension). Typed options go as one
`--flag=value` token; a positional or list element starting with `-` is refused,
and so is any typed value the CLI would replace with a file — it expands an
`@`-leading argument, or the value after a `key=` in one, from disk (`@-` from
stdin). `.flag()`/`.args()`/`.command()` guard neither.

Some tasks hand back **values**:

```ts
const subscription = await AzTasks.subscriptionId();
const token = await AzTasks.accessToken((s) =>
  s.resource("https://vault.azure.net")
);
const dbPassword = await AzTasks.secretValue((s) =>
  s.vaultName("kv-prod").name("db-password")
);
const acr = await AzTasks.acrToken((s) => s.name("myregistry"));
const fqdn = await AzTasks.containerappFqdn((s) =>
  s.name("api").resourceGroup("rg-prod")
);
const url = await AzTasks.deploymentOutput("rg-prod", "release-42", "apiUrl");
const failures = await AzTasks.metricValue((s) =>
  s.resource(appInsightsId).metrics("requests/failed").aggregation("Count")
    .window("15m").aggregate("sum").missingDataAs(0)
);
const rows = await AzTasks.logAnalyticsQuery((q) =>
  q.workspace(workspaceId).analyticsQuery("AppRequests | count")
    .timespan("30m")
);
```

- Readers pin `--query` / `--output` after your lambda, run quietly and insist
  on success even under `.noThrow()`. Unusable output is an `AzOutputError`
  (never quoting the output).
- `metricValue` needs exactly one `.aggregation(...)`, fails on no data unless
  `.missingDataAs(0)`, spans every series (`"latest"` sums them at the newest
  timestamp), and refuses a filtered or split answer that reached `--top` (ten
  series by default). `logAnalyticsQuery` rows are all strings (`"None"` for
  empty).
- Secrets go to the CLI on **stdin** (`--password=@-`, `--federated-token=@-`,
  `--value=@-`, `--account-key=@-`), never the argv, and are registered with the
  redactor. `accountGetAccessToken`, `acrLogin`, `keyvaultSecretShow` and
  `keyvaultSecretSet` run quietly with `--output json` pinned and mask what they
  print. App settings reference Key Vault with `.keyVaultReference(name, uri)`.
- Every settings class takes `.runner((settings) => Promise<CommandOutput>)` —
  the seam a test answers through instead of spawning `az`.

### Apple signing — `@zuke/apple`

`CodesignTasks`, `NotarytoolTasks`, `SecurityTasks` and `DittoTasks` mirror
`codesign`, `xcrun notarytool`, `security` and `ditto`. A CI job signs from a
throwaway keychain, zips with `ditto`, and notarizes:

```ts
await SecurityTasks.temporaryKeychain(
  (s) => s.certificate(this.p12.value).certificatePassword(this.p12Pass.value),
  async ({ keychain, identity }) => {
    await CodesignTasks.sign((s) =>
      s.identity(identity.hash).keychain(keychain).options("runtime")
        .timestamp().force().file("dist/MyApp.app")
    );
  },
);
await CodesignTasks.verify((s) => s.strict().deep().file("dist/MyApp.app"));
await DittoTasks.archive((s) =>
  s.keepParent().source("dist/MyApp.app").destination("dist/MyApp.zip")
); // ditto -c -k --keepParent
const result = await NotarytoolTasks.submit((s) =>
  s.file("dist/MyApp.zip").key("AuthKey.p8").keyId(keyId).issuer(issuer)
    .wait().timeout("30m")
); // { id, status, message }
```

- `temporaryKeychain` reads the user search list, creates a uniquely named
  keychain with a random password in a private temp dir, turns auto-lock off,
  unlocks it, imports the decoded `.p12` from a `0600` file it deletes at once,
  runs `set-key-partition-list -S apple-tool:,apple:`, puts the keychain first
  on the search list and resolves the one codesigning identity
  (`.identity(nameOrHash)` picks among several). Cleanup — delete the keychain,
  restore the list, remove the dir — always runs; a failed cleanup step throws
  `KeychainCleanupError` with the callback's error as its `cause`.
- The search list is per user, so keychain lifetimes are serialized within a
  process — a second `temporaryKeychain` (a parallel target in a `group()`)
  waits for the first to be torn down. Separate processes as the same user (two
  builds, two jobs on one self-hosted runner account) cannot see that lock and
  must not sign at the same time.
- `--dry-run` echoes commands instead of running them and wrappers cannot tell,
  so `temporaryKeychain` fails with "no valid codesigning identity" and
  `NotarytoolTasks` fail with `NotarytoolOutputError` — keep signing and
  notarization targets out of a dry run.
- `NotarytoolTasks.submit` pins `--output-format json`. With `.wait()`, a status
  other than `Accepted` fetches `notarytool log` with the same credentials and
  throws `NotarizationError` (`.submission`, `.log.issues`); `.noThrow()`
  returns the result instead. Authenticate with exactly one of `.key().keyId()
  [.issuer()]`, `.keychainProfile(name)`, or `.appleId().password().teamId()`.
- Every password (`-p`, `-P`, `-k`, `--password`) is registered with the run's
  redactor and masked out of any `CommandError` — but it is still an argv token
  while the command runs, so prefer the API key and the random keychain password
  `temporaryKeychain` generates.
- A path operand that starts with `-` is passed as `./-…`, so a file name can
  never be read as a flag.

### Google Play — `@zuke/google`

`GooglePlayTasks.upload` is the counterpart of `TestFlightTasks.distribute`: it
ships the `.aab` that `FlutterTasks.buildAppBundle` built to a Play track
through the Google Play Developer API, with no CLI to install:

```ts
import { GooglePlayTasks } from "@zuke/google";

await GooglePlayTasks.upload((s) =>
  s.serviceAccount(this.playKey.value) // the key JSON's text; a secret parameter
    .packageName("com.example.app")
    .bundle("build/app/outputs/bundle/release/app-release.aab")
    .track("internal") // internal | alpha | beta | production | a closed track
    .status("completed") // or "draft"
    .releaseNotes("The latest build.", "en-US") // repeatable, one per language
    .timeout("15m")
);
```

- It signs the service account's RS256 JWT, exchanges it for an access token
  (scope `androidpublisher`), opens an edit, uploads the bundle, reads back its
  `versionCode`, sets the track's release to that code with the status and
  notes, and commits — or deletes the edit when a step fails. It returns the
  `versionCode`, track and status.
- `.status("draft")` is the only status Google accepts for an app that has never
  had a release; `.changesNotSentForReview()` commits without sending the
  changes for review, where Google requires that.
- The key and the token never reach a progress line or an error; a refused step
  throws `GooglePlayError` with Google's message and the HTTP status.

### Windows signing — `@zuke/signpath`

`SignPathTasks` submits to [SignPath](https://about.signpath.io) (free for OSS
through the SignPath Foundation) and `SigntoolTasks.verify` checks the result on
a Windows runner. From GitHub Actions, upload the file with
`actions/upload-artifact` (v4+) and let SignPath fetch it and verify the run:

```ts
const { signingRequestId } = await SignPathTasks.submit((s) =>
  s.organizationId(this.signpathOrg.value).apiToken(this.signpathToken.value)
    .projectSlug("zuke").signingPolicySlug("release-signing")
    .gitHubOrigin((g) => g.artifactId(this.artifactId.value))
    .timeout("30m").output("dist/signed/zuke.zip")
); // { signingRequestId, webUrl, status, signedArtifact }
await SigntoolTasks.verify((s) =>
  s.authenticodePolicy().verbose().file("dist/signed/zuke.exe")
); // signtool verify /pa /v …
```

- `.gitHubOrigin(...)` posts to SignPath's GitHub connector exactly as
  `signpath/github-action-submit-signing-request` does; run id, repository and
  token default to `GITHUB_RUN_ID`, `GITHUB_REPOSITORY`, `GITHUB_TOKEN`. An
  origin that does not verify throws `SignPathValidationError` with the
  connector's errors. `.artifact(path)` uploads directly instead
  (`SubmitWithArtifact`). Exactly one is required.
- `submit` polls every `.pollInterval()` (10s) up to `.timeout()` (10m):
  `Completed` returns; `Denied`/`Failed`/`Canceled` throw
  `SignPathSigningError`; the deadline throws `SignPathTimeoutError` — both name
  the request id and its SignPath web URL. `SignPathTasks.status` / `download`
  work on an existing id.

Where gh would **prompt**, the settings refuse first: `releaseDelete`,
`labelDelete`, `repoRename`, `repoArchive` and `repoDelete` need `.yes()`, a
comment's `.deleteLast()` does too, `issueCreate` needs `.title(...)`, and
`repoCreate` needs `.visibility(...)` because gh will not guess whether a new
repository is public. Every `run` command needs its `.selector(...)`, since gh
otherwise shows a picker. Flag pairs gh resolves silently in its own favour — a
draft that is also the latest release, `--pattern` alongside `--archive` — are
refused too, so a build never gets an outcome other than the one it asked for.

### Kubernetes — `KubectlTasks`

| Area                 | Tasks                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manifests            | `apply`, `create`, `replace`, `delete`, `diff`, `diffHasChanges`, `kustomize`                                                                                      |
| Resources            | `get`, `getEntries`, `getNamespaces`, `describe`, `patch`, `annotate`, `label`, `explain`                                                                          |
| Workloads            | `rollout`, `scale`, `setImage`, `setEnv`, `setResources`, `run`, `expose`                                                                                          |
| Pods                 | `logs`, `exec`, `cp`, `portForward`                                                                                                                                |
| Diagnostics          | `wait`, `top`, `events`, `eventEntries`                                                                                                                            |
| Cluster & kubeconfig | `currentContext`, `contexts`, `useContext`, `setContext`, `configView`, `version`, `versionInfo`, `clusterInfo`, `apiResources`, `apiVersions`, `authCanI`, `canI` |
| Nodes                | `cordon`, `drain`, `taint`                                                                                                                                         |

**Two exit codes are answers, not failures.** `kubectl diff` exits 1 when it
finds differences and `auth can-i` exits non-zero when the action is not
allowed, so each has a task that keeps the ordinary contract and a reader that
hands back the value. Anything above those codes still fails the build.

```ts
// Fails the target on drift — what a gate wants.
await KubectlTasks.diff((s) => s.file("k8s/").serverSide());
// Reads the same thing as a value, so the build decides.
const drifted = await KubectlTasks.diffHasChanges((s) => s.file("k8s/"));
const allowed = await KubectlTasks.canI((s) =>
  s.verb("create").resource("deployments")
);

const context = await KubectlTasks.currentContext();
await KubectlTasks.useContext((s) => s.contextName("staging"));
const events = await KubectlTasks.eventEntries((s) =>
  s.forResource("deploy/api")
);
await KubectlTasks.rollout((s) => s.pause().resource("deploy/api"));
await KubectlTasks.cp((s) =>
  s.from("prod/api-0:/out/report.xml").to("reports/")
);
await KubectlTasks.drain((s) =>
  s.node("w1").ignoreDaemonSets().deleteEmptyDirData()
);
```

`.context(...)` is the global flag pointing one command at a context;
`.contextName(...)` on `useContext`/`setContext` is the operand naming the
context to switch to. Two methods are renamed off the CLI because the base class
already owns the name: kubectl's `--quiet` on `auth can-i` is `.quietAnswer()`
(`.quiet()` suppresses Zuke's own echo), and `kubectl run --env` is
`.envVar(key, value)` (`.env(...)` sets kubectl's own environment).
