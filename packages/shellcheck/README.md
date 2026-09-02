# @zuke/shellcheck

Typed [ShellCheck](https://www.shellcheck.net/) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { ShellcheckTasks } from "jsr:@zuke/shellcheck";

await ShellcheckTasks.lint((s) =>
  s.shell("sh").severity("warning").paths("sh/lib.sh", "bin/gate")
);
```

## The dialect is the flag that matters

`shell("sh")` is what makes a portability gate mean anything. ShellCheck reads
the shebang otherwise, so a script with `#!/bin/bash` — or none at all — is
analysed as bash, and the POSIX violations the gate exists to catch are never
reported.

`shell`, `severity` and `format` take closed unions rather than bare strings:
ShellCheck rejects anything outside those sets, so a typo is a compile error
instead of a failed run.

## Resolution

`shellcheck` is a native binary, so it resolves from `PATH` — not from
`node_modules/.bin` the way the npm-distributed linters do. A missing binary
surfaces as a `ToolNotFoundError` naming the tool, rather than as a shell error.

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/shellcheck` — typed ShellCheck (https://www.shellcheck.net/) task
wrappers for Zuke builds.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it.

```ts
import { ShellcheckTasks } from "jsr:@zuke/shellcheck";
await ShellcheckTasks.lint((s) =>
  s.shell("sh").severity("warning").paths("sh/lib.sh", "bin/gate")
);
```
@module

const ShellcheckTasks: ShellcheckTasksApi
  Typed task functions for the ShellCheck static analyser.

class ShellcheckSettings extends ToolSettings
  Settings for a `shellcheck` run.

  override protected defaultTool(): string
    The default executable name (`shellcheck`).
  override protected defaultResolution(): ToolResolution
    Resolve the binary from `PATH` — ShellCheck is a native binary (Haskell),
    installed by a package manager rather than into `node_modules/.bin`.
  paths(...values: PathLike[]): this
    Scripts to check (positional); repeatable.
  shell(dialect: ShellcheckShell): this
    The dialect to analyse as (`-s`/`--shell`), overriding the shebang.

    This is the flag that makes a portability gate mean something: a script
    with a `#!/bin/bash` shebang, or none at all, is otherwise checked as
    bash, so the POSIX violations the gate exists to catch go unreported.
  severity(level: ShellcheckSeverity): this
    The lowest severity to report (`-S`/`--severity`).
  format(value: ShellcheckFormat): this
    The output format (`-f`/`--format`).
  exclude(...codes: string[]): this
    Suppress specific checks by code (`-e`/`--exclude`); repeatable. Codes may
    be given with or without the `SC` prefix, as ShellCheck accepts both.
  externalSources(): this
    Follow `source`d files outside the checked set (`-x`/`--external-sources`).
  override protected onOutput(output: CommandOutput): void
    Report `Findings` onto the build summary.
  override protected buildArgs(): string[]
    Assemble the `shellcheck` argv.

interface ShellcheckTasksApi
  The shape of {@link ShellcheckTasks}.

  lint(configure?: Configure<ShellcheckSettings>): Promise<CommandOutput>
    Analyse shell scripts with `shellcheck`.

type ShellcheckFormat = "tty" | "gcc" | "checkstyle" | "diff" | "json" | "json1" | "quiet"
  An output format ShellCheck can emit (`-f`).

type ShellcheckSeverity = "error" | "warning" | "info" | "style"
  The lowest severity ShellCheck reports (`-S`).

type ShellcheckShell = "sh" | "bash" | "dash" | "ksh" | "busybox"
  A shell dialect ShellCheck can analyse (`-s`), overriding the shebang.

  A closed set: ShellCheck rejects anything else outright, so the type does
  the same job the settings class does — the mistake is a compile error rather
  than a failed run.
````

</details>

<!-- ZUKE:API:END -->
