// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Escaping for text that reaches a GitHub Actions runner.
 *
 * The runner reads every line a step writes, on stdout and stderr alike, and
 * acts on two syntaxes. This module holds the one implementation of each
 * escape, so a value cannot reach the log through a path that forgot one.
 *
 * @module
 */

/**
 * Escape a value interpolated into the **body** of a workflow command
 * (`::error::<data>`).
 *
 * A workflow command is terminated by the end of its line, so a value carrying
 * a newline continues into what the runner parses as a *fresh* command. A
 * target's failure message embeds a subprocess's stderr verbatim, which is not
 * ours to trust: a tool that writes `::stop-commands::` on a line of its own
 * would otherwise suspend the runner's command processing, and one that writes
 * `::error::` would forge an annotation. Percent-encoding is the escape the
 * Actions spec defines for exactly this, and `%` is encoded first so the
 * encoding cannot be spoofed by a literal `%0A` in the input.
 *
 * Use this **only** inside a command Zuke is constructing. For text printed as
 * itself, see {@link neutralizeWorkflowCommands} — encoding every newline would
 * fold a multi-line compiler dump into one unreadable line.
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
 * Neutralise both workflow-command syntaxes in text that is printed to the log
 * **as itself** — a failure message, a target name, an actor, a reason.
 *
 * Two syntaxes, because the runner honours two:
 *
 * - a line whose first non-blank characters are `::`. The runner trims leading
 *   whitespace before that test, so indenting a line is not a defence;
 * - the legacy `##[command]` form, which is recognised **anywhere** in a line.
 *
 * Only text that would actually be interpreted is altered — the offending
 * marker is percent-encoded, which is the encoding the Actions spec already
 * defines and which a reader recognises. Everything else is returned
 * byte-identical, so ordinary output keeps its indentation, its blank lines and
 * its multi-line structure. That is the whole reason this is not
 * {@link escapeData}: a compiler dump must stay readable.
 *
 * Applied to the **value**, not the finished line, so an embedded newline
 * cannot smuggle a command onto a line of its own.
 */
export function neutralizeWorkflowCommands(value: string): string {
  if (!value.includes("::") && !value.includes("##[")) return value;
  return value
    .split("\n")
    .map((segment) => {
      // The runner trims leading whitespace before testing for `::`, so the
      // test here has to trim too — and the original whitespace is preserved,
      // since only the marker is encoded.
      const indent = segment.length - segment.trimStart().length;
      const body = segment.slice(indent);
      const head = body.startsWith("::") ? `%3A%3A${body.slice(2)}` : body;
      // `##[` is matched anywhere on the line, so every occurrence goes.
      return segment.slice(0, indent) + head.replaceAll("##[", "%23%23[");
    })
    .join("\n");
}
