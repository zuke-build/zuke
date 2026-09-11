// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The executor's output sink — the {@link Reporter} interface plus the small set
 * of reporter wrappers the engine composes: the console/silent defaults, a
 * redacting wrapper (masks resolved secrets), an escaping wrapper (neutralises
 * workflow commands in text this process did not author), a best-effort wrapper
 * (a throwing sink can never unwind the run), and a buffering wrapper (so a
 * target's block flushes atomically under concurrency).
 *
 * @module
 */

import type { Redactor } from "./redact.ts";
import { detectCiHost } from "./host.ts";
import { escapeLine, escapeLineIf } from "./render.ts";

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
 * Wrap a reporter so every line is neutralised with {@link escapeLine} before it
 * is written — for a sink whose lines are **never** workflow commands.
 *
 * On a GitHub Actions runner every line a step writes is parsed for commands, so
 * text this process did not author can forge an annotation, collapse a
 * `::group::` over real output, or issue `::stop-commands::` and silence the
 * masking directives that follow. The text reaching these sinks is exactly that:
 * a run id or an actor another run wrote into the shared state store, a message
 * a failing subprocess printed, a warning a remote cache server returned.
 *
 * Use this only where the module behind it emits no workflow commands of its
 * own. `escapeLine` encodes a leading `::`, so a sink that also carries
 * `::endgroup::` would have its grouping broken by this wrapper; those lines
 * have to be escaped where they are composed instead, which is what the
 * renderer does. Applying it twice is harmless — `escapeLine` removes the
 * sequence it encodes, so it is idempotent.
 */
export function escapingReporter(inner: Reporter): Reporter {
  return {
    info: (line) => inner.info(escapeLine(line)),
    error: (line) => inner.error(escapeLine(line)),
  };
}

/**
 * The sink every command-surface module writes through, neutralised for a
 * GitHub Actions runner.
 *
 * These commands echo arguments the invoker chose — a run id, a target name, a
 * force reason — and read values another process wrote into the shared state
 * store. Under Actions those commonly come from a workflow-dispatch input or an
 * issue body rather than from a person at a terminal, and a thrown message
 * quotes them straight back.
 *
 * A sink rather than a guard at each of the sixty-odd writes, because none of
 * them should be exempt: unlike the run's reporter, none of these modules emits
 * a workflow command of its own, so there is no half to carve out. The MCP
 * command writes only diagnostics here — its protocol never goes through the
 * console — so escaping cannot corrupt it.
 *
 * The decision is made per line, not once when this module loads. A top-level
 * constant would read the environment at import time, before an embedder or a
 * test has set it, and the escaping would then silently not apply.
 */
export const cliReporter: Reporter = {
  info: (line) => console.log(escapeLineIf(onActionsRunner(), line)),
  error: (line) => console.error(escapeLineIf(onActionsRunner(), line)),
};

/** Whether this process is running on a GitHub Actions runner. */
function onActionsRunner(): boolean {
  return detectCiHost() === "github";
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
