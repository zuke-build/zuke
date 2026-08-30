# @zuke/gcloud

Typed [`gcloud`](https://cloud.google.com/sdk/gcloud) (Google Cloud SDK) task
wrapper for [Zuke](https://github.com/zuke-build/zuke#readme) builds, in a
fluent settings-lambda API. `gcloud` is vast, so this is a flexible command
builder: name the command with `.command(...)`, set the common global flags
fluently, and pass anything else with `.flag(...)`. Arguments stay a discrete
argv array, so command construction is injection-free.

```ts
import { GcloudTasks } from "jsr:@zuke/gcloud";

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
import { GcsTasks, SecretManagerTasks } from "jsr:@zuke/gcloud";

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

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/gcloud` — typed Google Cloud tooling for Zuke builds: the `gcloud`
(Google Cloud SDK) CLI wrapper, plus GCS and Secret Manager REST task
groups that share `gcloud`-based auth (no Google SDK dependency).

```ts
import { GcloudTasks, GcsTasks, SecretManagerTasks } from "jsr:@zuke/gcloud";

await GcloudTasks.run((s) => s.containerImagesAddTag(src, dst)); // CLI
await GcsTasks.writeJson("bucket", "state.json", { slot: "sit-7" }); // REST
const pw = await SecretManagerTasks.access("db-password", { project }); // REST
```

The CLI wrapper builds a discrete argv array (never a shell string), and the
REST groups take an injectable `fetch`, so both are testable without network
or a real cluster.
@module

function gcloudAccessToken(run: GcloudRunner): Promise<string>
  The default {@link AccessTokenProvider}: the trimmed stdout of
  `gcloud auth print-access-token`, run with `--quiet` so the token never
  streams to the build log. `run` defaults to {@link "./gcloud.ts".GcloudTasks}
  `.run` and is injectable for tests.

function resolveAccessToken(options: { token?: string; tokenProvider?: AccessTokenProvider; }): Promise<string>
  Resolve a bearer token from an explicit `token` or, when it is omitted, the
  `tokenProvider` (defaulting to {@link gcloudAccessToken}). Shared by the REST
  task groups so every call resolves auth the same way.

const GcloudTasks: GcloudTasksApi
  Typed task functions for the `gcloud` CLI.

const GcsTasks: GcsTasksApi
  Typed Google Cloud Storage JSON operations.

const RUN_SERVICE_URL_FORMAT: "value(status.url)"
  The `--format` the service-URL reader pins, so gcloud does the extraction.

const SecretManagerTasks: SecretManagerTasksApi
  Typed Google Secret Manager operations.

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

type GcloudRunner = (configure?: Configure<GcloudSettings>) => Promise<CommandOutput>
  Runs a `gcloud` command — the seam {@link gcloudAccessToken} resolves the
  token through. Defaults to {@link "./gcloud.ts".GcloudTasks} `.run`; injectable
  so the default provider is unit-testable without invoking `gcloud`.
````

</details>

<!-- ZUKE:API:END -->
