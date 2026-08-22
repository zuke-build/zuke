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

and scaffold Zuke into any project with `zuke setup`.
@module

async function main(args: string[], host: SetupHost, prompter: Prompter, docRunner: DocRunner): Promise<number>
  The CLI entry point. Returns a process exit code; `host`/`prompter`/`docRunner`
  are injectable for testing.

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

interface SetupHost
  Injected side effects, so {@link runSetup} is unit-testable.

  exists(path: string): Promise<boolean>
    Whether a path exists.
  isDirectory(path: string): Promise<boolean>
    Whether a path exists and is a directory (a reserved-name collision).
  readText(path: string): Promise<string>
    Read a file as UTF-8 text.
  writeText(path: string, content: string): Promise<void>
    Write UTF-8 text to a file, creating or truncating it.
  chmod(path: string, mode: number): Promise<void>
    Set a file's permission bits (may be unsupported on some platforms).
  log(message: string): void
    Emit a line of progress output.

type DocRunner = (denoArgs: string[]) => Promise<number>
  Runs `deno doc <args>` — the injectable subprocess seam for
  {@link commandDoc}, so the command is testable without spawning `deno`.

type ImportSource = "package.json" | "Makefile"
  The kinds of project `zuke import` can read.
````

</details>

<!-- ZUKE:API:END -->
