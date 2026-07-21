# Console output

`@zuke/console` is the output engine behind every Zuke build — the ruled
banners, the coloured status lines, and the aligned **Build Summary** all come
from it. It's also a package you can import directly: a levelled logger with
tag-based markup and a set of layout primitives (`line`, `rule`, `box`,
`table`) that render cleanly to a terminal and degrade gracefully in CI, so a
build never has to reach for `console.log`.

```ts
import { ConsoleTasks as Log } from "jsr:@zuke/console";

Log.rule("Deploy");
Log.info("pushing [bold]core@1.2.0[/]");
Log.success("published 4 packages");
```

The package exports a single namespaced object, `ConsoleTasks` — logging
methods, layout primitives, and configuration all hang off it (like `FileTasks`
in the core library). It's conventional to alias it to `Log`.

## Logging & levels

Seven methods form a severity ladder. `trace`, `debug`, `info`, `log`, and
`success` write to **stdout**; `warn` and `error` write to **stderr**. Every
message accepts [markup](#markup).

```ts
Log.trace("resolved 42 source files");        // most verbose
Log.debug("cache hit for 'check'");
Log.info("pushing [bold]core@1.2.0[/]");       // → stdout
Log.log("a plain line — no icon, no styling"); // alias for info → stdout
Log.success("published [bold]4[/] packages");  // ✔ is added for you
Log.warn("coverage [yellow]94.2%[/] — below gate");  // → stderr
Log.error("type-check failed", { error: err });      // → stderr, prints the cause
```

Each line is prefixed with a level mark: `·` (trace), `›` (debug), `ℹ` (info),
`✔` (success), `⚠` (warn), `✖` (error). `log` is an alias for `info`; `success`
shares `info`'s severity but prints the `✔` mark.

Only messages at or above the active [level](#configuration) are printed — set
it to `"debug"` in CI, `"info"` locally (the default), or `"silent"` to mute
everything, structural output included. The threshold is seeded from the
`ZUKE_LOG_LEVEL` environment variable, falling back to `info` when it is unset
or unrecognised.

### `error({ error })` — appending a cause

`error()` takes an optional `{ error }` so it can print the underlying thrown
value. Its message is appended as a dimmed detail line under the error:

```ts
try {
  await typeCheck();
} catch (err) {
  Log.error("type-check failed", { error: err });
  // ✖ type-check failed
  //   TypeError: expected string, got number
}
```

The cause may be any value — an `Error` contributes its `.message`, anything
else is stringified.

### stdout vs stderr

The split is deliberate: informational output (`trace` through `success`) goes
to **stdout**, and diagnostics that signal something went wrong (`warn`,
`error`) go to **stderr**. This keeps a build's normal narration separable from
its problems — pipe stdout to a log and still see warnings on the terminal, or
vice versa.

Under GitHub Actions, `warn` and `error` additionally emit `::warning::` /
`::error::` workflow-command annotations (with any `{ error }` detail appended),
so they surface in the run's annotations pane. Colour is turned off in that mode
so the annotations stay plain.

## Markup

Wrap text in `[style]…[/]` tags. A tag carries one or more space-separated style
names, and `[/]` closes the most recent tag, restoring the surrounding style —
so tags nest cleanly. Every `ConsoleTasks` method that takes a message renders
it through the markup parser.

```ts
Log.info("[bold]core[/] is [green]ready[/]");            // one tag each
Log.info("[red bold]2 errors[/] in [underline]mod.ts[/]"); // combine styles
Log.info("[yellow]outer [cyan]inner[/] still yellow[/]");  // [/] closes the nearest tag
Log.info("[muted]12 files[/] scanned");                    // semantic theme token
```

The recognised style names are:

- **Attributes** — `bold`, `dim`, `italic`, `underline`, and `reset`.
- **Colours** — `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`,
  `white`, and `gray`.
- **Semantic tokens** — `success`, `warn`, `error`, `info`, `debug`, `trace`,
  and `muted`. These resolve through the active [theme](#configuration), so they
  stay consistent — and re-theme-able — across all your output.

An unknown tag contributes no colour but still nests correctly. When colour is
off (CI, `NO_COLOR`, a non-TTY) the same parser runs but emits no escape codes,
so tags are simply stripped to plain text.

### Literal brackets and escaping

A literal bracket is written by doubling it — `[[` renders as `[` and `]]` as
`]`. To print caller-supplied text safely, pass it through `Log.escape(text)`,
which doubles every bracket so nothing in it can be mistaken for a tag:

```ts
Log.info("array access looks like arr[[0]]");   // → arr[0]
Log.info("branch: " + Log.escape(userInput));   // untrusted text can't smuggle tags
```

Matching is purely structural, so escaping is the boundary for any arbitrary or
untrusted string — a file path, a captured error, user input.

## Lines & rules

`line` draws a horizontal divider; `rule` is a `line` with a centred title. Both
accept the same options — `char` (the glyph to repeat), `width`, and `style` (an
array of style names).

```ts
Log.line();                              // a full-width ── divider
Log.line({ char: "═", width: 40 });      // custom glyph and width
Log.line({ char: "·", style: ["dim"] }); // styled divider

Log.rule("Deploy");                       // a title centred in the rule
Log.rule("Tests", { style: ["cyan"] });   // rules take the same options as line()
Log.rule();                               // untitled — identical to line()
```

A title too wide for the given width falls back to a plain, untitled line.

## Boxes

`box` frames content in a single-line border. Pass a string (split on newlines)
or an array of pre-split lines, plus optional `title`, `padding`, `width`, a
`border` style, and a `titleStyle`.

```ts
// A single string, or an array of pre-split lines:
Log.box("Deployed core@1.2.0 to production.");

Log.box(
  ["core   1.2.0   ✔", "cli    1.2.0   ✔", "cmd    1.2.0   ✔"],
  {
    title: "Release",       // shown in the top border
    padding: 1,             // blank cells inside the border
    width: 40,              // fixed width (defaults to fit the content)
    border: ["green"],      // style the border glyphs…
    titleStyle: ["bold"],   // …and the title
  },
);
```

`border` and `titleStyle` take an array of style names (e.g. `["green"]` or
`["dim"]`) — they colour the border glyphs and title, not the box shape, which
is always drawn with Unicode box-drawing characters. Content is markup-aware.

## Tables

`table` renders aligned columns. Columns are described by a `header` and an
optional `align` (`"left"` — the default — or `"right"`); rows are arrays of
strings. Options control the look.

```ts
Log.table(
  [
    { header: "Package", align: "left" },   // align: "left" | "right"
    { header: "Version" },                    // defaults to left
    { header: "Size", align: "right" },
  ],
  [
    ["@zuke/core", "1.2.0", "18 kB"],
    ["@zuke/cli", "1.2.0", "12 kB"],
    ["@zuke/cmd", "1.2.0", "6 kB"],
  ],
  {
    divider: true,            // rule between header and body
    separator: "  ",          // gap between columns
    headerStyle: ["bold"],
    dividerStyle: ["dim"],
  },
);
```

`divider` draws a rule under the header, `separator` sets the gap between
columns, and `headerStyle` / `dividerStyle` style those rows. Header and cell
text may contain markup, and column widths are computed automatically from the
content.

## Headers & summary

Two helpers produce the framing Zuke prints around a run. `header(name)` is the
ruled banner before a target; `summary(reports, totalMs, ok)` is the final
status-and-timing table — `reports` is the per-target result set the runner
collects, `totalMs` is wall-clock time, and `ok` is the overall verdict.

```ts
// The ruled banner Zuke prints before each target runs:
Log.header("build");

// The aligned end-of-run summary table:
Log.summary(reports, totalMs, ok);
```

The [renderer](#renderer-integration) below calls both for you — reach for them
directly only when you drive the run loop yourself.

## Groups

Wrap a burst of output in a named group. In a plain terminal the name is printed
as a titled rule; under GitHub Actions the pair becomes a collapsible
`::group::` / `::endgroup::` block.

```ts
Log.group("Install");
Log.info("added 214 packages in 12.4s");
Log.endGroup();
```

`endGroup()` emits the closing `::endgroup::` only under GitHub Actions; in a
plain terminal there is nothing to close.

## Configuration

`configure` sets the log level, output sink, theme, colour mode, width, and
GitHub-annotation mode. It prints nothing itself — it changes what later calls
emit. `level()` reads the active threshold and `reset()` restores every option
to its default (re-seeding the level from the environment).

```ts
Log.configure({
  level: "debug",   // "trace" | "debug" | "info" | "warn" | "error" | "silent"
  color: true,      // force ANSI colour on/off (auto-detected from the TTY otherwise)
  width: 100,       // width used for rules, boxes, and wrapping
  github: true,     // emit ::group:: / ::warning:: / ::error:: annotations
  // sink:  a custom { out, err } target; theme: a custom palette
});

Log.level();        // read the active threshold
Log.reset();        // restore every option to its default
```

| `ConsoleOptions` field | Effect |
| --- | --- |
| `level` | The minimum severity to print (default from `ZUKE_LOG_LEVEL`, else `info`). |
| `sink` | Where rendered lines go — an `{ out(line), err(line) }` target (default: stdout/stderr). Handy for capturing output in tests. |
| `theme` | A custom colour palette (a `Theme`). |
| `color` | Force ANSI colour on or off (default: auto — a TTY with `NO_COLOR` unset). |
| `width` | Force the width used for rules, boxes, and wrapping (default: the terminal width). |
| `github` | Force GitHub Actions output formatting (default: auto-detected from `GITHUB_ACTIONS`). |

When left unset, `color`, `width`, and `github` are auto-detected per call:
colour follows `NO_COLOR` and TTY detection, width follows the terminal, and
GitHub mode follows the `GITHUB_ACTIONS` environment variable.

## Renderer integration

`@zuke/console` is wired into a build through a **renderer**. Pass
`consoleRenderer` to `run()` to route every banner and summary through it, or
build a custom-themed one with `createConsoleRenderer(theme)`.

```ts
import { Build, run } from "jsr:@zuke/core";
import {
  consoleRenderer,
  createConsoleRenderer,
  defaultTheme,
} from "jsr:@zuke/console";

// Route the whole build's banners and summary through @zuke/console:
await run(MyBuild, { renderer: consoleRenderer });

// …or ship your own palette by building a renderer from a Theme:
const renderer = createConsoleRenderer(defaultTheme);
await run(MyBuild, { renderer });
```

Start from `defaultTheme` and override the tokens you want to recolour — the
semantic markup tokens (`success`, `warn`, `muted`, …) then follow your palette
everywhere they appear, in both your own `Log` calls and Zuke's built-in output.

The target header is themed (its colour comes from the `Theme`); the footers,
summary table, and job-summary Markdown reuse Zuke's canonical `defaultRenderer`,
so output stays identical to a plain build unless a custom theme changes it.

## Reference

- `ConsoleTasks`, `consoleRenderer`, `createConsoleRenderer`, `defaultTheme`,
  `Theme`, and the option types are exported from `@zuke/console`; see the
  generated API blocks in
  [`packages/console/README.md`](../packages/console/README.md) and
  [`llms-full.txt`](../llms-full.txt).
- The renderer contract in general: [Extending Zuke](./extending.md).
- Where this output shows up in a run: [Getting started](./getting-started.md).
