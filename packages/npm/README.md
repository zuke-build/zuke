# @zuke/npm

Typed `npm` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Typed tasks cover the everyday npm surface; arguments stay
a discrete argv array, so command construction is injection-free.

```ts
import { NpmTasks } from "jsr:@zuke/npm";

await NpmTasks.ci((s) => s.omit("dev"));
await NpmTasks.run((s) => s.script("build").workspace("app"));
await NpmTasks.publish((s) => s.access("public").provenance());
```

Tasks, by what they do:

| Area                | Tasks                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Dependencies        | `install`, `ci`, `uninstall`, `update`, `dedupe`, `prune`, `rebuild`, `link` |
| Running             | `run`, `test`, `exec`                                                        |
| Publishing          | `publish`, `pack`, `version`, `unpublish`, `deprecate`, `distTag`            |
| Registry            | `view`, `ping`, `whoami`, `access`, `owner`, `token`                         |
| Inspection          | `ls`, `outdated`, `audit`, `sbom`                                            |
| Project & npm state | `init`, `pkg`, `config`, `cache`                                             |

## Shared flags

Every task accepts the flags npm reads as _configuration_ — `.registry()`,
`.json()`, `.logLevel()`, `.global()`, `.prefix()`, `.userconfig()` — because
npm itself accepts them on any command. The commands that understand workspaces
share `.workspace()` (repeatable), `.workspaces()`, and
`.includeWorkspaceRoot()`; naming one workspace _and_ all of them is refused
rather than passed on.

## Tasks that hand back values

Most tasks resolve to the raw `CommandOutput`. These four run a machine-readable
form and parse it, so a target reads npm's answer instead of scraping stdout:

```ts
const stale = await NpmTasks.outdatedEntries(); // { name, current, wanted, latest }[]
const audit = await NpmTasks.auditSummary(); // counts per severity
const version = await NpmTasks.pkgGet("version"); // one package.json field
const who = await NpmTasks.whoamiName(); // undefined when logged out
```

Two npm behaviours are handled rather than surfaced as failures: `npm outdated`
and `npm audit` exit non-zero _because_ they found something, which is the
answer being asked for, and `npm whoami` exits non-zero when logged out. All
four narrow npm's JSON with type guards rather than casting, so a payload from a
different npm version, or an HTML error page from a proxy, reads as "nothing to
report" instead of throwing.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/npm` — typed `NpmTasks` wrappers for the `npm` CLI, for use in Zuke
build targets (including builds that drive Node projects).

```ts
import { NpmTasks } from "jsr:@zuke/npm";

await NpmTasks.ci();
await NpmTasks.run((s) => s.script("build"));
const stale = await NpmTasks.outdatedEntries();
```

Typed tasks cover the everyday npm surface — installing, running scripts,
publishing, registry administration, inspection, and the project's own
files. A handful hand back parsed values rather than raw output:
`outdatedEntries`, `auditSummary`, `pkgGet`, and `whoamiName`.
@module

function parsePkgField(stdout: string, key: string): string | undefined
  The scalar `npm pkg get <key>` reported, or `undefined` when the field is
  unset or is not a scalar.

  npm answers with JSON, so a string field arrives quoted, a missing one
  arrives as `{}`, and asking within a workspace (or for several keys) yields
  an object keyed by what was asked for — this reads all three. An object or
  array field yields `undefined`, because there is no single string to hand
  back.

  Not part of the package's public surface — exported for its unit test.

async function readPkgField(key: string, configure?: Configure<NpmPkgSettings>): Promise<string | undefined>
  Run `npm pkg get <key> --json` and read the field out of it. Backs
  {@link "./npm.ts".NpmTasks.pkgGet}.

async function readWhoami(configure?: Configure<NpmWhoamiSettings>): Promise<string | undefined>
  Read the authenticated user's name, or `undefined` when the registry does
  not recognise this machine. Backs {@link "./npm.ts".NpmTasks.whoamiName}.

  Being logged out is an answer, not a failure — a release target asks so it
  can report the missing credential itself, rather than dying on npm's exit
  code partway through.

const NpmTasks: NpmTasksApi
  Typed task functions for the `npm` CLI.

class NpmAccessSettings extends NpmSettings
  Settings for `npm access`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  listPackages(owner?: string, pkg?: string): this
    List the packages a user, scope, or team can reach (`access list packages`).
  listCollaborators(pkg?: string, user?: string): this
    List a package's collaborators (`access list collaborators`).
  getStatus(pkg?: string): this
    Read whether a package is public or private (`access get status`), the default.
  setStatus(level: "public" | "private", pkg?: string): this
    Set a package public or private (`access set status=<level>`).
  setMfa(mode: "none" | "publish" | "automation", pkg?: string): this
    Require two-factor auth for publishing (`access set mfa=<mode>`).
  grant(permission: "read-only" | "read-write", team: string, pkg?: string): this
    Give a team access (`access grant <permission> <scope:team>`).
  revoke(team: string, pkg?: string): this
    Take a team's access away (`access revoke <scope:team>`).
  otp(code: string): this
    Provide a one-time password (`--otp=`).
  override protected subcommandArgs(): string[]
    Assemble the `npm access` argv.

class NpmAuditSettings extends NpmWorkspaceSettings
  Settings for `npm audit`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  fix(): this
    Install compatible updates for what it finds (`npm audit fix`).
  signatures(): this
    Verify the registry signatures of what is installed (`npm audit signatures`).
  auditLevel(level: "info" | "low" | "moderate" | "high" | "critical" | "none"): this
    The severity at which the command fails
    (`--audit-level=<info|low|moderate|high|critical|none>`).
  omit(...types: NpmOmitType[]): this
    Skip a dependency group (`--omit=<group>`); repeatable.
  include(...types: NpmIncludeType[]): this
    Keep a dependency group npm would otherwise omit (`--include=<group>`); repeatable.
  packageLockOnly(): this
    Audit the lockfile without touching `node_modules` (`--package-lock-only`).
  dryRun(): this
    Report what a fix would change without changing it (`--dry-run`).
  override protected subcommandArgs(): string[]
    Assemble the `npm audit` argv.

class NpmCacheSettings extends NpmSettings
  Settings for `npm cache`. Pick the operation with {@link add},
  {@link clean}, {@link ls}, or {@link verify}.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  add(...specs: string[]): this
    Add a package to the cache (`cache add <spec>`).
  clean(key?: string): this
    Empty the cache (`cache clean`). npm refuses this without `--force`, so
    pair it with {@link force} — see the error this reports otherwise.
  ls(...specs: string[]): this
    List what the cache holds (`cache ls`).
  verify(): this
    Check and compact the cache (`cache verify`), the default.
  cache(path: PathLike): this
    Use a specific cache directory (`--cache=<path>`).
  force(): this
    Confirm a clean npm would otherwise refuse (`--force`).
  override protected subcommandArgs(): string[]
    Assemble the `npm cache` argv.

class NpmCiSettings extends NpmDependencySettings
  Settings for `npm ci`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  noAudit(): this
    Skip the audit npm runs after installing (`--no-audit`).
  noFund(): this
    Skip the funding message (`--no-fund`).
  override protected subcommandArgs(): string[]
    Assemble the `npm ci` argv.

class NpmConfigSettings extends NpmSettings
  Settings for `npm config`. Pick the operation with {@link get}, {@link set},
  {@link deleteKeys}, {@link list}, or {@link fix}.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  get(...keys: string[]): this
    Read config keys (`config get <key>...`).
  set(...assignments: string[]): this
    Write config keys (`config set <key>=<value>...`).
  deleteKeys(...keys: string[]): this
    Remove config keys (`config delete <key>...`).
  list(): this
    List the effective configuration (`config list`).
  fix(): this
    Repair invalid config entries (`config fix`).
  location(where: "global" | "user" | "project"): this
    Which file to read or write (`--location=<global|user|project>`).
  long(): this
    Include defaults in a listing (`--long`).
  override protected subcommandArgs(): string[]
    Assemble the `npm config` argv.

class NpmDedupeSettings extends NpmDependencySettings
  Settings for `npm dedupe`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  dryRun(): this
    Report what would move without changing the tree (`--dry-run`).
  override protected subcommandArgs(): string[]
    Assemble the `npm dedupe` argv.

abstract class NpmDependencySettings extends NpmWorkspaceSettings
  Shared base for the install-shaped commands: the `--omit`/`--include`
  dependency-group selectors npm accepts on all of them, plus the package
  specs most of them take.

  packages(...specs: string[]): this
    Package specs the command operates on (positional); repeatable.
  omit(...types: NpmOmitType[]): this
    Skip a dependency group (`--omit=<group>`); repeatable.
  include(...types: NpmIncludeType[]): this
    Keep a dependency group npm would otherwise omit (`--include=<group>`); repeatable.
  ignoreScripts(): this
    Do not run lifecycle scripts (`--ignore-scripts`).
  foregroundScripts(): this
    Show lifecycle-script output as it runs (`--foreground-scripts`).
  protected get packageSpecs(): readonly string[]
    The package specs given, for the subclasses that must require them.
  protected dependencyArgs(): string[]
    The dependency-group and lifecycle-script flags these commands share.
  override protected onOutput(output: CommandOutput): void
    Report `Added`, `Removed`, `Changed` (and `Vulnerabilities` when audited) onto the build summary.

class NpmDeprecateSettings extends NpmSettings
  Settings for `npm deprecate`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  spec(value: string): this
    The package spec to deprecate, e.g. `app@<2` (required).
  message(text: string): this
    The warning installers will see (required). An empty message is how npm
    un-deprecates a version, so it must be given deliberately rather than
    by omission.
  otp(code: string): this
    Provide a one-time password (`--otp=`).
  override protected subcommandArgs(): string[]
    Assemble the `npm deprecate` argv.

class NpmDistTagSettings extends NpmWorkspaceSettings
  Settings for `npm dist-tag`. Pick the subcommand with {@link add},
  {@link rm}, or {@link ls}.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  add(spec: string, tag?: string): this
    Point a tag at a published version (`dist-tag add <pkg@version> [<tag>]`).
    The spec must carry the version; a tag cannot point at a range. With no
    tag npm uses `latest`, as it does on the command line.
  rm(spec: string, tag: string): this
    Remove a tag (`dist-tag rm <pkg> <tag>`).
  ls(spec?: string): this
    List a package's tags (`dist-tag ls [<pkg>]`), the default.
  override protected subcommandArgs(): string[]
    Assemble the `npm dist-tag` argv.

class NpmExecSettings extends NpmWorkspaceSettings
  Settings for `npm exec`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  command(name: string): this
    The command to execute (required).
  package(spec: string): this
    The package providing the command (`--package=`).
  yes(): this
    Skip the install prompt (`--yes`).
  no(): this
    Refuse to install anything (`--no`), so the command runs only if it is
    already present — what a hermetic CI step wants instead of a silent fetch.
  execArgs(...args: Array<string | number>): this
    Arguments forwarded to the command (after `--`).
  override protected subcommandArgs(): string[]
    Assemble the `npm exec` argv.

class NpmInitSettings extends NpmWorkspaceSettings
  Settings for `npm init`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  initializer(spec: string): this
    The initializer package to run, e.g. `vite` for `npm init vite`
    (positional). With none, npm writes a `package.json` itself.
  yes(): this
    Accept the defaults instead of prompting (`--yes`).
  scope(name: string): this
    Scope the created package (`--scope=<@scope>`).
  initArgs(...args: Array<string | number>): this
    Arguments forwarded to the initializer (after `--`).
  override protected subcommandArgs(): string[]
    Assemble the `npm init` argv.

class NpmInstallSettings extends NpmDependencySettings
  Settings for `npm install`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  saveDev(): this
    Save to devDependencies (`--save-dev`).
  saveOptional(): this
    Save to optionalDependencies (`--save-optional`).
  savePeer(): this
    Save to peerDependencies (`--save-peer`).
  saveExact(): this
    Pin exact versions (`--save-exact`).
  noSave(): this
    Install without recording the dependency (`--no-save`).
  installStrategy(strategy: "hoisted" | "nested" | "shallow" | "linked"): this
    How npm lays out the tree (`--install-strategy=<strategy>`).
  noAudit(): this
    Skip the audit npm runs after installing (`--no-audit`).
  noFund(): this
    Skip the funding message (`--no-fund`).
  override protected subcommandArgs(): string[]
    Assemble the `npm install` argv.

class NpmLinkSettings extends NpmDependencySettings
  Settings for `npm link`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  saveDev(): this
    Record the linked package in devDependencies (`--save-dev`).
  override protected subcommandArgs(): string[]
    Assemble the `npm link` argv.

class NpmLsSettings extends NpmWorkspaceSettings
  Settings for `npm ls`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  spec(value: string): this
    Limit the listing to one package spec (positional).
  depth(levels: number): this
    How deep to walk the tree (`--depth=<n>`); `0` lists direct dependencies.
  all(): this
    Show every dependency, not just the top level (`--all`).
  long(): this
    Include extended information (`--long`).
  parseable(): this
    Emit one line per package, tab-separated (`--parseable`).
  omit(...types: NpmOmitType[]): this
    Skip a dependency group (`--omit=<group>`); repeatable.
  override protected subcommandArgs(): string[]
    Assemble the `npm ls` argv.

class NpmOutdatedSettings extends NpmWorkspaceSettings
  Settings for `npm outdated`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  packages(...specs: string[]): this
    Limit the report to these package specs (positional); repeatable.
  all(): this
    Report transitive dependencies too (`--all`).
  long(): this
    Include the package type and homepage (`--long`).
  override protected subcommandArgs(): string[]
    Assemble the `npm outdated` argv.

class NpmOwnerSettings extends NpmWorkspaceSettings
  Settings for `npm owner`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  add(user: string, pkg: string): this
    Add a maintainer (`owner add <user> <pkg>`).
  rm(user: string, pkg: string): this
    Remove a maintainer (`owner rm <user> <pkg>`).
  ls(pkg: string): this
    List a package's maintainers (`owner ls <pkg>`).
  otp(code: string): this
    Provide a one-time password (`--otp=`).
  override protected subcommandArgs(): string[]
    Assemble the `npm owner` argv.

class NpmPackSettings extends NpmWorkspaceSettings
  Settings for `npm pack`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  packages(...specs: string[]): this
    Package specs to pack (positional); defaults to the current project.
  packDestination(dir: PathLike): this
    Where to write the tarball (`--pack-destination=<dir>`).
  dryRun(): this
    Report what would be packed without writing a tarball (`--dry-run`).
  override protected subcommandArgs(): string[]
    Assemble the `npm pack` argv.

class NpmPingSettings extends NpmSettings
  Settings for `npm ping`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  override protected subcommandArgs(): string[]
    Assemble the `npm ping` argv.

class NpmPkgSettings extends NpmWorkspaceSettings
  Settings for `npm pkg`. Pick the operation with {@link get}, {@link set},
  {@link deleteKeys}, or {@link fix}.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  get(...keys: string[]): this
    Read one or more `package.json` fields (`pkg get <key>...`).
  set(...assignments: string[]): this
    Write fields (`pkg set <key>=<value>...`). Each argument is npm's own
    `key=value` form, which is also how it addresses arrays and nested keys.
  deleteKeys(...keys: string[]): this
    Remove fields (`pkg delete <key>...`).
  fix(): this
    Repair what npm can correct automatically (`pkg fix`).
  force(): this
    Skip npm's confirmation for a destructive edit (`--force`).
  override protected subcommandArgs(): string[]
    Assemble the `npm pkg` argv.

class NpmPruneSettings extends NpmDependencySettings
  Settings for `npm prune`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  dryRun(): this
    Report what would be removed without removing it (`--dry-run`).
  override protected subcommandArgs(): string[]
    Assemble the `npm prune` argv.

class NpmPublishSettings extends NpmWorkspaceSettings
  Settings for `npm publish`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  tag(name: string): this
    Publish under a dist-tag (`--tag=`).
  access(level: NpmAccess): this
    Set the package access level (`--access=`).
  dryRun(): this
    Report what would be published without uploading (`--dry-run`).
  otp(code: string): this
    Provide a one-time password (`--otp=`).
  provenance(): this
    Publish with a provenance attestation (`--provenance`), which npm can
    generate from a trusted CI run — the supply-chain signal a consumer can
    verify against the workflow that built the tarball.
  override protected subcommandArgs(): string[]
    Assemble the `npm publish` argv.

class NpmRebuildSettings extends NpmDependencySettings
  Settings for `npm rebuild`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  noBinLinks(): this
    Do not create the `.bin` symlinks (`--no-bin-links`).
  override protected subcommandArgs(): string[]
    Assemble the `npm rebuild` argv.

class NpmRunSettings extends NpmWorkspaceSettings
  Settings for `npm run`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  script(name: string): this
    The package.json script to run (required).
  ifPresent(): this
    Do not fail when the script is missing (`--if-present`).
  scriptArgs(...args: Array<string | number>): this
    Arguments forwarded to the script (after `--`).
  override protected subcommandArgs(): string[]
    Assemble the `npm run` argv.

class NpmSbomSettings extends NpmWorkspaceSettings
  Settings for `npm sbom`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  sbomFormat(format: "cyclonedx" | "spdx"): this
    Which document to emit (`--sbom-format=<cyclonedx|spdx>`), required by npm.
  sbomType(type: "library" | "application" | "framework"): this
    What the project is (`--sbom-type=<library|application|framework>`).
  omit(...types: NpmOmitType[]): this
    Skip a dependency group (`--omit=<group>`); repeatable.
  packageLockOnly(): this
    Build the document from the lockfile alone (`--package-lock-only`).
  override protected subcommandArgs(): string[]
    Assemble the `npm sbom` argv.

abstract class NpmSettings extends ToolSettings
  Shared base for every `npm` subcommand: the binary, and the flags npm treats
  as configuration rather than as a command's own — it accepts these on any
  command, which is why they live here instead of being repeated.

  abstract protected readonly taskName: string
    The `NpmTasks` method this settings class backs, for the errors it
    reports — so a failure names the task a build called, not the class. A
    field rather than a method: it is the class's identity, not a
    computation.
  override protected defaultTool(): string
    The default binary: `npm` resolved from PATH.
  abstract protected subcommandArgs(): string[]
    The subcommand argv, before the shared config flags are appended.
  registry(url: string): this
    Use a specific registry (`--registry=<url>`).
  json(): this
    Emit JSON (`--json`). The value-returning tasks set this themselves; a
    caller reaches for it to parse output the wrapper does not yet model.
  logLevel(level: NpmLogLevel): this
    How much npm prints (`--loglevel=<level>`).
  global(): this
    Operate on the global install rather than the project (`--global`).
  prefix(path: PathLike): this
    Run as if npm were started in this directory (`--prefix=<path>`).
  userconfig(path: PathLike): this
    Read this user config file rather than `~/.npmrc` (`--userconfig=<path>`).
  protected configArgs(): string[]
    The config flags, rendered after the subcommand's own arguments.
  override protected buildArgs(): string[]
    Assemble the `npm` argv: the subcommand, then the shared config flags —
    but before any `--`, because everything after that separator belongs to
    the script or the executed command rather than to npm. Appending blindly
    would hand `--json` to the script and leave npm's own output unchanged.

class NpmTestSettings extends NpmWorkspaceSettings
  Settings for `npm test`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  testArgs(...args: Array<string | number>): this
    Arguments forwarded to the test script (after `--`).
  override protected subcommandArgs(): string[]
    Assemble the `npm test` argv.

class NpmTokenSettings extends NpmSettings
  Settings for `npm token`. Pick the subcommand with {@link list},
  {@link create}, or {@link revoke}.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  list(): this
    List this account's tokens (`token list`), the default.
  create(): this
    Create a token (`token create`).
  revoke(idOrToken: string): this
    Revoke a token by id or value (`token revoke <id|token>`).
  readOnly(): this
    Create a token that cannot publish (`--read-only`).
  cidr(...ranges: string[]): this
    Restrict a created token to these ranges (`--cidr=<range>`); repeatable.
  otp(code: string): this
    Provide a one-time password (`--otp=`).
  override protected subcommandArgs(): string[]
    Assemble the `npm token` argv.

class NpmUninstallSettings extends NpmDependencySettings
  Settings for `npm uninstall`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  noSave(): this
    Remove the package without updating `package.json` (`--no-save`).
  override protected subcommandArgs(): string[]
    Assemble the `npm uninstall` argv.

class NpmUnpublishSettings extends NpmWorkspaceSettings
  Settings for `npm unpublish`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  spec(value: string): this
    The package spec to remove, e.g. `app@1.2.3` (positional).
  force(): this
    Confirm an unpublish npm would otherwise refuse (`--force`) — removing a
    whole package, or a version outside the 72-hour window.
  dryRun(): this
    Report what would be removed without removing it (`--dry-run`).
  override protected subcommandArgs(): string[]
    Assemble the `npm unpublish` argv.

class NpmUpdateSettings extends NpmDependencySettings
  Settings for `npm update`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  save(): this
    Write the updated ranges back to `package.json` (`--save`).
  override protected subcommandArgs(): string[]
    Assemble the `npm update` argv.

class NpmVersionSettings extends NpmWorkspaceSettings
  Settings for `npm version`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  bump(value: string): this
    The bump: `patch` | `minor` | `major` or an explicit semver (required).
  message(text: string): this
    Commit message; `%s` expands to the new version (`--message`).
  noGitTagVersion(): this
    Do not create a git commit and tag (`--no-git-tag-version`).
  preid(id: string): this
    The prerelease identifier for a `pre*` bump (`--preid=<id>`), e.g. `rc`.
  allowSameVersion(): this
    Accept a bump to the version already set (`--allow-same-version`).
  override protected subcommandArgs(): string[]
    Assemble the `npm version` argv.

class NpmViewSettings extends NpmWorkspaceSettings
  Settings for `npm view`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  spec(value: string): this
    The package spec to read, e.g. `react@18` (positional).
  field(...names: string[]): this
    A field of the registry metadata to print, e.g. `version` or
    `dist-tags.latest` (positional); repeatable. With none, npm prints the
    whole record.
  override protected subcommandArgs(): string[]
    Assemble the `npm view` argv.

class NpmWhoamiSettings extends NpmSettings
  Settings for `npm whoami`.

  override protected readonly taskName: string
    The `NpmTasks` method this backs.
  override protected subcommandArgs(): string[]
    Assemble the `npm whoami` argv.

abstract class NpmWorkspaceSettings extends NpmSettings
  Base for the npm commands that accept workspace selection. `--workspace`
  names one (repeatable) and `--workspaces` means all of them; npm takes one
  or the other, and this refuses the combination rather than passing on a
  command whose meaning is ambiguous.

  workspace(...names: string[]): this
    Run in this workspace (`--workspace=<name>`); repeatable.
  workspaces(): this
    Run in every workspace (`--workspaces`). Mutually exclusive with
    {@link workspace} — setting both is a build error.
  includeWorkspaceRoot(): this
    Include the root project alongside the workspaces (`--include-workspace-root`).
  protected workspaceArgs(): string[]
    The workspace flags, after refusing a selection that names both one
    workspace and all of them.

interface NpmAuditSummary
  How many vulnerabilities `npm audit` found, by severity.

  info: number
    Informational findings.
  low: number
    Low-severity findings.
  moderate: number
    Moderate-severity findings.
  high: number
    High-severity findings.
  critical: number
    Critical-severity findings.
  total: number
    Every finding, whatever its severity.

interface NpmOutdatedEntry
  One dependency `npm outdated` reports as behind.

  name: string
    The package name.
  current?: string
    The version installed now, absent when the package is missing entirely.
  wanted?: string
    The newest version the range in `package.json` allows.
  latest?: string
    The newest version published.
  location?: string
    Where in the tree it is installed.
  dependent?: string
    The package that depends on it.

interface NpmTasksApi
  The shape of {@link NpmTasks}.

  install(configure?: Configure<NpmInstallSettings>): Promise<CommandOutput>
    Install dependencies: `npm install`.
  ci(configure?: Configure<NpmCiSettings>): Promise<CommandOutput>
    Clean install from the lockfile: `npm ci`.
  uninstall(configure?: Configure<NpmUninstallSettings>): Promise<CommandOutput>
    Remove dependencies: `npm uninstall`.
  update(configure?: Configure<NpmUpdateSettings>): Promise<CommandOutput>
    Update dependencies within their ranges: `npm update`.
  dedupe(configure?: Configure<NpmDedupeSettings>): Promise<CommandOutput>
    Flatten duplicated packages: `npm dedupe`.
  prune(configure?: Configure<NpmPruneSettings>): Promise<CommandOutput>
    Remove packages nothing depends on: `npm prune`.
  rebuild(configure?: Configure<NpmRebuildSettings>): Promise<CommandOutput>
    Rebuild native packages: `npm rebuild`.
  link(configure?: Configure<NpmLinkSettings>): Promise<CommandOutput>
    Symlink a package for local development: `npm link`.
  run(configure?: Configure<NpmRunSettings>): Promise<CommandOutput>
    Run a package.json script: `npm run`.
  test(configure?: Configure<NpmTestSettings>): Promise<CommandOutput>
    Run the project's test script: `npm test`.
  exec(configure?: Configure<NpmExecSettings>): Promise<CommandOutput>
    Execute a package binary: `npm exec`.
  publish(configure?: Configure<NpmPublishSettings>): Promise<CommandOutput>
    Publish the package: `npm publish`.
  pack(configure?: Configure<NpmPackSettings>): Promise<CommandOutput>
    Build a tarball without publishing it: `npm pack`.
  version(configure?: Configure<NpmVersionSettings>): Promise<CommandOutput>
    Bump the package version: `npm version`.
  unpublish(configure?: Configure<NpmUnpublishSettings>): Promise<CommandOutput>
    Remove a published version: `npm unpublish`.
  deprecate(configure?: Configure<NpmDeprecateSettings>): Promise<CommandOutput>
    Warn installers off a version: `npm deprecate`.
  distTag(configure?: Configure<NpmDistTagSettings>): Promise<CommandOutput>
    Manage dist-tags: `npm dist-tag add|rm|ls`.
  view(configure?: Configure<NpmViewSettings>): Promise<CommandOutput>
    Read registry metadata: `npm view`.
  ping(configure?: Configure<NpmPingSettings>): Promise<CommandOutput>
    Check the registry is reachable: `npm ping`.
  whoami(configure?: Configure<NpmWhoamiSettings>): Promise<CommandOutput>
    Print the authenticated user: `npm whoami`.
  whoamiName(configure?: Configure<NpmWhoamiSettings>): Promise<string | undefined>
    The authenticated user's name, or `undefined` when this machine is not
    logged in — an answer a release target can act on, rather than the
    non-zero exit npm reports.
  access(configure?: Configure<NpmAccessSettings>): Promise<CommandOutput>
    Manage package access: `npm access`.
  owner(configure?: Configure<NpmOwnerSettings>): Promise<CommandOutput>
    Manage package maintainers: `npm owner add|rm|ls`.
  token(configure?: Configure<NpmTokenSettings>): Promise<CommandOutput>
    Manage registry tokens: `npm token list|create|revoke`.
  ls(configure?: Configure<NpmLsSettings>): Promise<CommandOutput>
    List the installed tree: `npm ls`.
  outdated(configure?: Configure<NpmOutdatedSettings>): Promise<CommandOutput>
    Report dependencies behind their latest: `npm outdated`.
  outdatedEntries(configure?: Configure<NpmOutdatedSettings>): Promise<NpmOutdatedEntry[]>
    The outdated dependencies as parsed {@link NpmOutdatedEntry} values. npm
    exits non-zero because something is outdated, so this reads that as the
    answer rather than as a failure; an empty array means everything is
    current.
  audit(configure?: Configure<NpmAuditSettings>): Promise<CommandOutput>
    Audit dependencies for vulnerabilities: `npm audit`.
  auditSummary(configure?: Configure<NpmAuditSettings>): Promise<NpmAuditSummary>
    The audit's vulnerability counts by severity, so a target decides for
    itself what is worth failing on. npm's non-zero exit is the finding, not
    an error.
  sbom(configure?: Configure<NpmSbomSettings>): Promise<CommandOutput>
    Emit a software bill of materials: `npm sbom`.
  init(configure?: Configure<NpmInitSettings>): Promise<CommandOutput>
    Create a package or run an initializer: `npm init`.
  pkg(configure?: Configure<NpmPkgSettings>): Promise<CommandOutput>
    Read or write package.json fields: `npm pkg get|set|delete|fix`.
  pkgGet(key: string, configure?: Configure<NpmPkgSettings>): Promise<string | undefined>
    One `package.json` field as a string, or `undefined` when it is unset or
    is not a scalar — how a build reads its own version without parsing the
    manifest or guessing where it lives.
  config(configure?: Configure<NpmConfigSettings>): Promise<CommandOutput>
    Read or write npm configuration: `npm config get|set|delete|list|fix`.
  cache(configure?: Configure<NpmCacheSettings>): Promise<CommandOutput>
    Maintain the package cache: `npm cache add|clean|ls|verify`.

type NpmAccess = "public" | "restricted"
  An access level accepted by npm's `--access` flag.

type NpmIncludeType = "prod" | "dev" | "optional" | "peer"
  A dependency group accepted by npm's `--include` flag.

type NpmLogLevel = "silent" | "error" | "warn" | "notice" | "http" | "info" | "verbose" | "silly"
  How verbose npm should be (`--loglevel`).

type NpmOmitType = "dev" | "optional" | "peer"
  A dependency group accepted by npm's `--omit` flag.
````

</details>

<!-- ZUKE:API:END -->
