# @zuke/biome

Typed [Biome](https://biomejs.dev) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `check`, `format`,
`lint`, and `ci`.

```ts
import { BiomeTasks } from "jsr:@zuke/biome";

await BiomeTasks.ci((s) => s.paths("src")); // read-only, CI-tuned
await BiomeTasks.check((s) => s.write().paths("src")); // apply safe fixes
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/biome` — typed `BiomeTasks` wrappers for the Biome (https://biomejs.dev)
CLI (lint + format + import organizing in one tool), for use in Zuke builds.

```ts
import { BiomeTasks } from "jsr:@zuke/biome";

await BiomeTasks.ci((s) => s.paths("src"));
await BiomeTasks.check((s) => s.write().paths("src"));
```
@module

const BiomeTasks: BiomeTasksApi
  Typed task functions for the `biome` CLI.

class BiomeCheckSettings extends BiomeSettings
  Settings for `biome check` (lint + format + organize-imports).

  write(): this
    Write safe fixes back to disk (`--write`).
  unsafe(): this
    Also apply unsafe fixes; implies writing (`--unsafe`).
  override protected buildArgs(): string[]

class BiomeCiSettings extends BiomeSettings
  Settings for `biome ci` (read-only check tuned for CI).

  override protected buildArgs(): string[]

class BiomeFormatSettings extends BiomeSettings
  Settings for `biome format`.

  write(): this
    Write formatting changes back to disk (`--write`).
  override protected buildArgs(): string[]

class BiomeLintSettings extends BiomeSettings
  Settings for `biome lint`.

  write(): this
    Write safe lint fixes back to disk (`--write`).
  unsafe(): this
    Also apply unsafe fixes; implies writing (`--unsafe`).
  override protected buildArgs(): string[]

interface BiomeTasksApi
  The shape of {@link BiomeTasks}.

  check(configure?: Configure<BiomeCheckSettings>): Promise<CommandOutput>
    Lint, format, and organize imports: `biome check`.
  format(configure?: Configure<BiomeFormatSettings>): Promise<CommandOutput>
    Format code: `biome format`.
  lint(configure?: Configure<BiomeLintSettings>): Promise<CommandOutput>
    Lint code: `biome lint`.
  ci(configure?: Configure<BiomeCiSettings>): Promise<CommandOutput>
    Read-only CI check: `biome ci`.
````

</details>

<!-- ZUKE:API:END -->
