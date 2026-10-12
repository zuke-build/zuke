# @zuke/signpath

Authenticode signing through [SignPath](https://about.signpath.io) for
[Zuke](https://github.com/zuke-build/zuke#readme) builds: submit a signing
request, wait for it, download the signed artifact, and check the signature with
`signtool verify` — in a fluent settings-lambda API, with the API token kept out
of every progress line and error.

```ts
import { SignPathTasks, SigntoolTasks } from "@zuke/signpath";

const { signingRequestId } = await SignPathTasks.submit((s) =>
  s.organizationId(orgId).apiToken(token)
    .projectSlug("zuke").signingPolicySlug("release-signing")
    .gitHubOrigin((g) => g.artifactId(artifactId))
    .timeout("30m").output("dist/signed/zuke.zip")
);
await SigntoolTasks.verify((s) =>
  s.authenticodePolicy().verbose().file("dist/signed/zuke.exe")
); // signtool verify /pa /v dist/signed/zuke.exe
```

## The tasks

| Task                     | What it does                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `SignPathTasks.submit`   | submits a signing request, waits for a final status, and with `.output(path)` downloads the result |
| `SignPathTasks.status`   | reads a request's status once (`status`, `workflowStatus`, `isFinalStatus`, `webUrl`)              |
| `SignPathTasks.download` | downloads a completed request's signed artifact to `.output(path)`                                 |
| `SigntoolTasks.verify`   | runs `signtool verify` from the Windows SDK to check the Authenticode signature                    |

## Two ways to submit

**GitHub origin** — `.gitHubOrigin((g) => g.artifactId(id))`. The build uploads
the file with `actions/upload-artifact` (v4 or later) and passes the step's
`artifact-id` output. SignPath's GitHub connector then reads the workflow run,
checks the artifact belongs to it and that every job leading up to it ran on a
GitHub-hosted runner, and downloads the artifact itself. This is the route
SignPath's open-source programme requires. The run id, repository and GitHub
token default to `GITHUB_RUN_ID`, `GITHUB_REPOSITORY` and `GITHUB_TOKEN`; the
workflow's own token needs `actions: read` and `contents: read`. Origin
validation failures throw a `SignPathValidationError` listing what the connector
reported and how to fix it.

**Direct upload** — `.artifact(path)` posts the file to SignPath's
`SubmitWithArtifact` endpoint. Use it outside GitHub Actions, for a project
whose policy does not require origin verification.

Exactly one of the two is required. `.artifactConfigurationSlug(slug)`,
`.description(text)` and `.parameter(name, value)` are optional on both.

## Waiting

`submit` polls the request's status every `.pollInterval(...)` (default ten
seconds) until it is final, for at most `.timeout(...)` (default ten minutes — a
policy with a manual approval wants longer):

- `Completed` returns the result;
- `Denied`, `Failed` or `Canceled` throws a `SignPathSigningError` naming the
  request and its page in the SignPath web app;
- still not final at the deadline throws a `SignPathTimeoutError`, likewise. The
  request is left as it is — approve it and fetch the file later with
  `SignPathTasks.download`.

Every step logs one line (`SignPath: signing request … is WaitingForApproval`),
printed when the status changes.

## The token

The API token is sent only as `Authorization: Bearer …` to the API URL (by
default `https://app.signpath.io/Api`) and the connector URL, both of which must
be `https:` unless loopback. It defaults to the `SIGNPATH_API_TOKEN` environment
variable, the organization id to `SIGNPATH_ORGANIZATION_ID`. Every message the
package builds — from a SignPath answer, a status, a runtime error — is scrubbed
of the API token and the GitHub token, stripped of control characters and capped
in length, and no error keeps the underlying one as its `cause`. Declare the
token as a `parameter(...).secret()` so Zuke masks it in its own output too.

Organization and request ids must be GUIDs, so nothing a caller or a server
supplies can add a segment, a query or a fragment to a URL.

## Transport

Every call has a timeout (`.requestTimeout(...)`, default one minute;
`.downloadTimeout(...)`, default five minutes). A status read or a download is
retried after a network error, a timeout, or HTTP 429, 502, 503 or 504; a
submission only after 429 or 503, so a retry cannot create a second signing
request (`.retries(n)`, default 3, with a doubling delay from one second). An
API call that is redirected fails rather than following the redirect with the
token. A download may follow up to five redirects to blob storage, each `https:`
or on the same origin, and drops the token as soon as it leaves SignPath's
origin.

## The download

The signed artifact is written to exactly the `.output(path)` given — the name
SignPath sends in `Content-Disposition` is ignored — and its directory is
created. It is streamed to a uniquely named sibling file and renamed into place
only once complete, so a failed, timed-out or oversized (`.maxDownloadBytes(n)`,
default 2 GiB) download never leaves a truncated file where the build expects a
signed one. A GitHub-origin artifact comes back as the zip
`actions/upload-artifact` made; unzip it with core's `extractZip`.

## Dry runs

SignPath calls are HTTP requests, not commands, so `--dry-run` cannot echo them:
a `.dryRunnable()` target that calls `SignPathTasks.submit` really submits. Keep
signing targets out of dry runs (do not mark them `.dryRunnable()`).

## signtool

`SigntoolTasks.verify` lives here because it is the other half of the same job:
SignPath signs, `signtool verify` proves the signature on the runner before the
file is released. Only `verify` is wrapped — SignPath's keys never leave its
HSM, so `signtool sign` has no place in this flow. `signtool.exe` ships with the
Windows SDK and is usually not on `PATH` (on a GitHub-hosted Windows runner it
lives under `C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64`): point
`.toolPath(...)` at it. Pass `.authenticodePolicy()` (`/pa`) for an ordinary
`.exe` or `.msi`; without it `signtool` applies the driver policy. A file
operand starting with `-` is passed as `./-…`, and one starting with `/` is
refused, since `signtool` would read it as an option.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/signpath` — Authenticode signing through
SignPath (https://about.signpath.io) from Zuke builds, and `signtool verify`
to check the result.

`SignPathTasks.submit` submits a signing request, waits for SignPath to
finish it, and downloads the signed artifact. From GitHub Actions, have
SignPath fetch the artifact `actions/upload-artifact` uploaded and verify
the workflow run it came from — the route SignPath's open-source programme
requires:

```ts
import { SignPathTasks, SigntoolTasks } from "@zuke/signpath";

await SignPathTasks.submit((s) =>
  s.organizationId(orgId).apiToken(token)
    .projectSlug("zuke").signingPolicySlug("release-signing")
    .gitHubOrigin((g) => g.artifactId(artifactId))
    .output("dist/signed/zuke.zip")
);
await SigntoolTasks.verify((s) =>
  s.authenticodePolicy().verbose().file("dist/signed/zuke.exe")
);
```

Elsewhere, upload the file directly with `.artifact(path)` instead of
`.gitHubOrigin(...)`. The API token never reaches a progress line or an
error message.
@module

const SignPathTasks: SignPathTasksApi
  Typed task functions for SignPath's code-signing service.

const SigntoolTasks: SigntoolTasksApi
  Typed task functions for the Windows SDK's `signtool`.

class SignPathApiError extends Error
  SignPath refused a call: a non-2xx status that is not a transient one the
  transport retried.

  ```ts
  try {
    await SignPathTasks.status((s) => s.signingRequestId(id));
  } catch (error) {
    if (error instanceof SignPathApiError && error.status === 401) {
      // the API token is wrong or expired
    }
  }
  ```

  constructor(method: string, path: string, status: number, detail: string | undefined)
    Build the error from the failing call and what the server said.
  override name: string
    The error name.
  readonly method: string
    The HTTP method of the failing call.
  readonly path: string
    The endpoint path, such as `/v1/<org>/SigningRequests` (never the host).
  readonly status: number
    The HTTP status of the answer.
  readonly detail: string | undefined
    What SignPath said, when it said anything: the `error`, `detail`, `title`
    or `message` of a JSON answer, or the start of a plain-text one. Scrubbed
    of credentials and control characters, and capped in length.

class SignPathConnectionSettings
  The connection half of every SignPath call's settings.

  organizationId_?: string
    The organization id (set by {@link organizationId}); else read from the environment.
  apiToken_?: string
    The API token (set by {@link apiToken}); else read from the environment.
  apiUrl_: string
    The REST API's base URL (set by {@link apiUrl}).
  requestTimeout_: number
    The per-call timeout in ms (set by {@link requestTimeout}).
  downloadTimeout_: number
    The signed-artifact download timeout in ms (set by {@link downloadTimeout}).
  maxDownloadBytes_: number
    The signed-artifact size cap in bytes (set by {@link maxDownloadBytes}).
  retries_: number
    How many times a transient failure is retried (set by {@link retries}).
  fetch_: typeof fetch
    The `fetch` to use (set by {@link fetch}); the global one by default.
  readEnv_: (name: string) => string | undefined
    The environment reader (set by {@link readEnv}).
  sleep_: (ms: number) => Promise<void>
    How the task waits between polls and retries (set by {@link sleep}).
  now_: () => number
    The clock, in epoch ms (set by {@link now}).
  log_: (line: string) => void
    Where progress lines go (set by {@link log}); `console.log` by default.
  organizationId(id: string): this
    The SignPath organization id — the GUID in the web app's URLs and under
    Organization settings. Defaults to the `SIGNPATH_ORGANIZATION_ID`
    environment variable.
  apiToken(token: string): this
    The API token of a SignPath user with submitter permission on the
    project's signing policy, sent as `Authorization: Bearer <token>`.
    Defaults to the `SIGNPATH_API_TOKEN` environment variable.

    The token never reaches a progress line or an error message: every
    message this package builds is scrubbed of it. Declare it in the build as
    a `parameter(...).secret()` so Zuke masks it in its own output too.
  apiUrl(url: string): this
    The REST API's base URL, `https://app.signpath.io/Api` by default; the
    version and organization (`/v1/<org>/…`) are appended. It carries the
    token, so it must be `https:` unless it is loopback or
    `ZUKE_ALLOW_INSECURE_URL` is set. The web app's links in errors and
    progress lines use the same origin (`<origin>/Web/<org>/…`).
  requestTimeout(duration: string | number): this
    Abort one API call after this long (`"30s"`, or ms); default one minute.
  downloadTimeout(duration: string | number): this
    Abort a signed-artifact download that has not finished after this long
    (`"10m"`, or ms); default five minutes.
  maxDownloadBytes(bytes: number): this
    Refuse a signed artifact larger than this many bytes; default 2 GiB.
  retries(count: number): this
    Retry a transient failure this many times (default 3), with a doubling
    delay from one second. A status poll or a download is retried after a
    network error, a timeout, or HTTP 429, 502, 503 or 504; a submission only
    after 429 or 503, the answers that say the request was not processed, so
    a retry cannot create a second signing request.
  fetch(fetcher: typeof fetch): this
    Send with this `fetch` instead of the global one — the seam tests use.
  readEnv(reader: (name: string) => string | undefined): this
    Read environment variables through `reader` instead of `Deno.env`.
  sleep(sleeper: (ms: number) => Promise<void>): this
    Wait through `sleeper` instead of a timer — the seam tests use.
  now(clock: () => number): this
    Read the time from `clock` (epoch ms) instead of `Date.now`.
  log(sink: (line: string) => void): this
    Send progress lines to `sink` instead of `console.log`.

class SignPathDownloadSettings extends SignPathStatusSettings
  Settings for `SignPathTasks.download`: the connection, the signing
  request's id, and where to write the signed artifact.

  output_?: string
    Where to write the signed artifact (set by {@link output}).
  output(path: PathLike): this
    The file to write the signed artifact to; its directory is created when
    missing, and an existing file is replaced. Required.

class SignPathGitHubOriginSettings
  Where the artifact to sign lives in GitHub Actions. Only the artifact id is
  required: the run, repository and token default to the workflow's own
  environment (`GITHUB_RUN_ID`, `GITHUB_REPOSITORY`, `GITHUB_TOKEN`).

  ```ts
  await SignPathTasks.submit((s) =>
    s.projectSlug("zuke").signingPolicySlug("release-signing")
      .gitHubOrigin((g) => g.artifactId(artifactId).token(githubToken))
      .output("dist/signed/zuke.zip")
  );
  ```

  artifactId_?: string
    The workflow artifact's id (set by {@link artifactId}).
  runId_?: string
    The workflow run's id (set by {@link runId}); else `GITHUB_RUN_ID`.
  repository_?: string
    The repository, `owner/name` (set by {@link repository}); else `GITHUB_REPOSITORY`.
  token_?: string
    The GitHub token (set by {@link token}); else `GITHUB_TOKEN`.
  connectorUrl_: string
    The connector's URL (set by {@link connectorUrl}).
  artifactId(id: string | number): this
    The id of the artifact `actions/upload-artifact` (v4 or later) uploaded —
    its `artifact-id` step output. Required.
  runId(id: string | number): this
    The workflow run the artifact belongs to; defaults to `GITHUB_RUN_ID`.
  repository(name: string): this
    The repository, `owner/name`; defaults to `GITHUB_REPOSITORY`.
  token(value: string): this
    The GitHub token the connector reads the run and downloads the artifact
    with — the workflow's `GITHUB_TOKEN` (with `actions: read` and
    `contents: read`) is enough. Defaults to the `GITHUB_TOKEN` environment
    variable. It is masked out of every message, like the API token.

    The workflow's own token stops working when the workflow ends, so the
    task must wait for SignPath to fetch the artifact; `submit` always waits.
  connectorUrl(url: string): this
    The SignPath GitHub connector to submit through; SignPath's hosted
    GitHub.com one by default. Only a self-hosted GitHub Enterprise Server
    needs another. It carries the API token, so it must be `https:`.

class SignPathRequestError extends Error
  A SignPath call produced no usable answer: it could not be sent, it timed
  out, it was redirected somewhere it must not follow, the download was larger
  than allowed, or the answer was not shaped as SignPath documents it.

  constructor(method: string, path: string, reason: string)
    Build the error from the failing call and the (scrubbed) reason.
  override name: string
    The error name.
  readonly method: string
    The HTTP method of the failing call.
  readonly path: string
    The endpoint path, such as `/v1/<org>/SigningRequests` (never the host).

class SignPathSigningError extends Error
  A signing request reached a final status other than `Completed` — it was
  `Denied` by an approver, `Failed` (a malware scan, a processing error, an
  artifact SignPath could not retrieve) or `Canceled`.

  constructor(signingRequestId: string, status: string, workflowStatus: string | undefined, webUrl: string)
    Build the error from the request and the final status it reached.
  override name: string
    The error name.
  readonly signingRequestId: string
    The signing request's id.
  readonly status: string
    The final status, such as `Denied`.
  readonly workflowStatus: string | undefined
    The finer-grained workflow status, such as `MalwareDetected`, when sent.
  readonly webUrl: string
    The signing request's page in the SignPath web app.

class SignPathStatusSettings extends SignPathConnectionSettings
  Settings for `SignPathTasks.status`: the connection and the request's id.

  signingRequestId_?: string
    The signing request's id (set by {@link signingRequestId}).
  signingRequestId(id: string): this
    The signing request to read — the GUID `submit` returned. Required.

class SignPathSubmitSettings extends SignPathConnectionSettings
  Settings for `SignPathTasks.submit`.

  projectSlug_?: string
    The project's slug (set by {@link projectSlug}).
  signingPolicySlug_?: string
    The signing policy's slug (set by {@link signingPolicySlug}).
  artifactConfigurationSlug_?: string
    The artifact configuration's slug (set by {@link artifactConfigurationSlug}).
  description_?: string
    The request's description (set by {@link description}).
  readonly parameters_: Array<readonly [string, string]>
    User-defined parameters, in the order set (set by {@link parameter}).
  artifact_?: string
    A local file to upload (set by {@link artifact}).
  gitHubOrigin_?: SignPathGitHubOriginSettings
    A GitHub Actions artifact to fetch (set by {@link gitHubOrigin}).
  output_?: string
    Where to write the signed artifact (set by {@link output}).
  timeout_: number
    How long to wait for the request to finish, in ms (set by {@link timeout}).
  pollInterval_: number
    How often to poll its status, in ms (set by {@link pollInterval}).
  projectSlug(slug: string): this
    The SignPath project's slug. Required.
  signingPolicySlug(slug: string): this
    The signing policy's slug, such as `release-signing` — it decides the
    certificate and whether an approver must sign off. Required.
  artifactConfigurationSlug(slug: string): this
    The artifact configuration's slug — which files inside the artifact are
    signed, and how. The project's default configuration when unset.
  description(text: string): this
    A description shown on the request, such as the version being released.
  parameter(name: string, value: string): this
    A user-defined parameter the artifact configuration reads (a version
    number to stamp, say). Names are letters, digits, `.`, `-` and `_`.
    Repeatable.
  artifact(path: PathLike): this
    Upload this local file as the artifact (`SubmitWithArtifact`). Exactly one
    of `artifact` and {@link gitHubOrigin} is required.

    SignPath's open-source programme accepts only builds whose origin it can
    verify, so for it use {@link gitHubOrigin} instead.
  gitHubOrigin(configure: Configure<SignPathGitHubOriginSettings>): this
    Have SignPath fetch the artifact from a GitHub Actions workflow run and
    verify its origin. Exactly one of {@link artifact} and `gitHubOrigin` is
    required.
  output(path: PathLike): this
    Download the signed artifact to this file once the request completes; its
    directory is created when missing. Without it, `submit` only waits.
  timeout(duration: string | number): this
    Fail with a `SignPathTimeoutError` when the request is not final after
    this long (`"30m"`, or ms); default ten minutes. A policy that needs a
    manual approval wants longer.
  pollInterval(duration: string | number): this
    Poll the request's status this often (`"5s"`, or ms; at least one second);
    default ten seconds.

class SignPathTimeoutError extends Error
  A signing request was still not final when the wait ran out — typically
  one waiting for a manual approval. The request is left as it is; approve
  it and fetch the result later with `SignPathTasks.download`.

  constructor(signingRequestId: string, status: string, timeoutMs: number, webUrl: string)
    Build the error from the request, its last status and the wait's length.
  override name: string
    The error name.
  readonly signingRequestId: string
    The signing request's id.
  readonly status: string
    The last status seen, such as `WaitingForApproval`.
  readonly timeoutMs: number
    How long the wait lasted, in milliseconds.
  readonly webUrl: string
    The signing request's page in the SignPath web app.

class SignPathValidationError extends Error
  The SignPath GitHub connector refused to create the signing request because
  the build's origin did not verify — the artifact is not from this workflow
  run, a job ran on a self-hosted runner, the GitHub token cannot read the
  run, and the like. {@link issues} lists what the connector reported.

  constructor(issues: readonly SignPathValidationIssue[])
    Build the error from the connector's validation errors.
  override name: string
    The error name.
  readonly issues: readonly SignPathValidationIssue[]
    The validation errors, in the order the connector reported them.

class SigntoolVerifySettings extends ToolSettings
  Settings for `signtool verify`.

  override protected defaultTool(): string
    The default executable name (`signtool`).
  override protected defaultResolution(): ToolResolution
    Resolve from `PATH` — `signtool` is a native Windows SDK binary.
  authenticodePolicy(): this
    Verify against the default Authenticode policy (`/pa`) — what a signed
    `.exe` or `.msi` needs. Without it `signtool` applies the Windows driver
    policy and rejects ordinary code-signing certificates.
  kernelPolicy(): this
    Verify against the kernel-mode driver signing policy (`/kp`).
  policy(guid: string): this
    Verify against the policy with this GUID (`/pg`).
  allSignatures(): this
    Verify every signature of a file that carries several (`/all`).
  signatureIndex(index: number): this
    Verify only the signature at this index, from 0 (`/ds`).
  hash(algorithm: SigntoolHashAlgorithm): this
    Look the file up in a catalog only for this digest algorithm (`/hash`).
  catalog(path: PathLike): this
    Verify against this catalog file (`/c`).
  rootSubjectName(name: string): this
    Require the signing certificate to chain to a root whose subject name
    contains this text (`/r`).
  timestampWarning(): this
    Warn when the signature is not timestamped (`/tw`).
  description(): this
    Print the signature's description and URL (`/d`).
  verbose(): this
    Print the signer, the chain and the timestamp (`/v`).
  debug(): this
    Print debugging information (`/debug`).
  file(...paths: PathLike[]): this
    The files to verify (positional), at least one. A relative path that
    starts with `-` is passed as `./-…` so it cannot be read as an option; one
    that starts with `/` is refused, since `signtool` would read it as an
    option and on Windows it means the current drive's root — give a
    drive-qualified or a relative path instead.
  override protected buildArgs(): string[]
    Assemble the argv: `verify`, the flags, then the files.

interface SignPathSignedArtifact
  A signed artifact written to disk by `SignPathTasks.download` or `submit`.

  readonly path: string
    The path it was written to — the one configured with `.output(...)`.
  readonly bytes: number
    Its size in bytes.

interface SignPathSigningRequestStatus
  Where a signing request stands, from `GET …/SigningRequests/<id>/Status`.

  SignPath documents these `status` values: `InProgress`,
  `WaitingForApproval`, `Completed`, `Failed`, `Denied` and `Canceled` — the
  last four final. `workflowStatus` is finer-grained (`Submitted`,
  `RetrievingArtifact`, `ScanningForMalware`, `Processing`, `MalwareDetected`,
  `ArtifactRetrievalFailed`, …). Both are kept as the strings SignPath sent, so
  a value added later still reads.

  readonly signingRequestId: string
    The signing request's id, a GUID.
  readonly status: string
    The status, such as `InProgress` or `Completed`.
  readonly workflowStatus: string | undefined
    The workflow status, such as `ScanningForMalware`, when sent.
  readonly isFinalStatus: boolean
    Whether the request will not change any more: SignPath's `isFinalStatus`,
    or — should an answer leave it out — whether `status` is one of the four
    documented final ones.
  readonly webUrl: string
    The signing request's page in the SignPath web app.

interface SignPathSubmission
  What `SignPathTasks.submit` did: the request, its outcome, the download.

  readonly signingRequestId: string
    The new signing request's id, a GUID.
  readonly webUrl: string
    The signing request's page in the SignPath web app.
  readonly status: SignPathSigningRequestStatus
    The final status — always `Completed`; anything else throws.
  readonly signedArtifact: SignPathSignedArtifact | undefined
    The signed artifact, when `.output(...)` asked for it to be downloaded.

interface SignPathTasksApi
  The operations {@link SignPathTasks} exposes.

  submit(configure: Configure<SignPathSubmitSettings>): Promise<SignPathSubmission>
    Submit a signing request, wait for it to complete, and — with
    `.output(path)` — download the signed artifact.

    ```ts
    const { signingRequestId } = await SignPathTasks.submit((s) =>
      s.organizationId(orgId).apiToken(token)
        .projectSlug("zuke").signingPolicySlug("release-signing")
        .gitHubOrigin((g) => g.artifactId(artifactId))
        .timeout("30m").output("dist/signed/zuke.zip")
    );
    ```

    @throws {SignPathValidationError}
        when the GitHub origin did not verify.

    @throws {SignPathSigningError}
        when the request ends other than `Completed`.

    @throws {SignPathTimeoutError}
        when it is not final within `.timeout(...)`.

    @throws {SignPathApiError}
        when SignPath refuses a call.

    @throws {SignPathRequestError}
        when a call gets no usable answer.

  status(configure: Configure<SignPathStatusSettings>): Promise<SignPathSigningRequestStatus>
    Read a signing request's status once — no waiting.

    ```ts
    const { status } = await SignPathTasks.status((s) =>
      s.signingRequestId(id)
    );
    ```
  download(configure: Configure<SignPathDownloadSettings>): Promise<SignPathSignedArtifact>
    Download a completed signing request's signed artifact.

    ```ts
    await SignPathTasks.download((s) =>
      s.signingRequestId(id).output("dist/signed/zuke.exe")
    );
    ```

interface SignPathValidationIssue
  One build-system validation error the GitHub connector reported.

  readonly error: string
    What failed, as the connector worded it (scrubbed and capped).
  readonly howToFix: string | undefined
    The connector's advice on fixing it, when it gave any.

interface SigntoolTasksApi
  The shape of {@link SigntoolTasks}.

  verify(configure: Configure<SigntoolVerifySettings>): Promise<CommandOutput>
    Check a file's Authenticode signature with `signtool verify`; a file that
    is unsigned or fails the policy exits non-zero, which throws unless
    `.noThrow()` is set.

type SigntoolHashAlgorithm = "SHA1" | "SHA256"
  The digest algorithms `/hash` accepts.
````

</details>

<!-- ZUKE:API:END -->
