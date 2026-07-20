# @zuke/dpdm

Typed [dpdm](https://github.com/acrazing/dpdm) CLI task wrapper for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — analyze a project's
module dependency graph and report circular imports.

```ts
import { DpdmTasks } from "jsr:@zuke/dpdm";

// Fail the build on any circular dependency among the entry files.
await DpdmTasks.analyze((s) =>
  s.noTree().noWarning().exitCode("circular:1").entries("src/index.ts")
);
```

Entry files are passed via `.entries(...)` and appended after every option, and
arguments stay a discrete argv array — so command construction is
injection-free.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/dpdm` — a typed `DpdmTasks` wrapper for the
dpdm (https://github.com/acrazing/dpdm) CLI (module dependency graph and
circular-import analysis), for use in Zuke builds.

```ts
import { DpdmTasks } from "jsr:@zuke/dpdm";

await DpdmTasks.analyze((s) =>
  s.noTree().noWarning().exitCode("circular:1").entries("src/index.ts")
);
```
@module

const DpdmTasks: DpdmTasksApi
  Typed task functions for the `dpdm` CLI.

class DpdmAnalyzeSettings extends ToolSettings
  Settings for a `dpdm` analysis run.

  override protected defaultTool(): string
    The command this settings object runs (`dpdm`).
  transform(): this
    Transform TypeScript modules to JavaScript before analysis (`--transform`).
  noTree(): this
    Suppress the dependency tree output (`--no-tree`).
  noCircular(): this
    Suppress the circular-dependency output (`--no-circular`).
  noWarning(): this
    Suppress warnings about unresolved/missing modules (`--no-warning`).
  noProgress(): this
    Disable the progress bar (`--no-progress`).
  output(path: PathLike): this
    Write the analysis as JSON to a file (`--output`).
  tsconfig(path: PathLike): this
    Use an explicit tsconfig for module resolution (`--tsconfig`).
  context(path: PathLike): this
    Set the context directory used to shorten printed paths (`--context`).
  extensions(...exts: string[]): this
    Extensions to resolve, e.g. `.ts`, `.tsx` (`--extensions`).
  js(...exts: string[]): this
    Extensions treated as JavaScript-like (`--js`).
  include(pattern: string): this
    Only analyze files matching this regular expression (`--include`).
  exclude(pattern: string): this
    Skip files matching this regular expression (`--exclude`).
  skipDynamicImports(mode: "circular" | "tree"): this
    Skip dynamic imports when detecting `circular` or `tree` (`--skip-dynamic-imports`).
  detectUnusedFilesFrom(glob: string): this
    Detect unused files starting from this glob (`--detect-unused-files-from`).
  exitCode(rule: string): this
    Exit with a code when a case occurs, e.g. `circular:1` (`--exit-code`).
  entries(...paths: PathLike[]): this
    The entry files or globs to analyze (appended after all options).
  override protected buildArgs(): string[]
    Assemble the `dpdm <flags> <entries...>` argv.

interface DpdmTasksApi
  The shape of {@link DpdmTasks}.

  analyze(configure?: Configure<DpdmAnalyzeSettings>): Promise<CommandOutput>
    Analyze dependencies and circular imports: `dpdm <flags> <entries...>`.
````

</details>

<!-- ZUKE:API:END -->
