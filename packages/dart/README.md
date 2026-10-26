# @zuke/dart

Typed [Dart](https://dart.dev) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `analyze`, `format`,
`fix`, `test`, `run`, `compile*` for every target, `doc`, `create`, `pub*`,
`info` and `version`.

```ts
import { Build, run, target } from "@zuke/core";
import { DartTasks } from "@zuke/dart";

class Cli extends Build {
  deps = target().executes(async () => {
    await DartTasks.pubGet((s) => s.enforceLockfile());
  });
  check = target().dependsOn(this.deps).executes(async () => {
    await DartTasks.format((s) => s.setExitIfChanged().output("none"));
    await DartTasks.analyze((s) => s.fatalInfos());
    await DartTasks.test((s) => s.coverage("coverage").reporter("github"));
  });
  binary = target().dependsOn(this.check).executes(async () => {
    await DartTasks.compileExe((s) =>
      s.entry("bin/main.dart").output("build/cli").define("ENV", "prod")
    );
  });
}

await run(Cli);
```

`dart` is resolved from `PATH`. A path operand that starts with `-` is passed as
`./-…` so it can never be read as a flag, and a package name that would be is
refused. For `run`, anything passed through `.args()` lands after the entry
point and reaches the program.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/dart` — typed `DartTasks` wrappers for the Dart (https://dart.dev)
CLI, for use in Zuke builds: analyze, format, fix and test Dart code,
compile it to every target, generate docs, scaffold and run programs, and
manage pub dependencies.

```ts
import { DartTasks } from "@zuke/dart";

await DartTasks.pubGet((s) => s.enforceLockfile());
await DartTasks.analyze((s) => s.fatalInfos());
await DartTasks.format((s) => s.setExitIfChanged().output("none"));
await DartTasks.test((s) => s.coverage("coverage").reporter("github"));
await DartTasks.compileExe((s) =>
  s.entry("bin/main.dart").output("build/app")
);
```
@module

const DartTasks: DartTasksApi
  Typed task functions for the `dart` CLI.

class DartAnalyzeSettings extends DartSettings
  Settings for `dart analyze`.

  path(path: PathLike): this
    A file or directory to analyze (defaults to the current one); repeatable.
  fatalInfos(): this
    Treat info-level issues as fatal (`--fatal-infos`).
  noFatalWarnings(): this
    Do not fail on warnings (`--no-fatal-warnings`).
  format(name: "default" | "json" | "machine"): this
    The output format: `default`, `json` or `machine` (`--format`).
  packages(path: PathLike): this
    The package resolution file to use (`--packages`).
  override protected buildArgs(): string[]
    Assemble the `dart analyze` argv.

class DartCompileSettings extends DartVmSettings
  Settings for `dart compile <target>`.

  constructor(target: DartCompileTarget)
    Settings for `dart compile <target>`.
  override enableAsserts(): this
    Enable assert statements (`--enable-asserts`); not for `kernel`.
  override verbosity(level: "error" | "warning" | "info" | "all"): this
    How much to print (`--verbosity`); not for `wasm`.
  entry(path: PathLike): this
    The Dart entry point to compile; required.
  output(path: PathLike): this
    Where to write the compiled artifact (`--output`).
  targetOs(os: DartTargetOs): this
    Cross-compile for another OS (`--target-os`); `exe` and `aot-snapshot` only.
  saveDebuggingInfo(path: PathLike): this
    Strip debugging information into a separate file (`--save-debugging-info`); `exe` and `aot-snapshot` only.
  depfile(path: PathLike): this
    Write a Makefile-style dependency file (`--depfile`); not for `js`.
  optimize(level: number): this
    The optimization level, `0` to `4` (`-O<level>`); `js` and `wasm` only.
  override protected buildArgs(): string[]
    Assemble the `dart compile <target>` argv.

class DartCreateSettings extends DartSettings
  Settings for `dart create`.

  dir(path: PathLike): this
    The directory to create the project in; required.
  template(name: DartCreateTemplate): this
    The project template, instead of `console` (`--template`).
  noPub(): this
    Skip the implicit `dart pub get` (`--no-pub`).
  force(): this
    Create into a directory that already exists (`--force`).
  override protected buildArgs(): string[]
    Assemble the `dart create` argv.

class DartDocSettings extends DartSettings
  Settings for `dart doc`.

  dir(path: PathLike): this
    The package directory to document (defaults to the current one).
  output(path: PathLike): this
    Where to write the generated docs, instead of `doc/api` (`--output`).
  validateLinks(): this
    Check the generated docs for broken links (`--validate-links`).
  dryRun(): this
    Report what would be documented without writing files (`--dry-run`).
  override protected buildArgs(): string[]
    Assemble the `dart doc` argv.

class DartFixSettings extends DartSettings
  Settings for `dart fix`.

  dir(path: PathLike): this
    The directory to fix (defaults to the current one).
  apply(): this
    Apply the proposed fixes (`--apply`). Without it or `.dryRun()`, `dart fix` only prints usage.
  dryRun(): this
    List the proposed fixes without applying them (`--dry-run`).
  code(code: string): this
    Apply only the fix for one diagnostic code (`--code`); repeatable.
  override protected buildArgs(): string[]
    Assemble the `dart fix` argv.

class DartFormatSettings extends DartSettings
  Settings for `dart format`. With no `.path()` the current directory is
  formatted: `dart format` itself would read stdin instead, and in CI — no
  terminal, empty stdin — a `.setExitIfChanged()` check would pass vacuously.

  path(path: PathLike): this
    A file or directory to format (defaults to `.`); repeatable.
  output(mode: "write" | "show" | "json" | "none"): this
    What to do with formatted code: `write` (default), `show`, `json` or `none` (`--output`).
  setExitIfChanged(): this
    Exit with code 1 when any file would change — the CI check (`--set-exit-if-changed`).
  lineLength(columns: number): this
    Wrap lines longer than this (`--line-length`).
  show(which: "all" | "changed" | "none"): this
    Which files to list: `all`, `changed` (default) or `none` (`--show`).
  summary(kind: "line" | "profile" | "none"): this
    The summary to print: `line` (default), `profile` or `none` (`--summary`).
  followLinks(): this
    Follow symbolic links into directories (`--follow-links`).
  languageVersion(version: string): this
    The language version to parse as, e.g. `3.3` (`--language-version`).
  enableExperiment(name: string): this
    Enable an experimental language feature (`--enable-experiment`); repeatable.
  override protected buildArgs(): string[]
    Assemble the `dart format` argv.

class DartInfoSettings extends DartSettings
  Settings for `dart info`, which prints diagnostic details about the SDK.

  noRemoveFilePaths(): this
    Keep file paths in the output instead of redacting them (`--no-remove-file-paths`).
  override protected buildArgs(): string[]
    Assemble the `dart info` argv.

class DartPubDepsSettings extends DartSettings
  Settings for `dart pub deps`.

  style(name: "compact" | "tree" | "list"): this
    The layout: `compact`, `tree` (default) or `list` (`--style`).
  noDev(): this
    Leave dev dependencies out (`--no-dev`).
  executables(): this
    List the executables the dependencies expose instead (`--executables`).
  json(): this
    Print the dependency graph as JSON (`--json`).
  override protected buildArgs(): string[]
    Assemble the `dart pub deps` argv.

class DartPubDowngradeSettings extends DartSettings
  Settings for `dart pub downgrade`.

  package(name: string): this
    Downgrade only this package (defaults to all); repeatable.
  offline(): this
    Resolve from the local pub cache only (`--offline`).
  dryRun(): this
    Report what would change without changing it (`--dry-run`).
  tighten(): this
    Lower the constraints in `pubspec.yaml` to the resolved versions (`--tighten`).
  override protected buildArgs(): string[]
    Assemble the `dart pub downgrade` argv.

class DartPubGetSettings extends DartSettings
  Settings for `dart pub get`.

  offline(): this
    Resolve from the local pub cache only (`--offline`).
  enforceLockfile(): this
    Fail rather than change `pubspec.lock` (`--enforce-lockfile`).
  dryRun(): this
    Report what would change without changing it (`--dry-run`).
  noPrecompile(): this
    Skip precompiling executables (`--no-precompile`).
  override protected buildArgs(): string[]
    Assemble the `dart pub get` argv.

class DartPubOutdatedSettings extends DartSettings
  Settings for `dart pub outdated`.

  json(): this
    Print machine-readable JSON (`--json`).
  showAll(): this
    Include packages that are already up to date (`--show-all`).
  noDevDependencies(): this
    Leave dev dependencies out (`--no-dev-dependencies`).
  noTransitive(): this
    Leave transitive dependencies out (`--no-transitive`).
  prereleases(): this
    Include prereleases when looking for newer versions (`--prereleases`).
  override protected buildArgs(): string[]
    Assemble the `dart pub outdated` argv.

class DartPubPackagesSettings extends DartSettings
  Settings for `dart pub add` and `dart pub remove`.

  constructor(verb: "add" | "remove")
    Settings for `dart pub <verb>`.
  package(spec: string): this
    A package to add or remove; repeatable, at least one is required. For
    `add` it takes pub's descriptor syntax: `http`, `http:^1.2.0`, or
    `dev:mocktail` for a dev dependency.
  offline(): this
    Resolve from the local pub cache only (`--offline`).
  dryRun(): this
    Report what would change without changing it (`--dry-run`).
  override protected buildArgs(): string[]
    Assemble the `dart pub add|remove` argv.

class DartPubPublishSettings extends DartSettings
  Settings for `dart pub publish`.

  dryRun(): this
    Validate the package without uploading it (`--dry-run`).
  force(): this
    Publish without the confirmation prompt — what CI needs (`--force`).
  skipValidation(): this
    Publish even when validation reports warnings (`--skip-validation`).
  override protected buildArgs(): string[]
    Assemble the `dart pub publish` argv.

class DartPubUpgradeSettings extends DartSettings
  Settings for `dart pub upgrade`.

  package(name: string): this
    Upgrade only this package (defaults to all); repeatable.
  offline(): this
    Resolve from the local pub cache only (`--offline`).
  dryRun(): this
    Report what would change without changing it (`--dry-run`).
  majorVersions(): this
    Also raise constraints in `pubspec.yaml` across majors (`--major-versions`).
  tighten(): this
    Raise lower bounds in `pubspec.yaml` to the resolved versions (`--tighten`).
  unlockTransitive(): this
    Also upgrade the transitive dependencies of the named packages (`--unlock-transitive`).
  override protected buildArgs(): string[]
    Assemble the `dart pub upgrade` argv.

class DartRunSettings extends DartVmSettings
  Settings for `dart run`. The entry point is the last token the settings
  build, so anything passed through `.args()` lands after it and reaches the
  program, not the VM — without an `.entry()`, the first `.args()` token is
  what `dart run` takes as the program, exactly as on the command line.

  entry(fileOrTarget: PathLike): this
    The Dart file to run, or a package executable such as `build_runner` or
    `test:test`. Without one, `dart run` runs the current package's own
    executable.
  observe(bind: string): this
    Start the VM service with the debugging conveniences and pause on start
    (`--observe=<port>[/<bind-address>]`). The value is attached with `=`
    because `dart run` reads the option's value from the next token, which
    would otherwise be the entry point.
  enableVmService(bind: string): this
    Start the VM service without pausing (`--enable-vm-service=<port>[/<bind-address>]`).
  override protected buildArgs(): string[]
    Assemble the `dart run` argv.

abstract class DartSettings extends ToolSettings
  Base for all `dart` settings: the binary is `dart`, found on `PATH`.

  override protected defaultTool(): string
    The binary these settings invoke: `dart`.
  override protected defaultResolution(): ToolResolution
    Resolve from `PATH` — the Dart SDK is installed natively.

class DartTestSettings extends DartSettings
  Settings for `dart test`.

  path(path: PathLike): this
    A test file or directory to run (defaults to `test/`); repeatable.
  name(pattern: string): this
    Run only tests whose name matches a regular expression (`--name`); repeatable.
  plainName(text: string): this
    Run only tests whose name contains a string (`--plain-name`); repeatable.
  tags(expression: string): this
    Run only tests with a tag expression (`--tags`).
  excludeTags(expression: string): this
    Skip tests matching a tag expression (`--exclude-tags`).
  preset(name: string): this
    Apply a preset from `dart_test.yaml` (`--preset`); repeatable.
  runSkipped(): this
    Run skipped tests too (`--run-skipped`).
  failFast(): this
    Stop after the first failure (`--fail-fast`).
  platform(name: string): this
    Run on a platform, e.g. `vm`, `chrome` or `node` (`--platform`); repeatable.
  compiler(name: string): this
    The compiler for a platform, e.g. `dart2js`, `dart2wasm` or `kernel` (`--compiler`); repeatable.
  concurrency(count: number): this
    How many test suites to run at once (`--concurrency`).
  timeout(value: string): this
    The default per-test timeout, e.g. `30s` or `2x` (`--timeout`).
  coverage(dir: PathLike): this
    Collect coverage into a directory of JSON reports (`--coverage`).
  reporter(name: string): this
    The console reporter: `compact`, `expanded`, `failures-only`, `github`, `json` or `silent` (`--reporter`).
  fileReporter(spec: string): this
    Also write a reporter's output to a file, e.g. `json:report.json` (`--file-reporter`).
  randomizeOrderingSeed(seed: string | number): this
    Shuffle test order with a seed, or `random` (`--test-randomize-ordering-seed`).
  ignoreTimeouts(): this
    Do not stop a test at its timeout (`--ignore-timeouts`).
  noColor(): this
    Print stack traces without colour codes (`--no-color`).
  shard(index: number, total: number): this
    Run one shard of the suite: `shard(index, total)` renders
    `--total-shards total --shard-index index`, with `index` from 0.
  override protected buildArgs(): string[]
    Assemble the `dart test` argv.

class DartVersionSettings extends DartSettings
  Settings for `dart --version`.

  override protected buildArgs(): string[]
    Assemble the `dart --version` argv.

abstract class DartVmSettings extends DartSettings
  Flags shared by the commands that load Dart code into the VM — `compile`
  and `run`: `--define`, `--enable-asserts`, `--enable-experiment`,
  `--packages` and `--verbosity`. Valued options render as `--flag=value`:
  `dart compile js` hands its argv to dart2js, whose parser accepts only that
  spelling, and Dart's `args` package accepts it everywhere else.

  protected vmFlag(...tokens: string[]): this
    Push the shared flags in call order.
  define(name: string, value: string): this
    Define an environment declaration (`--define=name=value`); repeatable.
  enableAsserts(): this
    Enable assert statements (`--enable-asserts`).
  enableExperiment(name: string): this
    Enable an experimental language feature (`--enable-experiment`); repeatable.
  packages(path: PathLike): this
    The package resolution file to use (`--packages`).
  verbosity(level: "error" | "warning" | "info" | "all"): this
    How much to print: `error`, `warning`, `info` or `all` (`--verbosity`).
  protected vmArgs(): string[]
    The shared VM flags, in call order.

interface DartTasksApi
  The shape of {@link DartTasks}.

  compileExe: DartCompileTask
    Compile to a self-contained executable: `dart compile exe`.
  compileAotSnapshot: DartCompileTask
    Compile to an AOT snapshot for `dartaotruntime`: `dart compile aot-snapshot`.
  compileJitSnapshot: DartCompileTask
    Compile to a JIT snapshot: `dart compile jit-snapshot`.
  compileKernel: DartCompileTask
    Compile to a kernel binary: `dart compile kernel`.
  compileJs: DartCompileTask
    Compile to JavaScript: `dart compile js`.
  compileWasm: DartCompileTask
    Compile to WebAssembly: `dart compile wasm`.
  analyze(configure?: Configure<DartAnalyzeSettings>): Promise<CommandOutput>
    Analyze the project's Dart code: `dart analyze`.
  format(configure?: Configure<DartFormatSettings>): Promise<CommandOutput>
    Format Dart code, or check it with `.setExitIfChanged()`: `dart format`.
  fix(configure?: Configure<DartFixSettings>): Promise<CommandOutput>
    Apply analyzer fixes: `dart fix`.
  test(configure?: Configure<DartTestSettings>): Promise<CommandOutput>
    Run the tests: `dart test`.
  run(configure?: Configure<DartRunSettings>): Promise<CommandOutput>
    Run a Dart program or package executable: `dart run`.
  doc(configure?: Configure<DartDocSettings>): Promise<CommandOutput>
    Generate API documentation: `dart doc`.
  create(configure: Configure<DartCreateSettings>): Promise<CommandOutput>
    Scaffold a project: `dart create`.
  pubGet(configure?: Configure<DartPubGetSettings>): Promise<CommandOutput>
    Resolve dependencies: `dart pub get`.
  pubUpgrade(configure?: Configure<DartPubUpgradeSettings>): Promise<CommandOutput>
    Upgrade dependencies: `dart pub upgrade`.
  pubDowngrade(configure?: Configure<DartPubDowngradeSettings>): Promise<CommandOutput>
    Downgrade dependencies to their lowest allowed versions: `dart pub downgrade`.
  pubOutdated(configure?: Configure<DartPubOutdatedSettings>): Promise<CommandOutput>
    List outdated dependencies: `dart pub outdated`.
  pubDeps(configure?: Configure<DartPubDepsSettings>): Promise<CommandOutput>
    Print the dependency graph: `dart pub deps`.
  pubAdd(configure: Configure<DartPubPackagesSettings>): Promise<CommandOutput>
    Add dependencies to `pubspec.yaml`: `dart pub add`.
  pubRemove(configure: Configure<DartPubPackagesSettings>): Promise<CommandOutput>
    Remove dependencies from `pubspec.yaml`: `dart pub remove`.
  pubPublish(configure?: Configure<DartPubPublishSettings>): Promise<CommandOutput>
    Publish the package to pub.dev: `dart pub publish`.
  info(configure?: Configure<DartInfoSettings>): Promise<CommandOutput>
    Print diagnostic details about the SDK: `dart info`.
  version(configure?: Configure<DartVersionSettings>): Promise<CommandOutput>
    Print the Dart SDK version: `dart --version`.

type DartCompileTarget = "aot-snapshot" | "exe" | "jit-snapshot" | "js" | "kernel" | "wasm"
  A `dart compile` target: what the entry point is compiled to.

type DartCompileTask = (configure: Configure<DartCompileSettings>) => Promise<CommandOutput>
  A task that runs `dart compile <target>`; `.entry()` is required.

type DartCreateTemplate = "cli" | "console" | "package" | "server-shelf" | "web"
  A `dart create` template (`--template`).

type DartTargetOs = "android" | "fuchsia" | "ios" | "linux" | "macos" | "windows"
  An operating system `dart compile exe|aot-snapshot` can target (`--target-os`).
````

</details>

<!-- ZUKE:API:END -->
