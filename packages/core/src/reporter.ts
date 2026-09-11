// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The executor's output sink — the {@link Reporter} interface plus the small set
 * of reporter wrappers the engine composes: the console/silent defaults, a
 * redacting wrapper (masks resolved secrets), a best-effort wrapper (a throwing
 * sink can never unwind the run), and a buffering wrapper (so a target's block
 * flushes atomically under concurrency).
 *
 * @module
 */

import type { Redactor } from "./redact.ts";
import { escapeLine } from "./render.ts";

/** Sink for executor output, defaulting to the console. Overridable in tests. */
export interface Reporter {
  /** Write an informational line. */
  info(line: string): void;
  /** Write an error line. */
  error(line: string): void;
}

/** The default reporter: writes to `console.log`/`console.error`. */
export const consoleReporter: Reporter = {
  info: (line) => console.log(line),
  error: (line) => console.error(line),
};

/** A reporter that discards all output (used by `silent`). */
export const silentReporter: Reporter = { info: () => {}, error: () => {} };

/** Wrap a reporter so every line is passed through the {@link Redactor} first. */
export function redactingReporter(
  inner: Reporter,
  redactor: Redactor,
): Reporter {
  return {
    info: (line) => inner.info(redactor.redact(line)),
    error: (line) => inner.error(redactor.redact(line)),
  };
}

/**
 * Wrap a reporter so every line is escaped for a GitHub Actions runner.
 *
 * The runner parses **every** line a step writes, whichever function inside
 * Zuke composed it. About forty reporter calls interpolate text this process
 * did not author — a store-derived actor, a subprocess's stderr, a network
 * warning, a run id — and keeping forty call sites escaped by hand is the kind
 * of guard that drifts. Escaping at the sink makes it hold by construction.
 *
 * **This sink must not carry Zuke's own workflow commands.** `::endgroup::`
 * does not survive being escaped, so the lines the renderer composes go to an
 * unescaped sink instead; the renderer escapes the untrusted values it
 * interpolates itself, at construction, where it still knows which part of the
 * line is a command and which is data. That split is the whole contract: no
 * line leaves core unescaped unless the renderer composed it.
 *
 * `escapeLine` is a no-op on ordinary text and idempotent on text it has
 * already encoded, so double-wrapping changes nothing.
 */
export function escapingReporter(inner: Reporter): Reporter {
  return {
    info: (line) => inner.info(escapeLine(line)),
    error: (line) => inner.error(escapeLine(line)),
  };
}

/**
 * Wrap a reporter so a failing write can never escape into the run. Output is a
 * best-effort side effect: a sink that throws — a custom reporter with a bug, or
 * the default console raising `BrokenPipe`/EPIPE when stdout is piped to a reader
 * that closed early (`zuke build | head`) — must not turn into a rejection that
 * unwinds the scheduler and strands the durable run record `running`. A thrown
 * write is dropped; every other write still lands.
 */
export function safeReporter(inner: Reporter): Reporter {
  return {
    info: (line) => {
      try {
        inner.info(line);
      } catch {
        // best-effort: a broken output sink must not break the build
      }
    },
    error: (line) => {
      try {
        inner.error(line);
      } catch {
        // best-effort: a broken output sink must not break the build
      }
    },
  };
}

/** A reporter that buffers lines so a target's block can flush atomically. */
export function bufferReporter(): {
  reporter: Reporter;
  flush: (to: Reporter) => void;
} {
  const lines: Array<{ error: boolean; text: string }> = [];
  return {
    reporter: {
      info: (text) => void lines.push({ error: false, text }),
      error: (text) => void lines.push({ error: true, text }),
    },
    flush: (to) => {
      for (const line of lines) {
        if (line.error) to.error(line.text);
        else to.info(line.text);
      }
    },
  };
}
