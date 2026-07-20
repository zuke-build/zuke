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
    Assemble the `biome check` argv.

class BiomeCiSettings extends BiomeSettings
  Settings for `biome ci` (read-only check tuned for CI).

  override protected buildArgs(): string[]
    Assemble the `biome ci` argv.

class BiomeFormatSettings extends BiomeSettings
  Settings for `biome format`.

  write(): this
    Write formatting changes back to disk (`--write`).
  override protected buildArgs(): string[]
    Assemble the `biome format` argv.

class BiomeLintSettings extends BiomeSettings
  Settings for `biome lint`.

  write(): this
    Write safe lint fixes back to disk (`--write`).
  unsafe(): this
    Also apply unsafe fixes; implies writing (`--unsafe`).
  override protected buildArgs(): string[]
    Assemble the `biome lint` argv.

abstract class BiomeSettings extends ToolSettings
  Base for all `biome` subcommand settings: the binary is `biome`, and the
  common filters (config path, reporter, `--staged`, `--changed`) plus the
  trailing path arguments are shared by every subcommand.

  override protected defaultTool(): string
    The tool binary: `biome`.
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `node_modules/.bin` by default — biome is an npm-distributed tool.
  paths(...paths: PathLike[]): this
    Files or directories to operate on; omit to use the configured includes.
  config(path: PathLike): this
    Use an explicit configuration file (`--config-path`).
  reporter(name: string): this
    Choose the diagnostics reporter, e.g. `github` or `json` (`--reporter`).
  staged(): this
    Restrict to files staged in git (`--staged`).
  changed(): this
    Restrict to files changed against the VCS base (`--changed`).
  protected flagArgs(): string[]
    The shared flag arguments (before paths).
  protected pathArgs(): string[]
    The trailing path arguments.

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
