// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The worker host: spawns the SDK worker, accepts its one loopback connection,
 * and serves the calls a target body makes while the engine runs the graph.
 *
 * Every `exec` a body asks for runs inside that body's own async context, so
 * the executor's ambient dry-run echo, cancel signal and redactor apply to it
 * exactly as they apply to a `$` call in a TypeScript build.
 *
 * @module
 */

import type { TargetContext } from "@zuke/core";
import { Command } from "@zuke/core/shell";
import { Peer, RpcFailure } from "./peer.ts";
import {
  CANCELLED,
  type ConfigureParams,
  type ExecRequest,
  type Hello,
  type HookName,
  type Manifest,
  parseCacheKey,
  parseCondition,
  parseExec,
  parseHello,
  parseManifest,
  PROTOCOL_VERSION,
} from "./protocol.ts";

/** How the host starts its worker. */
export interface WorkerOptions {
  /** The worker's argv, from `zuke.json`'s `sdk.command`. */
  readonly command: readonly string[];
  /** The directory to start the worker in. */
  readonly cwd: string;
  /** How long to wait for the worker's `hello` before giving up. */
  readonly connectTimeoutMs?: number;
  /** How long a cancelled body may take to settle before the worker is killed. */
  readonly graceMs?: number;
}

/** One `exec` waiting to be run inside its target's body. */
interface Call {
  readonly request: ExecRequest;
  readonly settle: (run: () => Promise<unknown>) => void;
}

/** A queue the socket pushes into and a target body drains. */
class Channel {
  #items: Call[] = [];
  #wake: (() => void) | undefined;
  #closed = false;

  push(item: Call): void {
    this.#items.push(item);
    this.#wake?.();
  }

  close(): void {
    this.#closed = true;
    this.#wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Call> {
    while (true) {
      const next = this.#items.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.#closed) return;
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
      this.#wake = undefined;
    }
  }
}

function forwardLines(
  stream: ReadableStream<Uint8Array>,
  write: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffered = "";
  return stream.pipeTo(
    new WritableStream({
      write(chunk) {
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) write(line);
      },
      close() {
        if (buffered !== "") write(buffered);
      },
    }),
  );
}

function after(ms: number): Promise<false> {
  return new Promise((resolve) => setTimeout(() => resolve(false), ms));
}

function signal(child: Deno.ChildProcess, name: Deno.Signal): void {
  try {
    child.kill(name);
  } catch {
    // Already exited: nothing left to signal.
  }
}

/**
 * Stop the worker and wait for it, bounded: SIGTERM, then SIGKILL after the
 * grace period, so a worker that ignores the first never stalls the caller.
 */
async function stopChild(
  child: Deno.ChildProcess,
  graceMs: number,
): Promise<void> {
  const exited = child.status.then(() => true);
  signal(child, "SIGTERM");
  if (!(await Promise.race([exited, after(graceMs)]))) signal(child, "SIGKILL");
  await exited;
}

/** The worker host. Start one with {@link WorkerHost.start}. */
export class WorkerHost {
  readonly #peer: Peer;
  readonly #child: Deno.ChildProcess;
  readonly #hello: Hello;
  readonly #graceMs: number;
  readonly #background: Promise<unknown>;
  readonly #channels = new Map<string, Channel>();

  private constructor(
    peer: Peer,
    child: Deno.ChildProcess,
    hello: Hello,
    background: Promise<unknown>,
    graceMs: number,
  ) {
    this.#peer = peer;
    this.#child = child;
    this.#hello = hello;
    this.#background = background;
    this.#graceMs = graceMs;
    peer.on("exec", (params) => this.#enqueue(parseExec(params)));
  }

  /** The SDK the worker announced itself as. */
  get sdk(): string {
    return this.#hello.sdk;
  }

  /**
   * Listen on loopback, spawn the worker with the address and a fresh token in
   * its environment, and wait for its `hello`. The listener accepts exactly one
   * connection and closes.
   */
  static async start(options: WorkerOptions): Promise<WorkerHost> {
    const [program, ...args] = options.command;
    if (program === undefined) {
      throw new Error("zuke: sdk.command in zuke.json must not be empty");
    }
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const token = crypto.randomUUID();
    const child = new Deno.Command(program, {
      args,
      cwd: options.cwd,
      env: {
        ZUKE_ENGINE_ADDR: `127.0.0.1:${listener.addr.port}`,
        ZUKE_ENGINE_TOKEN: token,
        ZUKE_PROTOCOL: String(PROTOCOL_VERSION),
      },
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    // The worker's own output is the build's log, never the protocol, and it
    // goes to stderr so `--list --json` on stdout stays machine-readable.
    const forwarding = Promise.all([
      forwardLines(child.stdout, (l) => console.error(`worker: ${l}`)),
      forwardLines(child.stderr, (l) => console.error(`worker: ${l}`)),
    ]);
    const timeoutMs = options.connectTimeoutMs ?? 10_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `zuke: the worker (${options.command.join(" ")}) did not ` +
                `connect within ${timeoutMs}ms`,
            ),
          ),
        timeoutMs,
      );
    });
    // A worker that dies before connecting fails the start at once, with its
    // exit code, instead of after the connect timeout.
    const exited = child.status.then((status) => {
      throw new Error(
        `zuke: the worker (${options.command.join(" ")}) exited with code ` +
          `${status.code} before connecting`,
      );
    });
    exited.catch(() => {}); // Rejects after every normal exit too; raced below.
    let peer: Peer | undefined;
    try {
      const conn = await Promise.race([listener.accept(), timeout, exited]);
      listener.close();
      conn.setNoDelay(true);
      const connected = new Peer(conn);
      peer = connected;
      const hello = new Promise<Hello>((resolve, reject) => {
        connected.on("hello", (params) => {
          try {
            resolve(parseHello(params, token));
            return {};
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
            throw error;
          }
        });
      });
      const serving = connected.serve();
      const greeted = await Promise.race([hello, timeout, exited]);
      return new WorkerHost(
        connected,
        child,
        greeted,
        Promise.all([serving, forwarding]),
        options.graceMs ?? 5_000,
      );
    } catch (error) {
      if (peer === undefined) listener.close();
      else peer.close();
      await stopChild(child, options.graceMs ?? 5_000);
      await forwarding;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ask the worker to describe its build. */
  async describe(): Promise<Manifest> {
    return parseManifest(await this.#peer.request("build.describe", {}));
  }

  /** Tell the worker the resolved parameters. */
  async configure(params: ConfigureParams): Promise<void> {
    await this.#peer.request("build.configure", params);
  }

  /** Call a build hook the manifest flagged and wait for it to settle. */
  async hook(name: HookName, params: unknown): Promise<void> {
    await this.#peer.request(`build.${name}`, params);
  }

  /** Ask whether the named target's condition holds. */
  async condition(target: string): Promise<boolean> {
    return parseCondition(
      await this.#peer.request("target.condition", { target }),
      target,
    );
  }

  /** Ask for the named target's extra cache key. */
  async cacheKey(target: string): Promise<string> {
    return parseCacheKey(
      await this.#peer.request("target.cacheKey", { target }),
      target,
    );
  }

  /**
   * Run one target's body in the worker, serving the `exec` calls it makes
   * until it settles. Rejects with the worker's message when the body fails.
   */
  async runTarget(name: string, ctx: TargetContext): Promise<void> {
    const channel = new Channel();
    this.#channels.set(name, channel);
    const finished = this.#peer
      .request("target.run", {
        target: name,
        runId: ctx.runId,
        dryRun: ctx.dryRun,
      })
      .finally(() => channel.close());
    finished.catch(() => {}); // Observed below; never an unhandled rejection.
    let grace: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      void this.#peer.notify("run.cancel", { target: name });
      // A body that ignores the cancel is cut off after the grace period; the
      // closed peer then rejects `finished`, so the loop below cannot hang.
      grace = setTimeout(() => this.kill(), this.#graceMs);
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    try {
      // Each call runs here, inside the body's async context, so the ambient
      // dry-run echo and cancel signal reach the command.
      for await (const call of channel) {
        call.settle(() => this.#exec(call.request, ctx));
      }
      await finished;
    } finally {
      clearTimeout(grace);
      ctx.signal.removeEventListener("abort", onAbort);
      this.#channels.delete(name);
    }
  }

  /** Tell the worker the run is over, wait for it to exit, release everything. */
  async finish(code: number): Promise<void> {
    await this.#peer.notify("run.exit", { code });
    this.#peer.close();
    const exited = this.#child.status.then(() => true);
    if (!(await Promise.race([exited, after(this.#graceMs)]))) {
      await stopChild(this.#child, this.#graceMs);
    }
    await this.#background.catch(() => {});
  }

  /** Kill the worker outright. */
  kill(): void {
    this.#peer.close();
    signal(this.#child, "SIGTERM");
  }

  #enqueue(request: ExecRequest): Promise<unknown> {
    const channel = this.#channels.get(request.target);
    if (channel === undefined) {
      throw new RpcFailure(
        -32000,
        `exec: target "${request.target}" has no body running`,
      );
    }
    return new Promise((resolve, reject) => {
      channel.push({
        request,
        settle: (run) => run().then(resolve, reject),
      });
    });
  }

  async #exec(request: ExecRequest, ctx: TargetContext): Promise<unknown> {
    // shortcut: the engine's own environment is not cleared, so a variable the
    // worker lacks but the engine has still reaches the child; add clearEnv
    // once a worker needs an exact environment.
    let command = new Command([...request.argv])
      .cwd(request.cwd ?? this.#hello.cwd)
      .env({ ...this.#hello.env, ...request.env })
      .noThrow()
      .signal(ctx.signal);
    if (request.stdin !== undefined) command = command.stdin(request.stdin);
    const output = await command;
    if (ctx.signal.aborted) throw new RpcFailure(CANCELLED, "cancelled");
    return { code: output.code, stdout: output.stdout, stderr: output.stderr };
  }
}
