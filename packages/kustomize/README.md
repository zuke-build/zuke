# @zuke/kustomize

Typed [Kustomize](https://kustomize.io) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `build` and
`editSetImage`.

```ts
import { KustomizeTasks } from "jsr:@zuke/kustomize";

await KustomizeTasks.build((s) => s.dir("overlays/prod").output("out.yaml"));
await KustomizeTasks.editSetImage((s) => s.image("api", "api:1.4"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/kustomize` — typed `KustomizeTasks` wrappers for the
Kustomize (https://kustomize.io) CLI, for use in Zuke builds.

```ts
import { KustomizeTasks } from "jsr:@zuke/kustomize";

await KustomizeTasks.build((s) => s.dir("overlays/prod"));
await KustomizeTasks.editSetImage((s) => s.image("api", "api:1.4"));
```
@module

const KustomizeTasks: KustomizeTasksApi
  Typed task functions for the `kustomize` CLI.

class KustomizeBuildSettings extends KustomizeSettings
  Settings for `kustomize build`.

  dir(path: PathLike): this
    The kustomization directory to build (defaults to the current directory).
  output(path: PathLike): this
    Write the rendered output to a file or directory (`--output`).
  enableHelm(): this
    Enable the Helm chart inflator (`--enable-helm`).
  loadRestrictor(mode: string): this
    Set the file-load restrictor, e.g. `LoadRestrictionsNone` (`--load-restrictor`).
  override protected buildArgs(): string[]

class KustomizeEditSetImageSettings extends KustomizeSettings
  Settings for `kustomize edit set image`.

  image(name: string, reference: string): this
    Set an image override, e.g. `("api", "api:1.4")` → `api=api:1.4`; repeatable,
    at least one is required.
  override protected buildArgs(): string[]

interface KustomizeTasksApi
  The shape of {@link KustomizeTasks}.

  build(configure?: Configure<KustomizeBuildSettings>): Promise<CommandOutput>
    Render a kustomization: `kustomize build`.
  editSetImage(configure?: Configure<KustomizeEditSetImageSettings>): Promise<CommandOutput>
    Update image overrides: `kustomize edit set image`.
````

</details>

<!-- ZUKE:API:END -->
