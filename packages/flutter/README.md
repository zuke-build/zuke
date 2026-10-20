# @zuke/flutter

Typed [Flutter](https://flutter.dev) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `analyze`, `test`,
`build*` for every artifact, `pub*`, `clean`, `create`, `genL10n`, `drive`,
`install`, `devices`, `doctor`, `precache`, `config` and `version`.

```ts
import { Build, run, target } from "@zuke/core";
import { FlutterTasks } from "@zuke/flutter";

class App extends Build {
  deps = target().executes(async () => {
    await FlutterTasks.pubGet((s) => s.enforceLockfile());
  });
  test = target().dependsOn(this.deps).executes(async () => {
    await FlutterTasks.analyze();
    await FlutterTasks.test((s) => s.coverage().reporter("github"));
  });
  bundle = target().dependsOn(this.test).executes(async () => {
    await FlutterTasks.buildAppBundle((s) =>
      s.release().flavor("prod").buildNumber(42)
        .obfuscate().splitDebugInfo("build/symbols")
    );
  });
}

await run(App);
```

`flutter` is resolved from `PATH`. A path operand that starts with `-` is passed
as `./-…` so it can never be read as a flag, and a package name that would be is
refused.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/flutter` — typed `FlutterTasks` wrappers for the
Flutter (https://flutter.dev) CLI, for use in Zuke builds: analyze, test,
build every artifact, manage pub dependencies, and drive devices and the SDK.

```ts
import { FlutterTasks } from "@zuke/flutter";

await FlutterTasks.pubGet((s) => s.enforceLockfile());
await FlutterTasks.analyze();
await FlutterTasks.test((s) => s.coverage());
await FlutterTasks.buildAppBundle((s) =>
  s.release().flavor("prod").buildNumber(42)
);
```
@module

const FlutterTasks: FlutterTasksApi
  Typed task functions for the `flutter` CLI.

class FlutterAnalyzeSettings extends FlutterSettings
  Settings for `flutter analyze`.

  path(path: PathLike): this
    A file or directory to analyze (defaults to the project); repeatable.
  noFatalInfos(): this
    Do not fail on info-level issues (`--no-fatal-infos`).
  noFatalWarnings(): this
    Do not fail on warnings (`--no-fatal-warnings`).
  write(path: PathLike): this
    Also write the analysis results to a file (`--write`).
  override protected buildArgs(): string[]
    Assemble the `flutter analyze` argv.

abstract class FlutterAppSettings extends FlutterCompileSettings
  Compile flags plus the build mode and the entry point (`--target`), shared by
  `flutter build` and `flutter drive`.

  mode(mode: FlutterBuildMode): this
    The build mode (`--debug`, `--profile` or `--release`).
  release(): this
    Build in release mode (`--release`).
  target(path: PathLike): this
    The main entry-point file, instead of `lib/main.dart` (`--target`).
  protected appArgs(): string[]
    The mode and entry point, then the shared compile flags.

class FlutterBuildSettings extends FlutterAppSettings
  Settings for `flutter build <target>`. Flags that only one target accepts say
  so; `flutter` rejects them for the others.

  constructor(kind: FlutterBuildTarget)
    Settings for `flutter build <kind>`.
  buildName(name: string): this
    The version name, e.g. `1.4.0` (`--build-name`).
  buildNumber(number: string | number): this
    The build number, e.g. the CI run number (`--build-number`).
  obfuscate(): this
    Obfuscate Dart symbols (`--obfuscate`); needs {@link splitDebugInfo}.
  splitDebugInfo(dir: PathLike): this
    Write split debug symbols to a directory (`--split-debug-info`).
  noTreeShakeIcons(): this
    Keep every icon font glyph (`--no-tree-shake-icons`).
  targetPlatform(platform: string): this
    The platform to build for (`--target-platform`). Android takes several ABIs,
    e.g. `android-arm64`, joined into one list; `linux` and `windows` take one,
    e.g. `linux-arm64`.
  splitPerAbi(): this
    `apk`: one APK per ABI (`--split-per-abi`).
  noCodesign(): this
    `ios`: build without code signing (`--no-codesign`).
  exportMethod(method: string): this
    `ipa`: the export method, e.g. `app-store` or `ad-hoc` (`--export-method`).
  exportOptionsPlist(path: PathLike): this
    `ipa`: the export options plist (`--export-options-plist`).
  baseHref(href: string): this
    `web`: the base href of the app, e.g. `/app/` (`--base-href`).
  wasm(): this
    `web`: compile to WebAssembly (`--wasm`).
  sourceMaps(): this
    `web`: emit source maps (`--source-maps`).
  output(dir: PathLike): this
    `web`: the output directory, instead of `build/web` (`--output`).
  override protected buildArgs(): string[]
    Assemble the `flutter build <target>` argv.

class FlutterCommandSettings extends FlutterSettings
  Settings for a flagless command: `flutter clean`, or `flutter gen-l10n`
  (configured by `l10n.yaml`). Extra flags go through `.args()`.

  constructor(command: FlutterPlainCommand)
    Settings for `flutter <command>`.
  override protected buildArgs(): string[]
    Assemble the `flutter <command>` argv.

abstract class FlutterCompileSettings extends FlutterSettings
  Flags shared by the commands that compile Dart code: `--no-pub`,
  `--dart-define`, `--dart-define-from-file` and `--flavor`.

  noPub(): this
    Skip the implicit `flutter pub get` (`--no-pub`).
  dartDefine(name: string, value: string): this
    Define a compile-time constant (`--dart-define=name=value`); repeatable.
  dartDefineFromFile(path: PathLike): this
    Read compile-time constants from a JSON or `.env` file (`--dart-define-from-file`); repeatable.
  flavor(name: string): this
    The build flavor, for apps with product flavors or schemes (`--flavor`).
  protected compileArgs(): string[]
    The shared compile flags, in a stable order.

class FlutterConfigSettings extends FlutterSettings
  Settings for `flutter config`.

  enable(feature: string): this
    Turn a feature on, e.g. `web` → `--enable-web`; repeatable.
  disable(feature: string): this
    Turn a feature off, e.g. `web` → `--no-enable-web`; repeatable.
  androidSdk(dir: PathLike): this
    The Android SDK directory (`--android-sdk`).
  noAnalytics(): this
    Turn analytics reporting off (`--no-analytics`).
  clearFeatures(): this
    Reset every feature flag to its default (`--clear-features`).
  override protected buildArgs(): string[]
    Assemble the `flutter config` argv.

class FlutterCreateSettings extends FlutterSettings
  Settings for `flutter create`.

  dir(path: PathLike): this
    The directory to create the project in; required.
  org(org: string): this
    The reverse-domain organization, e.g. `com.example` (`--org`).
  projectName(name: string): this
    The Dart package name, instead of the directory's (`--project-name`).
  description(text: string): this
    The project description (`--description`).
  template(name: string): this
    The template: `app`, `module`, `package`, `plugin`, … (`--template`).
  platform(name: string): this
    A platform to scaffold, e.g. `android` or `web` (`--platforms`); repeatable.
  empty(): this
    Scaffold a minimal app without the counter sample (`--empty`).
  override protected buildArgs(): string[]
    Assemble the `flutter create` argv.

class FlutterDevicesSettings extends FlutterSettings
  Settings for `flutter devices`.

  machine(): this
    Print the devices as JSON (`--machine`).
  override protected buildArgs(): string[]
    Assemble the `flutter devices` argv.

class FlutterDoctorSettings extends FlutterSettings
  Settings for `flutter doctor`.

  verbose(): this
    Show full details for every check (`--verbose`).
  override protected buildArgs(): string[]
    Assemble the `flutter doctor` argv.

class FlutterDriveSettings extends FlutterAppSettings
  Settings for `flutter drive`, which runs integration tests on a device.

  driver(path: PathLike): this
    The test driver file, e.g. `test_driver/integration_test.dart` (`--driver`).
  deviceId(id: string): this
    The device to run on, e.g. `chrome` or an emulator id (`--device-id`).
  screenshot(dir: PathLike): this
    Save a screenshot to this directory if the run fails (`--screenshot`).
  override protected buildArgs(): string[]
    Assemble the `flutter drive` argv.

class FlutterInstallSettings extends FlutterSettings
  Settings for `flutter install`, which installs a built app on a device.

  mode(mode: FlutterBuildMode): this
    Install the build of this mode (`--debug`, `--profile` or `--release`).
  flavor(name: string): this
    Install this build flavor (`--flavor`).
  deviceId(id: string): this
    The device to install on (`--device-id`).
  useApplicationBinary(path: PathLike): this
    Install this prebuilt binary instead (`--use-application-binary`).
  uninstallOnly(): this
    Only uninstall the app (`--uninstall-only`).
  override protected buildArgs(): string[]
    Assemble the `flutter install` argv.

class FlutterPrecacheSettings extends FlutterSettings
  Settings for `flutter precache`, which downloads platform artifacts.

  platform(name: string): this
    Fetch a platform's artifacts, e.g. `android` → `--android`; repeatable.
  force(): this
    Re-download even when cached (`--force`).
  override protected buildArgs(): string[]
    Assemble the `flutter precache` argv.

class FlutterPubDepsSettings extends FlutterSettings
  Settings for `flutter pub deps`.

  json(): this
    Print the dependency graph as JSON (`--json`).
  override protected buildArgs(): string[]
    Assemble the `flutter pub deps` argv.

class FlutterPubGetSettings extends FlutterSettings
  Settings for `flutter pub get`.

  offline(): this
    Resolve from the local pub cache only (`--offline`).
  enforceLockfile(): this
    Fail rather than change `pubspec.lock` (`--enforce-lockfile`).
  override protected buildArgs(): string[]
    Assemble the `flutter pub get` argv.

class FlutterPubOutdatedSettings extends FlutterSettings
  Settings for `flutter pub outdated`.

  json(): this
    Print machine-readable JSON (`--json`).
  showAll(): this
    Include packages that are already up to date (`--show-all`).
  override protected buildArgs(): string[]
    Assemble the `flutter pub outdated` argv.

class FlutterPubPackagesSettings extends FlutterSettings
  Settings for `flutter pub add` and `flutter pub remove`.

  constructor(verb: "add" | "remove")
    Settings for `flutter pub <verb>`.
  package(spec: string): this
    A package to add or remove; repeatable, at least one is required. For
    `add` it takes pub's descriptor syntax: `http`, `http:^1.2.0`, or
    `dev:mocktail` for a dev dependency.
  override protected buildArgs(): string[]
    Assemble the `flutter pub add|remove` argv.

class FlutterPubUpgradeSettings extends FlutterSettings
  Settings for `flutter pub upgrade`.

  package(name: string): this
    Upgrade only this package (defaults to all); repeatable.
  majorVersions(): this
    Also raise constraints in `pubspec.yaml` across majors (`--major-versions`).
  tighten(): this
    Raise lower bounds in `pubspec.yaml` to the resolved versions (`--tighten`).
  override protected buildArgs(): string[]
    Assemble the `flutter pub upgrade` argv.

abstract class FlutterSettings extends ToolSettings
  Base for all `flutter` settings: the binary is `flutter`, found on `PATH`.

  override protected defaultTool(): string
    The binary these settings invoke: `flutter`.
  override protected defaultResolution(): ToolResolution
    Resolve from `PATH` — the Flutter SDK is installed natively.

class FlutterTestSettings extends FlutterCompileSettings
  Settings for `flutter test`.

  path(path: PathLike): this
    A test file or directory to run (defaults to `test/`); repeatable.
  coverage(): this
    Collect coverage into `coverage/lcov.info` (`--coverage`).
  coveragePath(path: PathLike): this
    Where to write the lcov coverage report (`--coverage-path`).
  mergeCoverage(): this
    Merge with the existing coverage report (`--merge-coverage`).
  name(pattern: string): this
    Run only tests whose name matches a regular expression (`--name`); repeatable.
  plainName(text: string): this
    Run only tests whose name contains a string (`--plain-name`); repeatable.
  tags(expression: string): this
    Run only tests with a tag expression (`--tags`).
  excludeTags(expression: string): this
    Skip tests matching a tag expression (`--exclude-tags`).
  concurrency(count: number): this
    How many test suites to run at once (`--concurrency`).
  reporter(name: string): this
    The console reporter: `compact`, `expanded`, `github`, `json`, … (`--reporter`).
  fileReporter(spec: string): this
    Also write a reporter's output to a file, e.g. `json:report.json` (`--file-reporter`).
  updateGoldens(): this
    Rewrite golden files instead of comparing against them (`--update-goldens`).
  platform(name: string): this
    Run on a platform other than the VM, e.g. `chrome` (`--platform`).
  randomizeOrderingSeed(seed: string | number): this
    Shuffle test order with a seed, or `random` (`--test-randomize-ordering-seed`).
  timeout(value: string): this
    The default per-test timeout, e.g. `30s` or `2x` (`--timeout`).
  shard(index: number, total: number): this
    Run one shard of the suite: `shard(index, total)` renders
    `--total-shards total --shard-index index`, with `index` from 0.
  override protected buildArgs(): string[]
    Assemble the `flutter test` argv.

class FlutterVersionSettings extends FlutterSettings
  Settings for `flutter --version`.

  machine(): this
    Print the versions as JSON (`--machine`).
  override protected buildArgs(): string[]
    Assemble the `flutter --version` argv.

interface FlutterTasksApi
  The shape of {@link FlutterTasks}.

  buildAar: FlutterBuildTask
    Build an Android library: `flutter build aar`. It builds the debug, profile
    and release variants unless told not to, so a single mode needs the others
    turned off through `.args("--no-debug", "--no-profile")`.
  buildApk: FlutterBuildTask
    Build an Android APK: `flutter build apk`.
  buildAppBundle: FlutterBuildTask
    Build an Android App Bundle: `flutter build appbundle`.
  buildIos: FlutterBuildTask
    Build the iOS app: `flutter build ios`.
  buildIpa: FlutterBuildTask
    Build an iOS archive and IPA: `flutter build ipa`.
  buildLinux: FlutterBuildTask
    Build the Linux desktop app: `flutter build linux`.
  buildMacos: FlutterBuildTask
    Build the macOS desktop app: `flutter build macos`.
  buildWeb: FlutterBuildTask
    Build the web app: `flutter build web`.
  buildWindows: FlutterBuildTask
    Build the Windows desktop app: `flutter build windows`.
  analyze(configure?: Configure<FlutterAnalyzeSettings>): Promise<CommandOutput>
    Analyze the project's Dart code: `flutter analyze`.
  test(configure?: Configure<FlutterTestSettings>): Promise<CommandOutput>
    Run the unit and widget tests: `flutter test`.
  pubGet(configure?: Configure<FlutterPubGetSettings>): Promise<CommandOutput>
    Resolve dependencies: `flutter pub get`.
  pubUpgrade(configure?: Configure<FlutterPubUpgradeSettings>): Promise<CommandOutput>
    Upgrade dependencies: `flutter pub upgrade`.
  pubOutdated(configure?: Configure<FlutterPubOutdatedSettings>): Promise<CommandOutput>
    List outdated dependencies: `flutter pub outdated`.
  pubDeps(configure?: Configure<FlutterPubDepsSettings>): Promise<CommandOutput>
    Print the dependency graph: `flutter pub deps`.
  pubAdd(configure: Configure<FlutterPubPackagesSettings>): Promise<CommandOutput>
    Add dependencies to `pubspec.yaml`: `flutter pub add`.
  pubRemove(configure: Configure<FlutterPubPackagesSettings>): Promise<CommandOutput>
    Remove dependencies from `pubspec.yaml`: `flutter pub remove`.
  clean(configure?: Configure<FlutterCommandSettings>): Promise<CommandOutput>
    Delete the build and `.dart_tool` directories: `flutter clean`.
  create(configure: Configure<FlutterCreateSettings>): Promise<CommandOutput>
    Scaffold a project: `flutter create`.
  genL10n(configure?: Configure<FlutterCommandSettings>): Promise<CommandOutput>
    Generate localizations from `l10n.yaml`: `flutter gen-l10n`.
  drive(configure?: Configure<FlutterDriveSettings>): Promise<CommandOutput>
    Run integration tests on a device: `flutter drive`.
  install(configure?: Configure<FlutterInstallSettings>): Promise<CommandOutput>
    Install a built app on a device: `flutter install`.
  devices(configure?: Configure<FlutterDevicesSettings>): Promise<CommandOutput>
    List connected devices: `flutter devices`.
  doctor(configure?: Configure<FlutterDoctorSettings>): Promise<CommandOutput>
    Check the toolchain: `flutter doctor`.
  precache(configure?: Configure<FlutterPrecacheSettings>): Promise<CommandOutput>
    Download platform artifacts: `flutter precache`.
  config(configure?: Configure<FlutterConfigSettings>): Promise<CommandOutput>
    Change SDK settings: `flutter config`.
  version(configure?: Configure<FlutterVersionSettings>): Promise<CommandOutput>
    Print the Flutter, Dart and engine versions: `flutter --version`.

type FlutterBuildMode = "debug" | "profile" | "release"
  A Flutter build mode, rendered as `--debug`, `--profile` or `--release`.

type FlutterBuildTarget = "aar" | "apk" | "appbundle" | "ios" | "ipa" | "linux" | "macos" | "web" | "windows"
  The artifact `flutter build` produces — its subcommand.

type FlutterBuildTask = (configure?: Configure<FlutterBuildSettings>) => Promise<CommandOutput>
  A task that runs `flutter build <target>`.

type FlutterPlainCommand = "clean" | "gen-l10n"
  A `flutter` command that a build runs without flags.
````

</details>

<!-- ZUKE:API:END -->
