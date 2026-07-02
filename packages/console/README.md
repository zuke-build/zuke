# @zuke/console

Task-shaped console output for [Zuke](https://github.com/zuke-build/zuke#readme)
builds — so a build never reaches for `console.log`. A levelled logger, an
inline markup language with a semantic theme, and the primitives Zuke draws its
own output with (`line`, `rule`, `box`, `table`, and the target `header` /
`summary`).

```ts
import { ConsoleTasks as Log } from "jsr:@zuke/console";

Log.rule("Deploy");
Log.info("pushing [bold]core@1.2.0[/]");
Log.success("[green]✔[/] published 4 packages");
Log.warn("coverage [yellow]94.2%[/] — below gate");
Log.error("type-check failed", { error: err });
```

## Logger

`trace` · `debug` · `info` · `success` · `warn` · `error` — an NUKE-style
severity ladder. The active level (from `ZUKE_LOG_LEVEL`, or
`ConsoleTasks.configure({ level })`) gates what prints; `warn`/`error` go to
stderr and become `::warning::` / `::error::` annotations under GitHub Actions.

## Markup, not chalk-chaining

Styling lives inside the string as data — `"[red bold]oops[/]"` — so the API
stays declarative and there are no chainable style objects to thread around.
Tags nest and restore the surrounding style; a literal bracket is doubled
(`[[`). Semantic theme tokens (`[success]`, `[warn]`, `[muted]`) resolve through
the active {@link Theme}, and `NO_COLOR` / a non-TTY / CI turn colour off
automatically.

To drop arbitrary or untrusted text into a message — a file path, a captured
error, user input — wrap it in `ConsoleTasks.escape(...)` so its `[`/`]` render
literally instead of being parsed as tags (like Spectre.Console's
`Markup.Escape`):

```ts
Log.info(`found ${Log.escape(userInput)} in ${Log.escape(path)}`);
```

## Primitives — the same ones Zuke draws with

`ConsoleTasks.line()`, `.rule("Title")`, `.box(text, { title })`, and
`.table(columns, rows)` are width- and colour-aware. `.header(name)` and
`.summary(reports, totalMs, ok)` render the exact per-target banner and
end-of-build table Zuke prints, so a build can reuse them directly.

## Restyle a build's own output

A build can route the executor's banners through this package — Zuke dogfoods
this in its own build:

```ts
import { run } from "jsr:@zuke/core";
import { consoleRenderer } from "jsr:@zuke/console";

await run(MyBuild, { renderer: consoleRenderer });
```

`createConsoleRenderer(theme)` builds a renderer for a custom palette.

## Inspiration & credits

`@zuke/console` stands on the shoulders of the console libraries that made build
output pleasant to read:

- [**Spectre.Console**](https://spectreconsole.net/) (.NET) — the inline
  `[style]…[/]` markup language, the semantic theme, and the `rule` / `box` /
  `table` widgets.
- [**NUKE**](https://nuke.build/)'s `Logger` (.NET) — the levelled
  `Info`/`Success`/`Warn`/`Error`/`Trace` API and its CI-aware output.
- [**chalk**](https://github.com/chalk/chalk) (Node) — the ergonomics of
  terminal styling that set the bar, reimagined here as markup rather than
  method chaining.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/console` — task-shaped console output for Zuke builds, so a build never
reaches for `console.log`. A levelled logger (NUKE-style), Spectre.Console-style
markup and a semantic theme, and the primitives Zuke draws its own output with
(`line`, `rule`, `box`, `table`, target `header`/`summary`).

```ts
import { ConsoleTasks as Log } from "jsr:@zuke/console";

Log.rule("Deploy");
Log.info("pushing [bold]core@1.2.0[/]");
Log.success("published 4 packages");
```

A build can also route the executor's own banners through this package:

```ts
import { run } from "jsr:@zuke/core";
import { consoleRenderer } from "jsr:@zuke/console";

await run(MyBuild, { renderer: consoleRenderer });
```
@module

function createConsoleRenderer(theme: Theme): Renderer
  Build a {@link Renderer} that draws target headers with `theme`'s palette.

const ConsoleTasks: ConsoleTasksApi
  Task-shaped console output. A single namespaced object (like `FileTasks`)
  rather than loose helpers: logging methods, structural primitives, and
  configuration all hang off `ConsoleTasks`.

const consoleRenderer: Renderer
  The default console renderer, using {@link defaultTheme}.

const defaultTheme: Theme
  The default palette — a conventional terminal colour scheme.

interface ConsoleOptions
  Options accepted when reconfiguring {@link ConsoleTasks}.

  level?: LogLevel
    The minimum severity to print.
  sink?: Sink
    Where rendered lines go (default: stdout/stderr).
  theme?: Theme
    A custom colour palette.
  color?: boolean
    Force ANSI colour on or off (default: auto-detected).
  width?: number
    Force the rule/box width (default: the terminal width).
  github?: boolean
    Force GitHub Actions output formatting (default: auto-detected).

interface ConsoleTasksApi
  The shape of {@link ConsoleTasks}.

  info(message: string): void
    Log an informational message (markup-aware).
  log(message: string): void
    Alias for {@link ConsoleTasksApi.info}.
  success(message: string): void
    Log a success/completion message.
  warn(message: string): void
    Log a warning (a `::warning::` annotation under GitHub Actions).
  error(message: string, options?: ErrorOptions): void
    Log an error, optionally appending a thrown value's message.
  debug(message: string): void
    Log a debug diagnostic (shown only at `debug`/`trace` level).
  trace(message: string): void
    Log the most verbose trace output (shown only at `trace` level).
  escape(text: string): string
    Escape `[`/`]` in `text` so it renders literally rather than as markup —
    for embedding arbitrary or untrusted strings in a message.
  line(options?: LineOptions): void
    Print a horizontal rule spanning the width.
  rule(title?: string, options?: RuleOptions): void
    Print a rule, optionally with a centred title.
  box(content: string | string[], options?: BoxOptions): void
    Print a bordered panel around `content` (markup-aware).
  table(columns: TableColumn[], rows: string[][], options?: TableOptions): void
    Print an aligned table; header and cell text may contain markup.
  header(name: string): void
    Print the ruled banner Zuke opens a target's section with.
  summary(reports: TargetReport[], totalMs: number, ok: boolean): void
    Print the end-of-build summary table and closing verdict.
  group(name: string): void
    Open a collapsible group; close it with {@link ConsoleTasksApi.endGroup}.
  endGroup(): void
    Close the group opened by {@link ConsoleTasksApi.group}.
  configure(options: ConsoleOptions): void
    Reconfigure logging (level, sink, theme, colour, width, Actions mode).
  level(): LogLevel
    The active minimum severity.
  reset(): void
    Reset all configuration to defaults (level re-seeded from the env).

interface ErrorOptions
  Options for {@link ConsoleTasks.error}.

  error?: unknown
    An error whose message is appended as a dimmed detail line.

interface RuleOptions extends LineOptions
  Options for {@link ConsoleTasks.rule}.

interface Sink
  A destination for rendered lines. Overridable to capture output in tests.

  out(line: string): void
    Write a line to standard output.
  err(line: string): void
    Write a line to standard error.

interface Theme
  The colour palette. Each semantic token maps to the ANSI styles applied to
  text (or markup) tagged with that name.

  info: StyleName[]
    Informational messages.
  success: StyleName[]
    Success/completion messages.
  warn: StyleName[]
    Warnings.
  error: StyleName[]
    Errors and failures.
  debug: StyleName[]
    Debug diagnostics.
  trace: StyleName[]
    The most verbose trace output.
  muted: StyleName[]
    De-emphasised, secondary text.

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent"
  A severity threshold. Messages below the active level are suppressed.
````

</details>

<!-- ZUKE:API:END -->
