# Zuke package catalogue

Which `@zuke/<tool>` wrapper exists for a CLI. Read this before writing any
command.

> Confirm exact signatures against the version the project has installed: on
> Node, `node_modules/@zuke/<package>/README.md` (its `## API` section) and the
> `.d.ts` files; on Deno, `deno doc jsr:@zuke/<package>`. For breadth, use
> `llms-full.txt`
> (<https://raw.githubusercontent.com/zuke-build/zuke/master/llms-full.txt>,
> which tracks `master`). This file is a summary, not the source of truth.

## Tool wrappers — the settings-lambda style

Every external tool is a `*Tasks` object; each task takes `(s) => s.…` mirroring
the real CLI's flags. A non-exhaustive map, as package: object — typical tasks
(see each installed package's docs, above, for the full task list and settings
methods of each):

- `@zuke/core`: `FileTasks`, `EnvTasks`, `ProcessTasks`, `RuntimeTasks`,
  `StreamTasks`, `NetTasks`, `AnnounceTasks`, `ToolTasks`, `BrowserTasks` —
  copy/move/remove/read/write/stat files, symlink/readLink (`force` re-points an
  existing link); env vars, child processes and signals, runtime facts (os,
  arch, cwd, whether a stream is a terminal), changing directory and exit, temp
  files and directories, a stream to a file, TCP listeners and connections, an
  HTTP server; Slack/Teams/Discord posts; install tool binaries; open an http(s)
  URL in the default browser (`BrowserTasks.open`)
- `@zuke/cli`: the `zuke` command — not a wrapper — `npm install -g
  @zuke-build/cli` (or, on Deno, `deno install -A -g -n zuke jsr:@zuke/cli`),
  then `zuke setup` scaffolds a project, on Node unless `--runtime deno`; inside
  one, `zuke <target>` runs that project's build from any directory in it; `zuke
  upgrade` updates the installed CLI; `zuke setup --sdk python` scaffolds a
  Python build the engine runs, and `zuke upgrade --engine` moves its engine
  pin; `zuke add <tool>`/`remove` edit the project's package.json (`zuke add
  docker` = `npm:@zuke-build/docker`, aliased `@zuke/docker`), or its deno.json
  on Deno (`jsr:@zuke/docker`), `zuke cache` fetches the build's graph, and
  `zuke relock [--min-dep-age 0]` regenerates the lock whatever core the project
  is on
- `@zuke/engine`: the engine for SDK-hosted builds — not a wrapper — runs the
  worker a project's `zuke.json` names under `sdk` (e.g. `{ "command": ["uv",
  "run", "build.py"] }`) on the core engine; the standalone `zuke` binary
  carries it, and a Python project's `./zuke` launcher downloads the pinned
  `zuke` release and runs that, so the project needs no Deno anywhere
- `@zuke/console`: `ConsoleTasks` — themed console output (headings, notices,
  the `logo()` splash) so a build never hand-rolls `console.log`
- `@zuke/qr`: `QrTasks` — `print`/`render`/`encode` a QR code for any data —
  URLs, Wi-Fi and login strings, tokens, JSON — as terminal output, text lines
  or the raw module matrix; no `qrencode` needed
- `@zuke/deno`: `DenoTasks`, `DenoDeployTasks` — `check`, `test`, `bench`,
  `fmt`, `lint`, `cache`, `clean`, `doc`, `run`, `serve`, `eval`, `task`,
  `compile`, `info`, `init`, `upgrade`, `add`, `remove`, `install`, `uninstall`,
  `outdated`, `why`, `ci`, `approveScripts`, `bumpVersion`, `publish`, `pack`,
  `coverage`; readers `moduleGraph`, `cacheInfo`; `DenoDeployTasks` (until Deno
  Deploy closes, about April 2027): `deploy` (`.prod()`), `create`,
  `envList`/`envAdd`
  (`.secretValue()`)/`envUpdateValue`/`envUpdateContexts`/`envDelete`/`envLoad`,
  `logs` (`.once()`), `deploymentsList`, `appsList`, `appsGet`, `orgsList`,
  `whoami`; `.token()` rides `DENO_DEPLOY_TOKEN`, add `.nonInteractive()` in CI
- `@zuke/docs`: `DocsTasks` — turn generated API docs into published output
- `@zuke/npm`, `@zuke/npx`, `@zuke/bun`, `@zuke/pnpm`, `@zuke/yarn`,
  `@zuke/node`: `NpmTasks`, `NpxTasks`, `BunTasks`, ... — JS package managers +
  `npx` runner + `node`. `NpmTasks` covers npm's everyday surface —
  install/publish/registry/inspect — and hands back values from
  `outdatedEntries`, `auditSummary`, `pkgGet`, `whoamiName`
- `@zuke/cmd`: `CmdTasks` — `exec` — generic fallback for any CLI
- `@zuke/docker`, `@zuke/docker-compose`: `DockerTasks`, ... —
  build/run/compose. `DockerComposeTasks` covers the Compose surface — the
  lifecycle (`up`/`down`/`create`/`scale`/`wait`), images, containers
  (`run`/`exec`/`cp`/`export`), and the listings — with `servicePort`,
  `waitExitCode` and `composeVersion` handing back values. `dockerComposeCanary`
  is a stable/canary service platform for `@zuke/canary`. `DockerTasks` covers
  the everyday docker surface — containers, images, registry, and the
  `volume`/`network`/`system`/`context` groups — with `psEntries`,
  `imageEntries`, `volumeNames`, `networkNames` handing back values
- `@zuke/git`, `@zuke/gh`: `GitTasks`, `GhTasks` — git — the everyday surface,
  typed (see below) — and GitHub CLI: typed
  `pr`/`issue`/`release`/`run`/`workflow`/`repo`/`secret`/`variable`/`label`/`cache`
  tasks (see below), `GhTasks.run` for the long tail, `GhTasks.api` for REST
  endpoints without a verb, `GhTasks.createOrUpdateFile` to write one file
  through the contents API (`unchanged` when identical, no commit)
- `@zuke/homebrew`: `BrewTasks`, `HomebrewTasks` — Homebrew — `BrewTasks` types
  `brew`
  (`install`/`uninstall`/`test`/`audit`/`style`/`livecheck`/`tap`/`untap`/`tapNew`/`repository`,
  `info` parsed from `--json=v2`); `HomebrewTasks` ships a prebuilt binary
  through a tap: `formula` renders the Ruby, `publish` writes it to the tap
  (idempotent), `verify` installs/tests/uninstalls it through a throwaway local
  tap, `verifyJob` is its macOS + Linux CI job (see below)
- `@zuke/chocolatey`: `ChocoTasks`, `ChocolateyTasks` — Chocolatey —
  `ChocoTasks` types `choco` v2 (`pack`/`push`/`install`/`uninstall`/`apikey`,
  common `--yes`/`--force`/`--no-progress`/`--limit-output`); `ChocolateyTasks`
  ships a prebuilt Windows binary: `package` renders the nuspec and
  `chocolateyinstall.ps1` for a release zip, `verify`
  packs/installs/runs/uninstalls it from a temp source, `publish` pushes it with
  the API key masked, `verifyJob` is its Windows CI job (see below)
- `@zuke/cspell`, `@zuke/eslint`, `@zuke/oxlint`, `@zuke/biome`, `@zuke/dprint`,
  `@zuke/knip`, `@zuke/dpdm`, `@zuke/lint-staged`, `@zuke/shellcheck`: `*Tasks`
  — lint/format/spell/dead-code. `ShellcheckTasks.lint` analyses shell scripts;
  give it `.shell("sh")` or ShellCheck reads the shebang and checks a POSIX
  script as bash
- `@zuke/tsc`, `@zuke/tsx`, `@zuke/tsc-alias`, `@zuke/tsup`, `@zuke/tsdown`,
  `@zuke/vite`, `@zuke/storybook`, `@zuke/turbo`, `@zuke/nx`, `@zuke/nest`:
  `*Tasks` — TS compile / bundle / monorepo / framework CLIs
- `@zuke/openapi-ts`, `@zuke/orval`, `@zuke/redocly`: `*Tasks` — generate API
  clients from OpenAPI
- `@zuke/husky`: `HuskyTasks` — git hooks
- `@zuke/jest`, `@zuke/vitest`, `@zuke/playwright`, `@zuke/cypress`: `*Tasks` —
  test runners
- `@zuke/jsr`, `@zuke/codecov`, `@zuke/release-please`: `JsrTasks`,
  `CodecovTasks`, ... — publish / coverage upload / releases
- `@zuke/kubectl`, `@zuke/helm`, `@zuke/kustomize`, `@zuke/argo-rollouts`,
  `@zuke/terraform`, `@zuke/tofu`, `@zuke/gcloud`: `*Tasks` — infra/deploy.
  `ArgoRolloutsTasks` drives the Argo Rollouts plugin — `setImage` starts a
  rollout, `promote` advances it past a pause (`.full()` skips the rest),
  `abort` backs it out, `status` waits on it; weights come from the Rollout
  manifest's steps, not the CLI. `KubectlTasks` covers the deploy surface —
  manifests, workloads, pods, nodes, kubeconfig — with `diffHasChanges`, `canI`,
  `getEntries`, `eventEntries`, `currentContext`, `versionInfo` handing back
  values (see below), plus `kubectlCanary` — a two-Deployment platform for
  `@zuke/canary`. `HelmTasks` adds `helmCanary`, a two-release platform for it.
  `GcloudTasks` types the Google Cloud deploy path — auth, builds, Cloud Run,
  Artifact Registry, GKE, storage, secrets, logs, metrics (see below), plus
  `cloudRunCanary` and a `cloudMonitoring(...)` analysis for `@zuke/canary`.
- `@zuke/aws`: `AwsTasks`, `lambdaCanary`, `cloudwatch` — the AWS CLI — typed
  STS, `configure`, S3, ECR, ECS, Lambda, CloudFormation, Secrets Manager, SSM,
  EKS, CloudWatch and Logs tasks, readers that hand back values (`accountId`,
  `ecrLoginPassword`, `secretString`, `parameterValue`, `stackOutput`,
  `lambdaPublishedVersion`, `metricValue`, `alarmState`, `logsInsightsQuery`),
  `lambdaCanary(...)` — a Lambda alias platform — and `cloudwatch(...)` — a
  CloudWatch analysis — for `@zuke/canary` (see below)
- `@zuke/az`: `AzTasks`, `containerAppCanary`, `azureMonitor` — the Azure CLI —
  typed login, account, resource groups, ACR, AKS, Container Apps, App Service,
  Functions, Key Vault, deployment, blob storage and Azure Monitor tasks,
  readers that hand back values (`accessToken`, `subscriptionId`, `tenantId`,
  `secretValue`, `acrToken`, `containerappFqdn`, `webappHostName`,
  `deploymentOutput`, `resourceGroupExists`, `metricValue`,
  `logAnalyticsQuery`), `containerAppCanary(...)` — a Container Apps platform —
  and `azureMonitor(...)` — an Azure Monitor analysis — for `@zuke/canary` (see
  below)
- `@zuke/apple`: `CodesignTasks`, `NotarytoolTasks`, `SecurityTasks`,
  `DittoTasks`, `XcodebuildTasks`, `ProvisioningProfileTasks`,
  `TestFlightTasks`, `AltoolTasks` — macOS signing — `codesign`
  sign/verify/display, `xcrun notarytool` submit/info/log/history (parsed JSON;
  a rejected `.wait()` throws with the log's issues), `security` keychain
  subcommands and `temporaryKeychain(...)` for CI, and `ditto` to zip a bundle
  (see below); iOS builds — `XcodebuildTasks.build`/`test` (`.testPlan()`,
  `.onlyTesting()`, `.enableCodeCoverage()`)/`archive`
  (`.archivePath()`)/`exportArchive` (`.exportOptionsPlist()`),
  `writeExportOptions(path, (o) => o.method("app-store-connect").teamId(t))`,
  `.allowProvisioningUpdates().authenticationKey(p8, keyId, issuer)`,
  `.buildSetting(name, value)`; TestFlight —
  `ProvisioningProfileTasks.temporary((s) => s.base64(p), async ({ profile }) =>
  …)` installs a profile for the signing steps only (`inspect`/`install` too;
  expired refused), `TestFlightTasks.distribute((s) =>
  s.issuerId(i).keyId(k).privateKey(p8).bundleId(b).buildNumber(n).usesNonExemptEncryption(false).whatToTest(t).group("QA").submitForBetaReview())`
  waits for processing then distributes, `AltoolTasks.uploadApp`/`validateApp`
  (deprecated `altool`)
- `@zuke/signpath`: `SignPathTasks`, `SigntoolTasks` — Windows Authenticode
  signing through SignPath — `submit` (GitHub-origin `.gitHubOrigin((g) =>
  g.artifactId(id))` or direct `.artifact(path)`; waits, throws on
  Denied/Failed/Canceled/timeout, downloads to `.output(path)`), `status`,
  `download`, and `signtool verify` (see below)
- `@zuke/google`: `GooglePlayTasks` — Google Play — `upload((s) =>
  s.serviceAccount(keyJson).packageName(p).bundle(aab).track("internal").status("completed").releaseNotes(t,
  "en-US").timeout("15m"))` signs in as the service account, opens an edit,
  uploads the `.aab`, sets the track's release to its `versionCode` and commits
  (deleting the edit on failure); `.status("draft")` for an app that has never
  had a release, `.changesNotSentForReview()` where Google requires it (see
  below)
- `@zuke/flutter`: `FlutterTasks` — Flutter apps — `analyze`, `test`
  (`.coverage()`, `.shard(i, n)`, `.reporter()`),
  `buildApk`/`buildAppBundle`/`buildAar`/`buildIos`/`buildIpa`/`buildWeb`/`buildMacos`/`buildLinux`/`buildWindows`
  (`.release()`, `.flavor()`, `.target()`, `.dartDefine(k, v)`,
  `.buildName()`/`.buildNumber()`, `.obfuscate().splitDebugInfo(dir)`),
  `pubGet`/`pubUpgrade`/`pubOutdated`/`pubDeps`/`pubAdd`/`pubRemove`, `clean`,
  `create`, `genL10n`, `drive`, `install`, `devices`, `doctor`, `precache`,
  `config`, `version`; `flutter` resolved from `PATH`
- `@zuke/dart`: `DartTasks` — the Dart CLI — `analyze` (`.fatalInfos()`,
  `.format()`), `format` (`.setExitIfChanged()`, `.output()`, `.lineLength()`),
  `fix` (`.apply()`, `.dryRun()`, `.code()`), `test` (`.coverage(dir)`,
  `.shard(i, n)`, `.reporter()`, `.platform()`, `.compiler()`), `run`
  (`.entry()`, `.define(k, v)`, `.enableAsserts()`; `.args()` reach the
  program),
  `compileExe`/`compileAotSnapshot`/`compileJitSnapshot`/`compileKernel`/`compileJs`/`compileWasm`
  (`.entry()` required, `.output()`, `.targetOs()`, `.define(k, v)`,
  `.optimize(n)`, `.saveDebuggingInfo()`), `doc`, `create`,
  `pubGet`/`pubUpgrade`/`pubDowngrade`/`pubOutdated`/`pubDeps`/`pubAdd`/`pubRemove`/`pubPublish`,
  `info`, `version`; `dart` resolved from `PATH`
- `@zuke/security`: `*Tasks` — security scanning
- `@zuke/claude`, `@zuke/codex`, `@zuke/gemini`: `ClaudeTasks`, ... — headless
  AI CLIs
- `@zuke/ai`: `securityReviewer`, ..., `aiFixer`, `agentFixer` — AI review
  gates + self-healing (see below)
- `@zuke/otel`: `otel` (a plugin) — export runs and targets as OpenTelemetry
  traces (see below)
- `@zuke/canary`: `canary` (a component), `httpProbe`, `prometheus`,
  `metricThreshold` — canary releases — stage, step exposure up under analysis,
  approve, promote, with one `abort` on every failure path (see below)
- `@zuke/prometheus`: `PrometheusTasks` — the Prometheus HTTP API —
  `query`/`queryRange` with typed vector/matrix/scalar/string results (NaN and
  infinities parsed, native histograms typed, `warnings`/`infos` kept),
  `series`, `labels`, `labelValues`, `metadata`, `targets`, `rules`, `alerts`,
  `buildInfo`, the `healthy`/`ready` probes, and the `value`/`samples` readers a
  gate needs (see below)

The catalog keeps growing — the package list in `llms.txt`'s `## Packages`
catalogue (or the list above) is the source of truth for **whether a wrapper
exists**; a package's own docs only confirm the **shape** of a package whose
name you already know, it cannot tell you one exists. Check the catalogue before
reaching for the fallback below — using `CmdTasks.exec`/`$` for a tool that has
a `@zuke/<tool>` package is a bug, not a style choice.
