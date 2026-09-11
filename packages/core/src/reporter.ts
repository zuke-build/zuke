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
import { detectCiHost } from "./host.ts";
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
 * line **Zuke composes** leaves core unescaped unless the renderer composed it.
 *
 * The qualifier is load-bearing. A subprocess's own stdout and stderr are
 * relayed byte for byte by the shell, to the real file descriptors, and are not
 * routed through any reporter — so a tool that prints a workflow command still
 * reaches the runner as one. That is deliberate: a build may run a tool whose
 * commands are wanted, and rewriting another program's output stream would
 * corrupt it. What this guarantees is narrower and worth stating exactly: text
 * Zuke itself interpolated into a line it wrote cannot be read as a command.
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
 * Wrap `inner` for the runner when this process is on GitHub Actions, and hand
 * it back untouched anywhere else.
 *
 * The one place the question "should this line be escaped for the runner?" is
 * answered for a reporter that was not composed by `composeOutput` — the cancel,
 * resume and reap paths default their own sinks. Those emit no workflow commands
 * of their own, so they wrap unconditionally: there is no renderer half to carve
 * out, and every line they print interpolates something from the shared store or
 * a thrown error.
 *
 * The reader is injectable so a caller can be tested without touching the
 * ambient environment.
 */
export function runnerReporter(
  inner: Reporter,
  readEnv?: (name: string) => string | undefined,
): Reporter {
  // Decided per line, not once when this is called. A module-level
  // `const cli = runnerReporter(consoleReporter)` would otherwise read the
  // environment at import time, which is before a test — or any embedder that
  // sets the variable itself — has set it, and the escaping would silently not
  // apply. The check is a map lookup on an environment read; the cost is not
  // worth a trap that fails open.
  const escaped = (line: string): string =>
    detectCiHost(readEnv) === "github" ? escapeLine(line) : line;
  return {
    info: (line) => inner.info(escaped(line)),
    error: (line) => inner.error(escaped(line)),
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
  rendered: Reporter;
  flush: (to: Reporter, toRendered: Reporter) => void;
} {
  const lines: Array<{ error: boolean; rendered: boolean; text: string }> = [];
  const sink = (rendered: boolean): Reporter => ({
    info: (text) => void lines.push({ error: false, rendered, text }),
    error: (text) => void lines.push({ error: true, rendered, text }),
  });
  return {
    reporter: sink(false),
    // Buffered alongside the escaped sink, in one list, so the block still
    // flushes in the order it was written — a target's header, its body and its
    // footer come from different sinks, and two buffers would interleave them
    // wrongly. Each line remembers which sink it came from so the escaping
    // distinction survives the round trip.
    rendered: sink(true),
    flush: (to, toRendered) => {
      for (const line of lines) {
        const out = line.rendered ? toRendered : to;
        if (line.error) out.error(line.text);
        else out.info(line.text);
      }
    },
  };
}
