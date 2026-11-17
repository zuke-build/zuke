// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Starting a child process on `node:child_process`, for a runtime that is
 * not Deno. It gives the shell the same {@link ChildProcess} the Deno call
 * does, with these differences settled here so nothing above sees them.
 *
 * - **A command that cannot be started.** Node learns it after the call has
 *   returned, so nothing is thrown: the child's `status` rejects with the
 *   error, its `pid` is `-1`, and its streams are empty.
 * - **A child ended by a signal.** Node reports no exit code for one. It is
 *   given the code a shell reports, 128 plus the signal's number.
 * - **Closing the input of a child that has exited.** It succeeds, as it does
 *   on Deno, where Node would fail it.
 * - **The environment.** Node replaces the environment with what it is given,
 *   so the parent's is put under it, unless the child is to start from an
 *   empty one.
 *
 * - **Variable names on Windows.** They are not case-sensitive there, so a
 *   variable given replaces the parent's whatever its case, as it does on
 *   Deno, where Node would keep whichever sorts first.
 *
 * Node reports only some failures late: a command that is not there or may
 * not be run. Any other, a working directory that is a file for one, it
 * throws at once, as Deno does.
 *
 * A Windows batch file is started through `cmd.exe` on a line built so that
 * no argument can become a command, see `process_batch.ts`; and where it is
 * only a package manager's shim for a Node script, the script is started
 * directly, see `process_shim.ts`.
 *
 * @module
 */

import { type ChildProcess as NodeChild, spawn } from "node:child_process";
import { constants } from "node:os";
import process from "node:process";
import { Readable, Writable } from "node:stream";
import { isFileSync, readSmallTextSync } from "./fs.ts";
import { invocation } from "./process_batch.ts";
import type { ChildProcess, ProcessOptions, ProcessStdio } from "./process.ts";
import type { CommandStatus, Signal } from "./signal.ts";

/** The most a batch file may hold and still be read to see whether it is a shim. */
const SHIM_LIMIT = 64 * 1024;

/** The `stdio` entry Node names each {@link ProcessStdio}. */
function nodeStdio(
  stdio: ProcessStdio | undefined,
): "inherit" | "pipe" | "ignore" {
  if (stdio === "piped") return "pipe";
  return stdio === "null" ? "ignore" : "inherit";
}

/** The number of the signal called `name`, or `undefined` if there is none. */
function signalNumber(name: string): number | undefined {
  return Object.entries(constants.signals).find(([known]) => known === name)
    ?.[1];
}

/** Whether `name` is a signal this platform has, and so one of {@link Signal}. */
function isSignal(name: string): name is Signal {
  return signalNumber(name) !== undefined;
}

/** How a child Node saw exit with `code`, or die of `signal`, ended. */
function statusOf(code: number | null, signal: string | null): CommandStatus {
  if (signal !== null && isSignal(signal)) {
    return {
      success: false,
      code: 128 + (signalNumber(signal) ?? 0),
      signal,
    };
  }
  return { success: code === 0, code: code ?? 1, signal: null };
}

/** The error for reading a stream that was not piped. */
function notPiped(name: string): TypeError {
  return new TypeError(`The child's ${name} is not piped`);
}

/**
 * A child's input as a web stream. Node tears the pipe down when the child
 * exits, after which closing it fails; closing the input of a child that has
 * gone is not a failure, so that one is let through.
 */
function inputOf(stdin: Writable): WritableStream<Uint8Array> {
  const writer = Writable.toWeb(stdin).getWriter();
  return new WritableStream({
    write: (chunk) => writer.write(chunk),
    close: () => writer.close().catch(() => {}),
    abort: (reason) => writer.abort(reason),
  });
}

/** A {@link ChildProcess} over a child Node started, or could not start. */
class NodeChildProcess implements ChildProcess {
  readonly #child: NodeChild;
  readonly #stdin: WritableStream<Uint8Array> | null;
  readonly #stdout: ReadableStream<Uint8Array> | null;
  readonly #stderr: ReadableStream<Uint8Array> | null;
  /** The operating-system process id, or `-1` for a child that never started. */
  readonly pid: number;
  /** Resolves when the process exits; rejects if it could not be started. */
  readonly status: Promise<CommandStatus>;

  /** Wrap `child`, which was started with `options`. */
  constructor(child: NodeChild, options: ProcessOptions) {
    this.#child = child;
    this.pid = child.pid ?? -1;
    const started = child.pid !== undefined;
    this.status = new Promise<CommandStatus>((resolve, reject) => {
      child.once("exit", (code, signal) => resolve(statusOf(code, signal)));
      // Node also reports an abort, and a signal it could not deliver, as an
      // error on a child that is running. Only a child that never started
      // has no exit to wait for.
      child.on("error", (error) => {
        if (!started) reject(error);
      });
    });
    // A caller that only stops the child never reads this; whoever does read
    // it still sees the rejection.
    this.status.catch(() => {});
    this.#stdin = options.stdin !== "piped"
      ? null
      : started && child.stdin !== null
      ? inputOf(child.stdin)
      : new WritableStream();
    this.#stdout = NodeChildProcess.#output(
      options.stdout,
      started,
      child.stdout,
    );
    this.#stderr = NodeChildProcess.#output(
      options.stderr,
      started,
      child.stderr,
    );
  }

  /** A piped output as a web stream: the child's, or an empty one if it never started. */
  static #output(
    stdio: ProcessStdio | undefined,
    started: boolean,
    stream: Readable | null,
  ): ReadableStream<Uint8Array> | null {
    if (stdio !== "piped") return null;
    if (started && stream !== null) return Readable.toWeb(stream);
    return new ReadableStream({ start: (controller) => controller.close() });
  }

  /** Deliver a signal to the process. Throws if it has already exited. */
  kill(signal: Signal = "SIGTERM"): void {
    const number = signalNumber(signal);
    if (number === undefined) {
      throw new TypeError(`This platform has no signal ${signal}`);
    }
    if (
      this.#child.pid === undefined || this.#child.exitCode !== null ||
      this.#child.signalCode !== null
    ) {
      throw new TypeError("Child process has already terminated");
    }
    this.#child.kill(number);
  }

  /** The child's input. */
  get stdin(): WritableStream<Uint8Array> {
    if (this.#stdin === null) throw notPiped("stdin");
    return this.#stdin;
  }

  /** The child's output. */
  get stdout(): ReadableStream<Uint8Array> {
    if (this.#stdout === null) throw notPiped("stdout");
    return this.#stdout;
  }

  /** The child's error output. */
  get stderr(): ReadableStream<Uint8Array> {
    if (this.#stderr === null) throw notPiped("stderr");
    return this.#stderr;
  }
}

/**
 * The environment a child is given: the parent's, with `added` over it. On
 * Windows a parent variable whose name differs from an added one only in
 * case is dropped, so the added one is the only one there.
 */
export function childEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
  added: Readonly<Record<string, string>>,
  windows: boolean,
): Record<string, string | undefined> {
  if (!windows) return { ...parent, ...added };
  const replaced = new Set(
    Object.keys(added).map((name) => name.toUpperCase()),
  );
  const kept = Object.entries(parent).filter(([name]) =>
    !replaced.has(name.toUpperCase())
  );
  return { ...Object.fromEntries(kept), ...added };
}

/**
 * Start `command` with `options` on `node:child_process`. The command and
 * each argument reach the child as they are: no shell reads them, and for a
 * Windows batch file, which only `cmd.exe` can run, the line it reads is
 * built so that they still do.
 *
 * @throws {Error} for a batch file whose path or arguments cannot be passed
 * safely.
 */
export function spawnOnNode(
  command: string,
  options: ProcessOptions,
): ChildProcess {
  const windows = process.platform === "win32";
  const added = options.env ?? {};
  const env = options.clearEnv
    ? added
    : options.env === undefined
    ? undefined
    : childEnvironment(process.env, added, windows);
  const start = invocation(
    command,
    options.args,
    windows,
    process.env,
    env ?? process.env,
    {
      isFile: isFileSync,
      readText: (path) => readSmallTextSync(path, SHIM_LIMIT),
    },
  );
  const child = spawn(start.file, start.args, {
    cwd: options.cwd,
    env,
    // The whole line is then the one written: nothing is quoted again, and
    // it begins with the bare name, as the line Rust builds does.
    windowsVerbatimArguments: start.verbatim,
    argv0: start.verbatim ? "cmd.exe" : undefined,
    stdio: [
      nodeStdio(options.stdin),
      nodeStdio(options.stdout),
      nodeStdio(options.stderr),
    ],
    signal: options.signal,
    windowsHide: true,
  });
  return new NodeChildProcess(child, options);
}
