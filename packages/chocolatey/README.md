# @zuke/chocolatey

Ship a prebuilt Windows binary through [Chocolatey](https://chocolatey.org) from
a [Zuke](https://github.com/zuke-build/zuke#readme) build. `ChocoTasks` is a
typed wrapper for the `choco` CLI (v2); `ChocolateyTasks` renders a package for
a zip hosted on a release, verifies that it installs, publishes it, and declares
the CI job that verifies it on Windows.

```ts
import { ChocolateyTasks } from "@zuke/chocolatey";

const pkg = ChocolateyTasks.package((s) =>
  s.id("app").version("1.2.3").title("App")
    .authors("Acme").owners("acme")
    .projectUrl("https://example.com")
    .licenseUrl("https://example.com/LICENSE")
    .packageSourceUrl("https://github.com/acme/app")
    .description("Command-line tool that builds and ships widgets")
    .tags("cli", "widgets")
    .url64bit(winZipUrl).checksum64(winZipSha)
);

await ChocolateyTasks.verify((s) =>
  s.package(pkg).binary("app").command("--version").expectVersion()
);
const result = await ChocolateyTasks.publish((s) =>
  s.package(pkg).apiKey(chocoKey)
);
// result: { source: "https://push.chocolatey.org/", nupkg: "app.1.2.3.nupkg" }
```

## Rendering a package

`ChocolateyTasks.package` returns the package's files — `<id>.nuspec` and
`tools/chocolateyinstall.ps1` — keyed by their path, and is pure: nothing is
read or written. The install script downloads the zip, checks its SHA-256 and
unpacks it into the package's own `tools` directory:

```powershell
$ErrorActionPreference = 'Stop'
$toolsDir = $(Split-Path -parent $MyInvocation.MyCommand.Definition)

$packageArgs = @{
  packageName    = 'app'
  unzipLocation  = $toolsDir
  url64bit       = 'https://…/app-x86_64-pc-windows-msvc.zip'
  checksum64     = '…'
  checksumType64 = 'sha256'
}

Install-ChocolateyZipPackage @packageArgs
```

- **No uninstall script.** Choco puts a shim on `PATH` for every `.exe` under
  the package directory, so the binary in the zip is on `PATH` once installed.
  `choco uninstall` removes the package directory — the unpacked files with it —
  and those shims, so the package needs no `chocolateyuninstall.ps1`: the
  install changes nothing outside its own directory.
- **Deterministic.** The nuspec elements are written in a fixed order and the
  checksum lowercase, so re-rendering an unchanged release produces the same
  bytes.
- **Validated.** The id is lowercase letters and digits joined by single `.`,
  `-` or `_` (at most 100 characters — it is also the nuspec's file name); the
  version is a NuGet version with no leading zeros (`1.2.3`, `1.2.3.4`,
  `1.2.3-beta.1`); every URL is `https`, printable ASCII, with no user name or
  password (and is never echoed in an error); the checksum is 64 hex digits; the
  description is 30 to 4000 characters, the community repository's limits;
  authors, owners, title and summary are one line each; tags are single words.
  Every refusal names the setter.
- **Injection-safe.** Every nuspec value goes through one XML escaper — the five
  markup characters as entities, a carriage return and every invisible or
  bidirectional character as a numeric reference, and a character XML cannot
  hold refused — so no value can close its element and add metadata of its own.
  Every script value is a PowerShell single-quoted string, in which nothing
  expands; each quote, the typographic ones PowerShell also accepts included, is
  doubled.
- **License URL, not expression.** The nuspec carries `licenseUrl`, which the
  community repository requires whenever the software has a license; the NuGet
  `<license>` expression element is not rendered. `requireLicenseAcceptance` is
  always `false`, so the package installs unattended.

## Verifying a package

```ts
verifyPackage = target().executes(() =>
  ChocolateyTasks.verify((s) =>
    s.package(pkg).binary("app").command("--version").expectVersion()
  )
);
release = cicd({
  invokes: [ChocolateyTasks.verifyJob((s) => s.target(this.verifyPackage))],
});
```

`verify` installs the package the way a user would: it writes the files into a
fresh temporary directory, runs `choco pack` there, then
`choco install <id> --source=<dir> --version=<version> --yes --force
--no-progress`
— the directory is the only source, and `--force` replaces a copy already on the
machine — and runs the shim with the given arguments, checking that its output
contains the version (`expectVersion()`) or a text (`expectOutput(...)`). The
`choco uninstall` and the removal of the directory always run, whether or not
the install and the check passed, and an error in the cleanup is raised
alongside the one that caused it, never instead of it.

`verifyJob` returns a plain `CiInvocation` for `cicd({ invokes: [...] })`: a
`windows-latest` matrix (`.runners(...)` to change it) that lets every runner
finish. GitHub's Windows runners ship with Chocolatey and run elevated, so the
job needs no setup step. Spread it to add anything the pipeline decides, such as
`{ ...ChocolateyTasks.verifyJob(…), timeoutMinutes: 20 }`.

## Publishing

`publish` packs a rendered package in a temporary directory and pushes the
`.nupkg` with `choco push`, removing the directory afterwards; `.nupkg(path)`
pushes one already built instead. The source defaults to the community
repository, `https://push.chocolatey.org/`, and must be `https`.

**The API key.** Choco takes a key only as an argument (`--api-key=<key>`) or
from what `choco apikey add` saved — it reads no environment variable and no
standard input. So the key is registered with the run's redactor, which masks
every rendering of the command, and masked out of every error the push raises,
inside a run or outside one. It is still visible in the process table while the
push runs; on a host shared with other users, save it once with
`ChocoTasks.apikey((s) => s.add().source(…).apiKey(key))` and leave `.apiKey`
unset, and choco looks it up by source.

## The choco CLI

```ts
import { ChocoTasks } from "@zuke/chocolatey";

await ChocoTasks.pack((s) => s.nuspec("app.nuspec").outputDirectory("dist"));
await ChocoTasks.install((s) =>
  s.packages("app").source("dist").version("1.2.3").yes().noProgress()
);
await ChocoTasks.push((s) =>
  s.nupkg("dist/app.1.2.3.nupkg").source("https://push.chocolatey.org/")
    .apiKey(key)
);
```

`pack`, `push`, `install`, `uninstall` and `apikey` mirror choco's commands and
options; every command also takes the common switches `.yes()`, `.force()`,
`.noProgress()`, `.limitOutput()` and `.verbose()`; `run` builds anything else.
Valued options render as one `--name=value` token, the form choco's help prints,
so a value that starts with `-` stays a value. `choco` resolves from `PATH`.
Arguments stay a discrete argv array, and an operand choco would read as a
switch (`-x`, `/x`) is refused.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/chocolatey` — ship a prebuilt Windows binary through
Chocolatey (https://chocolatey.org) from a Zuke build: `ChocoTasks` wraps
the `choco` CLI, and `ChocolateyTasks` renders a package for a zip hosted
on a release, verifies it installs, publishes it, and declares the CI job
that verifies it on Windows.

```ts
import { ChocolateyTasks } from "@zuke/chocolatey";

const pkg = ChocolateyTasks.package((s) =>
  s.id("app").version("1.2.3").authors("Acme")
    .projectUrl("https://example.com")
    .licenseUrl("https://example.com/LICENSE")
    .description("Command-line tool that builds and ships widgets")
    .url64bit(winZipUrl).checksum64(winZipSha)
);
await ChocolateyTasks.verify((s) =>
  s.package(pkg).binary("app").command("--version").expectVersion()
);
await ChocolateyTasks.publish((s) => s.package(pkg).apiKey(chocoKey));
```
@module

const ChocoTasks: ChocoTasksApi
  Typed task functions for the Chocolatey `choco` CLI.

const ChocolateyTasks: ChocolateyTasksApi
  Tasks for shipping a prebuilt Windows binary through Chocolatey.

class ChocoApikeySettings extends ChocoCommandSettings
  Settings for `choco apikey`, which manages the API keys choco saves per
  source — so a later `choco push` to that source needs no key on its
  command line.

  ```ts
  await ChocoTasks.apikey((s) =>
    s.add().source("https://push.chocolatey.org/").apiKey(key)
  );
  ```

  `add` needs a {@link source} and an {@link apiKey}; `remove` needs a
  source. With no action set, choco lists the saved keys (by source; it never
  prints a key itself).

  list(): this
    List the saved keys' sources (`apikey list`).
  add(): this
    Save the {@link apiKey} for the {@link source} (`apikey add`).
  remove(): this
    Remove the key saved for the {@link source} (`apikey remove`).
  source(url: string): this
    The source the key is for (`--source`).
  apiKey(value: string): this
    The key to save (`--api-key`), for {@link add}. Masked in every rendering
    of the command and in its errors.
  protected verb(): string[]
    The command: `apikey`, then the action when one is set.
  protected commandFlags(): string[]
    The options set.

    @throws {Error}
        when `add` lacks a source or key, `remove` lacks a
        source, or a key is given to anything but `add`.

abstract class ChocoCommandSettings extends ChocoSettings
  Base for a typed `choco` command: the command, then its operands, then its
  own options, then the common switches — the order choco's own usage lines
  print (`choco install <pkg> [<options/switches>]`). Anything added through
  the inherited `.command(...)`/`.flag(...)` escape hatches follows.

  Valued options render as one `--name=value` token, the spelling choco's
  help prints, so a value that starts with `-` stays the option's value
  rather than becoming a switch of its own.

  Operands are refused when choco would read them as a switch: a package id
  or file path never starts with `-`, and passing `--force` as a "package"
  would change what the command does rather than fail.

  abstract protected verb(): string[]
    The command, e.g. `["install"]` or `["apikey", "add"]`.
  abstract protected commandFlags(): string[]
    This command's own options.
  yes(): this
    Answer yes to every prompt (`--yes`), which also accepts licenses.
  force(): this
    Force the behaviour (`--force`) — reinstall an installed package, say.
    Choco warns against it in normal operation.
  noProgress(): this
    Do not print download progress percentages (`--no-progress`).
  limitOutput(): this
    Print only the essential information (`--limit-output`).
  verbose(): this
    Print verbose messages (`--verbose`).
  protected addOperands(values: readonly string[]): void
    Append operands — package ids or file paths — in order.
  protected get operands(): readonly string[]
    The operands added so far.
  protected secret(value: string): void
    Record `value` as a credential this command carries on its command line:
    registered with the run's redactor, and masked out of any error the
    command raises — inside a run or outside one.
  override protected leadingTokens(): string[]
    The command, its operands, its options, then the common switches.
  override run(): Promise<CommandOutput>
    Run the command, masking every value passed to {@link secret} out of any
    `CommandError` or `CommandTimeoutError` it raises.

class ChocoInstallSettings extends ChocoCommandSettings
  Settings for `choco install`.

  packages(...ids: string[]): this
    Package ids to install (required); repeatable.
  source(location: string): this
    Where to find the packages (`--source`): a feed URL, or a local directory
    holding `.nupkg` files. Defaults to the configured feeds.
  version(value: string): this
    The exact version to install (`--version`).
  prerelease(): this
    Consider prerelease versions (`--prerelease`).
  protected verb(): string[]
    The command: `install`.
  protected commandFlags(): string[]
    The options set, in choco's help order.

class ChocoPackSettings extends ChocoCommandSettings
  Settings for `choco pack`, which builds a `.nupkg` from a `.nuspec`. With no
  nuspec named, choco packs the one in the working directory.

  nuspec(path: PathLike): this
    The `.nuspec` to pack; defaults to the one in the working directory.
  version(value: string): this
    The version to write into the package, overriding the nuspec's (`--version`).
  outputDirectory(path: PathLike): this
    Where to write the `.nupkg` (`--output-directory`); defaults to the working directory.
  protected verb(): string[]
    The command: `pack`.
  protected commandFlags(): string[]
    The options set, in choco's help order.

class ChocoPushSettings extends ChocoCommandSettings
  Settings for `choco push`, which uploads a `.nupkg` to a source. With no
  package named, choco pushes the only `.nupkg` in the working directory.

  The API key is an argument — choco reads it from nowhere else — so it is
  registered with the run's redactor and masked out of any error the push
  raises. It is still visible in the process table for the push's duration;
  on a shared host, save it once with `choco apikey add` instead and leave
  {@link apiKey} unset, and choco looks it up by source.

  nupkg(path: PathLike): this
    The `.nupkg` to push.
  source(url: string): this
    The source to push to (`--source`), e.g. `https://push.chocolatey.org/`
    for the community repository.
  apiKey(value: string): this
    The source's API key (`--api-key`). Masked in every rendering of the
    command and in its errors.
  protected verb(): string[]
    The command: `push`.
  protected commandFlags(): string[]
    The options set, in choco's help order.

class ChocoSettings extends SubcommandSettings
  Settings for a `choco` invocation.

  override protected defaultTool(): string
    The default executable name (`choco`).
  override protected defaultResolution(): ToolResolution
    Resolve `choco` from `PATH` — Chocolatey is a native install under
    `%ChocolateyInstall%`, never a `node_modules` package.

class ChocoUninstallSettings extends ChocoCommandSettings
  Settings for `choco uninstall`.

  packages(...ids: string[]): this
    Package ids to uninstall (required); repeatable.
  source(location: string): this
    The source the packages came from (`--source`).
  version(value: string): this
    The installed version to uninstall (`--version`).
  allVersions(): this
    Uninstall every installed version (`--all-versions`).
  protected verb(): string[]
    The command: `uninstall`.
  protected commandFlags(): string[]
    The options set, in choco's help order.

class ChocolateyPackageSettings
  Settings for a package that installs a prebuilt binary from a zip.

  id_?: string
    The package id. Set by {@link id}.
  version_?: string
    The package version. Set by {@link version}.
  title_?: string
    The display title. Set by {@link title}.
  authors_: string[]
    The software's authors. Added by {@link authors}.
  owners_: string[]
    The package's maintainers. Added by {@link owners}.
  projectUrl_?: string
    The software's homepage. Set by {@link projectUrl}.
  licenseUrl_?: string
    The license's URL. Set by {@link licenseUrl}.
  iconUrl_?: string
    The icon's URL. Set by {@link iconUrl}.
  copyright_?: string
    The copyright notice. Set by {@link copyright}.
  packageSourceUrl_?: string
    Where the package's source lives. Set by {@link packageSourceUrl}.
  docsUrl_?: string
    The software's documentation. Set by {@link docsUrl}.
  bugTrackerUrl_?: string
    The software's issue tracker. Set by {@link bugTrackerUrl}.
  tags_: string[]
    The search tags. Added by {@link tags}.
  summary_?: string
    The one-line summary. Set by {@link summary}.
  description_?: string
    The description. Set by {@link description}.
  releaseNotes_?: string
    The release notes. Set by {@link releaseNotes}.
  url64bit_?: string
    The 64-bit zip's URL. Set by {@link url64bit}.
  checksum64_?: string
    The 64-bit zip's SHA-256. Set by {@link checksum64}.
  id(value: string): this
    The package id (required), e.g. `app`: lowercase letters and digits,
    joined by single `.`, `-` or `_`, at most 100 characters. It is also the
    nuspec's file name, `<id>.nuspec`.
  version(value: string): this
    The package version (required), a NuGet version such as `1.2.3`,
    `1.2.3.4` or `1.2.3-beta.1` — usually the release's own version.
  title(value: string): this
    The display title (`<title>`), e.g. `App (Portable)`.
  authors(...names: string[]): this
    The software's authors (`<authors>`, required); repeatable.
  owners(...names: string[]): this
    The package's maintainers (`<owners>`) — on the community repository,
    the user names that may push it; repeatable.
  projectUrl(url: string): this
    The software's homepage (`<projectUrl>`, required; must be `https`).
  licenseUrl(url: string): this
    The license's URL (`<licenseUrl>`, `https`) — the community repository
    requires it whenever the software has one.
  iconUrl(url: string): this
    The package icon's URL (`<iconUrl>`, `https`).
  packageSourceUrl(url: string): this
    Where the package's own source lives (`<packageSourceUrl>`, `https`) —
    typically the repository whose build renders it.
  docsUrl(url: string): this
    The software's documentation (`<docsUrl>`, `https`).
  bugTrackerUrl(url: string): this
    The software's issue tracker (`<bugTrackerUrl>`, `https`).
  tags(...values: string[]): this
    Search tags (`<tags>`), each one word; repeatable.
  copyright(text: string): this
    The software's copyright notice (`<copyright>`), one line — e.g. the
    line in its LICENSE, `Copyright (c) 2026 Acme`. The community
    repository's moderators ask for it whenever the software has one.
  summary(text: string): this
    A one-line summary (`<summary>`).
  description(text: string): this
    The description (`<description>`, required; Markdown is fine), held to
    the community repository's length rules: 30 to 4000 characters.
  releaseNotes(text: string): this
    The release notes (`<releaseNotes>`): text, Markdown, or a URL.
  url64bit(url: string): this
    The 64-bit zip on the release (required; must be `https`) — what the
    install script downloads (`url64bit`) and unpacks into the package's
    `tools` directory, where choco shims every `.exe` it holds.
  checksum64(sha256: string): this
    The zip's SHA-256 (required; 64 hex digits) — checked by choco before
    anything is unpacked (`checksum64`, with `checksumType64 = 'sha256'`).

class ChocolateyPublishSettings
  Settings for publishing a package.

  package_?: ChocolateyPackage
    The rendered package to pack and push. Set by {@link package}.
  nupkg_?: string
    A `.nupkg` already built. Set by {@link nupkg}.
  apiKey_?: string
    The API key. Set by {@link apiKey}.
  source_: string
    The source to push to. Set by {@link source}.
  toolPath_?: string
    The `choco` binary to run. Set by {@link toolPath}.
  package(value: ChocolateyPackage): this
    The package to publish — what `ChocolateyTasks.package` rendered. It is
    packed in a temporary directory and the `.nupkg` pushed. Set this or
    {@link nupkg}, not both.
  nupkg(path: PathLike): this
    A `.nupkg` already built, pushed as it is. Set this or {@link package}.
  apiKey(value: string): this
    The source's API key — for the community repository, the one on
    `https://community.chocolatey.org/account`. Masked in every rendering of
    the push and in its errors. When unset, choco uses the key saved for the
    source with `choco apikey add`.
  source(url: string): this
    The source to push to (`https`), defaulting to the community repository,
    `https://push.chocolatey.org/`. An internal feed's push URL works too.
  toolPath(path: PathLike): this
    The `choco` to run, when it is not on `PATH`.

class ChocolateyVerifyJobSettings
  Settings for the package-verification CI job.

  target_?: TargetBuilder
    The target the job runs. Set by {@link target}.
  runners_: string[]
    The runner labels the job fans out over. Set by {@link runners}.
  target(value: TargetBuilder): this
    The target to run (required) — one that calls `ChocolateyTasks.verify`,
    or otherwise installs, checks and uninstalls the package.
  runners(...labels: string[]): this
    The runner labels to verify on, replacing the default `windows-latest` —
    e.g. `"windows-2022", "windows-2025"` to cover both images. Each must be
    a Windows runner with Chocolatey installed.

class ChocolateyVerifySettings
  Settings for verifying a rendered package.

  package_?: ChocolateyPackage
    The package to verify. Set by {@link package}.
  binary_?: string
    The shim to run once installed. Set by {@link binary}.
  args_: string[]
    The arguments to run it with. Set by {@link command}.
  expectation_?: ChocolateyVerifyExpectation
    What its output must contain. Set by {@link expectVersion}/{@link expectOutput}.
  toolPath_?: string
    The `choco` binary to run. Set by {@link toolPath}.
  package(value: ChocolateyPackage): this
    The package to verify (required) — what `ChocolateyTasks.package` rendered.
  binary(name: string): this
    The command the package puts on `PATH` (required), e.g. `app` — choco
    names each shim after the `.exe` it found in the zip.
  command(...args: string[]): this
    The arguments to run the binary with, e.g. `"--version"`.
  expectVersion(): this
    Require the binary's output to contain the package version.
  expectOutput(text: string): this
    Require the binary's output to contain `text`.
  toolPath(path: PathLike): this
    The `choco` to run, when it is not on `PATH`.

interface ChocoTasksApi
  The shape of {@link ChocoTasks}.

  run(configure?: Configure<ChocoSettings>): Promise<CommandOutput>
    Run any `choco` command, built with `.command(...)`/`.flag(...)`.
  pack(configure?: Configure<ChocoPackSettings>): Promise<CommandOutput>
    Build a `.nupkg` from a `.nuspec` (`choco pack`).
  push(configure?: Configure<ChocoPushSettings>): Promise<CommandOutput>
    Upload a `.nupkg` to a source (`choco push`); the API key is masked.
  install(configure: Configure<ChocoInstallSettings>): Promise<CommandOutput>
    Install packages (`choco install`).
  uninstall(configure: Configure<ChocoUninstallSettings>): Promise<CommandOutput>
    Uninstall packages (`choco uninstall`).
  apikey(configure?: Configure<ChocoApikeySettings>): Promise<CommandOutput>
    List, save or remove a source's API key (`choco apikey`).

interface ChocolateyPackage
  A rendered Chocolatey package: its identity, and the files that make it up,
  keyed by their path relative to the package directory —
  `<id>.nuspec` and `tools/chocolateyinstall.ps1`.

  Plain data, so it can be written to disk, compared, or handed to
  `ChocolateyTasks.verify` and `ChocolateyTasks.publish`, which write it to a
  temporary directory and pack it there.

  readonly id: string
    The package id.
  readonly version: string
    The package version.
  readonly files: Readonly<Record<string, string>>
    Each file's content, keyed by its `/`-separated relative path.

interface ChocolateyPublishResult
  What a `ChocolateyTasks.publish` call pushed, and where.

  source: string
    The source pushed to.
  nupkg: string
    The file name of the `.nupkg` pushed, e.g. `app.1.2.3.nupkg`.

interface ChocolateyTasksApi
  The shape of {@link ChocolateyTasks}.

  package(configure: Configure<ChocolateyPackageSettings>): ChocolateyPackage
    The files of a package that installs a prebuilt binary from a zip on a
    release: `<id>.nuspec` and `tools/chocolateyinstall.ps1`. Pure: nothing
    is read or written.

    @throws {Error}
        naming the setter whose value is missing or invalid.

  verify(configure: Configure<ChocolateyVerifySettings>): Promise<void>
    Pack a rendered package in a temporary directory, install it from there,
    run the binary it puts on `PATH`, then uninstall it and remove the
    directory — the cleanup runs whether or not the install and check
    succeeded.
  publish(configure: Configure<ChocolateyPublishSettings>): Promise<ChocolateyPublishResult>
    Push a package — rendered, or a `.nupkg` already built — to the community
    repository or another source, with its API key masked.
  verifyJob(configure: Configure<ChocolateyVerifyJobSettings>): CiInvocation
    The CI job that runs a verifying target on Windows runners, ready to
    list in `cicd({ invokes: [...] })`.

type ChocoApikeyAction = "list" | "add" | "remove"
  What `choco apikey` does: list the saved keys, save one, or remove one.

type ChocolateyVerifyExpectation = { kind: "version"; } | { kind: "output"; text: string; }
  What the binary's output must contain: the package version, or a text.
````

</details>

<!-- ZUKE:API:END -->
