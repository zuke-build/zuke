# @zuke/helm

Typed [Helm](https://helm.sh) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `install`, `upgrade`,
`uninstall`, `rollback`, `getAll`, `template`, `lint`, `dependencyUpdate`,
`repoAdd`, and `package`.

```ts
import { HelmTasks } from "@zuke/helm";

await HelmTasks.upgrade((s) =>
  s.release("api").chart("./charts/api").install().namespace("prod")
    .set("image.tag", "1.4").wait()
);
```

Every task shares the cluster-targeting flags `.namespace(...)`,
`.kubeContext(...)`, and `.kubeconfig(...)`. Arguments stay a discrete argv
array end-to-end — never a shell string — so command construction is
injection-free.

## Helm canary platform

`helmCanary` makes a pair of releases a platform for a
[`@zuke/canary`](https://jsr.io/@zuke/canary) rollout. The candidate runs as a
second release (`<stable>-canary` unless you name it with
`.canaryRelease(...)`), and exposure is the share of the replicas it holds:

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { canary, httpProbe } from "@zuke/canary";
import { helmCanary } from "@zuke/helm";

class Deploy extends Build {
  tag = parameter("Image tag to roll out").required();

  rollout = canary((c) =>
    c.platform(
      helmCanary((h) =>
        h.chart("./charts/api").stableRelease("api").namespace("prod")
          .image(this.tag.value).replicas(10).values("values-prod.yaml")
          .helm((s) => s.kubeContext("prod"))
      ),
    )
      .steps(10, 50)
      .bake("10m")
      .analysis(httpProbe((p) => p.url("https://api.example.com/healthz")))
  );
  ship = target().dependsOn(this.rollout.promote).executes(() => {});
}

await run(Deploy);
```

Every upgrade passes `--reset-then-reuse-values`, and every command on the
stable release `--history-max 0`:

| Call      | helm                                                                                                                                                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`   | `get all <stable> --template '{{.Release.Version}} {{.Release.Info.Status}}'` — refused unless `deployed`, else recorded; `get all <canary>` — refused if the canary release already exists; then `upgrade <canary> <chart> --set replicaCount=0 --set-string image.tag=<image> --install --wait`. |
| `expose`  | `upgrade <canary> <chart> --set replicaCount=<n> --wait`, then `upgrade <stable> <stable chart> --set replicaCount=<total-n>`. `n` is rounded, at least 1 above 0 %; returns `n / total`.                                                                                                          |
| `promote` | `upgrade <stable> <chart> --set replicaCount=<total> --set-string image.tag=<image> --wait`, then `uninstall <canary> --ignore-not-found`.                                                                                                                                                         |
| `abort`   | `rollback <stable> <recorded revision> --wait`, then `uninstall <canary> --ignore-not-found`. Run by hand, the revision set with `.stableRevision(n)`; without one it refuses.                                                                                                                     |

`stage` records the image, the total replica count, the charts and their
versions, the values files and the image and replica keys, and `expose` and
`promote` use what it recorded — so a resumed process configured with another
image or chart still promotes the one that was analysed. Every command's exit
code is checked, so a `.helm((s) => s.noThrow())` or a runner that returns a
failed output cannot make a failed install look staged or a failed rollback look
done. A rollback is `helm rollback` to the exact revision `stage` read, so it
restores the stable image, values and replica count even after a promotion that
failed half-way; a stage that failed before installing anything runs no rollback
at all.

`stage` also records the stable release, the canary release and the namespace. A
later `expose`, `promote` or rollback configured with any other value refuses,
naming both, rather than act on either set: the kube context and kubeconfig in
`.helm(...)` cannot be recorded, so **do not change them, the release names or
the namespace mid-rollout** — finish or cancel the rollout with the
configuration it started with. A rollback run by hand with no record
(`rollout.abort`) uses the configuration as it is.

What it relies on, and cannot check:

- **The stable release's Service must select the canary release's pods too.** A
  chart scaffolded by `helm create` selects on
  `app.kubernetes.io/instance: <release>`, so its canary pods would take no
  requests at all and every analysis would pass on the stable version alone. Use
  a chart whose selector spans both releases.
- **The canary release inherits nothing from the stable one.** It is the chart's
  defaults plus `.values(...)`, so those files must reproduce the stable
  release's whole configuration — values only ever set by hand on the stable
  release are not in what the canary ran.
- **A second release of the chart must coexist with the first.** Names that are
  hard-coded or set by `fullnameOverride`, a duplicated Ingress host,
  cluster-scoped objects, and hooks that run again on install all collide or
  misbehave.
- **The chart must honour the replica key** (`replicaCount` by default, set with
  `.replicasKey(...)`): an enabled autoscaler ignores it.
- **The image key defaults to `image.tag`**, so `.image(...)` is the tag alone
  (a `@sha256:` digest after it is fine); point `.imageKey(...)` at a key that
  takes a full reference to pass one.
- **Every replica move re-renders the stable release.** Without
  `.stableChart(...)` it renders `.chart(...)`, so a candidate that changes the
  chart changes every stable pod's templates at the first step. Name the chart
  the stable release runs with `.stableChart(...)` / `.stableVersion(...)`, or
  keep the chart and version identical for both. A chart that is not a local
  path (`./…`, `../…`, `/…` or a Windows `C:\…`) must be pinned — `.chart(...)`
  with `.version(...)`, and `.stableChart(...)` with `.stableVersion(...)` — and
  `stage` refuses it otherwise, since an unpinned repository or `oci://` chart
  would render its latest version at every step and the promotion could install
  a chart that was never analysed.
- **A local chart is recorded by its path, not its content.** Editing the chart
  directory mid-rollout means the later steps and the promotion render a chart
  that was not the one analysed; leave it alone until the rollout finishes, or
  roll out a packaged, versioned chart instead.
- **Capacity can dip briefly.** The canary release scales up first, but `--wait`
  counts a Deployment ready at `replicas - maxUnavailable`, and the stable
  release scales down without waiting.
- **A rollback returns the stable release to the revision `stage` recorded**, so
  a deploy someone else made to it mid-rollout is rolled back too. The adapter's
  own commands keep every revision (`--history-max 0`), but another upgrade of
  the stable release mid-rollout (default `HELM_MAX_HISTORY`, 10) can still
  prune it; the rollback then fails rather than guess.
- Requires Helm 3.14 or later in the 3.x line (`--reset-then-reuse-values`,
  `uninstall --ignore-not-found`).

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/helm` — typed `HelmTasks` wrappers for the Helm (https://helm.sh) CLI,
for packaging and deploying to Kubernetes from a Zuke build.

```ts
import { HelmTasks } from "@zuke/helm";

await HelmTasks.upgrade((s) =>
  s.release("api").chart("./charts/api").install().namespace("prod").wait()
);
```

`helmCanary` makes a pair of releases a platform for a `@zuke/canary`
rollout.
@module

function helmCanary(configure: Configure<HelmCanarySettings>): HelmCanary
  Two Helm releases of one chart as a canary platform, for `@zuke/canary`:

  ```ts
  c.platform(helmCanary((h) =>
    h.chart("./charts/api").stableRelease("api").namespace("prod")
      .image(this.tag.value).replicas(10).values("values-prod.yaml")
      .helm((s) => s.kubeContext("prod"))
  ))
  ```

  The lambda runs on every call, so it may read resolved parameters; the
  image, replica count, charts, versions, values files and keys are fixed by
  `stage`. Every upgrade passes
  `--reset-then-reuse-values`, and every command on the stable release
  `--history-max 0`.

  - stage — reads the stable release's revision and status, checks no
    canary release exists, then `upgrade <stable>-canary <chart> --set replicaCount=0 --set-string image.tag=<image> --install --wait`.
  - expose — `upgrade --set replicaCount=<n>` on the canary release
    (waiting), then on the stable release with the remainder.
  - promote — `upgrade <stable> --set replicaCount=<total> --set-string image.tag=<image> --wait`, then `uninstall <canary> --ignore-not-found`.
  - abort — `rollback <stable> <recorded revision> --wait`, then the same
    uninstall; run by hand, the revision set with `.stableRevision(...)`.

const HelmTasks: HelmTasksApi
  Typed task functions for the `helm` CLI.

class HelmCanary
  Two Helm releases of one chart as a canary platform. Create one with
  {@link helmCanary}; hand it to `@zuke/canary`'s `c.platform(...)`.

  Exposure is the canary release's share of the replicas, so it is quantised.

  constructor(configure: Configure<HelmCanarySettings>)
    A platform whose settings `configure` produces, afresh on every call.
  readonly exposure: "replicas"
    Exposure is a share of replicas, quantised to whole pods.
  describe(): string
    `"Helm release api in prod"`, for the build summary.
  async stage(ctx: HelmCanaryContext): Promise<void>
    Check the stable release is deployed and record its revision, check no
    canary release is left over, then install the candidate as the canary
    release with no replicas: `upgrade <canary> <chart> --set <replicasKey>=0 --set-string <imageKey>=<image> --install --wait`. The
    image, replica count, charts, versions, values files and keys are
    recorded, and every later call uses those, not a configuration that may
    have changed since.
  async expose(percent: number, ctx: HelmCanaryContext): Promise<number>
    Give the canary release `percent` of the staged replica count — rounded,
    and at least one for any share above 0 — scaling it up (waiting) before
    the stable release down (not waiting). Returns the share achieved.
  async promote(ctx: HelmCanaryContext): Promise<void>
    Upgrade the stable release to the staged chart and image at the staged
    replica count, waiting for it, then uninstall the canary release.
    Idempotent.
  async abort(ctx: HelmCanaryContext): Promise<void>
    Return the stable release to where it was and remove the canary release.
    Idempotent. What it does depends on what this rollout recorded:

    - Staged (a rollback mid-rollout, or after a promotion that failed):
      `helm rollback <stable> <revision> --wait` to the revision `stage`
      recorded, then `helm uninstall <canary> --ignore-not-found`.
    - The canary install was under way: the stable release was never
      touched, so only the canary release is uninstalled.
    - Stage failed before the canary install: nothing changed; nothing
      runs.
    - Nothing recorded (`rollout.abort` run by hand, a fresh run): the
      rollback goes to {@link HelmCanarySettings.stableRevision}. Without one
      this refuses, since claiming a rollback it cannot do would be worse.
    - A record it does not recognise: refuses.

class HelmCanarySettings
  How `helmCanary` reaches the releases, configured through its lambda.

  chart_?: string
    The chart the candidate is rendered from (set by {@link chart}).
  version_?: string
    The candidate chart's version (set by {@link version}).
  stableChart_?: string
    The chart the stable release runs (set by {@link stableChart}).
  stableVersion_?: string
    The stable chart's version (set by {@link stableVersion}).
  stableRelease_?: string
    The release serving today (set by {@link stableRelease}).
  canaryRelease_?: string
    The release the candidate runs as (set by {@link canaryRelease}).
  namespace_?: string
    The namespace both releases live in (set by {@link namespace}).
  image_?: string
    The candidate's image value (set by {@link image}).
  imageKey_: string
    The values path the image is set on (set by {@link imageKey}).
  replicasKey_: string
    The values path the replica count is set on (set by {@link replicasKey}).
  replicas_?: number
    The total replica count across both releases (set by {@link replicas}).
  values_: string[]
    Values files for the canary release and the promotion (set by {@link values}).
  timeout_?: string
    How long each waiting command may take (set by {@link timeout}).
  stableRevision_?: number
    The revision a hand-run rollback returns to (set by {@link stableRevision}).
  helm_?: Configure<HelmSettings>
    Global helm flags for every command (set by {@link helm}).
  runner_: HelmSettingsRunner
    How each command is run (set by {@link runner}).
  chart(ref: string): this
    The chart the candidate is rendered from — a path, `repo/name` or an
    `oci://` reference. The canary release and the promotion use it; the
    stable release's replica moves use it too unless {@link stableChart}
    names the chart the stable release runs. Pin a repository chart with
    {@link version}: a chart that is not a local path (one starting with
    `.` or `/`, or a Windows drive path) is refused without one. A local
    chart is recorded by its path, not its content, so leave it unchanged
    until the rollout finishes.
  version(value: string): this
    The candidate chart's version (`--version`).
  stableChart(ref: string): this
    The chart the stable release runs today, for the replica moves on it
    while the canary runs. Without it they render {@link chart}, so a
    candidate that changes the chart changes every stable pod's templates at
    the first step. A chart that is not a local path (one starting with `.`
    or `/`, or a Windows drive path) must be pinned with {@link stableVersion}, or each move would
    render whatever the repository serves as latest.
  stableVersion(value: string): this
    The stable chart's version (`--version` on the stable release's replica
    moves). Defaults to {@link version} when {@link stableChart} is not set,
    and is required when it names a repository or `oci://` chart.
  stableRelease(name: string): this
    The release serving today. It must already exist; the canary amends it.
  canaryRelease(name: string): this
    The release the candidate runs as (default `<stable>-canary`).
  namespace(name: string): this
    The namespace both releases live in (`--namespace`).
  image(value: string): this
    The candidate's image, as the chart reads it at {@link imageKey}. With
    the default key, `image.tag`, that is the tag alone (`1.4.2`, or
    `1.4.2@sha256:…`), as the chart `helm create` scaffolds expects; point
    {@link imageKey} at a key that takes a full reference to pass one. Set
    with `--set-string`, so a tag like `1.10` is not turned into a number.
  imageKey(path: string): this
    The values path the image is set on (default `image.tag`).
  replicasKey(path: string): this
    The values path the replica count is set on (default `replicaCount`, as
    `helm create` scaffolds). The chart must honour it — an enabled
    autoscaler that ignores it makes the exposure meaningless.
  replicas(total: number): this
    The total replica count, split between the two releases while the
    canary runs and given to the stable release by the promotion.
  values(...files: PathLike[]): this
    Values files (`--values`) the canary release is installed with, and that
    the promotion merges into the stable release's values. The canary
    release inherits nothing from the stable one, so these must carry its
    whole configuration.
  timeout(duration: string): this
    How long each command that waits may take, e.g. `10m` (`--timeout`).
  stableRevision(revision: number): this
    The stable release's revision to roll back to when `rollout.abort` is run
    by hand — the one `helm history <stable>` lists from before the rollout.
    Such a run is fresh, with no record of a rollout, so it has nothing else
    to go on. A rollback the engine runs mid-rollout does not use it: that one
    returns to the revision `stage` recorded.
  helm(configure: Configure<HelmSettings>): this
    Global flags for every helm command the platform runs —
    `(s) => s.kubeContext("prod").kubeconfig("~/.kube/prod")`, or a
    `.toolPath(...)` to a specific helm. The kube context and kubeconfig must
    not change mid-rollout: the rollout records its release names and
    namespace and refuses a change to those, but cannot record or check
    these.
  runner(run: HelmSettingsRunner): this
    Replace how each prepared command is run. The default runs it; this is
    for a test, or for a build that executes helm through something else.

class HelmDependencyUpdateSettings extends HelmSettings
  Settings for `helm dependency update`.

  chart(path: PathLike): this
    The chart path whose dependencies to update (required).
  override protected buildArgs(): string[]
    Assemble the `helm dependency update` argv.

class HelmGetAllSettings extends HelmSettings
  Settings for `helm get all` (everything recorded about a release).

  release(name: string): this
    The release to read (required).
  revision(number: number): this
    Read a specific revision instead of the latest (`--revision`). A whole
    number from 1 up.
  template(value: string): this
    Format the output with a Go template over `.Release` (`--template`) —
    e.g. `{{.Release.Version}}` prints just the current revision.
  override protected buildArgs(): string[]
    Assemble the `helm get all` argv.

class HelmInstallSettings extends HelmValuesSettings
  Settings for `helm install`.

  release(name: string): this
    The release name (required).
  chart(ref: string): this
    The chart reference or path (required).
  createNamespace(): this
    Create the release namespace if absent (`--create-namespace`).
  wait(): this
    Wait until resources are ready (`--wait`).
  atomic(): this
    Roll back on failure (`--atomic`).
  timeout(duration: string): this
    Operation timeout, e.g. `5m` (`--timeout`).
  dryRun(): this
    Simulate the install (`--dry-run`).
  override protected buildArgs(): string[]
    Assemble the `helm install` argv.

class HelmLintSettings extends HelmSettings
  Settings for `helm lint`.

  chart(path: PathLike): this
    The chart path to lint (required).
  values(path: PathLike): this
    Add a values file (`--values`); repeatable.
  strict(): this
    Treat warnings as errors (`--strict`).
  override protected buildArgs(): string[]
    Assemble the `helm lint` argv.

class HelmPackageSettings extends HelmSettings
  Settings for `helm package`.

  chart(path: PathLike): this
    The chart path to package (required).
  destination(path: PathLike): this
    Output directory for the packaged chart (`--destination`).
  version(value: string): this
    Set the chart version (`--version`).
  appVersion(value: string): this
    Set the chart appVersion (`--app-version`).
  override protected buildArgs(): string[]
    Assemble the `helm package` argv.

class HelmRepoAddSettings extends HelmSettings
  Settings for `helm repo add`.

  name(value: string): this
    The repository name (required).
  url(value: string): this
    The repository URL (required).
  override protected buildArgs(): string[]
    Assemble the `helm repo add` argv.

class HelmRollbackSettings extends HelmSettings
  Settings for `helm rollback`.

  release(name: string): this
    The release to roll back (required).
  revision(number: number): this
    The revision to roll back to. Without one, helm rolls back to the
    previous revision. A whole number from 1 up.
  wait(): this
    Wait until resources are ready (`--wait`).
  timeout(duration: string): this
    Operation timeout, e.g. `5m` (`--timeout`).
  historyMax(count: number): this
    Keep at most `count` revisions of the release; `0` keeps them all
    (`--history-max`). A whole number from 0 up.
  override protected buildArgs(): string[]
    Assemble the `helm rollback` argv.

abstract class HelmSettings extends ToolSettings
  Base for all `helm` subcommand settings: the binary is `helm`, and the
  cluster-targeting flags (`--namespace`, `--kube-context`, `--kubeconfig`) are
  shared by every subcommand.

  override protected defaultTool(): string
    The tool binary: `helm`.
  namespace(name: string): this
    Target a namespace (`--namespace`).
  kubeContext(name: string): this
    Use a named kube context (`--kube-context`).
  kubeconfig(path: PathLike): this
    Use an explicit kubeconfig file (`--kubeconfig`).
  protected globalArgs(): string[]
    The cluster-targeting flags shared by every subcommand.

class HelmTemplateSettings extends HelmValuesSettings
  Settings for `helm template` (render manifests locally).

  release(name: string): this
    The release name (required).
  chart(ref: string): this
    The chart reference or path (required).
  outputDir(path: PathLike): this
    Write rendered manifests to a directory (`--output-dir`).
  override protected buildArgs(): string[]
    Assemble the `helm template` argv.

class HelmUninstallSettings extends HelmSettings
  Settings for `helm uninstall`.

  release(name: string): this
    The release name to uninstall (required).
  keepHistory(): this
    Retain release history (`--keep-history`).
  ignoreNotFound(): this
    Treat "release not found" as a successful uninstall
    (`--ignore-not-found`, Helm 3.13 and later).
  wait(): this
    Wait until removal completes (`--wait`).
  override protected buildArgs(): string[]
    Assemble the `helm uninstall` argv.

class HelmUpgradeSettings extends HelmValuesSettings
  Settings for `helm upgrade`.

  release(name: string): this
    The release name (required).
  chart(ref: string): this
    The chart reference or path (required).
  install(): this
    Install the release if it does not exist (`--install`).
  reuseValues(): this
    Reuse the last release's values and merge the command line's `--set` and
    `--values` over them (`--reuse-values`).
  resetThenReuseValues(): this
    Reset to the new chart's default values, apply the last release's values
    over them, then the command line's (`--reset-then-reuse-values`, Helm
    3.14 and later). Unlike {@link reuseValues}, a default the new chart
    changed is picked up.
  historyMax(count: number): this
    Keep at most `count` revisions of the release; `0` keeps them all
    (`--history-max`). A whole number from 0 up.
  createNamespace(): this
    Create the release namespace if absent (`--create-namespace`).
  wait(): this
    Wait until resources are ready (`--wait`).
  atomic(): this
    Roll back on failure (`--atomic`).
  timeout(duration: string): this
    Operation timeout, e.g. `5m` (`--timeout`).
  override protected buildArgs(): string[]
    Assemble the `helm upgrade` argv.

abstract class HelmValuesSettings extends HelmSettings
  Base for value-bearing commands (install/upgrade/template).

  values(path: PathLike): this
    Add a values file (`--values`/`-f`); repeatable.
  set(name: string, value: string): this
    Override a single value (`--set name=value`); repeatable.
  setString(name: string, value: string): this
    Override a single value as a string (`--set-string name=value`);
    repeatable. Unlike `--set`, helm does not infer a type, so a tag such as
    `1.10` or `2024` stays a string.
  version(value: string): this
    Pin the chart version (`--version`).
  protected valueArgs(): string[]
    The shared value/version arguments.

interface HelmCanaryContext
  The part of the canary engine's context the Helm platform uses: the
  rollout's durable state, where the stable release's revision and the staged
  candidate are recorded, and the build summary. The engine hands a richer
  context; this is the narrow view.

  readonly state: TargetStateHandle
    The rollout's durable platform state, shared by every call.
  reportSummary(pairs: SummaryPairs): void
    Add key/value pairs to the calling target's row in the build summary.

interface HelmTasksApi
  The shape of {@link HelmTasks}.

  install(configure?: Configure<HelmInstallSettings>): Promise<CommandOutput>
    Install a chart: `helm install`.
  upgrade(configure?: Configure<HelmUpgradeSettings>): Promise<CommandOutput>
    Upgrade (or install) a release: `helm upgrade`.
  uninstall(configure?: Configure<HelmUninstallSettings>): Promise<CommandOutput>
    Uninstall a release: `helm uninstall`.
  rollback(configure?: Configure<HelmRollbackSettings>): Promise<CommandOutput>
    Roll a release back to an earlier revision: `helm rollback`.
  getAll(configure?: Configure<HelmGetAllSettings>): Promise<CommandOutput>
    Read everything recorded about a release: `helm get all`.
  template(configure?: Configure<HelmTemplateSettings>): Promise<CommandOutput>
    Render manifests locally: `helm template`.
  lint(configure?: Configure<HelmLintSettings>): Promise<CommandOutput>
    Lint a chart: `helm lint`.
  dependencyUpdate(configure?: Configure<HelmDependencyUpdateSettings>): Promise<CommandOutput>
    Update chart dependencies: `helm dependency update`.
  repoAdd(configure?: Configure<HelmRepoAddSettings>): Promise<CommandOutput>
    Add a chart repository: `helm repo add`.
  package(configure?: Configure<HelmPackageSettings>): Promise<CommandOutput>
    Package a chart: `helm package`.

type HelmSettingsRunner = (settings: HelmSettings) => Promise<CommandOutput>
  Runs one prepared `helm` command and returns its output. The default runs
  it; a test or a build that executes helm some other way injects its own
  with {@link HelmCanarySettings.runner}.
````

</details>

<!-- ZUKE:API:END -->
