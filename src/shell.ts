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
 */

/** A value that may be interpolated into a `$` template. */
export type Interpolatable =
  | string
  | number
  | Array<string | number>;

/** Raised when a command exits non-zero and throwing was not suppressed. */
export class CommandError extends Error {
  override name = "CommandError";
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

/** The resolved result of a command, available when awaiting a {@link Command}. */
export class CommandOutput {
  constructor(
    readonly code: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {}

  /** Trimmed stdout. */
  text(): string {
    return this.stdout.trim();
  }
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Concatenate byte chunks into one buffer and decode as UTF-8. */
function decodeChunks(chunks: Uint8Array[]): string {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(merged);
}

/** Drain a stream, optionally tee-ing each chunk to a live sink, and capture. */
async function collect(
  stream: ReadableStream<Uint8Array>,
  sink: { writeSync(p: Uint8Array): number } | null,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      if (sink) sink.writeSync(value);
    }
  } finally {
    reader.releaseLock();
  }
  return decodeChunks(chunks);
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
  #result?: Promise<RunResult>;

  constructor(argv: string[]) {
    this.#argv = argv;
  }

  /** Merge additional environment variables. */
  env(record: Record<string, string>): this {
    this.#env = { ...this.#env, ...record };
    return this;
  }

  /** Set the working directory for the process. */
  cwd(path: string): this {
    this.#cwd = path;
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

  /** The command line, for diagnostics. */
  get commandLine(): string {
    return this.#argv.join(" ");
  }

  #run(): Promise<RunResult> {
    if (!this.#result) this.#result = this.#spawn();
    return this.#result;
  }

  async #spawn(): Promise<RunResult> {
    const [cmd, ...args] = this.#argv;
    if (!cmd) throw new Error("Cannot run an empty command.");

    const child = new Deno.Command(cmd, {
      args,
      cwd: this.#cwd,
      env: this.#env,
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    // When capturing programmatically, don't echo stdout to the terminal.
    const streamStdout = !this.#quiet && !this.#capturing;
    const streamStderr = !this.#quiet;

    const [stdout, stderr] = await Promise.all([
      collect(child.stdout, streamStdout ? Deno.stdout : null),
      collect(child.stderr, streamStderr ? Deno.stderr : null),
    ]);
    const status = await child.status;
    return { code: status.code, stdout, stderr };
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
    return new CommandOutput(r.code, r.stdout, r.stderr);
  }

  /** Run and resolve to trimmed stdout. Throws on non-zero unless `noThrow`. */
  async text(): Promise<string> {
    this.#capturing = true;
    const r = await this.#run();
    this.#maybeThrow(r);
    return r.stdout.trim();
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
