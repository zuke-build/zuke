// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Primitive terminal rendering, shared by the executor's build reporting
 * (`./report.ts`) and the `@zuke/console` package: ANSI styling, terminal-width
 * detection, duration formatting, and the reusable `line`/`box`/`table`
 * primitives that draw a build's output.
 *
 * Everything here is pure — no I/O, no process state — so argv-free output can
 * be unit-tested and reused without duplicating escape codes. Cells may already
 * carry ANSI codes; width is measured on the visible text ({@link visibleWidth})
 * so painted content still aligns.
 *
 * @module
 */

/**
 * Escape a value interpolated into the body of a GitHub Actions workflow
 * command (`::error::<data>`).
 *
 * A workflow command is terminated by the end of its line, so a value carrying
 * a newline continues into what the runner parses as a *fresh* command. A
 * target's failure message embeds a subprocess's stderr verbatim, which is not
 * ours to trust: a tool that writes `::stop-commands::` on a line of its own
 * would otherwise suspend the runner's command processing, and one that writes
 * `::error::` would forge an annotation. Percent-encoding is the escape the
 * Actions spec defines for exactly this, and `%` is encoded first so the
 * encoding cannot be spoofed by a literal `%0A` in the input.
 */
export function escapeData(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

/**
 * Escape a value interpolated into a workflow command's **property** list
 * (`::error title=<property>::`). Properties are comma-separated and
 * colon-terminated, so those two characters need encoding on top of what
 * {@link escapeData} handles.
 */
export function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/**
 * Neutralise workflow commands in text that is *printed as itself* on a stream
 * the GitHub Actions runner parses — a failure message, a target name, a
 * summary row — rather than interpolated into a command's body.
 *
 * {@link escapeData} is the wrong tool there. It answers the same threat, but
 * by encoding every newline, which would fold a multi-line compiler dump into
 * one unreadable `%0A`-joined line: correct, and useless to the person reading
 * the log. This keeps the text as it was written and disarms only the two
 * sequences the runner acts on.
 *
 * Both forms are covered, because the runner accepts both. A line whose first
 * non-blank characters are `::` opens a command, and leading whitespace is
 * trimmed before that test, so indenting the text defends nothing. The legacy
 * `##[command]` form is recognised *anywhere* in a line, so it needs no newline
 * to reach at all.
 *
 * "Blank" is the runner's idea of it, not this language's. The two sets differ
 * by exactly one character in the direction that matters: NEXT LINE (U+0085),
 * which the runner trims and `\s` does not match. It is not a line terminator
 * for the reader the runner uses, so it travels inside a line and disappears
 * only when the command is parsed, which would let `::` reach the front of a
 * line that looked indented here. It is matched explicitly for that reason.
 *
 * Ordinary output is returned unchanged; only text that would have been
 * executed as a command comes back visibly encoded.
 */
export function escapeLine(text: string): string {
  return text
    .split(/(\r\n|\r|\n)/)
    .map((part) =>
      /^(?:\r\n|\r|\n)$/.test(part)
        ? part
        : part.replace(/^([\s\u0085]*)::/, "$1%3A%3A").replaceAll(
          "##[",
          "%23%23[",
        )
    )
    .join("");
}

/**
 * {@link escapeLine}, applied only when something is parsing this process's
 * output for workflow commands.
 *
 * The condition is not a security gate — the runner parses every line a step
 * writes, whatever this process believes about its own style. It is a
 * readability one: `escapeLine` leaves ordinary text alone, but a compiler
 * dump that legitimately begins a line with `::` would come back encoded, and
 * on a developer's terminal that is noise protecting against nothing.
 *
 * It exists so the decision has one implementation. It was written out at more
 * than a dozen call sites, in three shapes that had already drifted apart — two
 * asking the style, one asking the environment — which is how a site gets added
 * without it.
 */
export function escapeLineIf(github: boolean, text: string): string {
  return github ? escapeLine(text) : text;
}

/** ANSI select-graphic-rendition codes, keyed by style name. */
export const SGR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
} as const;

/** A style name understood by {@link sgrCodes}, {@link paint}, and markup. */
export type StyleName = keyof typeof SGR;

/** Whether a string names one of the {@link SGR} styles. */
export function isStyleName(name: string): name is StyleName {
  return Object.hasOwn(SGR, name);
}

/** How a run renders its output. */
export interface Style {
  /** Wrap target output in `::group::`/`::endgroup::` and emit `::error::`. */
  github: boolean;
  /** Emit ANSI colour codes (off when piped, under `NO_COLOR`, or in CI). */
  color: boolean;
  /** Width of horizontal rules and boxes, in characters. */
  width: number;
}

/** Concatenate the escape codes for `names` (an unknown name contributes none). */
export function sgrCodes(names: readonly StyleName[]): string {
  let codes = "";
  for (const name of names) codes += SGR[name];
  return codes;
}

/** Wrap text in ANSI codes when colour is enabled, otherwise return it as-is. */
export function paint(color: boolean, codes: string, text: string): string {
  return color ? `${codes}${text}${SGR.reset}` : text;
}

/** Paint `text` in the named styles when `color` is enabled. */
export function stylize(
  color: boolean,
  names: readonly StyleName[],
  text: string,
): string {
  return paint(color, sgrCodes(names), text);
}

/** Matches every ANSI SGR escape sequence, so width can ignore colour codes. */
// deno-lint-ignore no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Strip ANSI escape sequences, leaving the visible text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** The printable width of `text`, ignoring any ANSI colour codes it carries. */
export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

/** Pad `text` to `width` visible columns, aligning left (default) or right. */
export function pad(
  text: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  const gap = Math.max(0, width - visibleWidth(text));
  const spaces = " ".repeat(gap);
  return align === "right" ? spaces + text : text + spaces;
}

/** Format a duration in milliseconds as `1.2s`. */
export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Default rule/box width used when the terminal size can't be detected. */
const DEFAULT_WIDTH = 80;

/** Minimum rule/box width — narrower terminals look broken with our headers. */
const MIN_WIDTH = 40;

/** Read the terminal width if available, clamped to a sane range. */
export function detectWidth(): number {
  try {
    const size = Deno.consoleSize();
    return Math.max(MIN_WIDTH, Math.min(size.columns, DEFAULT_WIDTH));
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** Options for {@link line}. */
export interface LineOptions {
  /** The character to repeat. Defaults to `═`. */
  char?: string;
  /** The rule width. Defaults to the style's width. */
  width?: number;
  /** Styles applied to the whole rule. Defaults to `["dim"]`. */
  style?: readonly StyleName[];
}

/** A horizontal rule spanning the style's width (dimmed by default). */
export function line(style: Style, options: LineOptions = {}): string {
  const char = options.char ?? "═";
  const width = options.width ?? style.width;
  const count = char.length > 0
    ? Math.max(0, Math.floor(width / char.length))
    : 0;
  return stylize(style.color, options.style ?? ["dim"], char.repeat(count));
}

/** Options for {@link box}. */
export interface BoxOptions {
  /** A title embedded in the top border. */
  title?: string;
  /** Horizontal padding inside the border, in spaces. Defaults to `1`. */
  padding?: number;
  /** Force an inner width; widened automatically to fit content and title. */
  width?: number;
  /** Styles for the border characters. Defaults to `["dim"]`. */
  border?: readonly StyleName[];
  /** Styles for the title text. Defaults to `["bold"]`. */
  titleStyle?: readonly StyleName[];
}

/** Box-drawing characters for {@link box}. */
const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
} as const;

/**
 * A bordered panel around `content` (a string, split on newlines, or an array
 * of lines). Content may carry ANSI codes; padding is measured on the visible
 * text so the border stays flush.
 */
export function box(
  style: Style,
  content: string | readonly string[],
  options: BoxOptions = {},
): string[] {
  const lines = Array.isArray(content)
    ? [...content]
    : String(content).split("\n");
  const padding = options.padding ?? 1;
  const border = options.border ?? ["dim"];
  const titleStyle = options.titleStyle ?? ["bold"];
  const title = options.title ? ` ${options.title} ` : "";

  const contentWidth = lines.reduce((w, l) => Math.max(w, visibleWidth(l)), 0);
  const inner = Math.max(
    contentWidth + padding * 2,
    visibleWidth(title) + 2,
    options.width ?? 0,
  );
  const contentArea = inner - padding * 2;

  const bp = (text: string) => stylize(style.color, border, text);
  const tp = (text: string) => stylize(style.color, titleStyle, text);
  const bar = bp(BOX.vertical);
  const gap = " ".repeat(padding);

  const top = bp(BOX.topLeft + BOX.horizontal) + tp(title) +
    bp(BOX.horizontal.repeat(inner - 1 - visibleWidth(title)) + BOX.topRight);
  const bottom = bp(
    BOX.bottomLeft + BOX.horizontal.repeat(inner) + BOX.bottomRight,
  );
  const body = lines.map((l) =>
    `${bar}${gap}${pad(l, contentArea)}${gap}${bar}`
  );
  return [top, ...body, bottom];
}

/** One column of a {@link table}. */
export interface TableColumn {
  /** The column header. */
  header: string;
  /** Cell alignment. Defaults to `left`. */
  align?: "left" | "right";
}

/** Options for {@link table}. */
export interface TableOptions {
  /** Column separator. Defaults to two spaces. */
  separator?: string;
  /** Draw a dividing rule under the header. Defaults to `true`. */
  divider?: boolean;
  /** Styles for the header row. Defaults to `["bold"]`. */
  headerStyle?: readonly StyleName[];
  /** Styles for the divider rule. Defaults to `["dim"]`. */
  dividerStyle?: readonly StyleName[];
}

/**
 * An aligned text table: a styled header row, an optional dividing rule, then
 * one line per row. Column widths fit the widest visible cell; cells may already
 * carry ANSI colour. Rows shorter than the columns are padded with empty cells.
 */
export function table(
  style: Style,
  columns: readonly TableColumn[],
  rows: readonly (readonly string[])[],
  options: TableOptions = {},
): string[] {
  const separator = options.separator ?? "  ";
  const widths = columns.map((col, i) => {
    const cells = rows.map((r) => visibleWidth(r[i] ?? ""));
    return Math.max(visibleWidth(col.header), ...cells, 0);
  });
  const layout = (cells: readonly string[]): string =>
    columns
      .map((col, i) => pad(cells[i] ?? "", widths[i], col.align ?? "left"))
      .join(separator)
      .replace(/\s+$/, "");

  const header = stylize(
    style.color,
    options.headerStyle ?? ["bold"],
    layout(columns.map((c) => c.header)),
  );
  const out = [header];
  if (options.divider !== false) {
    const width = widths.reduce((w, x) => w + x, 0) +
      separator.length * Math.max(0, columns.length - 1);
    out.push(
      stylize(style.color, options.dividerStyle ?? ["dim"], "─".repeat(width)),
    );
  }
  for (const row of rows) out.push(layout(row));
  return out;
}
