/**
 * `ConsoleTasks` — task-shaped console output for Zuke builds, so a build never
 * reaches for `console.log`. It combines an NUKE-style levelled logger
 * (`info`/`success`/`warn`/`error`/`debug`/`trace`), Spectre.Console-style
 * markup and a semantic {@link Theme}, and the primitives Zuke itself draws with
 * (`line`, `rule`, `box`, `table`, and the target `header`/`summary`).
 *
 * Every method resolves its style once — honouring `NO_COLOR`, TTY detection,
 * and GitHub Actions — then renders through the shared `@zuke/core/render`
 * primitives, so console output matches a build's own banners exactly.
 *
 * ```ts
 * import { ConsoleTasks as Log } from "jsr:@zuke/console";
 *
 * Log.rule("Deploy");
 * Log.info("pushing [bold]core@1.2.0[/]");
 * Log.success("published 4 packages");
 * ```
 *
 * @module
 */

import {
  box as renderBox,
  type BoxOptions,
  detectWidth,
  line as renderLine,
  type LineOptions,
  type Style,
  stylize,
  table as renderTable,
  type TableColumn,
  type TableOptions,
  visibleWidth,
} from "@zuke/core/render";
import { defaultRenderer, type TargetReport } from "@zuke/core";
import { LEVEL_ORDER, type LogLevel, resolveLevel } from "./level.ts";
import {
  defaultTheme,
  LEVEL_MARKS,
  type LevelMark,
  type Theme,
  themeTags,
} from "./theme.ts";
import { renderMarkup } from "./markup.ts";

/** A destination for rendered lines. Overridable to capture output in tests. */
export interface Sink {
  /** Write a line to standard output. */
  out(line: string): void;
  /** Write a line to standard error. */
  err(line: string): void;
}

/** The default sink: standard output and standard error. */
const defaultSink: Sink = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/** Read an environment variable, treating missing env access as unset. */
function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** Mutable configuration for {@link ConsoleTasks}. */
interface ConsoleState {
  level: LogLevel;
  sink: Sink;
  theme: Theme;
  color?: boolean;
  width?: number;
  github?: boolean;
}

/** A fresh state, with the level seeded from `ZUKE_LOG_LEVEL`. */
function freshState(): ConsoleState {
  return {
    level: resolveLevel(readEnv),
    sink: defaultSink,
    theme: defaultTheme,
  };
}

let state: ConsoleState = freshState();

/** Whether the build is running inside GitHub Actions. */
function autoGithub(): boolean {
  return readEnv("GITHUB_ACTIONS") === "true";
}

/** Whether terminal colour should be used (a TTY, with `NO_COLOR` unset). */
function autoColor(): boolean {
  if (readEnv("NO_COLOR")) return false;
  try {
    return Deno.stdout.isTerminal();
  } catch {
    return false;
  }
}

/** Resolve the active output style from overrides and the environment. */
function currentStyle(): Style {
  const github = state.github ?? autoGithub();
  const color = state.color ?? (github ? false : autoColor());
  const width = state.width ?? detectWidth();
  return { github, color, width };
}

/** Render markup with the active theme's tokens available as tags. */
function render(text: string, style: Style): string {
  return renderMarkup(text, {
    color: style.color,
    tags: themeTags(state.theme),
  });
}

/** A message from an unknown thrown value, without casting. */
function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** Emit each line to the given stream. */
function emit(lines: string[], stream: "out" | "err"): void {
  const write = stream === "err" ? state.sink.err : state.sink.out;
  for (const line of lines) write(line);
}

/** Whether structural output (rules, boxes, tables) is currently suppressed. */
function muted(): boolean {
  return state.level === "silent";
}

/** Options for {@link ConsoleTasks.error}. */
export interface ErrorOptions {
  /** An error whose message is appended as a dimmed detail line. */
  error?: unknown;
}

/** Options for {@link ConsoleTasks.rule}. */
export interface RuleOptions extends LineOptions {}

/**
 * Log one message at `severity`, decorated with `mark`. Under GitHub Actions,
 * warnings and errors become `::warning::`/`::error::` workflow commands.
 */
function logAt(
  severity: LogLevel,
  mark: LevelMark,
  message: string,
  options?: ErrorOptions,
): void {
  if (LEVEL_ORDER[severity] < LEVEL_ORDER[state.level]) return;
  const style = currentStyle();
  const stream: "out" | "err" = severity === "warn" || severity === "error"
    ? "err"
    : "out";
  const detail = options?.error !== undefined
    ? messageOf(options.error)
    : undefined;

  if (style.github && (severity === "warn" || severity === "error")) {
    const command = severity === "warn" ? "warning" : "error";
    const plain = renderMarkup(message, {
      color: false,
      tags: themeTags(state.theme),
    });
    emit([`::${command}::${detail ? `${plain}: ${detail}` : plain}`], stream);
    return;
  }

  const icon = stylize(style.color, state.theme[mark.token], mark.icon);
  const lines = [`${icon} ${render(message, style)}`];
  if (detail !== undefined) {
    lines.push(stylize(style.color, state.theme.muted, `  ${detail}`));
  }
  emit(lines, stream);
}

/** Build a titled horizontal rule: `═══ Title ══════`. */
function renderRule(style: Style, title: string, options: RuleOptions): string {
  const char = options.char ?? "═";
  const width = options.width ?? style.width;
  const styles = options.style ?? ["dim"];
  const label = render(title, style);
  const remaining = width - visibleWidth(label) - 2;
  if (remaining < 2) return renderLine(style, options);
  const leftLen = Math.floor(remaining / 2);
  const left = stylize(style.color, styles, char.repeat(leftLen));
  const right = stylize(style.color, styles, char.repeat(remaining - leftLen));
  return `${left} ${label} ${right}`;
}

/** Options accepted when reconfiguring {@link ConsoleTasks}. */
export interface ConsoleOptions {
  /** The minimum severity to print. */
  level?: LogLevel;
  /** Where rendered lines go (default: stdout/stderr). */
  sink?: Sink;
  /** A custom colour palette. */
  theme?: Theme;
  /** Force ANSI colour on or off (default: auto-detected). */
  color?: boolean;
  /** Force the rule/box width (default: the terminal width). */
  width?: number;
  /** Force GitHub Actions output formatting (default: auto-detected). */
  github?: boolean;
}

/** The shape of {@link ConsoleTasks}. */
export interface ConsoleTasksApi {
  /** Log an informational message (markup-aware). */
  info(message: string): void;
  /** Alias for {@link ConsoleTasksApi.info}. */
  log(message: string): void;
  /** Log a success/completion message. */
  success(message: string): void;
  /** Log a warning (a `::warning::` annotation under GitHub Actions). */
  warn(message: string): void;
  /** Log an error, optionally appending a thrown value's message. */
  error(message: string, options?: ErrorOptions): void;
  /** Log a debug diagnostic (shown only at `debug`/`trace` level). */
  debug(message: string): void;
  /** Log the most verbose trace output (shown only at `trace` level). */
  trace(message: string): void;
  /** Print a horizontal rule spanning the width. */
  line(options?: LineOptions): void;
  /** Print a rule, optionally with a centred title. */
  rule(title?: string, options?: RuleOptions): void;
  /** Print a bordered panel around `content` (markup-aware). */
  box(content: string | string[], options?: BoxOptions): void;
  /** Print an aligned table; header and cell text may contain markup. */
  table(
    columns: TableColumn[],
    rows: string[][],
    options?: TableOptions,
  ): void;
  /** Print the ruled banner Zuke opens a target's section with. */
  header(name: string): void;
  /** Print the end-of-build summary table and closing verdict. */
  summary(reports: TargetReport[], totalMs: number, ok: boolean): void;
  /** Open a collapsible group; close it with {@link ConsoleTasksApi.endGroup}. */
  group(name: string): void;
  /** Close the group opened by {@link ConsoleTasksApi.group}. */
  endGroup(): void;
  /** Reconfigure logging (level, sink, theme, colour, width, Actions mode). */
  configure(options: ConsoleOptions): void;
  /** The active minimum severity. */
  level(): LogLevel;
  /** Reset all configuration to defaults (level re-seeded from the env). */
  reset(): void;
}

/**
 * Task-shaped console output. A single namespaced object (like `FileTasks`)
 * rather than loose helpers: logging methods, structural primitives, and
 * configuration all hang off `ConsoleTasks`.
 */
export const ConsoleTasks: ConsoleTasksApi = {
  /** Log an informational message (markup-aware). */
  info(message: string): void {
    logAt("info", LEVEL_MARKS.info, message);
  },
  /** Alias for {@link ConsoleTasks.info}. */
  log(message: string): void {
    logAt("info", LEVEL_MARKS.info, message);
  },
  /** Log a success/completion message. */
  success(message: string): void {
    logAt("info", LEVEL_MARKS.success, message);
  },
  /** Log a warning (a `::warning::` annotation under GitHub Actions). */
  warn(message: string): void {
    logAt("warn", LEVEL_MARKS.warn, message);
  },
  /**
   * Log an error (a `::error::` annotation under GitHub Actions). Pass
   * `{ error }` to append the thrown value's message as a dimmed detail line.
   */
  error(message: string, options?: ErrorOptions): void {
    logAt("error", LEVEL_MARKS.error, message, options);
  },
  /** Log a debug diagnostic (shown only at `debug`/`trace` level). */
  debug(message: string): void {
    logAt("debug", LEVEL_MARKS.debug, message);
  },
  /** Log the most verbose trace output (shown only at `trace` level). */
  trace(message: string): void {
    logAt("trace", LEVEL_MARKS.trace, message);
  },

  /** Print a horizontal rule spanning the width. */
  line(options: LineOptions = {}): void {
    if (muted()) return;
    emit([renderLine(currentStyle(), options)], "out");
  },
  /** Print a rule, optionally with a centred title. */
  rule(title?: string, options: RuleOptions = {}): void {
    if (muted()) return;
    const style = currentStyle();
    emit([
      title === undefined
        ? renderLine(style, options)
        : renderRule(style, title, options),
    ], "out");
  },
  /** Print a bordered panel around `content` (markup-aware). */
  box(content: string | string[], options: BoxOptions = {}): void {
    if (muted()) return;
    const style = currentStyle();
    const lines = (Array.isArray(content) ? content : content.split("\n"))
      .map((l) => render(l, style));
    emit(renderBox(style, lines, options), "out");
  },
  /** Print an aligned table; header and cell text may contain markup. */
  table(
    columns: TableColumn[],
    rows: string[][],
    options: TableOptions = {},
  ): void {
    if (muted()) return;
    const style = currentStyle();
    const cols = columns.map((c) => ({
      ...c,
      header: render(c.header, style),
    }));
    const painted = rows.map((row) => row.map((cell) => render(cell, style)));
    emit(renderTable(style, cols, painted, options), "out");
  },
  /** Print the ruled banner Zuke opens a target's section with. */
  header(name: string): void {
    if (muted()) return;
    emit(defaultRenderer.targetHeader(currentStyle(), name), "out");
  },
  /** Print the end-of-build summary table and closing verdict. */
  summary(reports: TargetReport[], totalMs: number, ok: boolean): void {
    if (muted()) return;
    emit(
      defaultRenderer.summaryBlock(currentStyle(), reports, totalMs, ok),
      "out",
    );
  },
  /**
   * Open a collapsible group (`::group::` under GitHub Actions, otherwise a
   * titled rule). Close it with {@link ConsoleTasks.endGroup}.
   */
  group(name: string): void {
    if (muted()) return;
    const style = currentStyle();
    if (style.github) {
      emit([`::group::${renderMarkup(name, { color: false })}`], "out");
    } else {
      emit([renderRule(style, name, {})], "out");
    }
  },
  /** Close the group opened by {@link ConsoleTasks.group}. */
  endGroup(): void {
    if (muted()) return;
    if (currentStyle().github) emit(["::endgroup::"], "out");
  },

  /** Reconfigure logging (level, sink, theme, colour, width, Actions mode). */
  configure(options: ConsoleOptions): void {
    if (options.level !== undefined) state.level = options.level;
    if (options.sink !== undefined) state.sink = options.sink;
    if (options.theme !== undefined) state.theme = options.theme;
    if (options.color !== undefined) state.color = options.color;
    if (options.width !== undefined) state.width = options.width;
    if (options.github !== undefined) state.github = options.github;
  },
  /** The active minimum severity. */
  level(): LogLevel {
    return state.level;
  },
  /** Reset all configuration to defaults (level re-seeded from the env). */
  reset(): void {
    state = freshState();
  },
};
