# @zuke/helm

Typed [Helm](https://helm.sh) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `install`, `upgrade`,
`uninstall`, `template`, `lint`, `dependencyUpdate`, `repoAdd`, and `package`.

```ts
import { HelmTasks } from "jsr:@zuke/helm";

await HelmTasks.upgrade((s) =>
  s.release("api").chart("./charts/api").install().namespace("prod")
    .set("image.tag", "1.4").wait()
);
```

Every task shares the cluster-targeting flags `.namespace(...)`,
`.kubeContext(...)`, and `.kubeconfig(...)`. Arguments stay a discrete argv
array end-to-end — never a shell string — so command construction is
injection-free.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/helm` — typed `HelmTasks` wrappers for the Helm (https://helm.sh) CLI,
for packaging and deploying to Kubernetes from a Zuke build.

```ts
import { HelmTasks } from "jsr:@zuke/helm";

await HelmTasks.upgrade((s) =>
  s.release("api").chart("./charts/api").install().namespace("prod").wait()
);
```
@module

const HelmTasks: HelmTasksApi
  Typed task functions for the `helm` CLI.

class HelmDependencyUpdateSettings extends HelmSettings
  Settings for `helm dependency update`.

  chart(path: PathLike): this
    The chart path whose dependencies to update (required).
  override protected buildArgs(): string[]

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

class HelmLintSettings extends HelmSettings
  Settings for `helm lint`.

  chart(path: PathLike): this
    The chart path to lint (required).
  values(path: PathLike): this
    Add a values file (`--values`); repeatable.
  strict(): this
    Treat warnings as errors (`--strict`).
  override protected buildArgs(): string[]

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

class HelmRepoAddSettings extends HelmSettings
  Settings for `helm repo add`.

  name(value: string): this
    The repository name (required).
  url(value: string): this
    The repository URL (required).
  override protected buildArgs(): string[]

class HelmTemplateSettings extends HelmValuesSettings
  Settings for `helm template` (render manifests locally).

  release(name: string): this
    The release name (required).
  chart(ref: string): this
    The chart reference or path (required).
  outputDir(path: PathLike): this
    Write rendered manifests to a directory (`--output-dir`).
  override protected buildArgs(): string[]

class HelmUninstallSettings extends HelmSettings
  Settings for `helm uninstall`.

  release(name: string): this
    The release name to uninstall (required).
  keepHistory(): this
    Retain release history (`--keep-history`).
  wait(): this
    Wait until removal completes (`--wait`).
  override protected buildArgs(): string[]

class HelmUpgradeSettings extends HelmValuesSettings
  Settings for `helm upgrade`.

  release(name: string): this
    The release name (required).
  chart(ref: string): this
    The chart reference or path (required).
  install(): this
    Install the release if it does not exist (`--install`).
  createNamespace(): this
    Create the release namespace if absent (`--create-namespace`).
  wait(): this
    Wait until resources are ready (`--wait`).
  atomic(): this
    Roll back on failure (`--atomic`).
  timeout(duration: string): this
    Operation timeout, e.g. `5m` (`--timeout`).
  override protected buildArgs(): string[]

interface HelmTasksApi
  The shape of {@link HelmTasks}.

  install(configure?: Configure<HelmInstallSettings>): Promise<CommandOutput>
    Install a chart: `helm install`.
  upgrade(configure?: Configure<HelmUpgradeSettings>): Promise<CommandOutput>
    Upgrade (or install) a release: `helm upgrade`.
  uninstall(configure?: Configure<HelmUninstallSettings>): Promise<CommandOutput>
    Uninstall a release: `helm uninstall`.
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
````

</details>

<!-- ZUKE:API:END -->
