# @zuke/deno

Typed `deno` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — the whole
non-interactive CLI in a fluent settings-lambda API: `run`, `serve`, `task` and
`eval`; `test`, `bench`, `coverage`, `check`, `fmt`, `lint` and `doc`; `add`,
`remove`, `install`, `uninstall`, `outdated`, `why`, `ci`, `approve-scripts`,
`publish`, `pack` and `bump-version`; and `compile`, `cache`, `clean`, `info`,
`init` and `upgrade`.

```ts
import { DenoTasks } from "jsr:@zuke/deno";

await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
await DenoTasks.fmt((s) => s.check());
await DenoTasks.compile((s) =>
  s.allowAll().script("mod.ts").output("dist/app").target(
    "x86_64-unknown-linux-gnu",
  )
);
```

## Readers

Two tasks return a value instead of an exit code, parsed from
`deno info --json`: `moduleGraph` hands back the graph rooted at an entrypoint,
so a build can assert on what it actually pulls in, and `cacheInfo` reports the
toolchain's cache directories. `deno info` reports one or the other depending on
whether it was given a module, so each reader refuses the other's shape rather
than returning a confidently empty result.

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

function parseCacheInfo(stdout: string): DenoCacheInfo
  Parse the cache report from `deno info --json` stdout.

function parseModuleGraph(stdout: string): DenoModuleGraph
  Parse the module graph from `deno info --json <file>` stdout.

  Entries without a specifier are skipped rather than guessed at: a module
  deno could not name is not a module a build can act on.

const DenoTasks: DenoTasksApi
  Typed task functions for the `deno` CLI.

class CoverageThresholdError extends Error
  Raised when measured coverage falls below a configured threshold.

  constructor(readonly failures: string[])
    Construct the error from one message per metric that fell short.
  override name: string
    The error name, `"CoverageThresholdError"`.

class DenoAddSettings extends DenoLockSettings
  Settings for `deno add`.

  packages(...specs: string[]): this
    The packages to add, e.g. `jsr:@std/assert` or `npm:express` (required).
  dev(): this
    Add as a dev dependency (`--dev`). Deno only distinguishes the two in a
    `package.json`; against a `deno.json` the flag has nothing to record.
  jsr(): this
    Read unprefixed package names as JSR packages (`--jsr`).
  npm(): this
    Read unprefixed package names as npm packages (`--npm`), deno's default.
  saveExact(): this
    Record the exact version, without a caret range (`--save-exact`).
  lockfileOnly(): this
    Update the lockfile without installing (`--lockfile-only`).
  packageJson(): this
    Record the dependency in `package.json` rather than `deno.json` (`--package-json`).
  override protected buildArgs(): string[]
    Assemble the `deno add` argv.

class DenoApproveScriptsSettings extends DenoSettings
  Settings for `deno approve-scripts`.

  packages(...specs: string[]): this
    The npm specifiers whose lifecycle scripts to approve (required).
  lockfileOnly(): this
    Record the approval in the lockfile without installing (`--lockfile-only`).
  override protected buildArgs(): string[]
    Assemble the `deno approve-scripts` argv.

class DenoBenchSettings extends DenoPermissionSettings
  Settings for `deno bench`.

  paths(...paths: PathLike[]): this
    Restrict the run to specific benchmark files or directories.
  filter(pattern: string): this
    Only run benchmarks whose name matches (`--filter`).
  json(): this
    Report results as JSON (`--json`) rather than the table. Deno marks the
    flag unstable, so treat the shape as subject to change between releases.
  noRun(): this
    Cache the benchmark modules without running them (`--no-run`) — a cheap
    way to prove the benchmarks still compile without paying to run them.
  permitNoFiles(): this
    Succeed when no benchmark files matched (`--permit-no-files`) instead of
    failing the target.
  ignore(...patterns: string[]): this
    Skip files matching these patterns (`--ignore`).
  config(path: PathLike): this
    Use an explicit config file (`--config`).
  override protected buildArgs(): string[]
    Assemble the `deno bench` argv.

class DenoBumpVersionSettings extends DenoSettings
  Settings for `deno bump-version`.

  The subcommand is experimental — deno itself prints a notice saying so on
  every run — so treat its output as subject to change between releases.

  increment(kind: DenoVersionIncrement): this
    The increment to apply. Omit it to derive the increment from the
    conventional commits since {@link start}.
  dryRun(): this
    Print the planned changes without writing any files (`--dry-run`).
  workspace(): this
    Bump every package in the workspace (`--workspace`).
  noWorkspace(): this
    Bump only the manifest in the current directory (`--no-workspace`).
  config(path: PathLike): this
    The manifest to bump (`--config`).
  importMap(path: PathLike): this
    The import map whose `jsr:` constraints to rewrite (`--import-map`).
  base(ref: string): this
    Git ref to compare against in conventional-commits mode (`--base`).
  start(ref: string): this
    Git ref to start from in conventional-commits mode (`--start`).
  releaseNotes(path: PathLike): this
    Release notes file to prepend to in conventional-commits mode (`--release-notes`).
  override protected buildArgs(): string[]
    Assemble the `deno bump-version` argv.

class DenoCacheSettings extends DenoSettings
  Settings for `deno cache`.

  reload(): this
    Reload remote modules instead of using the cache (`--reload`).
  frozen(): this
    Error out if the lockfile is out of date (`--frozen`). See
    {@link DenoPermissionSettings.frozen} for why the name mirrors the real
    Deno flag rather than `PnpmSettings.frozenLockfile()`'s naming.
  paths(...paths: PathLike[]): this
    The entry points to cache (at least one is required).
  override protected buildArgs(): string[]
    Assemble the `deno cache` argv.

class DenoCheckSettings extends DenoSettings
  Settings for `deno check`.

  paths(...paths: PathLike[]): this
    The files to type-check (at least one is required).
  config(path: PathLike): this
    Type-check against a specific configuration file (`--config`) instead of the
    one Deno would discover by walking up from the checked files.

    The discovered config decides how bare specifiers resolve, so pointing at
    another one type-checks the same sources against a different dependency
    set — for example checking a workspace member against the published
    version of a sibling it declares, rather than the local member that
    workspace resolution would substitute.
  noLock(): this
    Ignore the lockfile entirely (`--no-lock`), neither reading nor writing it.

    Use it for a check whose resolutions are deliberately not the project's:
    writing them into the committed lock would corrupt it, and reading it would
    pin the very versions the check is trying to vary.
  frozen(): this
    Error out if the lockfile is out of date (`--frozen`). See
    {@link DenoPermissionSettings.frozen} for why the name mirrors the real
    Deno flag rather than `PnpmSettings.frozenLockfile()`'s naming.
  override protected buildArgs(): string[]
    Assemble the `deno check` argv.

class DenoCiSettings extends DenoSettings
  Settings for `deno ci`.

  prod(): this
    Install production dependencies only, excluding dev ones (`--prod`).
  skipTypes(): this
    Exclude `@types/*` packages (`--skip-types`). Deno selects them by name,
    so a package that ships runtime code under a `@types/` name is skipped
    too.
  envFile(path: PathLike): this
    Load environment variables from a file (`--env-file`).
  override protected buildArgs(): string[]
    Assemble the `deno ci` argv.

class DenoCleanSettings extends DenoSettings
  Settings for `deno clean`.

  dryRun(): this
    Report what would be removed without removing it (`--dry-run`).
  except(...paths: PathLike[]): this
    Keep the cache entries these files need (`--except`), clearing everything
    else. Use it to drop stale dependencies without forcing the next build to
    re-download the ones it still uses.
  override protected buildArgs(): string[]
    Assemble the `deno clean` argv.

class DenoCompileSettings extends DenoPermissionSettings
  Settings for `deno compile`.

  script(path: PathLike): this
    The entrypoint to compile (required).
  scriptArgs(...args: Array<string | number>): this
    Arguments baked into the executable, passed after the entrypoint.
  output(path: PathLike): this
    Output file (`--output`); defaults to a name inferred from the entrypoint.
  target(triple: DenoCompileTarget): this
    Cross-compile for another platform (`--target`).
  include(...paths: PathLike[]): this
    Embed an extra module, file or directory (`--include`, repeatable).

    Needed for anything the module graph cannot see statically — a
    dynamically imported module, a worker entrypoint, or a data file the
    program reads at runtime.
  exclude(...paths: PathLike[]): this
    Exclude a file or directory from what {@link include} embedded (`--exclude`).
  excludeUnusedNpm(): this
    Embed only the npm packages the module graph actually reaches
    (`--exclude-unused-npm`), instead of the whole lockfile snapshot.

    Packages reached only through a dynamic import are not statically
    traceable, so pass those to {@link include} explicitly.
  icon(path: PathLike): this
    Set the executable's Windows icon from a `.ico` file (`--icon`).
  noTerminal(): this
    Hide the console window on Windows (`--no-terminal`).
  selfExtracting(): this
    Produce a self-extracting binary (`--self-extracting`) that unpacks its
    embedded file system to disk on first run and executes from there.
  bundle(): this
    Bundle the entrypoint before embedding it (`--bundle`), rather than
    shipping the whole `node_modules` tree. Experimental: it produces a
    smaller, faster-starting binary but drops dynamic `require`/`import`
    patterns that cannot be traced statically.
  minify(): this
    Minify the bundled output (`--minify`). Requires {@link bundle} — the CLI
    rejects `--minify` on its own, and so does this wrapper, so the mistake
    surfaces while the argv is being built rather than after the compile
    starts.
  config(path: PathLike): this
    Use an explicit config file (`--config`).
  noCheck(): this
    Skip type-checking before compiling (`--no-check`).
  override protected buildArgs(): string[]
    Assemble the `deno compile` argv.

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
  frozen(): this
    Error out if the lockfile is out of date (`--frozen`). See
    {@link DenoPermissionSettings.frozen} for why the name mirrors the real
    Deno flag rather than `PnpmSettings.frozenLockfile()`'s naming.
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

class DenoEvalSettings extends DenoPermissionSettings
  Settings for `deno eval`.

  The code is passed as a single argv entry by the shell layer, never
  interpolated into a command string, so a value built from build parameters
  cannot break out of it.

  code(source: string): this
    The source to evaluate (required).
  print(): this
    Print the expression's result to stdout (`--print`).
  ext(value: DenoSourceExt): this
    Treat the source as this content type (`--ext`), rather than TypeScript.
  config(path: PathLike): this
    Use an explicit config file (`--config`).
  override protected buildArgs(): string[]
    Assemble the `deno eval` argv.

class DenoFmtSettings extends DenoSettings
  Settings for `deno fmt`.

  check(): this
    Verify formatting without writing changes (`--check`).
  paths(...paths: PathLike[]): this
    Restrict formatting to specific files or directories.
  override protected buildArgs(): string[]
    Assemble the `deno fmt` argv.

class DenoInfoSettings extends DenoSettings
  Settings for `deno info`.

  path(file: PathLike): this
    The module to report on. Omit it to report on the caches themselves —
    `deno info` with no file prints the cache directories rather than a module
    graph, which is why {@link DenoTasks.cacheInfo} and
    {@link DenoTasks.moduleGraph} are separate readers.
  json(): this
    Emit the report as JSON (`--json`).
  config(path: PathLike): this
    Use an explicit config file (`--config`).
  importMap(path: PathLike): this
    Load an import map from a file or URL (`--import-map`).
  reload(): this
    Reload the module cache before reporting (`--reload`).
  frozen(): this
    Error out if the lockfile is out of date (`--frozen`). See
    {@link DenoPermissionSettings.frozen} for why the name mirrors the real
    Deno flag.
  noLock(): this
    Ignore the lockfile entirely (`--no-lock`).
  noNpm(): this
    Do not resolve npm modules (`--no-npm`).
  noRemote(): this
    Do not resolve remote modules (`--no-remote`).
  get modulePath(): string | undefined
    The module {@link path} was set to, if any; read by
    {@link DenoTasks.moduleGraph} and {@link DenoTasks.cacheInfo} to tell the
    two reports apart. Reading the flag off the built argv would not do it:
    `--import-map` and `--config` also leave a non-flag token at the end.
  override protected buildArgs(): string[]
    Assemble the `deno info` argv.

class DenoInitSettings extends DenoSettings
  Settings for `deno init`.

  directory(name: string): this
    The directory to create, or the package to scaffold from.
  lib(): this
    Scaffold an example library project (`--lib`).
  serve(): this
    Scaffold an example `deno serve` project (`--serve`).
  empty(): this
    Scaffold a minimal project — just `main.ts` and `deno.json` (`--empty`).
  jsr(): this
    Scaffold from a JSR package (`--jsr`).
  npm(): this
    Scaffold from an npm `create-*` package (`--npm`).
  yes(): this
    Answer the scaffolding prompts affirmatively and grant full permissions
    (`--yes`). Required for an unattended run: without it `deno init` can stop
    on a prompt no build target is there to answer.
  override protected buildArgs(): string[]
    Assemble the `deno init` argv.

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

abstract class DenoLockSettings extends DenoSettings
  Base for the `deno` subcommands that read and write the lockfile.

  The lockfile flags are a section the CLI repeats across every one of them,
  so they live here once rather than being restated per subcommand.

  frozen(): this
    Error out if the lockfile is out of date (`--frozen`). See
    {@link DenoPermissionSettings.frozen} for why the name mirrors the real
    Deno flag.
  noLock(): this
    Ignore the lockfile entirely (`--no-lock`), neither reading nor writing it.
  lock(path: PathLike): this
    Use an explicit lockfile (`--lock`) instead of the discovered `deno.lock`.
  protected get lockArgs(): string[]
    The shared lockfile flags; read by subclasses assembling their argv.

class DenoOutdatedSettings extends DenoLockSettings
  Settings for `deno outdated`.

  filters(...patterns: string[]): this
    Restrict the report to dependencies matching these filters, which may
    include `*` wildcards. Filters match the alias a dependency is declared
    under, not the package it resolves to.
  compatible(): this
    Only consider versions satisfying the declared semver range (`--compatible`).
  latest(): this
    Consider the latest version regardless of the declared range (`--latest`).
  recursive(): this
    Include every workspace member (`--recursive`).
  update(): this
    Write the newer versions back into the manifest (`--update`) instead of
    only reporting them. Without it `deno outdated` reports and changes
    nothing, which is what a freshness gate wants.
  lockfileOnly(): this
    Update the lockfile without installing (`--lockfile-only`).
  override protected buildArgs(): string[]
    Assemble the `deno outdated` argv.

class DenoPackSettings extends DenoSettings
  Settings for `deno pack`.

  files(...patterns: string[]): this
    File patterns to include in the tarball; defaults to the package's own.
  allowDirty(): this
    Pack even with an uncommitted working tree (`--allow-dirty`).
  allowSlowTypes(): this
    Skip fast-check type extraction (`--allow-slow-types`). The tarball then
    ships without `.d.ts` files, so consumers get no types from it.
  dryRun(): this
    Report what would be packed without writing the tarball (`--dry-run`).
  noSourceMaps(): this
    Omit source maps from the tarball (`--no-source-maps`).
  ignore(...patterns: string[]): this
    Exclude files matching these patterns (`--ignore`).
  output(path: PathLike): this
    Write the tarball here (`--output`) instead of `<name>-<version>.tgz`.
  setVersion(version: string): this
    Override the version recorded in the tarball (`--set-version`).
  config(path: PathLike): this
    Use an explicit config file (`--config`).
  override protected buildArgs(): string[]
    Assemble the `deno pack` argv.

abstract class DenoPermissionSettings extends DenoSettings
  Base for subcommands that accept `--allow-*` permission flags.

  allowAll(): this
    Grant all permissions (`--allow-all`).
  allow(permission: DenoPermission, ...values: string[]): this
    Grant one permission, optionally scoped to values (`--allow-read=a,b`).
  frozen(): this
    Error out if the lockfile is out of date instead of silently updating it
    (`--frozen`). Use it whenever the module graph must match the committed
    `deno.lock` exactly — running an `npm:` tool in CI, say, so its transitive
    tree stays pinned to the audited integrity hashes rather than being
    resolved afresh. Named `frozen` — not `frozenLockfile` — to mirror the real
    Deno CLI flag exactly. This is a deliberate divergence from
    `PnpmSettings.frozenLockfile()` in `@zuke/pnpm`, which follows pnpm's own
    flag name instead: guideline 7 (mirror the real CLI) takes priority over
    cross-package naming symmetry.
  protected get permissionArgs(): string[]
    The accumulated permission flags, in declaration order.
  protected get frozenArgs(): string[]
    The `--frozen` flag, if set; read by subclasses assembling their argv.

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

class DenoRemoveSettings extends DenoLockSettings
  Settings for `deno remove`.

  packages(...names: string[]): this
    The packages to remove, by the name they are recorded under (required).
  lockfileOnly(): this
    Update the lockfile without touching `node_modules` (`--lockfile-only`).
  packageJson(): this
    Remove from `package.json` rather than `deno.json` (`--package-json`).
  override protected buildArgs(): string[]
    Assemble the `deno remove` argv.

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

class DenoServeSettings extends DenoPermissionSettings
  Settings for `deno serve`.

  A server runs until it is stopped, so a build target that awaits this task
  blocks forever. Give it a bound with `.killAfter(ms)` — for a smoke test
  that the server starts — or run it from a target the build is not waiting
  on.

  script(path: PathLike): this
    The module exporting the server's default handler (required).
  scriptArgs(...args: Array<string | number>): this
    Arguments passed to the server module (after the module path).
  port(value: number): this
    The TCP port to serve on (`--port`); `0` picks a free one.
  host(value: string): this
    The TCP address to serve on (`--host`), defaulting to all interfaces.
  parallel(): this
    Run one server worker per available CPU (`--parallel`), or as many as
    `DENO_JOBS` allows.
  open(): this
    Open a browser on the served address (`--open`).
  watch(): this
    Restart the server when a watched file changes (`--watch`).
  config(path: PathLike): this
    Use an explicit config file (`--config`).
  override protected buildArgs(): string[]
    Assemble the `deno serve` argv.

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
  frozen(): this
    Error out if the lockfile is out of date (`--frozen`). See
    {@link DenoPermissionSettings.frozen} for why the name mirrors the real
    Deno flag rather than `PnpmSettings.frozenLockfile()`'s naming.
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

class DenoUninstallSettings extends DenoLockSettings
  Settings for `deno uninstall`.

  packages(...names: string[]): this
    The dependency names, or the global executable name, to remove (required).
  global(): this
    Remove a globally installed executable (`--global`) rather than a project dependency.
  root(path: PathLike): this
    The installation root the executable lives under (`--root`).
  lockfileOnly(): this
    Update the lockfile without touching `node_modules` (`--lockfile-only`).
  packageJson(): this
    Remove from `package.json` rather than `deno.json` (`--package-json`).
  override protected buildArgs(): string[]
    Assemble the `deno uninstall` argv.

class DenoUpgradeSettings extends DenoSettings
  Settings for `deno upgrade`.

  version(value: string): this
    The version, channel (`alpha`, `beta`, `rc`, `canary`) or commit hash to
    install. Omit it to move to the latest stable release.
  dryRun(): this
    Run every check without replacing the executable (`--dry-run`).
  force(): this
    Replace the executable even when it is already up to date (`--force`).
  noDelta(): this
    Download the full archive instead of a delta update (`--no-delta`).
  output(path: PathLike): this
    Write the upgraded executable somewhere else (`--output`), leaving the
    running one in place. This is what makes `upgrade` usable from a build:
    a target can fetch a second Deno without replacing the one executing it.
  checksum(sha256: string): this
    Verify the downloaded archive against a SHA-256 checksum (`--checksum`).
  override protected buildArgs(): string[]
    Assemble the `deno upgrade` argv.

class DenoWhySettings extends DenoLockSettings
  Settings for `deno why`.

  packageName(value: string): this
    The package to explain, optionally with a version (`express@4.18.2`)
    (required).
  override protected buildArgs(): string[]
    Assemble the `deno why` argv.

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

interface DenoCacheInfo
  The cache locations `deno info --json` reports when given no module.

  denoVersion?: string
    The version of deno that produced the report.
  denoDir?: string
    The root cache directory, i.e. `DENO_DIR`.
  modulesCache?: string
    Where fetched remote modules are stored.
  npmCache?: string
    Where npm packages are stored.
  typescriptCache?: string
    Where emitted TypeScript is stored.
  registryCache?: string
    Where registry metadata is stored.
  originStorage?: string
    Where origin-bound storage (`localStorage`) is kept.

interface DenoModule
  One module in the graph {@link parseModuleGraph} returns.

  specifier: string
    The module's fully qualified specifier, e.g. `file:///…/mod.ts`.
  kind?: string
    How deno classified the module, e.g. `esm` or `npm`; absent on an error entry.
  local?: string
    The module's path in the local cache, when it has been fetched.
  size?: number
    The module's size in bytes, when known.
  mediaType?: string
    The media type deno resolved, e.g. `TypeScript`.
  error?: string
    Why the module could not be loaded, when it could not be.
  dependencies: DenoModuleDependency[]
    The specifiers this module imports, in source order.

interface DenoModuleDependency
  One import edge out of a {@link DenoModule}.

  specifier: string
    The specifier exactly as written in the source.
  error?: string
    Why the dependency could not be resolved, when it could not be.

interface DenoModuleGraph
  The module graph `deno info --json <file>` reports.

  roots: string[]
    The entry points the graph was built from.
  modules: DenoModule[]
    Every module reachable from {@link roots}, deno's order preserved.
  redirects: Record<string, string>
    Specifier redirects deno followed, from requested to resolved.

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
  serve(configure?: Configure<DenoServeSettings>): Promise<CommandOutput>
    Run a server: `deno serve`.
  eval(configure?: Configure<DenoEvalSettings>): Promise<CommandOutput>
    Evaluate a snippet: `deno eval`.
  bench(configure?: Configure<DenoBenchSettings>): Promise<CommandOutput>
    Run benchmarks: `deno bench`.
  compile(configure?: Configure<DenoCompileSettings>): Promise<CommandOutput>
    Build a self-contained executable: `deno compile`.
  clean(configure?: Configure<DenoCleanSettings>): Promise<CommandOutput>
    Remove the cache directory: `deno clean`.
  info(configure?: Configure<DenoInfoSettings>): Promise<CommandOutput>
    Report on a module or the caches: `deno info`.
  init(configure?: Configure<DenoInitSettings>): Promise<CommandOutput>
    Scaffold a new project: `deno init`.
  upgrade(configure?: Configure<DenoUpgradeSettings>): Promise<CommandOutput>
    Upgrade the deno executable: `deno upgrade`.
  add(configure?: Configure<DenoAddSettings>): Promise<CommandOutput>
    Add dependencies: `deno add`.
  remove(configure?: Configure<DenoRemoveSettings>): Promise<CommandOutput>
    Remove dependencies: `deno remove`.
  uninstall(configure?: Configure<DenoUninstallSettings>): Promise<CommandOutput>
    Uninstall a dependency or global executable: `deno uninstall`.
  outdated(configure?: Configure<DenoOutdatedSettings>): Promise<CommandOutput>
    Report outdated dependencies: `deno outdated`.
  why(configure?: Configure<DenoWhySettings>): Promise<CommandOutput>
    Explain why a package is installed: `deno why`.
  ci(configure?: Configure<DenoCiSettings>): Promise<CommandOutput>
    Install strictly from the lockfile: `deno ci`.
  approveScripts(configure?: Configure<DenoApproveScriptsSettings>): Promise<CommandOutput>
    Approve npm lifecycle scripts: `deno approve-scripts`.
  bumpVersion(configure?: Configure<DenoBumpVersionSettings>): Promise<CommandOutput>
    Bump the version in the manifest: `deno bump-version`.
  pack(configure?: Configure<DenoPackSettings>): Promise<CommandOutput>
    Build an npm-compatible tarball: `deno pack`.
  moduleGraph(configure?: Configure<DenoInfoSettings>): Promise<DenoModuleGraph>
    The module graph rooted at a file, parsed from `deno info --json`.

    A reader, not a gate: it returns the graph rather than printing it, so a
    build can assert on what its entry point actually pulls in.
  cacheInfo(configure?: Configure<DenoInfoSettings>): Promise<DenoCacheInfo>
    The toolchain's cache locations, parsed from `deno info --json`.

type DenoCompileTarget = "x86_64-unknown-linux-gnu" | "aarch64-unknown-linux-gnu" | "x86_64-pc-windows-msvc" | "x86_64-apple-darwin" | "aarch64-apple-darwin"
  A target triple `deno compile` can cross-compile to, as listed by
  `deno compile --help`. Typed as a union so a typo in a release matrix is a
  compile-time error rather than a build that fails minutes into CI.

type DenoPermission = "read" | "write" | "net" | "env" | "run" | "sys" | "ffi" | "import"
  A Deno permission domain, as used by `--allow-*` flags.

type DenoSourceExt = "ts" | "tsx" | "js" | "jsx" | "mts" | "mjs" | "cts" | "cjs"
  A content type `deno eval` and `deno bench` accept for `--ext`.

type DenoVersionIncrement = "major" | "minor" | "patch" | "premajor" | "preminor" | "prepatch" | "prerelease"
  A version increment `deno bump-version` understands.
````

</details>

<!-- ZUKE:API:END -->
