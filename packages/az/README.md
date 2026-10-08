# @zuke/az

Typed [`az`](https://learn.microsoft.com/cli/azure/) (Azure CLI) task wrapper
for [Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Typed settings cover a deploy path's commands — login,
account, resource groups, ACR, AKS, Container Apps, App Service, Functions, Key
Vault, resource-group deployments, blob storage and Azure Monitor — with the
CLI's own subcommand and flag names; a general builder covers everything else.
Arguments stay a discrete argv array, so command construction is injection-free.

## Usage

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { AzTasks } from "@zuke/az";

class Deploy extends Build {
  oidcToken = parameter("The workflow's OIDC token").secret().required();

  login = target().executes(async () => {
    await AzTasks.login((s) =>
      s.servicePrincipal().username("app-client-id").tenant("tenant-id")
        .federatedToken(this.oidcToken.value)
    );
  });

  image = target().dependsOn(this.login).executes(async () => {
    await AzTasks.acrBuild((s) =>
      s.registry("myregistry").image("api:1.4.0").source(".")
    );
  });

  roll = target().dependsOn(this.image).executes(async () => {
    await AzTasks.containerappUpdate((s) =>
      s.name("api").resourceGroup("rg-prod")
        .image("myregistry.azurecr.io/api:1.4.0").revisionSuffix("v140")
    );
  });
}

await run(Deploy);
```

Anything without a typed task goes through `run` and the general builder —
`.command(group, …, verb)`, the global options, and `.flag(name, value?)` /
`.args(...)`:

```ts
await AzTasks.run((s) =>
  s.command("network", "front-door", "purge")
    .flag("resource-group", "rg-prod").flag("name", "edge")
    .subscription("prod")
);
```

The global options mirror the CLI's: `subscription`, `output` (`json`, `jsonc`,
`yaml`, `yamlc`, `table`, `tsv`, `none`), `query`, `onlyShowErrors`, `verbose`
and `debug`. Every command runs with three of the CLI's configuration variables
set in its environment, so it never waits on a keypress or installs code behind
the build's back:

| Variable                                 | Effect                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AZURE_EXTENSION_USE_DYNAMIC_INSTALL=no` | A command from an extension that is not installed fails — instead of prompting, or silently installing it when there is no terminal. The CLI's message does not name the extension (`'query' is misspelled or not recognized by the system`, exit 2), so add extensions up front. |
| `AZURE_CORE_LOGIN_EXPERIENCE_V2=off`     | An interactive `az login` does not open its subscription selector.                                                                                                                                                                                                                |
| `AZURE_CORE_NO_COLOR=true`               | No ANSI colour codes in captured output.                                                                                                                                                                                                                                          |

Override any of them with `.env({...})`. A confirmation prompt — `group delete`,
`acr repository delete` — is not switched off: call the command's `.yes()`.

## Argument safety

Every typed option is sent as one `--flag=value` token, so a value that starts
with `-` stays a value. A positional operand or an element of a list-valued
option (`--metrics`, `--tags`, `--set-env-vars`, …) is a token of its own, so
one that starts with `-` is refused rather than letting the CLI read it as an
option.

The Azure CLI replaces any argument that starts with `@` — or, in a `key=value`
token, whose value after the first `=` does — with the contents of the file it
names, and `@-` with standard input, before the command is even parsed. Every
typed setter refuses such a value, so
`tag("k", "@~/.azure/msal_token_cache.json")` cannot send the CLI's token cache
to Azure. The one deliberate exception is `keyVaultReference(name, uri)` on app
settings, which writes the `@Microsoft.KeyVault(SecretUri=…)` form App Service
resolves. `.flag(...)`, `.args(...)` and `.command(...)` are the escape hatches
and guard neither, so never give them an untrusted value.

## Readers

A reader returns a value instead of the command's output. It pins `--query` and
`--output` after your lambda, so the CLI does the extraction, and runs quietly:

| Reader                               | Runs                                                      | Returns                                                       |
| ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------- |
| `accessToken()`                      | `account get-access-token --query accessToken`            | a bearer token, registered as a secret                        |
| `subscriptionId()`, `tenantId()`     | `account show --query id` / `tenantId`                    | the id                                                        |
| `secretValue((s) => …)`              | `keyvault secret show --query value`                      | the secret, exactly — multi-line values included              |
| `acrToken((s) => s.name(r))`         | `acr login --expose-token --query accessToken`            | a registry token, for `docker login`                          |
| `containerappFqdn((s) => …)`         | `containerapp show --query properties.configuration…fqdn` | the ingress FQDN                                              |
| `webappHostName((s) => …)`           | `webapp show --query defaultHostName`                     | the host name                                                 |
| `deploymentOutput(group, name, key)` | `deployment group show --query properties.outputs`        | one output (a non-string one as JSON)                         |
| `resourceGroupExists(name)`          | `group exists`                                            | `true` or `false`                                             |
| `metricValue((s) => …)`              | `monitor metrics list`                                    | the newest interval, or a `sum`/`average`/`maximum`/`minimum` |
| `logAnalyticsQuery((q) => …)`        | `monitor log-analytics query`                             | the rows, every cell a string                                 |

```ts
const failures = await AzTasks.metricValue((s) =>
  s.resource(appInsightsId).metrics("requests/failed").aggregation("Count")
    .dimension("cloud/roleName", "api").window("15m").aggregate("sum")
    .missingDataAs(0)
);
```

`metricValue` needs exactly one `aggregation`. Azure Monitor reports an interval
with no data without a value, so a missing value is no data, not zero; the
reader fails on no data unless `.missingDataAs(value)` says what it means. Every
aggregate spans every series the answer holds; `"latest"` sums the series at the
newest timestamp. A filtered or split query returns at most `--top` series per
metric (ten by default), so the reader refuses an answer that reached the limit
rather than total a partial one — conservatively, since exactly `top` series may
be complete. The range set by `.window(...)` is not aligned to the interval, so
the newest datapoint may cover an interval still being written.

`logAnalyticsQuery` runs a command from the CLI's `log-analytics` extension, a
preview extension — install it with `az extension add --name log-analytics`.
Without it the CLI only says the command is not recognized; the reader, the
`monitorLogAnalyticsQuery` task and the canary's KQL mode turn that into an
error that names the extension. The extension renders every cell as a string,
the way Python prints it: `"42"`, `"True"`, and `"None"` for an empty cell.

Output a reader cannot use — not JSON, the wrong shape, empty, several lines
where one was expected, or a truncated capture — raises an `AzOutputError`,
whose message never quotes the output. A command that fails surfaces as core's
usual `CommandError`, even under `.noThrow()`.

## Secrets

A secret never goes on the command line where the CLI can read it another way.
`login`'s `.password(...)` and `.federatedToken(...)`, `acrLogin`'s
`.password(...)`, `keyvaultSecretSet`'s `.value(...)` and the storage commands'
`.accountKey(...)`, `.sasToken(...)` and `.connectionString(...)` send
`--flag=@-` and hand the value to the CLI on standard input, so it is in neither
the argv nor the process table; each is registered with the run's redactor too.
The CLI strips trailing line breaks from what it reads that way — use
`keyvaultSecretSet((s) => s.file(path))` for a value that must keep them. A SAS
token's `sig` is registered on its own too, as written and URL-encoded, since
the debug log prints the token inside a request URL.

The commands that print a credential — `account get-access-token`,
`acr login --expose-token`, `keyvault secret show` and `keyvault secret set` —
always run quietly with `--output json` pinned, and what they return is
registered with the redactor by core's shared rules (`markSecretsInOutput` in
`@zuke/core/tooling`): the value under its usual key, any credential-named field
(`password`, `db_pwd`, `apiKey`, `accountKey`, `SharedAccessKey`, `sas`,
`connectionString`, `privateKeyPem`, …), and — when a `--query` may have moved
it — the answer whole and every value eight or more characters long. A secret's
own parts are masked on their own too: the fields of a Key Vault secret that is
a JSON object, the password in a connection string or a
`scheme://user:pass@host` URL, and the decoded text of a base64 credential.
`.debug()` registers the credentials the CLI reads from the environment
(`AZURE_STORAGE_KEY`, `AZURE_STORAGE_CONNECTION_STRING`,
`AZURE_STORAGE_SAS_TOKEN`, `AZURE_CLIENT_SECRET`, `AZURE_DEVOPS_EXT_PAT`) — from
the build's environment or set with `.env(...)`, in either order — but its log
can still carry what the CLI holds in its own token cache — keep it out of
shared CI logs.

## Azure Monitor canary analysis

`azureMonitor(...)` is an analysis for a `@zuke/canary` rollout: it reads a
metric over a recent window and fails the canary when any datapoint is out of
bounds — or, with `.kql(workspace, query)`, judges the one number a Log
Analytics query returns.

```ts
import { canary } from "@zuke/canary";
import { azureMonitor } from "@zuke/az";

rollout = canary((c) =>
  c.platform(platform).steps(10, 50)
    .analysis(azureMonitor((m) =>
      m.name("canary failures").resource(appInsightsId)
        .metric("requests/failed").aggregation("Count")
        .dimension("cloud/roleName", "api-canary")
        .window("5m").max(5).missingDataAs(0)
        .az((a) => a.subscription("prod"))
    ))
);
```

`@zuke/az` does not depend on `@zuke/canary`: the analysis has the shape
`c.analysis(...)` accepts. See
[docs/canary.md](https://github.com/zuke-build/zuke/blob/master/docs/canary.md#azure-monitor).

## Testing a build's Azure steps

Every settings class takes `.runner(fn)`, which replaces the spawn: the function
receives the prepared settings (read the argv with `.argv()`) and returns a
`CommandOutput`. The argv is built — and every refusal fires — before the runner
is called, and the exit code is still judged as for a real run, so a build's
Azure steps can be tested without a subscription or the CLI.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/az` — typed Azure CLI tasks for Zuke builds, readers and a canary analysis.

The `az` CLI wrapper has typed settings for the deploy path (login,
account, resource groups, ACR, AKS, Container Apps, App Service, Functions,
Key Vault, deployments, blob storage), Azure Monitor metrics and Log
Analytics, readers that return a value, and an `azureMonitor(...)` analysis
for `@zuke/canary` rollouts.

```ts
import { AzTasks, azureMonitor } from "@zuke/az";

const subscription = await AzTasks.subscriptionId();
await AzTasks.containerappUpdate((s) =>
  s.name("api").resourceGroup("rg-prod").image("myregistry.azurecr.io/api:1.4.0")
);
const failures = await AzTasks.metricValue((s) =>
  s.resource(appInsightsId).metrics("requests/failed").aggregation("Count")
    .window("15m").aggregate("sum").missingDataAs(0)
);
```

The wrapper builds a discrete argv array (never a shell string), and every
settings class takes a `.runner(...)`, so a build's Azure steps are testable
without a subscription or the CLI.
@module

function azureMonitor(configure: Configure<AzMonitorAnalysisSettings>): AzMonitorAnalysis
  An analysis that reads an Azure Monitor metric — or a KQL query — over a
  recent window and fails the canary when any datapoint is out of bounds,
  or when there is no data, unless
  {@link AzMonitorAnalysisSettings.missingDataAs} says what no data means.

  The lambda runs on each check, so it may read resolved parameters, and
  every failure message — one from the lambda included — passes through the
  run's redactor.

const AzTasks: AzTasksApi
  Typed task functions for the `az` CLI.

class AzAccountGetAccessTokenSettings extends AzSettings
  Settings for `az account get-access-token`.

  The answer is a bearer token, so the command always runs quietly —
  captured, never streamed — with `--output json` pinned whatever the
  settings or the user's config say, and the token is registered with the
  run's redactor once it returns.

  constructor()
    Settings that capture the token instead of streaming it.
  resource(uri: string): this
    The resource the token is for, as a Microsoft Entra v1.0 endpoint (`--resource`).
  resourceType(type: AzAccessTokenResourceType): this
    A well-known resource the token is for (`--resource-type`).
  scope(...scopes: string[]): this
    Microsoft Entra v2.0 scopes for the token (`--scope`); repeatable.
  tenant(tenant: string): this
    The tenant to get the token from (`--tenant`).
  override protected pinnedOutput(): AzOutputFormat
    Pin `--output json`, the form the returned token can be found in.
  override protected onOutput(output: CommandOutput): void
    Register the returned access token as a secret.
  override protected leadingTokens(): string[]
    Emit `account get-access-token` with its options.

class AzAccountListSettings extends AzSettings
  Settings for `az account list`.

  all(): this
    Include subscriptions from every cloud and in every state (`--all`).
  refresh(): this
    Read the subscriptions from the server, not the cache (`--refresh`).
  override protected leadingTokens(): string[]
    Emit `account list` with its options.

class AzAccountSetSettings extends AzSettings
  Settings for `az account set`: make a subscription the default. Name it
  with the global `.subscription(nameOrId)`, which `account set` requires.

  override protected leadingTokens(): string[]
    Emit `account set`.

class AzAccountShowSettings extends AzSettings
  Settings for `az account show`: the current (or the given) subscription.

  override protected leadingTokens(): string[]
    Emit `account show`.

class AzAcrBuildSettings extends AzSettings
  Settings for `az acr build`: build an image in the registry from a local
  directory, a git URL or a tarball, and push it.

  `--build-arg` values are visible to the ACR team for debugging, as the CLI
  warns; pass a credential with {@link secretBuildArg}, whose value is also
  registered with the run's redactor.

  registry(name: string): this
    The registry to build in (`--registry`).
  source(location: string): this
    The build context: a directory, a git URL or a tarball URL (the positional source).
  image(nameAndTag: string): this
    A `name:tag` to give the image (`--image`); repeatable.
  file(path: string): this
    The Dockerfile, relative to the source (`--file`).
  buildArg(name: string, value: string): this
    A build argument (`--build-arg name=value`); repeatable. Never a credential.
  secretBuildArg(name: string, value: string): this
    A build argument the ACR team does not see (`--secret-build-arg name=value`); repeatable. The value is registered with the run's
    redactor; it is still part of the argv.
  platform(platform: string): this
    The platform to build for (`--platform`), e.g. `"linux/arm64"`.
  target(stage: string): this
    The Dockerfile stage to build (`--target`).
  timeout(seconds: number): this
    The build's timeout in seconds (`--timeout`).
  resourceGroup(name: string): this
    The registry's resource group (`--resource-group`).
  noPush(): this
    Build without pushing (`--no-push`).
  noLogs(): this
    Do not stream the build's logs (`--no-logs`).
  noWait(): this
    Return once the build is queued (`--no-wait`).
  override protected leadingTokens(): string[]
    Emit `acr build` with its options and source.

class AzAcrLoginSettings extends AzSettings
  Settings for `az acr login`.

  Without {@link exposeToken} the CLI logs the local Docker client in itself.
  With it, the CLI prints a registry refresh token instead — for
  `docker login` with the user `00000000-0000-0000-0000-000000000000` — so the
  command always runs quietly with `--output json` pinned, and the token is
  registered with the run's redactor once it returns.

  constructor()
    Settings that capture the answer instead of streaming it.
  name(name: string): this
    The registry's name (`--name`).
  exposeToken(): this
    Print a token instead of logging Docker in (`--expose-token`).
  username(name: string): this
    A registry user, instead of the signed-in identity (`--username`).
  password(secret: string): this
    The registry user's password (`--password`), sent on standard input as
    `--password=@-` so it never enters the argv, and registered with the
    run's redactor.
  suffix(suffix: string): this
    The tenant suffix of the registry's login server (`--suffix`).
  override protected pinnedOutput(): AzOutputFormat
    Pin `--output json`, the form the returned token can be found in.
  override protected stdinInput(): string | undefined
    The password, for the CLI to read from standard input.
  override protected onOutput(output: CommandOutput): void
    Register the returned token as a secret — with {@link exposeToken} only:
    without it the CLI logs Docker in and prints no credential.
  override protected leadingTokens(): string[]
    Emit `acr login` with its options.

class AzAcrRepositoryDeleteSettings extends AzSettings
  Settings for `az acr repository delete`: one image, by tag or digest, or a
  whole repository. The CLI asks for confirmation unless {@link yes} is set.

  name(name: string): this
    The registry's name (`--name`).
  image(image: string): this
    The image to delete, `repo:tag` or `repo@digest` (`--image`).
  repository(name: string): this
    Delete the whole repository, every tag in it (`--repository`).
  yes(): this
    Delete without asking (`--yes`).
  override protected leadingTokens(): string[]
    Emit `acr repository delete` with its options.

class AzAcrRepositoryShowTagsSettings extends AzSettings
  Settings for `az acr repository show-tags`.

  name(name: string): this
    The registry's name (`--name`).
  repository(name: string): this
    The repository whose tags to list (`--repository`).
  top(count: number): this
    At most this many tags (`--top`).
  orderby(order: "time_asc" | "time_desc"): this
    Order by time, oldest or newest first (`--orderby`); by name otherwise.
  detail(): this
    Each tag's details, not only its name (`--detail`).
  override protected leadingTokens(): string[]
    Emit `acr repository show-tags` with its options.

class AzAksGetCredentialsSettings extends AzResourceSettings
  Settings for `az aks get-credentials`. The credentials go to a file —
  `~/.kube/config` unless {@link file} says otherwise. Printing them
  (`--file -`) would put a cluster credential in the build log, so a `-` is
  refused.

  admin(): this
    Get the cluster-admin credentials (`--admin`).
  file(path: string): this
    The kubeconfig file to write (`--file`); `~/.kube/config` by default.
  overwriteExisting(): this
    Replace an existing entry of the same name (`--overwrite-existing`).
  context(name: string): this
    The context name to write, instead of the cluster's (`--context`).
  publicFqdn(): this
    Point the kubeconfig at the cluster's public FQDN (`--public-fqdn`).
  format(format: "azure" | "exec"): this
    The credential format (`--format`): `azure` or `exec` (kubelogin).
  override protected leadingTokens(): string[]
    Emit `aks get-credentials` with its options.

class AzAksShowSettings extends AzResourceSettings
  Settings for `az aks show`.

  override protected leadingTokens(): string[]
    Emit `aks show`.

class AzContainerappIngressTrafficSetSettings extends AzResourceSettings
  Settings for `az containerapp ingress traffic set`: the share of traffic
  each revision — or each label — receives. The weights must add up to 100;
  the CLI checks.

  revisionWeight(revision: string, weight: number): this
    A revision's share of traffic, in percent (`--revision-weight revision=weight`); repeatable. `"latest"` is the newest revision.
  labelWeight(label: string, weight: number): this
    A label's share of traffic, in percent (`--label-weight label=weight`); repeatable.
  override protected leadingTokens(): string[]
    Emit `containerapp ingress traffic set` with its options.

class AzContainerappRevisionListSettings extends AzResourceSettings
  Settings for `az containerapp revision list`.

  all(): this
    Include inactive revisions (`--all`).
  override protected leadingTokens(): string[]
    Emit `containerapp revision list` with its options.

class AzContainerappRevisionSettings extends AzResourceSettings
  Settings for `az containerapp revision activate` and `deactivate`: the
  app, and the revision to switch.

  constructor(readonly verb_: "activate" | "deactivate")
    The settings for `revision <verb>`.
  revision(name: string): this
    The revision to activate or deactivate (`--revision`).
  override protected leadingTokens(): string[]
    Emit `containerapp revision <verb>` with its options.

class AzContainerappShowSettings extends AzResourceSettings
  Settings for `az containerapp show`. Secrets stay out: `--show-secrets` is not typed.

  override protected leadingTokens(): string[]
    Emit `containerapp show`.

class AzContainerappUpdateSettings extends AzResourceSettings
  Settings for `az containerapp update`: a new image, environment or scale,
  which makes a new revision.

  image(image: string): this
    The container image (`--image`), e.g. `"myregistry.azurecr.io/api:1.4.0"`.
  containerName(name: string): this
    The container to update, when the app has several (`--container-name`).
  revisionSuffix(suffix: string): this
    A suffix for the new revision's name (`--revision-suffix`).
  setEnvVar(name: string, value: string): this
    Add or update an environment variable (`--set-env-vars name=value`);
    repeatable. A value of `secretref:<secret>` reads one of the app's
    secrets.
  removeEnvVars(...names: string[]): this
    Remove environment variables (`--remove-env-vars`); repeatable.
  cpu(cores: number): this
    CPU cores for the container (`--cpu`), e.g. `0.5`.
  memory(amount: string): this
    Memory for the container (`--memory`), e.g. `"1.0Gi"`.
  minReplicas(count: number): this
    The fewest replicas (`--min-replicas`).
  maxReplicas(count: number): this
    The most replicas (`--max-replicas`).
  yaml(path: string): this
    Take the whole configuration from a YAML file (`--yaml`); other options are ignored.
  override protected leadingTokens(): string[]
    Emit `containerapp update` with its options.

class AzDeploymentGroupCreateSettings extends AzDeploymentGroupTemplateSettings
  Settings for `az deployment group create`.

  noWait(): this
    Return once the deployment has started (`--no-wait`).
  override protected leadingTokens(): string[]
    Emit `deployment group create` with its options.

class AzDeploymentGroupShowSettings extends AzResourceSettings
  Settings for `az deployment group show`.

  override protected leadingTokens(): string[]
    Emit `deployment group show`.

abstract class AzDeploymentGroupTemplateSettings extends AzResourceSettings
  The template, parameters and mode a deploying `deployment group` command
  shares — `create` and `what-if` read them identically. The deployment's
  `--name` is optional here; the CLI defaults it to the template file's name.

  templateFile(path: string): this
    A local ARM template or Bicep file (`--template-file`).
  templateUri(uri: string): this
    A template at a URL (`--template-uri`).
  templateSpec(id: string): this
    A template spec, by resource id (`--template-spec`).
  parametersFile(path: string): this
    A parameters file — JSON or `.bicepparam` (`--parameters <path>`);
    repeatable, later values winning.
  parameter(name: string, value: string | number | boolean): this
    One parameter (`--parameters name=value`); repeatable. The value is
    converted to the type the template declares. It is part of the argv, so a
    secure value belongs in a parameters file or a Key Vault reference.
  mode(mode: AzDeploymentMode): this
    `Incremental` (the default) or `Complete`, which deletes what the template omits (`--mode`).
  protected templateTokens(task: string): string[]
    The template, parameter and mode options, refused without one template.

class AzDeploymentGroupWhatIfSettings extends AzDeploymentGroupTemplateSettings
  Settings for `az deployment group what-if`: what a deployment would change.

  resultFormat(format: "FullResourcePayloads" | "ResourceIdOnly"): this
    How much of each change to show (`--result-format`).
  excludeChangeTypes(...types: AzWhatIfChangeType[]): this
    Leave these kinds of change out (`--exclude-change-types`); repeatable.
  noPrettyPrint(): this
    Print the result as JSON rather than the formatted diff (`--no-pretty-print`).
  override protected leadingTokens(): string[]
    Emit `deployment group what-if` with its options.

class AzFunctionappDeploymentSourceConfigZipSettings extends AzResourceSettings
  Settings for `az functionapp deployment source config-zip`: deploy a zip
  package to a function app. This is the generally available command;
  `az functionapp deploy` is still in preview.

  src(path: string): this
    The zip package (`--src`).
  buildRemote(value: boolean): this
    Build the package on the service — install dependencies there (`--build-remote`).
  timeout(seconds: number): this
    How long to wait for the deployment's status, in seconds (`--timeout`).
  slot(name: string): this
    A slot instead of production (`--slot`).
  override protected leadingTokens(): string[]
    Emit `functionapp deployment source config-zip` with its options.

class AzGroupCreateSettings extends AzSettings
  Settings for `az group create`.

  name(name: string): this
    The resource group's name (`--name`).
  location(location: string): this
    The region to create it in (`--location`), e.g. `"westeurope"`.
  tag(key: string, value: string): this
    A tag (`--tags key=value`); repeatable.
  managedBy(id: string): this
    The id of the resource that manages the group (`--managed-by`).
  override protected leadingTokens(): string[]
    Emit `group create` with its options.

class AzGroupDeleteSettings extends AzSettings
  Settings for `az group delete`. The CLI asks for confirmation unless
  {@link yes} is set — and fails, without a terminal to ask on.

  name(name: string): this
    The resource group's name (`--name`).
  yes(): this
    Delete without asking (`--yes`).
  noWait(): this
    Return once the deletion has started (`--no-wait`).
  forceDeletionTypes(type: AzForceDeletionType): this
    Force-delete the group's resources of this type (`--force-deletion-types`).
  override protected leadingTokens(): string[]
    Emit `group delete` with its options.

class AzGroupExistsSettings extends AzSettings
  Settings for `az group exists`, which prints `true` or `false`.

  name(name: string): this
    The resource group's name (`--name`).
  override protected leadingTokens(): string[]
    Emit `group exists`.

class AzGroupShowSettings extends AzSettings
  Settings for `az group show`.

  name(name: string): this
    The resource group's name (`--name`).
  override protected leadingTokens(): string[]
    Emit `group show`.

class AzKeyvaultSecretSetSettings extends AzSettings
  Settings for `az keyvault secret set`.

  The value comes from a {@link file} — read exactly, with its
  {@link encoding} — or from {@link value}, which is sent on standard input
  as `--value=@-` so it never enters the argv. The CLI strips trailing line
  breaks from what it reads that way; use a file for a value that must keep
  them.

  constructor()
    Settings that capture the answer, which carries the value, instead of streaming it.
  vaultName(name: string): this
    The vault's name (`--vault-name`).
  name(name: string): this
    The secret's name (`--name`).
  value(secret: string): this
    The value, sent on standard input as `--value=@-` and registered with the
    run's redactor.
  file(path: string): this
    Read the value from a file (`--file`) — the way to keep it exact.
  encoding(encoding: AzKeyvaultSecretEncoding): this
    How the {@link file} is encoded (`--encoding`); `utf-8` by default.
    Refused without a file: the CLI saves it as a `file-encoding` tag that
    `keyvault secret download` later decodes with.
  contentType(type: string): this
    What the value is, e.g. `"password"` (`--content-type`).
  expires(time: AzTime): this
    When the secret expires (`--expires`): a `Date`, or a string such as
    `2027-01-01T00:00:00Z` — the CLI takes UTC to the second, no fractions.
  notBefore(time: AzTime): this
    When the secret becomes usable (`--not-before`), in the same form as {@link expires}.
  disabled(value: boolean): this
    Create the secret disabled, or enabled (`--disabled`).
  tag(key: string, value: string): this
    A tag (`--tags key=value`); repeatable.
  override protected pinnedOutput(): AzOutputFormat
    Pin `--output json`, the form the returned value can be found in.
  override protected stdinInput(): string | undefined
    The value, for the CLI to read from standard input.
  override protected onOutput(output: CommandOutput): void
    Register the returned value as a secret.
  override protected leadingTokens(): string[]
    Emit `keyvault secret set` with its options.

class AzKeyvaultSecretShowSettings extends AzSettings
  Settings for `az keyvault secret show`.

  constructor()
    Settings that capture the secret instead of streaming it.
  vaultName(name: string): this
    The vault's name (`--vault-name`).
  name(name: string): this
    The secret's name (`--name`).
  version(version: string): this
    A specific version; the latest when omitted (`--version`).
  id(identifier: string): this
    The secret's full identifier, instead of vault and name (`--id`).
  override protected pinnedOutput(): AzOutputFormat
    Pin `--output json`, the form the returned value can be found in.
  override protected onOutput(output: CommandOutput): void
    Register the returned value as a secret.
  override protected leadingTokens(): string[]
    Emit `keyvault secret show` with its options.

class AzLoginSettings extends AzSettings
  Settings for `az login`, for the non-interactive forms a build uses. The
  interactive browser and device-code forms are left to `.command("login")`.

  Exactly one credential is sent: a secret ({@link password}), a
  {@link certificate} or a {@link federatedToken} for a service principal,
  or {@link identity} for a managed identity. A service principal without
  one would make the CLI prompt for a password, so it is refused here.

  `az login` reads the global `.subscription(...)` as the subscription to
  make the default once it has signed in. Its output lists the account's
  subscriptions — no credential — so it is not masked.

  servicePrincipal(): this
    Log in as a service principal (`--service-principal`).
  username(clientId: string): this
    The service principal's client id (`--username`).
  tenant(tenant: string): this
    The Microsoft Entra tenant, required for a service principal (`--tenant`).
  password(secret: string): this
    The service principal's client secret (`--password`), sent on standard
    input as `--password=@-` so it never enters the argv, and registered with
    the run's redactor. Prefer {@link federatedToken} (no long-lived secret)
    or {@link certificate}.
  federatedToken(token: string): this
    A federated token (OIDC) to exchange for the service principal's access
    (`--federated-token`), sent on standard input as `--federated-token=@-`
    and registered with the run's redactor.
  certificate(path: string): this
    A PEM file with the service principal's key and certificate (`--certificate`).
  useCertSnIssuer(): this
    Authenticate with Subject Name + Issuer, for automatic certificate
    rolls (`--use-cert-sn-issuer`).
  identity(): this
    Log in with the managed identity of the machine the build runs on (`--identity`).
  clientId(id: string): this
    A user-assigned managed identity, by client id (`--client-id`).
  objectId(id: string): this
    A user-assigned managed identity, by object id (`--object-id`).
  resourceId(id: string): this
    A user-assigned managed identity, by resource id (`--resource-id`).
  allowNoSubscriptions(): this
    Succeed for a tenant with no subscriptions (`--allow-no-subscriptions`).
  override protected stdinInput(): string | undefined
    The secret, for the CLI to read from standard input.
  override protected leadingTokens(): string[]
    Emit `login` with its options.

class AzLogoutSettings extends AzSettings
  Settings for `az logout`.

  username(name: string): this
    The account to log out; the active one when omitted (`--username`).
  override protected leadingTokens(): string[]
    Emit `logout` with its options.

class AzMonitorActivityLogListSettings extends AzSettings
  Settings for `az monitor activity-log list`: the control-plane events of a
  subscription, resource group or resource. The CLI returns at most
  {@link maxEvents} — 50 unless told otherwise.

  startTime(time: AzTime): this
    The start of the range (`--start-time`).
  endTime(time: AzTime): this
    The end of the range (`--end-time`); now by default.
  offset(duration: string | number): this
    The length of the range when only one end is given (`--offset`); six hours by default.
  resourceGroup(name: string): this
    Only events in this resource group (`--resource-group`).
  resourceId(id: string): this
    Only events on this resource (`--resource-id`).
  namespace(namespace: string): this
    Only events from this resource provider (`--namespace`).
  caller(caller: string): this
    Only events by this caller (`--caller`).
  status(status: string): this
    Only events with this status, e.g. `"Failed"` (`--status`).
  correlationId(id: string): this
    Only the events of this operation (`--correlation-id`).
  maxEvents(count: number): this
    The most events to return (`--max-events`); 50 by default.
  select(...properties: string[]): this
    Only these properties of each event (`--select`); repeatable.
  override protected leadingTokens(): string[]
    Emit `monitor activity-log list` with its options.

class AzMonitorAnalysisSettings
  Settings for {@link azureMonitor}: the metric or query, the window and the bounds.

  name_?: string
    What the metric is called in a failure (set by {@link name}).
  resource_?: string
    The resource whose metric is read (set by {@link resource}).
  metric_?: string
    The metric's name (set by {@link metric}).
  namespace_?: string
    The metric's namespace (set by {@link namespace}).
  aggregation_?: AzMonitorAggregation
    The aggregation judged (set by {@link aggregation}).
  interval_: AzMonitorInterval
    What each datapoint covers (set by {@link interval}).
  readonly dimensions_: Array<[string, string]>
    The dimension values the series is narrowed to (set by {@link dimension}).
  kql_?: { workspace: string; query: string; }
    The workspace and query of the KQL mode (set by {@link kql}).
  top_?: number
    The most series to read (set by {@link top}).
  window_: number
    How far back to read, in ms (set by {@link window}).
  min_?: number
    The lowest acceptable value (set by {@link min}).
  max_?: number
    The highest acceptable value (set by {@link max}).
  missingData_?: number
    The value to judge when there is no data (set by {@link missingDataAs}).
  az_: Configure<AzSettings>
    Global options for the command (set by {@link az}).
  now_: () => Date
    The clock the window is read against (set by {@link now}).
  name(name: string): this
    What to call the metric when it is out of bounds.
  resource(id: string): this
    The resource whose metric is read, by full resource id (`--resource`).
  metric(name: string): this
    The metric to judge, by name (`--metrics`).
  namespace(namespace: string): this
    The metric's namespace, when the resource has several (`--namespace`).
  aggregation(aggregation: AzMonitorAggregation): this
    The aggregation judged per interval (`--aggregation`), e.g. `"Total"`.
  interval(interval: AzMonitorInterval): this
    What each datapoint covers (`--interval`; default `PT1M`). Every
    datapoint is judged, so `.max(5)` on a per-minute `Total` means "no
    minute with more than five".
  dimension(name: string, value: string): this
    Only the series where dimension `name` is `value`; repeatable.
  kql(workspace: string, query: string): this
    Judge a Log Analytics query instead of a metric: `query` must return one
    row with one numeric column (`... | summarize count()`), run over the
    window against the workspace `workspace`. Needs the CLI's `log-analytics`
    extension installed.
  window(duration: string | number): this
    How far back to read (`"10m"`, or ms; default 5 minutes). For a metric
    the window ends at the last interval boundary, so the interval still
    being written is not judged. Azure Monitor publishes a datapoint a
    little after its interval ends, so the newest one in the window may
    still be short of data — harmless for a `max`, but a `min` on a `Total`
    or `Count` can fail on the lag rather than on the candidate.
  min(value: number): this
    Fail when any datapoint is below `value`, a finite number.
  max(value: number): this
    Fail when any datapoint is above `value`, a finite number.
  top(count: number): this
    The most series to read (`--top`; the CLI's default is ten). Azure
    Monitor applies it to a query narrowed by {@link dimension}, and the
    analysis fails rather than judge an answer that reached it — raise it
    when a dimension value matches more series than that.
  missingDataAs(value: number): this
    Judge `value` when the window has no data, instead of failing. Azure
    Monitor reports nothing for an interval with no events, so for a count
    of errors no data means `0`; for a latency it usually means the
    resource, metric or dimensions are wrong, which is why that is a failure
    by default.
  az(configure: Configure<AzSettings>): this
    Global options for the command — `(a) => a.subscription("prod")`, a
    `.toolPath(...)`, or a `.runner(...)`, the seam a test answers through.
    `--output` and `--query` are the analysis's own and are set after it.
  now(clock: () => Date): this
    The clock the window is read against — the seam a test pins it with.

class AzMonitorLogAnalyticsQuerySettings extends AzSettings
  Settings for `az monitor log-analytics query`.

  workspace(id: string): this
    The workspace's id — its customer id, a GUID (`--workspace`).
  analyticsQuery(query: string): this
    The KQL query (`--analytics-query`).
  timespan(range: string | number): this
    The range to query (`--timespan`): a duration back from now, as `"30m"`
    or milliseconds (sent as ISO 8601), or an ISO 8601 interval string such
    as `"2026-10-07T10:00:00Z/2026-10-07T11:00:00Z"`, sent as written. All
    the data by default.
  workspaces(...ids: string[]): this
    Further workspaces to union into the query (`--workspaces`); repeatable.
  override protected leadingTokens(): string[]
    Emit `monitor log-analytics query` with its options.

class AzMonitorMetricValueSettings extends AzMonitorMetricsListSettings
  Settings for `AzTasks.metricValue`: a `metrics list` request with exactly
  one {@link AzMonitorMetricsListSettings.aggregation}, and how to read it.

  metric_?: string
    The metric to read (set by {@link metric}); the only one when unset.
  aggregate_: AzMonitorAggregate
    How to turn the datapoints into one number (set by {@link aggregate}).
  missingData_?: number
    The value to return when there are no datapoints (set by {@link missingDataAs}).
  override protected taskName(): string
    The task name used in this reader's error messages.
  metric(name: string): this
    The metric to read, by name. Needed only when the request names more
    than one with `.metrics(...)`.
  aggregate(how: AzMonitorAggregate): this
    How to turn the datapoints into one number, across every series the
    answer holds. `"latest"` (the default) is the newest interval — the sum
    of the series' values at the newest timestamp any of them has, so a
    metric split by a dimension reads as its total. The others combine every
    datapoint in the range: a `"sum"` of per-minute `Total`s is the range's
    total.
  missingDataAs(value: number): this
    Return `value` when there are no datapoints, instead of failing. Azure
    Monitor reports an interval with no events without a value, so for a
    count of errors no data does mean `0`; for a latency it usually means the
    query is looking in the wrong place.

class AzMonitorMetricsAlertListSettings extends AzSettings
  Settings for `az monitor metrics alert list`.

  resourceGroup(name: string): this
    Only the rules in this resource group (`--resource-group`).
  override protected leadingTokens(): string[]
    Emit `monitor metrics alert list` with its options.

class AzMonitorMetricsAlertShowSettings extends AzResourceSettings
  Settings for `az monitor metrics alert show`: one metric alert rule. The
  rule's definition, not whether it is firing — that lives in Azure Monitor's
  alerts, not in the rule.

  override protected leadingTokens(): string[]
    Emit `monitor metrics alert show`.

class AzMonitorMetricsListDefinitionsSettings extends AzSettings
  Settings for `az monitor metrics list-definitions`: the metrics a resource has.

  resource(id: string): this
    The resource, by full resource id (`--resource`).
  namespace(namespace: string): this
    Only this metric namespace (`--namespace`).
  override protected leadingTokens(): string[]
    Emit `monitor metrics list-definitions` with its options.

class AzMonitorMetricsListSettings extends AzSettings
  Settings for `az monitor metrics list`: a resource's metrics over a time
  range, one datapoint per interval.

  The CLI returns at most {@link top} time series per metric — ten unless
  told otherwise — so a query that splits by a dimension can silently lose
  series; raise `top` to cover them.

  readonly aggregations_: AzMonitorAggregation[]
    The aggregations to compute (set by {@link aggregation}).
  protected taskName(): string
    The task name used in this command's error messages.
  resource(id: string): this
    The resource, by full resource id (`--resource`).
  metrics(...names: string[]): this
    The metrics to read, by name (`--metrics`); repeatable.
  aggregation(...types: AzMonitorAggregation[]): this
    The aggregations to compute per interval (`--aggregation`); repeatable.
  interval(interval: AzMonitorInterval): this
    The time grain of each datapoint (`--interval`); one minute by default.
    The range set by {@link window} is not aligned to it, so the newest
    datapoint may cover an interval that is still being written.
  startTime(time: AzTime): this
    The start of the range (`--start-time`).
  endTime(time: AzTime): this
    The end of the range (`--end-time`); now by default.
  window(duration: string | number, end: Date): this
    The `duration` (`"15m"`, or milliseconds) up to `end` — now, unless
    given — as `--start-time` and `--end-time`.
  offset(duration: string | number): this
    The length of the range when only one end is given (`--offset`, as
    `"30m"` or milliseconds); an hour by default.
  filter(expression: string): this
    An OData filter on the dimensions (`--filter`), e.g.
    `"ApiName eq 'GetBlob' and GeoType eq '*'"`. For plain equality, prefer
    {@link dimension}, which quotes the value.
  dimension(name: string, value: string): this
    Only the series where the dimension `name` is `value` — rendered into
    `--filter` as `name eq 'value'`, joined with `and`; repeatable.
  splitBy(...dimensions: string[]): this
    Split the series by these dimensions (`--dimension`); repeatable.
  namespace(namespace: string): this
    The metric namespace (`--namespace`).
  top(count: number): this
    The most time series to return per metric (`--top`); 10 by default.
  get seriesLimit_(): number | undefined
    The most series the answer can hold, when the query can return several —
    {@link top}, or the CLI's default of ten — and `undefined` when it cannot.
    Azure Monitor applies `--top` only to a filtered or split query; without
    one there is a single series. A reader that totals the series reads this
    to tell a complete answer from one cut at the limit.
  orderby(order: string): this
    The aggregation and direction to sort series by (`--orderby`), e.g. `"sum desc"`.
  override protected leadingTokens(): string[]
    Emit `monitor metrics list` with its options.

class AzOutputError extends Error
  The Azure CLI succeeded but printed something a reader cannot use: output
  that is not JSON, JSON of an unexpected shape, an empty or multi-line answer
  where one value was expected, no data where a number was expected, or a
  capture that was truncated.

  The message never quotes the output itself. Several readers return access
  tokens and secret values, and an error that echoed what the CLI printed
  would put the secret in the build log it was read to stay out of.

  constructor(readonly task: string, readonly detail: string)
    Build the error from the reader that failed and what was wrong.
  override name: string
    The error name.

abstract class AzResourceSettings extends AzSettings
  Settings for a command on one named resource in a resource group.

  name(name: string): this
    The resource's name (`--name`).
  resourceGroup(name: string): this
    The resource group the resource is in (`--resource-group`).
  protected resourceTokens(task: string, what: string): string[]
    `--name` and `--resource-group`, refused unless both are set; `what`
    names the resource in the refusal, `task` the command.
  protected optionalNameTokens(task: string, what: string): string[]
    `--resource-group`, refused unless set, and `--name` only when it is set
    — for a command whose name the CLI can default.

class AzSettings extends SubcommandSettings
  Settings for an `az` invocation.

  Every instance sets three of the CLI's configuration variables in the
  child's environment, so the CLI never waits on a keypress, installs code,
  or colours a build log:

  - `AZURE_EXTENSION_USE_DYNAMIC_INSTALL=no` — a command from an extension
    that is not installed fails, instead of prompting (on a terminal) or
    silently downloading and installing the extension (without one). The
    CLI's message does not name the extension — it says the command `is misspelled or not recognized by the system` and exits 2 — so install what
    a build needs up front with `az extension add --name <name>`.
  - `AZURE_CORE_LOGIN_EXPERIENCE_V2=off` — an interactive `az login` does not
    open its subscription selector.
  - `AZURE_CORE_NO_COLOR=true` — no ANSI colour codes in captured output.

  Setting them there keeps the argv exactly what the settings say; override
  any of them with `.env({...})`. A confirmation prompt (`group delete`
  without `--yes`) is not switched off: on a terminal it asks, without one
  the CLI fails — call the command's `.yes()` to confirm in the build.

  constructor()
    Settings with the CLI's prompts, extension installs and colour off.
  override protected defaultTool(): string
    The default executable name (`az`).
  subscription(nameOrId: string): this
    The subscription to run against, by name or id (`--subscription`); the
    CLI's default subscription when omitted. Most commands take it; the
    `account` commands read it as the subscription they act on.
  output(format: AzOutputFormat): this
    The output format (`--output`): `json`, `jsonc`, `yaml`, `yamlc`,
    `table`, `tsv` or `none`.
  query(expression: string): this
    A JMESPath expression that filters the output (`--query`).
  onlyShowErrors(): this
    Print errors only, suppressing warnings (`--only-show-errors`). The CLI
    refuses it beside `--debug` or `--verbose`, and so do these settings.
  verbose(): this
    More logging, on stderr (`--verbose`).
  override env(record: Record<string, string>): this
    Merge additional environment variables for the process. Under
    {@link debug} — set before or after — a credential variable set here is
    registered with the run's redactor, like one in the build's environment.
  debug(): this
    Turn on the CLI's debug logging (`--debug`), written to stderr.

    The debug log can carry credentials: request and response details,
    which for a Key Vault or storage command include what was read or sent.
    The credentials the CLI reads from the environment — `AZURE_STORAGE_KEY`,
    `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_SAS_TOKEN`,
    `AZURE_CLIENT_SECRET`, `AZURE_DEVOPS_EXT_PAT`, and Terraform's
    `ARM_CLIENT_SECRET` beside them — are registered with the run's redactor,
    whether they are in the build's environment or set with {@link env}, but a token the CLI holds in its own cache
    (`~/.azure`) is not known here and is not masked. Keep it for a local
    investigation, never a shared CI log.
  override flag(name: string, value?: string | number): this
    Add an arbitrary option: `--name value`, or the bare `--name`.

    Two hazards come with the escape hatch, which the typed setters guard and
    this does not: a value that starts with `-` is read by the CLI as the next
    option, and a value that starts with `@` — or, in a `key=value` list
    element, a value after the `=` that does — is replaced by that file's
    contents (`@-` by standard input), which then leave the machine in the
    request. Never pass an untrusted value here, or through `.args(...)` or
    `.command(...)`.
  protected pinnedOutput(): AzOutputFormat | undefined
    The `--output` a command insists on, whatever the settings or the user's
    config say; `undefined` leaves it to them. A credential-bearing command
    pins `json`, which is the form its secrets can be found in.
  protected get queried(): boolean
    Whether a `--query` was set — by the caller, or pinned by a reader. A
    credential-bearing command then registers every long scalar it printed,
    since the query may have moved the secret away from its usual key.
  runner(run: AzSettingsRunner): this
    Replace how this command is run. The default spawns the CLI; this is the
    seam a test answers commands through, and the way a build executes `az`
    through something else. The runner reads the argv from the settings it is
    handed and must not call their `run()` — that is the call it replaces.
  override async run(): Promise<CommandOutput>
    Run the command — through the {@link runner} when one is set, otherwise
    by spawning the CLI. Either way the output is reported to the settings'
    output hook and a non-zero exit throws a `CommandError` unless
    `.noThrow()` was called.
  override protected middleTokens(): string[]
    Emit the Azure CLI's global options after the command.

class AzStorageBlobDownloadSettings extends AzStorageBlobSettings
  Settings for `az storage blob download`.

  containerName(name: string): this
    The container (`--container-name`).
  name(name: string): this
    The blob's name (`--name`).
  file(path: string): this
    The local file to write (`--file`).
  overwrite(value: boolean): this
    Replace an existing local file (`--overwrite`).
  override protected leadingTokens(): string[]
    Emit `storage blob download` with its options.

abstract class AzStorageBlobSettings extends AzSettings
  The account and credential options every `storage blob` command takes.
  One credential at most: the CLI reads it from standard input.

  accountName(name: string): this
    The storage account (`--account-name`).
  authMode(mode: AzStorageAuthMode): this
    `login` uses the signed-in identity; `key` an account key (`--auth-mode`).
  accountKey(key: string): this
    The account key (`--account-key`), sent on standard input.
  sasToken(token: string): this
    A SAS token (`--sas-token`), sent on standard input. Its signature is
    registered on its own as well — as written, decoded and URL-encoded —
    since the CLI's debug log prints the token URL-encoded inside a request
    URL, where the token as a whole never appears.
  connectionString(connection: string): this
    A connection string (`--connection-string`), sent on standard input.
  override protected stdinInput(): string | undefined
    The credential, for the CLI to read from standard input.
  protected accountTokens(task: string): string[]
    The account and credential options, refused with more than one credential.

class AzStorageBlobUploadBatchSettings extends AzStorageBlobSettings
  Settings for `az storage blob upload-batch`: upload a directory.

  source(path: string): this
    The local directory to upload (`--source`).
  destination(container: string): this
    The container, by name or URL (`--destination`).
  pattern(glob: string): this
    Upload only the files matching this glob (`--pattern`).
  destinationPath(path: string): this
    A path inside the container to upload under (`--destination-path`).
  overwrite(value: boolean): this
    Replace existing blobs (`--overwrite`).
  dryrun(): this
    Show what would be uploaded without uploading (`--dryrun`).
  override protected leadingTokens(): string[]
    Emit `storage blob upload-batch` with its options.

class AzStorageBlobUploadSettings extends AzStorageBlobSettings
  Settings for `az storage blob upload`.

  containerName(name: string): this
    The container (`--container-name`).
  name(name: string): this
    The blob's name (`--name`).
  file(path: string): this
    The local file to upload (`--file`).
  overwrite(value: boolean): this
    Replace an existing blob (`--overwrite`).
  contentType(type: string): this
    The blob's MIME type (`--content-type`).
  contentCacheControl(value: string): this
    The blob's `Cache-Control` (`--content-cache-control`).
  tag(key: string, value: string): this
    A blob index tag (`--tags key=value`); repeatable.
  override protected leadingTokens(): string[]
    Emit `storage blob upload` with its options.

class AzWebappConfigAppsettingsSetSettings extends AzResourceSettings
  Settings for `az webapp config appsettings set`.

  Each setting's value is part of the argv, so it is visible in the process
  table and in the command line the build logs; a credential belongs in Key
  Vault, referenced with {@link keyVaultReference}. A value that starts with
  `@` is otherwise refused, because the CLI would read it from a file. The
  CLI's answer lists every setting with its value redacted.

  setting(name: string, value: string): this
    An app setting (`--settings name=value`); repeatable.
  keyVaultReference(name: string, secretUri: string): this
    An app setting whose value App Service reads from Key Vault; repeatable.
    Sent as the JSON object `{"name":"@Microsoft.KeyVault(SecretUri=<uri>)"}`,
    a form `--settings` accepts: written as `name=@Microsoft…` the CLI would
    first try to read a file of that name, and send its contents if one
    existed.
  slotSetting(name: string, value: string): this
    A setting that stays with its slot through a swap (`--slot-settings name=value`); repeatable.
  slot(name: string): this
    A slot instead of production (`--slot`).
  override protected leadingTokens(): string[]
    Emit `webapp config appsettings set` with its options.

class AzWebappDeploySettings extends AzResourceSettings
  Settings for `az webapp deploy`, the current deploy command (the older
  `webapp deployment source config-zip` is deprecated in its favour).

  srcPath(path: string): this
    The artifact to deploy, a local path (`--src-path`).
  srcUrl(url: string): this
    The artifact to deploy, a URL the app pulls it from (`--src-url`).
  type(type: AzWebappArtifactType): this
    The artifact's type, when its extension does not say (`--type`).
  targetPath(path: string): this
    Where to deploy it, an absolute path on the app (`--target-path`).
  slot(name: string): this
    The slot to deploy to; production when omitted (`--slot`).
  async(value: boolean): this
    Return once the artifact is pushed, without waiting for it to deploy (`--async`).
  restart(value: boolean): this
    Restart the app after deploying (`--restart`); the CLI's default is to.
  clean(value: boolean): this
    Empty the target directory first (`--clean`).
  timeout(ms: number): this
    How long to wait for the deployment, in milliseconds (`--timeout`).
  override protected leadingTokens(): string[]
    Emit `webapp deploy` with its options.

class AzWebappDeploymentSlotSwapSettings extends AzResourceSettings
  Settings for `az webapp deployment slot swap`: swap a slot with production,
  or with {@link targetSlot}.

  slot(name: string): this
    The slot to swap from (`--slot`).
  targetSlot(name: string): this
    The slot to swap with; production by default (`--target-slot`).
  action(action: AzSlotSwapAction): this
    `preview` applies the target's settings to the source first, `swap`
    completes the swap, `reset` cancels a preview (`--action`).
  preserveVnet(value: boolean): this
    Keep the virtual network with the slot (`--preserve-vnet`).
  override protected leadingTokens(): string[]
    Emit `webapp deployment slot swap` with its options.

class AzWebappShowSettings extends AzResourceSettings
  Settings for `az webapp show`.

  slot(name: string): this
    A slot instead of production (`--slot`).
  override protected leadingTokens(): string[]
    Emit `webapp show` with its options.

interface AzMonitorAnalysis
  A health check run against a canary, in the shape `@zuke/canary`'s
  `c.analysis(...)` accepts: throw to fail it, which rolls the rollout back.

  readonly name: string
    `"azureMonitor"`, for diagnostics.
  validate(context: AzMonitorAnalysisContext): Promise<void>
    Read the metric and throw when a datapoint is out of bounds.

interface AzMonitorAnalysisContext
  The part of the canary engine's context the analysis uses: the run's
  redactor, applied to every failure message. The engine hands a richer
  context; this is the narrow view.

  redact(text: string): string
    Mask every resolved `secret` parameter in `text`.

interface AzTasksApi
  The shape of {@link AzTasks}.

  run(configure?: Configure<AzSettings>): Promise<CommandOutput>
    Run any `az` command, built with `.command(group, …, verb)`.
  login(configure?: Configure<AzLoginSettings>): Promise<CommandOutput>
    Sign the CLI in, non-interactively: `az login`.
  logout(configure?: Configure<AzLogoutSettings>): Promise<CommandOutput>
    Sign the CLI out: `az logout`.
  accountShow(configure?: Configure<AzAccountShowSettings>): Promise<CommandOutput>
    Describe the current subscription: `az account show`.
  accountSet(configure?: Configure<AzAccountSetSettings>): Promise<CommandOutput>
    Make a subscription the default: `az account set`.
  accountList(configure?: Configure<AzAccountListSettings>): Promise<CommandOutput>
    List the subscriptions: `az account list`.
  accountGetAccessToken(configure?: Configure<AzAccountGetAccessTokenSettings>): Promise<CommandOutput>
    Get an access token: `az account get-access-token` (captured, never streamed).
  accessToken(configure?: Configure<AzAccountGetAccessTokenSettings>): Promise<string>
    An access token, read back as a string and registered as a secret. Pins
    `--query accessToken --output json`.
  subscriptionId(configure?: Configure<AzAccountShowSettings>): Promise<string>
    The subscription id the CLI acts on. Pins `--query id --output tsv`.
  tenantId(configure?: Configure<AzAccountShowSettings>): Promise<string>
    The tenant id of the current subscription. Pins `--query tenantId --output tsv`.
  groupCreate(configure?: Configure<AzGroupCreateSettings>): Promise<CommandOutput>
    Create a resource group: `az group create`.
  groupShow(configure?: Configure<AzGroupShowSettings>): Promise<CommandOutput>
    Describe a resource group: `az group show`.
  groupDelete(configure?: Configure<AzGroupDeleteSettings>): Promise<CommandOutput>
    Delete a resource group: `az group delete`.
  groupExists(configure?: Configure<AzGroupExistsSettings>): Promise<CommandOutput>
    Print whether a resource group exists: `az group exists`.
  resourceGroupExists(name: string, configure?: Configure<AzGroupExistsSettings>): Promise<boolean>
    Whether resource group `name` exists. Pins `--output json`.
  acrLogin(configure?: Configure<AzAcrLoginSettings>): Promise<CommandOutput>
    Log in to a registry: `az acr login` (captured, never streamed).
  acrToken(configure?: Configure<AzAcrLoginSettings>): Promise<string>
    A registry refresh token, for `docker login` as
    `00000000-0000-0000-0000-000000000000`: `az acr login --expose-token`,
    read back and registered as a secret. Pins `--query accessToken --output json`.
  acrBuild(configure?: Configure<AzAcrBuildSettings>): Promise<CommandOutput>
    Build and push an image in the registry: `az acr build`.
  acrRepositoryShowTags(configure?: Configure<AzAcrRepositoryShowTagsSettings>): Promise<CommandOutput>
    List a repository's tags: `az acr repository show-tags`.
  acrRepositoryDelete(configure?: Configure<AzAcrRepositoryDeleteSettings>): Promise<CommandOutput>
    Delete an image or a repository: `az acr repository delete`.
  aksGetCredentials(configure?: Configure<AzAksGetCredentialsSettings>): Promise<CommandOutput>
    Write a cluster's credentials to a kubeconfig: `az aks get-credentials`.
  aksShow(configure?: Configure<AzAksShowSettings>): Promise<CommandOutput>
    Describe a cluster: `az aks show`.
  containerappUpdate(configure?: Configure<AzContainerappUpdateSettings>): Promise<CommandOutput>
    Roll a container app onto a new revision: `az containerapp update`.
  containerappShow(configure?: Configure<AzContainerappShowSettings>): Promise<CommandOutput>
    Describe a container app: `az containerapp show`.
  containerappFqdn(configure?: Configure<AzContainerappShowSettings>): Promise<string>
    A container app's ingress FQDN. Pins `--query properties.configuration.ingress.fqdn --output tsv`; fails for an app
    without ingress.
  containerappRevisionList(configure?: Configure<AzContainerappRevisionListSettings>): Promise<CommandOutput>
    List a container app's revisions: `az containerapp revision list`.
  containerappRevisionActivate(configure?: Configure<AzContainerappRevisionSettings>): Promise<CommandOutput>
    Activate a revision: `az containerapp revision activate`.
  containerappRevisionDeactivate(configure?: Configure<AzContainerappRevisionSettings>): Promise<CommandOutput>
    Deactivate a revision: `az containerapp revision deactivate`.
  containerappIngressTrafficSet(configure?: Configure<AzContainerappIngressTrafficSetSettings>): Promise<CommandOutput>
    Split traffic between revisions or labels: `az containerapp ingress traffic set`.
  webappDeploy(configure?: Configure<AzWebappDeploySettings>): Promise<CommandOutput>
    Deploy an artifact to a web app: `az webapp deploy`.
  webappShow(configure?: Configure<AzWebappShowSettings>): Promise<CommandOutput>
    Describe a web app: `az webapp show`.
  webappHostName(configure?: Configure<AzWebappShowSettings>): Promise<string>
    A web app's default host name. Pins `--query defaultHostName --output tsv`.
  webappConfigAppsettingsSet(configure?: Configure<AzWebappConfigAppsettingsSetSettings>): Promise<CommandOutput>
    Set app settings: `az webapp config appsettings set`.
  webappDeploymentSlotSwap(configure?: Configure<AzWebappDeploymentSlotSwapSettings>): Promise<CommandOutput>
    Swap a deployment slot: `az webapp deployment slot swap`.
  functionappDeploymentSourceConfigZip(configure?: Configure<AzFunctionappDeploymentSourceConfigZipSettings>): Promise<CommandOutput>
    Deploy a zip package to a function app: `az functionapp deployment source config-zip`.
  keyvaultSecretShow(configure?: Configure<AzKeyvaultSecretShowSettings>): Promise<CommandOutput>
    Read a secret: `az keyvault secret show` (captured, never streamed).
  secretValue(configure?: Configure<AzKeyvaultSecretShowSettings>): Promise<string>
    A Key Vault secret's value, read back exactly — multi-line values and
    surrounding whitespace included — and registered as a secret. Pins
    `--query value --output json`.
  keyvaultSecretSet(configure?: Configure<AzKeyvaultSecretSetSettings>): Promise<CommandOutput>
    Write a secret: `az keyvault secret set` (captured, never streamed).
  deploymentGroupCreate(configure?: Configure<AzDeploymentGroupCreateSettings>): Promise<CommandOutput>
    Deploy a template to a resource group: `az deployment group create`.
  deploymentGroupShow(configure?: Configure<AzDeploymentGroupShowSettings>): Promise<CommandOutput>
    Describe a deployment: `az deployment group show`.
  deploymentGroupWhatIf(configure?: Configure<AzDeploymentGroupWhatIfSettings>): Promise<CommandOutput>
    Preview what a deployment would change: `az deployment group what-if`.
  deploymentOutput(group: string, name: string, key: string, configure?: Configure<AzDeploymentGroupShowSettings>): Promise<string>
    One output of deployment `name` in resource group `group`, read back as
    a string — a non-string output as its JSON text. Pins `--query properties.outputs --output json`; fails when there is no such output.
  storageBlobUpload(configure?: Configure<AzStorageBlobUploadSettings>): Promise<CommandOutput>
    Upload a file to a blob: `az storage blob upload`.
  storageBlobDownload(configure?: Configure<AzStorageBlobDownloadSettings>): Promise<CommandOutput>
    Download a blob to a file: `az storage blob download`.
  storageBlobUploadBatch(configure?: Configure<AzStorageBlobUploadBatchSettings>): Promise<CommandOutput>
    Upload a directory: `az storage blob upload-batch`.
  monitorMetricsList(configure?: Configure<AzMonitorMetricsListSettings>): Promise<CommandOutput>
    Read a resource's metrics: `az monitor metrics list`.
  metricValue(configure: Configure<AzMonitorMetricValueSettings>): Promise<number>
    One number from Azure Monitor: the latest datapoint of a metric, or an
    aggregate over the range. Pins `--query value --output json`; fails on
    no data unless `.missingDataAs(value)` says what it means.
  monitorMetricsListDefinitions(configure?: Configure<AzMonitorMetricsListDefinitionsSettings>): Promise<CommandOutput>
    List a resource's metric definitions: `az monitor metrics list-definitions`.
  monitorMetricsAlertList(configure?: Configure<AzMonitorMetricsAlertListSettings>): Promise<CommandOutput>
    List metric alert rules: `az monitor metrics alert list`.
  monitorMetricsAlertShow(configure?: Configure<AzMonitorMetricsAlertShowSettings>): Promise<CommandOutput>
    Describe a metric alert rule: `az monitor metrics alert show`.
  monitorActivityLogList(configure?: Configure<AzMonitorActivityLogListSettings>): Promise<CommandOutput>
    List activity-log events: `az monitor activity-log list`.
  monitorLogAnalyticsQuery(configure?: Configure<AzMonitorLogAnalyticsQuerySettings>): Promise<CommandOutput>
    Run a KQL query: `az monitor log-analytics query` (the `log-analytics` extension).
  logAnalyticsQuery(configure: Configure<AzMonitorLogAnalyticsQuerySettings>): Promise<AzLogAnalyticsRow[]>
    The rows of a KQL query, every cell a string. Pins `--output json` and
    the whole answer as the query.

type AzAccessTokenResourceType = "oss-rdbms" | "arm" | "aad-graph" | "ms-graph" | "batch" | "media" | "data-lake"
  The well-known resources `get-access-token --resource-type` accepts.

type AzDeploymentMode = "Incremental" | "Complete"
  How a deployment treats resources the template does not mention (`--mode`).

type AzForceDeletionType = "Microsoft.Compute/virtualMachines" | "Microsoft.Compute/virtualMachineScaleSets" | "Microsoft.Databricks/workspaces"
  The resource types `group delete --force-deletion-types` accepts.

type AzKeyvaultSecretEncoding = "utf-8" | "utf-16le" | "utf-16be" | "ascii" | "base64" | "hex"
  The encodings `keyvault secret set --encoding` accepts for a file.

type AzLogAnalyticsRow = Record<string, string>
  One row of a Log Analytics answer: `TableName`, and each column by name.

type AzMonitorAggregate = "latest" | "sum" | "average" | "maximum" | "minimum"
  How {@link AzMonitorMetricValueSettings} turns the datapoints into one
  number: the newest, or the sum, average, maximum or minimum of all of them.

type AzMonitorAggregation = "Average" | "Count" | "Maximum" | "Minimum" | "Total"
  The aggregations Azure Monitor computes per interval (`--aggregation`).

type AzMonitorInterval = "PT1M" | "PT5M" | "PT15M" | "PT30M" | "PT1H" | "PT6H" | "PT12H" | "PT24H"
  The time grains `metrics list --interval` takes, in ISO 8601 — the form the
  CLI passes through unchanged. (Its `##h##m` shorthand writes a mixed
  duration such as `1h30m` in the wrong order, so it is not offered.)

type AzOutputFormat = "json" | "jsonc" | "yaml" | "yamlc" | "table" | "tsv" | "none"
  The values the Azure CLI's `--output` option accepts.

type AzSettingsRunner = (settings: AzSettings) => Promise<CommandOutput>
  Runs one prepared `az` command and returns what the process produced. The
  default spawns the CLI; a test, or a build that executes the CLI some other
  way, injects its own with {@link AzSettings.runner}. The runner only
  produces the output: the exit code is judged afterwards exactly as for a
  spawned process, so a non-zero `code` still raises a `CommandError` unless
  the settings say `.noThrow()`.

type AzSlotSwapAction = "swap" | "preview" | "reset"
  The kinds of swap `webapp deployment slot swap --action` performs.

type AzStorageAuthMode = "login" | "key"
  How a storage command authenticates (`--auth-mode`).

type AzTime = Date | string
  A time given as a `Date` or as a string the CLI parses (ISO 8601).

type AzWebappArtifactType = "war" | "jar" | "ear" | "lib" | "startup" | "static" | "zip"
  The artifact types `webapp deploy --type` accepts.

type AzWhatIfChangeType = "Create" | "Delete" | "Deploy" | "Ignore" | "Modify" | "NoChange" | "Unsupported"
  The kinds of change `what-if --exclude-change-types` can leave out.
````

</details>

<!-- ZUKE:API:END -->
