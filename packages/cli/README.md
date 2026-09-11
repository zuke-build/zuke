# @zuke/cli

The `zuke` command-line tool — scaffold
[Zuke](https://github.com/zuke-build/zuke#readme) into any project.

```sh
deno install -A -g -n zuke jsr:@zuke/cli
zuke setup
```

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
the CLI's own (`setup`, `import`, `doc`) is forwarded to the nearest
`zuke.ts`, exactly as the `./zuke` launcher would run it.
@module

async function main(args: string[], host: SetupHost, prompter: Prompter, docRunner: DocRunner, starActions: StarActions, buildRunner: BuildRunner): Promise<number>
  The CLI entry point. Returns a process exit code; `host`, `prompter`,
  `docRunner`, `starActions`, and `buildRunner` are injectable for testing.

function parseImportFlags(args: string[]): ImportFlags
  Parse the argument list following `zuke import`.

function parseSetupFlags(args: string[]): SetupFlags
  Parse the argument list following `zuke setup`.

function resolveDocSpec(pkg: string | undefined): string | undefined
  Resolve a `zuke doc` argument to a `deno doc` specifier: a bare package name
  (`core`) becomes `jsr:@zuke/core`, a scoped name (`@scope/pkg`) becomes
  `jsr:@scope/pkg`, and an explicit `jsr:`/`npm:`/`https:`/`file:`/path
  specifier is passed through unchanged. Returns `undefined` for no argument.

const defaultPrompter: Prompter
  The real {@link Prompter}, backed by Deno's `prompt`/`confirm`.

interface BuildLocation
  Where a forwarded command runs, and how.

  root: string
    The absolute repository root: the directory holding `zuke.json`.
  frozen: boolean
    Whether a `deno.lock` sits at the root, so the run passes `--frozen`.

interface ImportFlags extends SetupFlags
  Flags accepted by `zuke import` — the setup flags plus `--from`.

  from?: ImportSource
    Force a source (`package.json` or `makefile`); auto-detected when unset.

interface Prompter
  The interactive surface, injectable so the wizard is testable without a TTY.

  interactive(): boolean
    Whether prompts should be shown (i.e. stdin is a terminal).
  ask(question: string, fallback: string): string
    Ask a free-text question, returning `fallback` if unanswered.
  confirm(question: string): boolean
    Ask a yes/no question.

interface SetupFlags
  Flags accepted by `zuke setup`.

  force: boolean
    Overwrite existing files.
  yes: boolean
    Skip prompts and accept defaults.
  name?: string
    Build class name for the starter `zuke.ts`.
  dir?: string
    Directory to scaffold into (defaults to the current directory).
  launcherName?: string
    Base name for the launcher scripts, when `zuke` is taken by a directory.
  mcp: boolean
    Also write `.mcp.json`, registering the build's MCP server for agent clients.
  allowRun: boolean
    Register that server with `--allow-run`, so the agent may execute targets. Implies `mcp`.
  bootstrapDeno?: boolean
    Which launchers to scaffold: `true` (`--bootstrap-deno`) for ones that
    install a pinned, checksum-verified Deno when none is on `PATH`, `false`
    (`--no-bootstrap-deno`) for ones that require it and fail closed. Unset:
    ask when interactive, else take the default (bootstrap).

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

type BuildRunner = (root: string, denoArgs: string[]) => Promise<number>
  Runs `deno <denoArgs>` from `root` and resolves to its exit code — the
  injectable subprocess seam, so the forwarding is testable without a build.

type DocRunner = (denoArgs: string[]) => Promise<number>
  Runs `deno doc <args>` — the injectable subprocess seam for
  {@link commandDoc}, so the command is testable without spawning `deno`.

type ImportSource = "package.json" | "Makefile"
  The kinds of project `zuke import` can read.
````

</details>

<!-- ZUKE:API:END -->
