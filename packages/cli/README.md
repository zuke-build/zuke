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

async function main(args: string[], host: SetupHost, prompter: Prompter): Promise<number>
  The CLI entry point. Returns a process exit code; `host`/`prompter` are
  injectable for testing.

function parseImportFlags(args: string[]): ImportFlags
  Parse the argument list following `zuke import`.

function parseSetupFlags(args: string[]): SetupFlags
  Parse the argument list following `zuke setup`.

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
````

</details>

<!-- ZUKE:API:END -->
