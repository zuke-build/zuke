// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Ergonomic process execution built on `Deno.Command`, exposed as the `$`
 * tagged template.
 *
 * ```ts
 * await $`deno test -A`;                            // throws on non-zero exit
 * const out = await $`git rev-parse HEAD`.text();   // trimmed stdout
 * const code = await $`flaky-cmd`.noThrow().code();  // exit code, no throw
 * await $`build`.env({ NODE_ENV: "prod" }).cwd("./app");
 * ```
 *
 * Interpolated values become *discrete argv entries* — they are never spliced
 * into a shell string — so there is no shell-injection surface. Arrays expand
 * to multiple arguments.
 *
 * @module
 */

import type { AbsolutePath, PathLike } from "./path.ts";
import { ambientSignal } from "./ambient_signal.ts";
import { ambientEcho } from "./ambient_echo.ts";
import { redactLine } from "./ambient_redactor.ts";
import { terminateProcess, TERMINATION_GRACE_MS } from "./terminate.ts";
import {
  captureStream,
  checkMaxCapturedBytes,
  DEFAULT_MAX_CAPTURED_BYTES,
  truncationNotice,
} from "./capture.ts";

/**
 * Split an already-written command string into argv with POSIX quoting rules —
 * for input that arrives as one line (a `package.json` script, a Makefile
 * recipe) rather than being constructed with `$`.
 */
export { ShellArgsError, splitShellArgs } from "./split_args.ts";

/** A value that may be interpolated into a `$` template. */
export type Interpolatable =
  | string
  | number
  | AbsolutePath
  | Array<string | number | AbsolutePath>;

/** Raised when a command exits non-zero and throwing was not suppressed. */
export class CommandError extends Error {
  /** The error name. */
  override name = "CommandError";
  /** Build the error from the failed command line, exit code, and stderr. */
  constructor(
    /** The command line that failed (argv joined by spaces). */
    readonly command: string,
    /** The process exit code. */
    readonly code: number,
    /** Captured stderr, if any. */
    readonly stderr: string,
  ) {
    super(
      `Command failed (exit ${code}): ${command}` +
        (stderr ? `\n${stderr.trimEnd()}` : ""),
    );
  }
}

/**
 * Raised when a command is killed for exceeding its {@link Command.killAfter}
 * budget. Thrown regardless of {@link Command.noThrow}, since a timeout is a
 * distinct, exceptional outcome from a normal non-zero exit.
 */
export class CommandTimeoutError extends Error {
  /** The error name. */
  override name = "CommandTimeoutError";
  /** Build the error from the command line and the elapsed-time budget. */
  constructor(
    /** The command line that timed out (argv joined by spaces). */
    readonly command: string,
    /** The elapsed-time budget, in milliseconds, that was exceeded. */
    readonly timeoutMs: number,
  ) {
    super(`Command timed out after ${timeoutMs}ms: ${command}`);
  }
}

/** The resolved result of a command, available when awaiting a {@link Command}. */
export class CommandOutput {
  /** Build the output from the process exit code and captured streams. */
  constructor(
    /** The process exit code. */
    readonly code: number,
    /** Captured standard output. */
    readonly stdout: string,
    /** Captured standard error. */
    readonly stderr: string,
    /**
     * Whether either captured stream hit the capture cap, in which case it holds
     * only its tail — the newest bytes — and its beginning is gone. See
     * {@link Command.maxCapturedBytes}.
     */
    readonly truncated: boolean = false,
    /** The per-stream capture cap that applied, in bytes. */
    readonly maxCapturedBytes: number = DEFAULT_MAX_CAPTURED_BYTES,
  ) {}

  /**
   * Trimmed stdout, prefixed with a one-line notice when {@link truncated} — so
   * a caller reading the output cannot mistake a tail for the whole of it.
   */
  text(): string {
    const text = this.stdout.trim();
    if (!this.truncated) return text;
    return `${truncationNotice(this.maxCapturedBytes)}\n${text}`;
  }
}

/**
 * A long-lived process started with {@link Command.spawn} — the handle a
 * {@link https://jsr.io/@zuke/core service} keeps alive. Unlike awaiting a
 * {@link Command}, spawning does not wait for the process to exit; call
 * {@link SpawnedProcess.stop} to terminate it (which is also the default
 * service teardown). Its stdout/stderr are inherited so the process's own
 * output is visible.
 */
export class SpawnedProcess {
  /** The child, or `undefined` for a no-op stub (a deep-dry-run echo). */
  readonly #child?: Deno.ChildProcess;

  /** Wrap a spawned child process (or none, for a stub) and its command line. */
  constructor(
    child: Deno.ChildProcess | undefined,
    readonly commandLine: string,
  ) {
    this.#child = child;
  }

  /** The operating-system process id (`-1` for a dry-run stub). */
  get pid(): number {
    return this.#child?.pid ?? -1;
  }

  /** Resolves when the process exits (immediate success for a dry-run stub). */
  get status(): Promise<Deno.CommandStatus> {
    return this.#child?.status ??
      Promise.resolve({ success: true, code: 0, signal: null });
  }

  /**
   * Terminate the process and wait for it to exit. Sends `signal` (default
   * `SIGTERM`); if the process has not exited within `graceMs` (default 5s), it
   * escalates to `SIGKILL` so a process that ignores `SIGTERM` cannot hang
   * teardown. A process that has already exited is treated as stopped. A
   * dry-run stub (no child) is a no-op.
   */
  stop(
    signal: Deno.Signal = "SIGTERM",
    graceMs: number = TERMINATION_GRACE_MS,
  ): Promise<void> {
    const child = this.#child;
    if (child === undefined) return Promise.resolve(); // stub: nothing to stop.
    return terminateProcess(child, signal, graceMs);
  }
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

/**
 * A lazily-executed command. Built by the `$` tagged template. The process does
 * not start until the command is awaited or a terminal method (`text`, `lines`,
 * `code`) is called; the result is memoised so repeated reads are cheap.
 */
export class Command implements PromiseLike<CommandOutput> {
  #argv: string[];
  #env: Record<string, string> = {};
  #cwd?: string;
  #throwOnError = true;
  #quiet = false;
  #capturing = false;
  #timeoutMs?: number;
  #signal?: AbortSignal;
  #maxCapturedBytes = DEFAULT_MAX_CAPTURED_BYTES;
  #result?: Promise<RunResult>;

  /** Build a command from a discrete argv array (binary first). */
  constructor(argv: string[]) {
    this.#argv = argv;
  }

  /** Merge additional environment variables. */
  env(record: Record<string, string>): this {
    this.#env = { ...this.#env, ...record };
    return this;
  }

  /** Set the working directory for the process. */
  cwd(path: PathLike): this {
    this.#cwd = String(path);
    return this;
  }

  /** Do not throw on a non-zero exit; combine with {@link code}. */
  noThrow(): this {
    this.#throwOnError = false;
    return this;
  }

  /** Suppress live stdout/stderr streaming to the terminal. */
  quiet(): this {
    this.#quiet = true;
    return this;
  }

  /**
   * Kill the process if it runs longer than `ms` milliseconds, raising a
   * {@link CommandTimeoutError}. Fires even under {@link noThrow}.
   */
  killAfter(ms: number): this {
    this.#timeoutMs = ms;
    return this;
  }

  /**
   * Cap how much of **each** captured stream is kept in memory, in bytes
   * (default 8 MiB). Capture keeps the newest bytes: once the cap is reached the
   * oldest are dropped, {@link CommandOutput.truncated} is set, and
   * {@link CommandOutput.text} prefixes a notice. Raise it for a command whose
   * whole output you must parse; lower it to bound a chatty one. Live streaming
   * to the terminal is never capped — every byte still reaches it.
   *
   * @throws {RangeError} If `bytes` is not a positive whole number.
   */
  maxCapturedBytes(bytes: number): this {
    checkMaxCapturedBytes(bytes);
    this.#maxCapturedBytes = bytes;
    return this;
  }

  /**
   * Terminate the process (via `SIGTERM`) when `signal` aborts — for example
   * when the enclosing run is cancelled. Overrides the executor's ambient
   * run signal for this command. Composes with {@link killAfter}: either the
   * timeout or the abort kills the process, whichever fires first.
   */
  signal(signal: AbortSignal): this {
    this.#signal = signal;
    return this;
  }

  /**
   * The command line, for diagnostics — argv joined by spaces, with the resolved
   * value of every `secret` parameter of the enclosing run masked. This is the
   * only rendered form of the command (the echo under `--dry-run`, a
   * {@link CommandError} message), so a secret passed as an argv token cannot
   * leak through one. The argv given to the operating system is unchanged.
   */
  get commandLine(): string {
    return redactLine(this.#argv.join(" "));
  }

  #run(): Promise<RunResult> {
    if (!this.#result) this.#result = this.#dispatch();
    return this.#result;
  }

  /**
   * Under a deep dry run (an ambient echo sink is installed), report the resolved
   * command line and resolve to an empty success without spawning; otherwise run
   * the process for real.
   */
  #dispatch(): Promise<RunResult> {
    const echo = ambientEcho();
    if (echo !== undefined) {
      echo(this.commandLine);
      return Promise.resolve({
        code: 0,
        stdout: "",
        stderr: "",
        truncated: false,
      });
    }
    return this.#spawn();
  }

  async #spawn(): Promise<RunResult> {
    const [cmd, ...args] = this.#argv;
    if (!cmd) throw new Error("Cannot run an empty command.");

    const ms = this.#timeoutMs;
    // `timedOut` distinguishes a timeout kill from an ordinary non-zero exit so
    // we can raise a dedicated error.
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const child = new Deno.Command(cmd, {
        args,
        cwd: this.#cwd,
        env: this.#env,
        stdout: "piped",
        stderr: "piped",
        // Cancellation (an explicit `.signal()`, else the executor's ambient run
        // signal) terminates the child too, independently of the timeout below.
        signal: this.#signal ?? ambientSignal(),
      }).spawn();

      // A timeout terminates the child itself rather than aborting the spawn
      // signal, because that only ever delivers SIGTERM: a child that ignores it
      // would keep the streams open and hang the run forever. The escalating
      // sequence guarantees the process dies and this promise settles.
      if (ms !== undefined) {
        timer = setTimeout(() => {
          timedOut = true;
          void terminateProcess(child);
        }, ms);
      }

      // When capturing programmatically, don't echo stdout to the terminal.
      const streamStdout = !this.#quiet && !this.#capturing;
      const streamStderr = !this.#quiet;

      // Capture is bounded (per stream) so a runaway child cannot grow the buffer
      // until the run dies; the tee to the terminal above stays unbounded.
      const cap = this.#maxCapturedBytes;
      const [stdout, stderr] = await Promise.all([
        captureStream(child.stdout, streamStdout ? Deno.stdout : null, cap),
        captureStream(child.stderr, streamStderr ? Deno.stderr : null, cap),
      ]);
      const status = await child.status;
      if (timedOut && ms !== undefined) {
        throw new CommandTimeoutError(this.commandLine, ms);
      }
      return {
        code: status.code,
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  #maybeThrow(r: RunResult): void {
    if (r.code !== 0 && this.#throwOnError) {
      throw new CommandError(this.commandLine, r.code, r.stderr);
    }
  }

  /** Await support: run the command and resolve to a {@link CommandOutput}. */
  then<TResult1 = CommandOutput, TResult2 = never>(
    onfulfilled?:
      | ((value: CommandOutput) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.#output().then(onfulfilled, onrejected);
  }

  async #output(): Promise<CommandOutput> {
    const r = await this.#run();
    this.#maybeThrow(r);
    return new CommandOutput(
      r.code,
      r.stdout,
      r.stderr,
      r.truncated,
      this.#maxCapturedBytes,
    );
  }

  /**
   * Run and resolve to trimmed stdout — prefixed with a truncation notice if the
   * capture cap was hit. Throws on non-zero unless `noThrow`.
   */
  async text(): Promise<string> {
    this.#capturing = true;
    return (await this.#output()).text();
  }

  /** Run and resolve to stdout split into lines (trailing blank dropped). */
  async lines(): Promise<string[]> {
    const text = await this.text();
    return text.length === 0 ? [] : text.split("\n");
  }

  /** Run and resolve to the numeric exit code. Never throws on non-zero. */
  async code(): Promise<number> {
    const r = await this.#run();
    return r.code;
  }

  /**
   * Start the command as a long-lived process **without** waiting for it to
   * exit, returning a {@link SpawnedProcess} handle. Use this for a service —
   * a dev server, a database, `docker compose up` — that must keep running
   * while other targets execute; stop it with {@link SpawnedProcess.stop}.
   * stdout/stderr are inherited so the process's output is visible.
   */
  spawn(): SpawnedProcess {
    const [cmd, ...args] = this.#argv;
    if (!cmd) throw new Error("Cannot spawn an empty command.");
    // Under a deep dry run, echo the command and hand back a no-op stub instead
    // of starting a real long-lived process.
    const echo = ambientEcho();
    if (echo !== undefined) {
      echo(this.commandLine);
      return new SpawnedProcess(undefined, this.commandLine);
    }
    const child = new Deno.Command(cmd, {
      args,
      cwd: this.#cwd,
      env: this.#env,
      stdout: "inherit",
      stderr: "inherit",
      signal: this.#signal ?? ambientSignal(),
    }).spawn();
    return new SpawnedProcess(child, this.commandLine);
  }
}

/**
 * Tokenise a tagged-template invocation into an argv array.
 *
 * Literal whitespace separates arguments; interpolated values are appended as
 * atomic tokens (so `--flag=${x}` and `pre${x}` work), and arrays expand to one
 * argument per element. Interpolated values are never re-split on whitespace,
 * which is what keeps command construction injection-free.
 */
export function tokenize(
  strings: ReadonlyArray<string>,
  values: ReadonlyArray<Interpolatable>,
): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasCurrent = false;

  const append = (s: string) => {
    current += s;
    hasCurrent = true;
  };
  const flush = () => {
    if (hasCurrent) {
      tokens.push(current);
      current = "";
      hasCurrent = false;
    }
  };

  for (let i = 0; i < strings.length; i++) {
    let buf = "";
    for (const ch of strings[i]) {
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        if (buf) {
          append(buf);
          buf = "";
        }
        flush();
      } else {
        buf += ch;
      }
    }
    if (buf) append(buf);

    if (i < values.length) {
      const v = values[i];
      const arr = Array.isArray(v) ? v : [v];
      for (let j = 0; j < arr.length; j++) {
        if (j > 0) flush();
        append(String(arr[j]));
      }
    }
  }
  flush();
  return tokens;
}

/**
 * Run an external command, ergonomically.
 *
 * @example `await $\`deno test -A\``
 */
export function $(
  strings: TemplateStringsArray,
  ...values: Interpolatable[]
): Command {
  return new Command(tokenize(strings, values));
}
