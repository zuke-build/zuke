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

const SecretManagerTasks: SecretManagerTasksApi
  Typed Google Secret Manager operations.

class GcloudSettings extends ToolSettings
  Settings for a `gcloud` invocation.

  override protected defaultTool(): string
    The default executable name (`gcloud`).
  command(...parts: Array<string | number>): this
    The command path and verb, e.g. `command("run", "deploy", "api")`.
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
  flag(name: string, value?: string | number): this
    Add an arbitrary flag. With a value it renders `--name value`; without one
    it renders the bare `--name`. Repeatable.
  override protected buildArgs(): string[]
    Assemble the `gcloud` argv from the command path and global flags.

interface GcloudTasksApi
  The shape of {@link GcloudTasks}.

  run(configure?: Configure<GcloudSettings>): Promise<CommandOutput>
    Run a `gcloud` command.

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
