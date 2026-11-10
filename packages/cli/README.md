# @zuke/cli

The `zuke` command-line tool — scaffold
[Zuke](https://github.com/zuke-build/zuke#readme) into any project.

```sh
deno install -A -g -n zuke jsr:@zuke/cli
zuke setup
zuke setup --sdk python   # a build.py, with launchers that run the zuke binary: no Deno
zuke upgrade              # later: move the installed CLI to the latest release
zuke upgrade --engine     # or move a Python project to the latest zuke release
```

The same CLI also ships as a standalone binary that needs no Deno up front:
`brew install zuke-build/tap/zuke` on macOS and Linux, and `choco install zuke`
on Windows (not Authenticode-signed yet). Update those with `brew upgrade zuke`
or `choco upgrade zuke`. See
[installing](https://github.com/zuke-build/zuke/blob/master/docs/install.md). A
Python project runs on that binary alone: its launchers download the pinned
release, checksum-verified, so neither it nor its CI ever needs Deno.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/cli` — the `zuke` command. Install it globally with

```sh
deno install -A -g -n zuke jsr:@zuke/cli
```

scaffold Zuke into any project with `zuke setup`, then run its build from
anywhere inside the project with `zuke <target>`: every command that is not
the CLI's own (`setup`, `import`, `doc`, `upgrade`, and the project
commands `add`, `remove`, `cache` and `relock`) is forwarded to the
nearest `zuke.ts`, exactly as the `./zuke` launcher would run it. Update the
installed CLI itself with `zuke upgrade`, and manage a project's
dependencies and lock with `zuke add`, `remove`, `cache` and `relock`.
@module

function binaryMain(args: string[], engine: EmbeddedEngine): Promise<number>
  The compiled `zuke` binary's entry point: {@link main} with every default
  and the `engine` the binary carries, so a project with no `zuke.ts` runs on
  it with no Deno installed.

async function main(args: string[], host: SetupHost, prompter: Prompter, docRunner: DocRunner, starActions: StarActions, buildRunner: BuildRunner, buildProbe: BuildProbe, upgradeHost: UpgradeHost, projectHost: ProjectHost, engine?: EmbeddedEngine): Promise<number>
  The CLI entry point. Returns a process exit code; `host`, `prompter`,
  `docRunner`, `starActions`, `buildRunner`, `buildProbe`, `upgradeHost` and
  `projectHost` are injectable for testing. `engine` is the engine the
  compiled binary carries, absent under `deno run`: see {@link binaryMain}.

function parseImportFlags(args: string[]): ImportFlags
  Parse the argument list following `zuke import`.

function parseSetupFlags(args: string[]): SetupFlags
  Parse the argument list following `zuke setup`.

const EMBEDDED_ENGINE_ENV: "ZUKE_EMBEDDED_ENGINE"
  Set to `1` in the environment of the process that runs a hosted build on
  the binary's own engine: the compiled entry reads it, before the CLI does,
  and removes it, so nothing the build starts inherits it.

const FORWARDED_ENV: "ZUKE_FORWARDED"
  Set to `1` in a launcher's environment, so a launcher that itself calls the
  global `zuke` gets the bare `deno run` instead of itself again, endlessly.

const defaultPrompter: Prompter
  The real {@link Prompter}, backed by Deno's `prompt`/`confirm`.

interface BinaryPin
  The pinned `zuke` release, the engine inside it, and each archive's digest.

  readonly version: string
    The release, without the tag's `cli-v` prefix, e.g. `"2.4.0"`.
  readonly engine: string
    The `@zuke/engine` release compiled into it.
  readonly checksums: Readonly<Record<BinaryTarget, string>>
    Lowercase hex SHA-256 of each target's archive.

interface BuildLocation
  Where a forwarded command runs, and how.

  root: string
    The absolute repository root: the directory holding `zuke.json`.
  frozen: boolean
    Whether a `deno.lock` sits at the root, so the run passes `--frozen`.
  launcher: string | null
    The absolute path of the executable `zuke` launcher at the root, run in
    place of `deno run` — or `null` when there is none, or the platform
    reports no file mode to tell (Windows).
  build: string
    The build file's name: the one the root's `zuke.json` names in its
    `build` field, `zuke.ts` when it names none.
  engine: string | null
    The `@zuke/engine` release that runs the build when the root has no
    build file: the `engine` field of its `zuke.json`, which then describes a
    build another SDK hosts. `null` when the root has its own build file.

interface BuildProbe
  The filesystem questions discovery asks, injectable so the walk and its
  trust gate are testable without a filesystem or a second user.

  exists(path: string): Promise<boolean>
    Whether a path exists (the link itself, not its target).
  ownership(path: string): Promise<Ownership | null>
    The owner and mode of what a path resolves to, or `null` when nothing is
    there.
  realPath(path: string): Promise<string>
    The path with every link resolved.
  readLink(path: string): Promise<string | null>
    The target a symlink names, exactly as written in the link (possibly
    relative to the link's directory), or `null` when `path` is not a link.
  uid(): number | null
    The current user's numeric id, or `null` where the platform has none.
  readText(path: string): Promise<string>
    The text of a file.

interface EmbeddedEngine
  The engine a compiled `zuke` carries, as its entry point describes it.

  readonly version: string
    The `@zuke/engine` release compiled in, such as `1.3.0`.
  readonly program: string
    The executable to start in engine mode: the binary itself.
  serves(pin: string): boolean
    Whether the compiled-in release serves the one `zuke.json` pins.

interface EnginePinHost
  What moving the pin reaches outside the process, injectable for tests.

  entry(path: string): Promise<"file" | "missing" | "other">
    What is at `path`, not following a link: a regular `file`, nothing
    (`missing`), or `other` — a directory, or a link, which a write would
    follow out of the project.
  readText(path: string): Promise<string>
    Read a regular text file.
  writeText(path: string, text: string): Promise<void>
    Write a text file, replacing what is there.
  cliMeta(): Promise<unknown>
    Fetch and parse `@zuke/cli`'s JSR `meta.json`, whose latest is the newest zuke.
  binaryPin(version: string): Promise<BinaryPin>
    Resolve the pin of a `zuke` release.

interface ImportFlags extends SetupFlags
  Flags accepted by `zuke import` — the setup flags plus `--from`.

  from?: ImportSource
    Force a source (`package.json`, `makefile` or `pyproject`); auto-detected
    when unset.

interface InstallHost
  The process facts {@link installSource} reads, injectable so each install
  kind is testable from a single process.

  standalone(): boolean
    Whether this process is a `deno compile` binary (`Deno.build.standalone`).
  mainModule(): string
    The running CLI's main module (`Deno.mainModule`). Deno reports a JSR
    program by its specifier, `jsr:@zuke/cli` or `jsr:@zuke/cli@<version>`.
  execPath(): string
    The running executable's path (`Deno.execPath()`).
  realPath(path: string): Promise<string>
    `path` with every symbolic link resolved (`Deno.realPath`).

interface Ownership
  What the trust gate needs to know about a filesystem entry.

  uid: number | null
    The numeric owner, or `null` where the platform reports none (Windows).
  mode: number | null
    The permission bits, or `null` where the platform reports none.

interface ProjectHost
  What the project commands reach outside the process, injectable so they
  are testable without a real `deno`.

  entry(path: string): Promise<"file" | "missing" | "other">
    What is at `path`, not following a link: a regular `file`, nothing
    (`missing`), or `other` — a directory, or a link, which a write would
    follow out of the project.
  readText(path: string): Promise<string>
    Read a text file, rejecting when it cannot be read.
  writeText(path: string, text: string): Promise<void>
    Write a text file, replacing what is there.
  remove(path: string): Promise<void>
    Remove a file.
  deno(denoArgs: string[], cwd: string): Promise<number>
    Run `deno <denoArgs>` in `cwd`, returning its exit code.
  denoVersion(): string
    The version of the Deno that runs the command.

interface Prompter
  The interactive surface, injectable so the wizard is testable without a TTY.

  interactive(): boolean
    Whether prompts should be shown (i.e. stdin is a terminal).
  ask(question: string, fallback: string): string
    Ask a free-text question, returning `fallback` if unanswered.
  confirm(question: string): boolean
    Ask a yes/no question.

interface SdkSetupOptions
  What `--sdk python` scaffolds against.

  pin: BinaryPin
    The `zuke` release the launchers run; `zuke.json` pins the engine it
    carries.

interface SetupFlags
  Flags accepted by `zuke setup`.

  force: boolean
    Overwrite existing files.
  yes: boolean
    Skip prompts and accept defaults.
  name?: string
    Build class name for the starter build file.
  buildFile?: string
    The TypeScript build file's name (`--build-file`). Unset: ask, else `build.ts`.
  dir?: string
    Directory to scaffold into (defaults to the current directory).
  launcherName?: string
    Base name for the launcher scripts, when `zuke` is taken by a directory.
  mcp: boolean
    Also write `.mcp.json`, registering the build's MCP server for agent clients.
  allowRun: boolean
    Register that server with `--allow-run`, so the agent may execute targets. Implies `mcp`.
  bootstrapDeno?: boolean
    Which launchers to scaffold: `true` (`--bootstrap`) for ones that
    download their pinned, checksum-verified runtime when it is missing —
    Deno for a `zuke.ts` build, the `zuke` binary for a hosted one — `false`
    (`--no-bootstrap`) for ones that require it on `PATH` and fail closed.
    Unset: ask when interactive, else take the default (bootstrap).
  sdk?: string
    The SDK whose build to scaffold (`--sdk python`): a `build.py` the engine
    runs, in place of a `zuke.ts`. Unset: a TypeScript build.
  zuke?: string
    The `zuke` release an SDK build's launchers run (`--zuke`), whose engine
    `zuke.json` pins. Unset: this zuke's own release.

interface SetupHost
  Injected side effects, so {@link runSetup} is unit-testable.

  exists(path: string): Promise<boolean>
    Whether a path exists.
  isDirectory(path: string): Promise<boolean>
    Whether a path exists and is a directory (a reserved-name collision).
  isSymlink(path: string): Promise<boolean>
    Whether a path is a symbolic link, without following it. Scaffolding
    refuses to write through one: the writes below follow links, so a link
    planted at a scaffold name by the very repository being set up would
    redirect them outside the target directory.

    The guard covers the names scaffolding chooses, which is where the hazard
    is — the caller never asked for `.gitignore` to be written, so a repository
    redirecting it is a decision nobody made. It reports what is there when it
    runs, and a link planted after it would escape it; that is why
    {@link SetupHost.writeText} does not write through a link either, so the
    refusal is the friendly answer rather than the only defence.

    Two things stay out of scope. The directory the caller names with `--dir`
    is the caller's to name, symlink or not. And a hard link is
    indistinguishable from the file it shares, so no probe can see one; git
    cannot check one out either, which is what keeps it out of the threat this
    guards.
  readText(path: string): Promise<string>
    Read a file as UTF-8 text.
  isTerminal?(): boolean
    Whether stdout is an interactive terminal, which decides whether the
    CLI's own output is rich. Optional: an implementation without it is
    asked through Deno, the way every other process decides.
  writeText(path: string, content: string): Promise<void>
    Write UTF-8 text to a file, creating or replacing it.

    An implementation must not write through a symbolic link standing at
    `path`: the scaffolder's confinement to its target directory rests on this,
    and the pre-write {@link SetupHost.isSymlink} check alone cannot carry it,
    since a link can appear after the check.
  chmod(path: string, mode: number): Promise<void>
    Set a file's permission bits (may be unsupported on some platforms).
  log(message: string): void
    Emit a line of progress output.

interface StarActions
  The side effects behind {@link promptStar}, injectable so tests never spawn
  `gh` or a browser.

  ghAuthenticated(): Promise<boolean>
    Whether the `gh` CLI is installed and holds a login.
  starWithGh(): Promise<void>
    Star the Zuke repository through `gh api`.
  openBrowser(url: string): Promise<boolean>
    Open `url` in the default browser; `false` when it could not launch.

interface UpgradeHost extends InstallHost
  What `zuke upgrade` reaches outside the process, injectable so the
  command is testable without the network or a real reinstall.

  binDir(): string | undefined
    The directory `deno install -g` installs into (`<root>/bin`):
    `DENO_INSTALL_ROOT`, else `~/.deno`, as Deno resolves it. `undefined`
    when the environment names neither as an absolute path.
  exists(path: string): Promise<boolean>
    Whether `path` exists.
  windows(): boolean
    Whether this is Windows, where the running shim is a `.cmd` file.
  meta(): Promise<unknown>
    Fetch and parse `@zuke/cli`'s JSR `meta.json`.
  binaryPin(version: string): Promise<BinaryPin>
    Resolve the pin of `zuke` release `version`, which `zuke setup --sdk`
    scaffolds a hosted build's launchers with and `zuke upgrade --engine`
    moves them to: its archives' digests and the engine it carries.
  install(denoArgs: string[]): Promise<number>
    Run `deno <denoArgs>` to reinstall, returning its exit code.
  denoVersion(): string
    The version of the Deno that runs the reinstall: the one running this
    CLI, since `zuke upgrade` only ever runs from a JSR install under Deno.
  readText(path: string): Promise<string>
    Read a text file, rejecting when it cannot be read.

type BinaryTarget = "aarch64-apple-darwin" | "x86_64-apple-darwin" | "aarch64-unknown-linux-gnu" | "x86_64-unknown-linux-gnu" | "x86_64-pc-windows-msvc"
  A platform a `zuke` release ships a binary for, as its archive names it.

type BuildRunner = (root: string, args: string[], program?: string, env?: Readonly<Record<string, string>>) => Promise<number>
  Runs `program <args>` from `root` — Deno when `program` is omitted, else the
  project's launcher at that path — and resolves to its exit code: the
  injectable subprocess seam, so the forwarding is testable without a build.
  `env` adds variables to the environment the child inherits.

type DocRunner = (denoArgs: string[]) => Promise<number>
  Runs `deno doc <args>` — the injectable subprocess seam for
  {@link commandDoc}, so the command is testable without spawning `deno`.

type ImportSource = "package.json" | "Makefile" | "pyproject.toml"
  The kinds of project `zuke import` can read.
````

</details>

<!-- ZUKE:API:END -->
