# @zuke/homebrew

Ship a prebuilt binary through a [Homebrew](https://brew.sh) tap from a
[Zuke](https://github.com/zuke-build/zuke#readme) build. `BrewTasks` is a typed
wrapper for the `brew` CLI; `HomebrewTasks` renders a formula, publishes it to
the tap, verifies that it installs, and declares the CI job that verifies it on
macOS and Linux.

```ts
import { HomebrewTasks } from "@zuke/homebrew";

const ruby = HomebrewTasks.formula((s) =>
  s.name("app").description("Command-line tool for widgets")
    .homepage("https://example.com").license("MIT")
    .binary((b) => b.os("macos").arch("arm").url(macArmUrl).sha256(macArmSha))
    .binary((b) => b.os("macos").arch("intel").url(macX64Url).sha256(macX64Sha))
    .binary((b) => b.os("linux").arch("intel").url(linuxUrl).sha256(linuxSha))
    .install("app")
    .test((t) => t.command("--version").expectVersion())
);

const result = await HomebrewTasks.publish((s) =>
  s.tap("acme/tap").formula("app", ruby).token(tapToken).message("app 1.2.3")
);
// result.state: "created" | "updated" | "unchanged"
```

## Rendering a formula

`HomebrewTasks.formula` returns the Ruby source of a formula that installs
prebuilt archives — one per OS and CPU family — and is pure: nothing is read or
written.

```ruby
class App < Formula
  desc "Command-line tool for widgets"
  homepage "https://example.com"
  license "MIT"

  on_macos do
    on_arm do
      url "https://…/app-aarch64-apple-darwin.tar.gz"
      sha256 "…"
    end
    …
  end

  def install
    bin.install "app"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/app --version")
  end
end
```

- **Deterministic.** `on_macos` before `on_linux`, `on_arm` before `on_intel`,
  whatever order the binaries were declared in, so re-rendering an unchanged
  release produces the same bytes — which is what lets `publish` report
  `unchanged`.
- **Version only when needed.** Homebrew reads the version from the archive URL,
  and `brew audit` rejects a `version` line that repeats it. A GitHub release
  asset (`…/releases/download/v1.2.3/…`) carries it, so leave `.version(...)`
  unset; set it only for a URL with no version in it. The test's
  `expectVersion()` works either way.
- **Validated.** The class name is derived from `.name(...)` exactly as
  Homebrew's `Formulary.class_s` does (`app-cli` → `AppCli`, `app@2` → `AppAT2`,
  `python@3.12` → `PythonAT312`), and a name whose class would not be a Ruby
  constant is refused. URLs must be `https` with no userinfo; a SHA-256 is 64
  lowercase hex digits; an OS/arch pair appears once; `bin.install` takes plain
  file names. The description is held to `brew audit`'s rules: at most 80
  characters, a capital first letter, no leading article or formula name, no
  trailing period. Every refusal names the setter.
- **Injection-safe.** Every value goes through one Ruby string escaper — quotes,
  backslashes, `#{…}`/`#@`/`#$` interpolation, line breaks, control and
  invisible characters — so a value can never leave its string literal. The
  test's command line is shell-quoted word by word before it is escaped, and a
  test with no expectation runs through `system` with an argv, with no shell.

## Publishing to a tap

`HomebrewTasks.publish` writes `Formula/<name>.rb` into the tap's GitHub
repository through `GhTasks.createOrUpdateFile` from
[`@zuke/gh`](https://jsr.io/@zuke/gh) — its transport, token handling and path
guards, not a second client. The tap may be given as `owner/homebrew-x` or as
brew's short `owner/x`; both name the repository `owner/homebrew-x`.

It is idempotent: the file's git blob SHA is compared with the new content's,
and a formula already in the tap is reported `unchanged` without a commit. A
write that loses a race is re-read once, so two runs publishing the same formula
both succeed. The token needs `contents: write` on the tap; it defaults to
`GITHUB_TOKEN`, but the repository never defaults to `GITHUB_REPOSITORY` — a
publish only ever writes to the tap it names. The source must define the class
Homebrew will load from `Formula/<name>.rb`, or the publish is refused.

## Verifying a formula

```ts
verifyFormula = target().executes(() =>
  HomebrewTasks.verify((s) => s.formulaFile("dist/app.rb").name("app"))
);
release = cicd({
  invokes: [HomebrewTasks.verifyJob((s) => s.target(this.verifyFormula))],
});
```

Current Homebrew refuses to install a formula from a file path ("Homebrew
requires formulae to be in a tap"; `HOMEBREW_FORBID_PACKAGES_FROM_PATHS` is on
unless `HOMEBREW_DEVELOPER` is set). So `verify` installs it the way a user
would, from a tap: it creates a throwaway local tap with
`brew tap-new --no-git`, copies the file into its `Formula/` directory (found
with `brew --repository <tap>`), then runs `brew install --formula <tap>/<name>`
and `brew test <tap>/<name>`. The uninstall and `brew untap --force` always run
— whether or not the install and test passed — and an error in the cleanup is
raised alongside the one that caused it, never instead of it. Every call runs
with `HOMEBREW_NO_AUTO_UPDATE=1`.

`verifyJob` returns a plain `CiInvocation` for `cicd({ invokes: [...] })`: a
`macos-latest` + `ubuntu-latest` matrix (`.runners(...)` to change it) that lets
every platform finish, with a step that puts Homebrew on `PATH` on Linux
runners, where it is installed but not on `PATH`. Spread it to add anything the
pipeline decides, such as
`{ ...HomebrewTasks.verifyJob(…), timeoutMinutes: 20 }`.

## The brew CLI

```ts
import { BrewTasks } from "@zuke/homebrew";

await BrewTasks.audit((s) => s.strict().online().formulae("acme/tap/app"));
await BrewTasks.install((s) => s.formula().formulae("acme/tap/app"));
const info = await BrewTasks.info((s) => s.formulae("app"));
info.formulae[0]?.installed; // ["1.2.3"]
```

`install`, `uninstall`, `test`, `audit`, `style`, `livecheck`, `tap`, `untap`,
`tapNew` and `repository` mirror brew's subcommands and flags; `info` runs with
`--json=v2` and returns the formulae parsed (name, versions, installed
versions); `run` builds anything else. `brew` resolves from `PATH`. Arguments
stay a discrete argv array, and an operand that starts with `-` is refused
rather than read as an option.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/homebrew` — ship a prebuilt binary through a
Homebrew (https://brew.sh) tap from a Zuke build: `BrewTasks` wraps the
`brew` CLI, and `HomebrewTasks` renders a formula, publishes it to the tap,
verifies it installs, and declares the CI job that verifies it on macOS and
Linux.

```ts
import { HomebrewTasks } from "@zuke/homebrew";

const ruby = HomebrewTasks.formula((s) =>
  s.name("app").description("Command-line tool for widgets")
    .homepage("https://example.com").license("MIT")
    .binary((b) => b.os("macos").arch("arm").url(macArmUrl).sha256(macArmSha))
    .binary((b) => b.os("linux").arch("intel").url(linuxUrl).sha256(linuxSha))
    .install("app")
    .test((t) => t.command("--version").expectVersion())
);
await HomebrewTasks.publish((s) =>
  s.tap("acme/tap").formula("app", ruby).token(tapToken).message("app 1.2.3")
);
```
@module

const BrewTasks: BrewTasksApi
  Typed task functions for the Homebrew `brew` CLI.

const HomebrewTasks: HomebrewTasksApi
  Tasks for shipping a prebuilt binary through a Homebrew tap.

class BrewAuditSettings extends BrewCommandSettings
  Settings for `brew audit`. With no formulae named, brew audits every
  formula it can find.

  formulae(...names: string[]): this
    Formulae to audit; repeatable.
  strict(): this
    Run the additional, stricter checks (`--strict`).
  online(): this
    Run the additional checks that need the network (`--online`).
  new(): this
    Run the checks for a formula new to Homebrew (`--new`), which imply
    `--strict` and `--online`.
  formula(): this
    Treat every name as a formula, not a cask (`--formula`).
  protected verb(): string
    The subcommand: `audit`.
  protected commandFlags(): string[]
    The flags set, in brew's manual order.

abstract class BrewCommandSettings extends BrewSettings
  Base for a typed `brew` subcommand: the verb, then its own flags, then its
  operands — the order brew's own usage lines print. Anything added through
  the inherited `.command(...)`/`.flag(...)` escape hatches follows.

  Operands are refused when they start with `-`. A formula or tap name never
  does, and brew would read one that did as an option — so `--force` passed as
  a "formula" would change what the command does rather than fail.

  abstract protected verb(): string
    The subcommand, e.g. `install`.
  abstract protected commandFlags(): string[]
    This subcommand's own flags.
  protected addOperands(values: readonly string[]): void
    Append operands — formula, tap or file names — in order.
  protected get operands(): readonly string[]
    The operands added so far.
  override protected leadingTokens(): string[]
    The verb, the flags and the operands lead the argv.

class BrewInfoSettings extends BrewCommandSettings
  Settings for `brew info`, which always runs with `--json=v2` — the
  documented, machine-readable form — so the task can hand back a
  {@link BrewInfo}.

  formulae(...names: string[]): this
    Formulae to describe; repeatable.
  formula(): this
    Treat every name as a formula, not a cask (`--formula`).
  installed(): this
    Describe every installed formula (`--installed`), instead of naming them.
  protected verb(): string
    The subcommand: `info`.
  protected commandFlags(): string[]
    `--json=v2`, then the flags set.

class BrewInstallSettings extends BrewCommandSettings
  Settings for `brew install`. A formula is named by its name, its
  `user/tap/name`, or — where Homebrew still allows it — a local `.rb` path.

  formulae(...names: string[]): this
    Formulae to install (required); repeatable.
  formula(): this
    Treat every name as a formula, not a cask (`--formula`).
  buildFromSource(): this
    Compile from source even when a bottle exists (`--build-from-source`).
  force(): this
    Install without checking for keg-only or unmigrated versions (`--force`).
  verbose(): this
    Print the verification and post-install steps (`--verbose`).
  protected verb(): string
    The subcommand: `install`.
  protected commandFlags(): string[]
    The flags set, in brew's manual order.

class BrewLivecheckSettings extends BrewCommandSettings
  Settings for `brew livecheck`, which looks for a newer upstream version.

  formulae(...names: string[]): this
    Formulae to check; repeatable.
  json(): this
    Print the result as JSON (`--json`).
  newerOnly(): this
    Report only versions newer than the installed one (`--newer-only`).
  formula(): this
    Check only formulae, not casks (`--formula`).
  protected verb(): string
    The subcommand: `livecheck`.
  protected commandFlags(): string[]
    The flags set, in brew's manual order.

class BrewRepositorySettings extends BrewCommandSettings
  Settings for `brew --repository`, which prints where Homebrew's repository
  is — or, given a tap, where that tap's directory is.

  tap(name: string): this
    The tap whose directory to print, `user/repo`.
  protected verb(): string
    The "subcommand": brew spells this one as a flag, `--repository`.
  protected commandFlags(): string[]
    It takes no flags of its own.

class BrewSettings extends SubcommandSettings
  Settings for a `brew` invocation.

  override protected defaultTool(): string
    The default executable name (`brew`).
  override protected defaultResolution(): ToolResolution
    Resolve `brew` from `PATH` — Homebrew is a native install under its own
    prefix, never a `node_modules` package.

class BrewStyleSettings extends BrewCommandSettings
  Settings for `brew style`, Homebrew's RuboCop check. With nothing named it
  checks Homebrew's own code and every tap.

  targets(...values: string[]): this
    Files, taps or formulae to check; repeatable.
  fix(): this
    Correct what RuboCop can correct (`--fix`).
  protected verb(): string
    The subcommand: `style`.
  protected commandFlags(): string[]
    The flags set.

class BrewTapNewSettings extends BrewCommandSettings
  Settings for `brew tap-new`, which generates a new, local tap.

  name(tap: string): this
    The tap to create (required), `user/repo`.
  noGit(): this
    Do not initialise a git repository for it (`--no-git`).
  branch(name: string): this
    Initialise git on this branch, with its CI workflows (`--branch=`).
  protected verb(): string
    The subcommand: `tap-new`.
  protected commandFlags(): string[]
    The flags set.

class BrewTapSettings extends BrewCommandSettings
  Settings for `brew tap`, which adds a formula repository.

  name(tap: string, url?: string): this
    The tap to add (required), `user/repo` — brew clones
    `github.com/user/homebrew-repo` — and optionally the URL to clone it from
    instead.
  force(): this
    Tap a core tap even under API mode (`--force`).
  protected verb(): string
    The subcommand: `tap`.
  protected commandFlags(): string[]
    The flags set.

class BrewTestSettings extends BrewCommandSettings
  Settings for `brew test`, which runs a formula's `test do` block.

  formulae(...names: string[]): this
    Installed formulae to test (required); repeatable.
  force(): this
    Test even when the formula is unlinked (`--force`).
  keepTmp(): this
    Keep the temporary files the test created (`--keep-tmp`).
  retry(): this
    Retry once if the test fails (`--retry`).
  protected verb(): string
    The subcommand: `test`.
  protected commandFlags(): string[]
    The flags set, in brew's manual order.

class BrewUninstallSettings extends BrewCommandSettings
  Settings for `brew uninstall`.

  formulae(...names: string[]): this
    Formulae to uninstall (required); repeatable.
  formula(): this
    Treat every name as a formula, not a cask (`--formula`).
  force(): this
    Delete every installed version (`--force`).
  ignoreDependencies(): this
    Uninstall even when another formula depends on it (`--ignore-dependencies`).
  protected verb(): string
    The subcommand: `uninstall`.
  protected commandFlags(): string[]
    The flags set, in brew's manual order.

class BrewUntapSettings extends BrewCommandSettings
  Settings for `brew untap`, which removes taps.

  taps(...names: string[]): this
    Taps to remove (required), `user/repo`; repeatable.
  force(): this
    Uninstall the tap's formulae first, rather than refusing (`--force`).
  protected verb(): string
    The subcommand: `untap`.
  protected commandFlags(): string[]
    The flags set.

class FormulaBinarySettings
  Settings for one prebuilt binary of a formula, rendered as
  `on_<os> do on_<arch> do url "…" sha256 "…" end end`.

  ```ts
  s.binary((b) =>
    b.os("macos").arch("arm").url("https://…/app-aarch64-apple-darwin.tar.gz")
      .sha256("…")
  )
  ```

  os_?: FormulaOs
    The operating system. Set by {@link os}.
  arch_?: FormulaArch
    The CPU family. Set by {@link arch}.
  url_?: string
    The download URL. Set by {@link url}.
  sha256_?: string
    The archive's SHA-256. Set by {@link sha256}.
  os(value: FormulaOs): this
    The operating system the archive runs on (required).
  arch(value: FormulaArch): this
    The CPU family the archive runs on (required).
  url(value: string): this
    Where Homebrew downloads the archive (required; must be `https`).
  sha256(value: string): this
    The archive's SHA-256 (required; 64 lowercase hex digits).
  resolve_(): FormulaBinary
    Validate the settings into a {@link FormulaBinary}.

    @throws {Error}
        naming the missing or malformed field.

class FormulaSettings
  Settings for a formula that installs prebuilt binaries.

  name_?: string
    The formula name. Set by {@link name}.
  description_?: string
    The one-line description. Set by {@link description}.
  homepage_?: string
    The project's homepage. Set by {@link homepage}.
  version_?: string
    The version. Set by {@link version}.
  license_?: string
    The SPDX license. Set by {@link license}.
  binaries_: FormulaBinarySettings[]
    The binaries, one per platform. Added by {@link binary}.
  install_: string[]
    The files `bin.install` places. Added by {@link install}.
  caveats_?: string
    The caveats text. Set by {@link caveats}.
  test_?: FormulaTestSettings
    The `test do` block. Set by {@link test}.
  name(value: string): this
    The formula name (required), e.g. `app` or `app@2`: a lowercase letter,
    then lowercase letters, digits, `-`, `_`, `.`, `+` or `@`. The Ruby class
    name is derived from it exactly as Homebrew does — `app-cli` defines
    `AppCli`, `app@2` defines `AppAT2`.
  description(text: string): this
    The one-line description (`desc`, required), held to `brew audit`'s rules:
    at most 80 characters, starting with a capital letter, not with an
    article or the formula's name, and with no trailing period.
  homepage(url: string): this
    The project's homepage (required; must be `https`).
  version(value: string): this
    The version, e.g. `1.2.3` — set it only when Homebrew cannot read it from
    the archive URLs.

    Homebrew detects a formula's version from its URL, and `brew audit`
    rejects a `version` line that repeats what it detected ("version … is
    redundant with version scanned from URL"). A GitHub release asset such as
    `…/releases/download/v1.2.3/app-aarch64-apple-darwin.tar.gz` carries it, so
    leave this unset there; `expectVersion()` in the test still works, against
    the detected version. Set it for a URL with no version in it, such as a
    `…/releases/latest/download/…` link or a content-addressed store.
  license(spdx: string): this
    The SPDX license identifier, e.g. `MIT`.
  binary(configure: Configure<FormulaBinarySettings>): this
    Add a prebuilt archive for one OS and CPU family. Call once per platform;
    at least one is required, and each OS/arch pair at most once.
  install(...files: string[]): this
    Files from the archive to place in the formula's `bin` (`bin.install`);
    at least one is required. Plain file names only — no directory part.
  caveats(text: string): this
    Text Homebrew prints after installing (`def caveats`).
  test(configure: Configure<FormulaTestSettings>): this
    The formula's `test do` block, which `brew test` runs. Without one,
    `brew test` (and so `HomebrewTasks.verify`) fails.

class FormulaTestSettings
  Settings for the formula's `test do` block.

  ```ts
  s.test((t) => t.command("--version").expectVersion())
  // test do
  //   assert_match version.to_s, shell_output("#{bin}/app --version")
  // end
  ```

  Without an expectation the command only has to succeed, and is run with
  `system` and an argv — no shell at all.

  binary_?: string
    The installed binary to run. Set by {@link binary}.
  args_: string[]
    The arguments to run it with. Set by {@link command}.
  expectation_?: FormulaTestExpectation
    What the output must contain. Set by {@link expectVersion}/{@link expectOutput}.
  binary(name: string): this
    Which installed binary to run. Defaults to the first one the formula
    installs; it must be one of them.
  command(...args: string[]): this
    The arguments to run the binary with, e.g. `"--version"`.
  expectVersion(): this
    Require the output to contain the formula's version.
  expectOutput(text: string): this
    Require the output to contain `text`.
  render_(installed: readonly string[]): string[]
    The block's lines (unindented, without `test do`/`end`), for a formula
    that installs `installed`.

    @throws {Error}
        when {@link binary} names a binary the formula does not
        install.

class HomebrewPublishSettings
  Settings for publishing a formula to a tap.

  tap_?: string
    The tap, as given. Set by {@link tap}.
  name_?: string
    The formula name. Set by {@link formula}.
  source_?: string
    The formula's Ruby source. Set by {@link formula}.
  token_?: string
    The token. Set by {@link token}.
  branch_?: string
    The branch to commit on. Set by {@link branch}.
  message_?: string
    The commit message. Set by {@link message}.
  baseUrl_?: string
    The API root. Set by {@link baseUrl}.
  fetch_?: typeof fetch
    The `fetch` implementation. Set by {@link fetch}.
  tap(value: string): this
    The tap (required): its GitHub repository `owner/homebrew-x`, or brew's
    short form `owner/x`, which names the same repository.
  formula(name: string, source: string): this
    The formula to publish (required): its name, which becomes the file
    `Formula/<name>.rb`, and its Ruby source — typically what
    `HomebrewTasks.formula` rendered.
  token(value: string): this
    The token to write with — needs `contents: write` on the tap repository.
    Defaults to `GITHUB_TOKEN`, which only works when the tap is the
    repository the job runs in; a separate tap needs its own token.
  branch(name: string): this
    The branch to commit on. Defaults to the tap's default branch.
  message(text: string): this
    The commit message. Defaults to `<name>: update formula`.
  baseUrl(url: string): this
    The API root, for GitHub Enterprise.
  fetch(fn: typeof fetch): this
    Override the `fetch` implementation (a test seam).

class HomebrewVerifyJobSettings
  Settings for the formula-verification CI job.

  target_?: TargetBuilder
    The target the job runs. Set by {@link target}.
  runners_: string[]
    The runner labels the job fans out over. Set by {@link runners}.
  target(value: TargetBuilder): this
    The target to run (required) — one that calls `HomebrewTasks.verify`, or
    otherwise installs, tests and uninstalls the formula.
  runners(...labels: string[]): this
    The runner labels to verify on, replacing the default `macos-latest` and
    `ubuntu-latest` — e.g. `"macos-15", "macos-15-intel", "ubuntu-latest"` to
    cover both Mac CPU families. GitHub's ARM Linux runners
    (`ubuntu-24.04-arm`) ship without Homebrew, so they cannot verify a
    formula without installing it first.

class HomebrewVerifySettings
  Settings for verifying a formula file.

  formulaFile_?: string
    The formula file to verify. Set by {@link formulaFile}.
  name_?: string
    The formula's name. Set by {@link name}.
  toolPath_?: string
    The `brew` binary to run. Set by {@link toolPath}.
  formulaFile(path: PathLike): this
    The formula's Ruby source on disk (required), e.g. `dist/app.rb`.
  name(value: string): this
    The formula's name (required) — the class the file defines is derived
    from it, and it is installed and tested under it.
  toolPath(path: PathLike): this
    The `brew` to run, when it is not on `PATH` — on a GitHub Linux runner
    Homebrew is installed but not on `PATH`:
    `/home/linuxbrew/.linuxbrew/bin/brew`.

interface BrewFormulaInfo
  One formula, as `brew info --json=v2` describes it.

  name: string
    The short name, e.g. `app`.
  fullName: string
    The fully qualified name, e.g. `acme/tap/app`.
  tap: string | null
    The tap it comes from, e.g. `acme/tap`, or `null` for a path formula.
  desc: string | null
    The one-line description, or `null` when it has none.
  homepage: string | null
    The homepage, or `null` when it has none.
  versions: BrewFormulaVersions
    The available versions.
  installed: string[]
    The installed versions, oldest first as brew lists them; empty when none.
  linkedKeg: string | null
    The linked keg's version, or `null` when none is linked.
  outdated: boolean
    Whether an installed version is older than the current one.

interface BrewFormulaVersions
  A formula's available versions, as `brew info` reports them.

  stable: string | null
    The stable version, or `null` for a HEAD-only formula.
  head: string | null
    The HEAD version, or `null` when the formula has no HEAD spec.
  bottle: boolean
    Whether a bottle (a prebuilt package) exists for this platform.

interface BrewInfo
  What `brew info --json=v2` reported.

  formulae: BrewFormulaInfo[]
    The formulae, in the order brew printed them.

interface BrewTasksApi
  The shape of {@link BrewTasks}.

  run(configure?: Configure<BrewSettings>): Promise<CommandOutput>
    Run any `brew` command, built with `.command(...)`/`.flag(...)`.
  install(configure: Configure<BrewInstallSettings>): Promise<CommandOutput>
    Install formulae (`brew install`).
  uninstall(configure: Configure<BrewUninstallSettings>): Promise<CommandOutput>
    Uninstall formulae (`brew uninstall`).
  test(configure: Configure<BrewTestSettings>): Promise<CommandOutput>
    Run installed formulae's `test do` blocks (`brew test`).
  audit(configure?: Configure<BrewAuditSettings>): Promise<CommandOutput>
    Audit formulae against Homebrew's rules (`brew audit`).
  style(configure?: Configure<BrewStyleSettings>): Promise<CommandOutput>
    Check formulae against Homebrew's RuboCop style (`brew style`).
  livecheck(configure?: Configure<BrewLivecheckSettings>): Promise<CommandOutput>
    Look for newer upstream versions (`brew livecheck`).
  tap(configure: Configure<BrewTapSettings>): Promise<CommandOutput>
    Add a tap (`brew tap`).
  untap(configure: Configure<BrewUntapSettings>): Promise<CommandOutput>
    Remove taps (`brew untap`).
  tapNew(configure: Configure<BrewTapNewSettings>): Promise<CommandOutput>
    Generate a new local tap (`brew tap-new`).
  repository(configure?: Configure<BrewRepositorySettings>): Promise<string>
    The directory of Homebrew's repository, or of a tap
    (`brew --repository [tap]`), as a path with the trailing newline removed.
  info(configure: Configure<BrewInfoSettings>): Promise<BrewInfo>
    Describe formulae (`brew info --json=v2`), parsed into a {@link BrewInfo}:
    names, versions and the installed versions.

interface FormulaBinary
  A validated binary, as the formula renders it.

  os: FormulaOs
    The operating system.
  arch: FormulaArch
    The CPU family.
  url: string
    The `https` download URL.
  sha256: string
    The archive's SHA-256, 64 lowercase hex digits.

interface HomebrewPublishResult
  What became of a `HomebrewTasks.publish` call.

  state: "created" | "updated" | "unchanged"
    `created` for a formula new to the tap, `updated` for a changed one,
    `unchanged` when the tap already held exactly this formula and nothing
    was committed.
  repo: string
    The tap's GitHub repository, `owner/homebrew-x`.
  path: string
    The formula's path in the tap, `Formula/<name>.rb`.
  commitSha?: string
    The commit that wrote it; absent when the state is `unchanged`.

interface HomebrewTasksApi
  The shape of {@link HomebrewTasks}.

  formula(configure: Configure<FormulaSettings>): string
    The Ruby source of a formula that installs prebuilt binaries — one
    archive per OS and CPU family. Pure: nothing is read or written.

    @throws {Error}
        naming the setter whose value is missing or invalid.

  publish(configure: Configure<HomebrewPublishSettings>): Promise<HomebrewPublishResult>
    Write `Formula/<name>.rb` into a tap repository on GitHub, or leave it
    alone — reporting `unchanged` — when the tap already holds exactly that
    source.
  verify(configure: Configure<HomebrewVerifySettings>): Promise<void>
    Install a formula file through a throwaway local tap, run its test, then
    uninstall it and remove the tap — the cleanup runs whether or not the
    install and test succeeded.
  verifyJob(configure: Configure<HomebrewVerifyJobSettings>): CiInvocation
    The CI job that runs a verifying target across macOS and Linux runners,
    ready to list in `cicd({ invokes: [...] })`.

type FormulaArch = "arm" | "intel"
  The CPU families a formula's `on_<arch>` blocks name.

type FormulaOs = "macos" | "linux"
  The operating systems a formula's `on_<os>` blocks name.

type FormulaTestExpectation = { kind: "version"; } | { kind: "output"; text: string; }
  What a formula test checks the command printed: the version, or a text.
````

</details>

<!-- ZUKE:API:END -->
