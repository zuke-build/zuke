# @zuke/deno

Typed `deno` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `fmt`, `lint`,
`check`, `test`, `coverage`, `cache`, `run`, and `task` in a fluent
settings-lambda API.

```ts
import { DenoTasks } from "jsr:@zuke/deno";

await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
await DenoTasks.fmt((s) => s.check());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/deno` — typed `DenoTasks` wrappers for the `deno` CLI, for use in
Zuke build targets.

```ts
import { DenoTasks } from "jsr:@zuke/deno";

await DenoTasks.check((s) => s.paths("mod.ts"));
await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
await DenoTasks.fmt((s) => s.check());
```
@module

const DenoTasks: DenoTasksApi
  Typed task functions for the `deno` CLI.

class CoverageThresholdError extends Error
  Raised when measured coverage falls below a configured threshold.

  constructor(readonly failures: string[])
    Construct the error from one message per metric that fell short.
  override name: string
    The error name, `"CoverageThresholdError"`.

class DenoCacheSettings extends DenoSettings
  Settings for `deno cache`.

  reload(): this
    Reload remote modules instead of using the cache (`--reload`).
  paths(...paths: PathLike[]): this
    The entry points to cache (at least one is required).
  override protected buildArgs(): string[]
    Assemble the `deno cache` argv.

class DenoCheckSettings extends DenoSettings
  Settings for `deno check`.

  paths(...paths: PathLike[]): this
    The files to type-check (at least one is required).
  override protected buildArgs(): string[]
    Assemble the `deno check` argv.

class DenoCoverageSettings extends DenoSettings
  Settings for `deno coverage`.

  dir(path: PathLike): this
    The coverage profile directory to report on.
  lcov(): this
    Emit lcov instead of the table report (`--lcov`).
  output(path: PathLike): this
    Write the report to a file (`--output=`).
  exclude(pattern: string): this
    Exclude files matching the pattern (`--exclude=`).
  linesThreshold(percent: number): this
    Fail the gate if line coverage is below `percent`. `deno coverage` has no
    fail-under flag, so {@link DenoTasks.coverage} enforces this after parsing
    the lcov report (and forces `--lcov` so a report exists to parse).
  branchesThreshold(percent: number): this
    Fail the gate if branch coverage is below `percent` (see {@link linesThreshold}).
  threshold(percent: number): this
    Fail the gate if either line or branch coverage is below `percent`.
  perFileThreshold(percent: number): this
    Fail the gate if any single instrumented file's line coverage is below
    `percent` — a per-file floor, so an under-tested file can't hide inside a
    healthy aggregate (see {@link CoverageThresholds.perFile}, which notes the
    `deno coverage` limit for files no test loads).
  get thresholds(): CoverageThresholds
    The configured thresholds; read by {@link DenoTasks.coverage}.
  get outputPath(): string | undefined
    The `--output` file path, if {@link output} was set; read by the task.
  override protected buildArgs(): string[]
    Assemble the `deno coverage` argv.

class DenoDocSettings extends DenoSettings
  Settings for `deno doc`.

  paths(...paths: PathLike[]): this
    The source files (entry points) to document.
  json(): this
    Output the documentation as JSON (`--json`).
  html(): this
    Generate static HTML documentation (`--html`).
  name(title: string): this
    Title for the generated HTML documentation (`--name`).
  output(dir: PathLike): this
    Output directory for HTML documentation (`--output`).
  private(): this
    Include private and internal symbols (`--private`).
  filter(symbol: string): this
    Document only the symbol at this dot-separated path (`--filter`).
  lint(): this
    Report documentation diagnostics rather than rendering docs (`--lint`).
  override protected buildArgs(): string[]
    Assemble the `deno doc` argv.

class DenoFmtSettings extends DenoSettings
  Settings for `deno fmt`.

  check(): this
    Verify formatting without writing changes (`--check`).
  paths(...paths: PathLike[]): this
    Restrict formatting to specific files or directories.
  override protected buildArgs(): string[]
    Assemble the `deno fmt` argv.

class DenoInstallSettings extends DenoPermissionSettings
  Settings for `deno install`.

  global(): this
    Install a global executable (`--global`/`-g`) instead of project deps.
  force(): this
    Overwrite an existing installation (`--force`/`-f`).
  root(path: PathLike): this
    Install root; the binary lands in `<root>/bin` (`--root`).
  name(value: string): this
    Name the installed executable (`--name`/`-n`).
  module(spec: string): this
    The module to install, e.g. `npm:cspell@9` (required for a global install).
  moduleArgs(...args: Array<string | number>): this
    Arguments baked into the generated launcher (after the module).
  override protected buildArgs(): string[]
    Assemble the `deno install` argv.

class DenoLintSettings extends DenoSettings
  Settings for `deno lint`.

  fix(): this
    Apply automatic fixes (`--fix`).
  paths(...paths: PathLike[]): this
    Restrict linting to specific files or directories.
  override protected buildArgs(): string[]
    Assemble the `deno lint` argv.

abstract class DenoPermissionSettings extends DenoSettings
  Base for subcommands that accept `--allow-*` permission flags.

  allowAll(): this
    Grant all permissions (`--allow-all`).
  allow(permission: DenoPermission, ...values: string[]): this
    Grant one permission, optionally scoped to values (`--allow-read=a,b`).
  protected get permissionArgs(): string[]
    The accumulated permission flags, in declaration order.

class DenoPublishSettings extends DenoSettings
  Settings for `deno publish`.

  allowDirty(): this
    Publish even with an uncommitted working tree (`--allow-dirty`).
  allowSlowTypes(): this
    Permit slow types in the published package (`--allow-slow-types`).
  noCheck(): this
    Skip type-checking before publishing (`--no-check`).
  dryRun(): this
    Validate without publishing (`--dry-run`).
  config(path: PathLike): this
    Use an explicit config file (`--config`).
  token(value: string): this
    Authenticate with a token instead of interactive/OIDC auth (`--token`).
  override protected buildArgs(): string[]
    Assemble the `deno publish` argv.

class DenoRunSettings extends DenoPermissionSettings
  Settings for `deno run`.

  script(path: PathLike): this
    The script to run (required).
  scriptArgs(...args: Array<string | number>): this
    Arguments passed to the script (after the script path).
  config(path: PathLike): this
    Use an explicit config file (`--config`).
  reload(): this
    Reload the module cache (`--reload`).
  override protected buildArgs(): string[]
    Assemble the `deno run` argv.

abstract class DenoSettings extends ToolSettings
  Base for all `deno` subcommand settings: binary is the running deno.

  override protected defaultTool(): string
    Default the tool binary to the running `deno` executable.

class DenoTaskSettings extends DenoSettings
  Settings for `deno task`.

  name(value: string): this
    The task name from deno.json (required).
  taskArgs(...args: Array<string | number>): this
    Arguments forwarded to the task.
  override protected buildArgs(): string[]
    Assemble the `deno task` argv.

class DenoTestSettings extends DenoPermissionSettings
  Settings for `deno test`.

  paths(...paths: PathLike[]): this
    Restrict the run to specific test files or directories.
  coverage(dir: PathLike): this
    Collect coverage into the given profile directory (`--coverage=`).
  filter(pattern: string): this
    Only run tests whose name matches (`--filter`).
  parallel(): this
    Run test files in parallel (`--parallel`).
  failFast(): this
    Stop on the first failure (`--fail-fast`).
  override protected buildArgs(): string[]
    Assemble the `deno test` argv.

interface CoverageThresholds
  Line and branch percentage floors; an omitted metric is not enforced.

  lines?: number
    Minimum line-coverage percentage (0–100).
  branches?: number
    Minimum branch-coverage percentage (0–100).
  perFile?: number
    Minimum per-file line-coverage percentage (0–100). Unlike {@link lines}
    (an aggregate over the whole report), this fails the gate when any single
    instrumented file falls below the floor — so an under-tested file can't
    hide inside a healthy repo-wide average. Files with no measurable lines are
    skipped. Note the coverage tool's limit: `deno coverage` only reports files
    that were loaded, so a source file no test imports at all is invisible to
    this check (as it is to every coverage metric).

interface DenoTasksApi
  The shape of {@link DenoTasks}.

  run(configure?: Configure<DenoRunSettings>): Promise<CommandOutput>
    Run a script: `deno run`.
  test(configure?: Configure<DenoTestSettings>): Promise<CommandOutput>
    Run tests: `deno test`.
  check(configure?: Configure<DenoCheckSettings>): Promise<CommandOutput>
    Type-check files: `deno check`.
  fmt(configure?: Configure<DenoFmtSettings>): Promise<CommandOutput>
    Format files: `deno fmt`.
  lint(configure?: Configure<DenoLintSettings>): Promise<CommandOutput>
    Lint files: `deno lint`.
  doc(configure?: Configure<DenoDocSettings>): Promise<CommandOutput>
    Generate documentation: `deno doc`.
  cache(configure?: Configure<DenoCacheSettings>): Promise<CommandOutput>
    Warm the module cache: `deno cache`.
  coverage(configure?: Configure<DenoCoverageSettings>): Promise<CommandOutput>
    Report coverage: `deno coverage`.
  install(configure?: Configure<DenoInstallSettings>): Promise<CommandOutput>
    Install a script or executable: `deno install`.
  publish(configure?: Configure<DenoPublishSettings>): Promise<CommandOutput>
    Publish a package to JSR: `deno publish`.
  task(configure?: Configure<DenoTaskSettings>): Promise<CommandOutput>
    Run a deno.json task: `deno task`.

type DenoPermission = "read" | "write" | "net" | "env" | "run" | "sys" | "ffi" | "import"
  A Deno permission domain, as used by `--allow-*` flags.
````

</details>

<!-- ZUKE:API:END -->
