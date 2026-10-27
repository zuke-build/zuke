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

import type { TargetContext, TargetStateHandle } from "@zuke/core";
import { Command } from "@zuke/core/shell";
import { ToolSettings } from "@zuke/core/tooling";
import { Peer, RpcFailure } from "./peer.ts";
import {
  CANCELLED,
  type ConfigureParams,
  type ExecRequest,
  type Hello,
  type HookName,
  type LateSettings,
  type Manifest,
  type ManifestTarget,
  parseBooleanAnswer,
  parseCacheKey,
  parseExec,
  parseHandle,
  parseHello,
  parseLog,
  parseManifest,
  parseOutcome,
  parseSecret,
  parseSettings,
  parseStateRead,
  parseStateWrite,
  parseSummary,
  parseTargeted,
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

/**
 * What a worker request is served with: the body's context while a body
 * runs, or only a cancel signal during a service phase, which has no body.
 */
interface Scope {
  readonly signal: AbortSignal;
  readonly ctx?: TargetContext;
}

/** One request waiting to be served inside its target's scope. */
interface Call {
  readonly run: (scope: Scope) => Promise<unknown>;
  readonly settle: (run: () => Promise<unknown>) => void;
}

/** The body context of `scope`, refused by name during a service phase. */
function bodyOf(scope: Scope, method: string): TargetContext {
  if (scope.ctx === undefined) {
    throw new RpcFailure(-32000, `${method}: a service phase has no body`);
  }
  return scope.ctx;
}

/**
 * The one public way to register a secret with the run's ambient redactor is
 * what a tool wrapper does from its settings; this is a settings class that
 * runs no tool and only registers.
 */
class SecretRegistrar extends ToolSettings {
  protected defaultTool(): string {
    return "zuke";
  }

  protected buildArgs(): string[] {
    return [];
  }

  /** Redact `value` from everything the run prints or records from now on. */
  register(value: string): void {
    this.markSecret(value);
  }
}

function stateOf(
  ctx: TargetContext,
  of: string | undefined,
): TargetStateHandle {
  return of === undefined ? ctx.state : ctx.stateOf(of);
}

/** The run plan as JSON: the planned targets and each one's dependencies. */
function planOf(ctx: TargetContext): unknown {
  const plan = ctx.plan();
  return {
    targets: plan.targets,
    dependencies: Object.fromEntries(
      plan.targets.map((t) => [t, plan.dependenciesOf(t)]),
    ),
  };
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
  /** Aborted when the host is killed: the signal a service phase's execs get. */
  readonly #aborter = new AbortController();

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
    const registrar = new SecretRegistrar();
    const serve = <R extends { readonly target: string }>(
      method: string,
      parse: (params: unknown) => R,
      run: (request: R, scope: Scope) => Promise<unknown> | unknown,
    ) =>
      peer.on(method, (params) => {
        const request = parse(params);
        return this.#enqueue(
          request.target,
          async (scope) => await run(request, scope),
        );
      });
    // A call a body makes: refused by name during a service phase.
    const inBody = <R extends { readonly target: string }>(
      method: string,
      parse: (params: unknown) => R,
      run: (request: R, ctx: TargetContext) => Promise<unknown> | unknown,
    ) => serve(method, parse, (r, scope) => run(r, bodyOf(scope, method)));
    serve("exec", parseExec, (r, scope) => this.#exec(r, scope.signal));
    serve("secret.register", parseSecret, (r) => registrar.register(r.value));
    serve("log", parseLog, (r) => console.log(r.line));
    inBody(
      "state.get",
      (p) => parseStateRead(p, "state.get"),
      (r, ctx) => stateOf(ctx, r.of).get(),
    );
    inBody(
      "state.set",
      (p) => parseStateWrite(p, "state.set"),
      (r, ctx) => stateOf(ctx, r.of).set(r.patch),
    );
    inBody(
      "state.trySet",
      (p) => parseStateWrite(p, "state.trySet"),
      async (r, ctx) => ({
        recorded: await stateOf(ctx, r.of).trySet(r.patch),
      }),
    );
    inBody("outcome.of", parseOutcome, (r, ctx) => ctx.outcomeOf(r.of) ?? null);
    inBody(
      "outcomes",
      (p) => ({ target: parseTargeted(p, "outcomes") }),
      (_, ctx) => Object.fromEntries(ctx.outcomes()),
    );
    inBody(
      "summary.report",
      parseSummary,
      (r, ctx) => ctx.reportSummary(r.pairs),
    );
    inBody(
      "plan",
      (p) => ({ target: parseTargeted(p, "plan") }),
      (_, ctx) => planOf(ctx),
    );
    inBody(
      "signals",
      (p) => ({ target: parseTargeted(p, "signals") }),
      (_, ctx) => Object.fromEntries(ctx.signals),
    );
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
    return parseBooleanAnswer(
      "target.condition",
      await this.#peer.request("target.condition", { target }),
      target,
    );
  }

  /** Ask for the late settings a target declared, once parameters resolved. */
  async settings(target: ManifestTarget): Promise<LateSettings> {
    return parseSettings(
      await this.#peer.request("target.settings", { target: target.name }),
      target,
    );
  }

  /** Ask whether a `resumeWhen` gate's predicate holds now. */
  async waitCheck(target: string): Promise<boolean> {
    return parseBooleanAnswer(
      "wait.check",
      await this.#peer.request("wait.check", { target }),
      target,
    );
  }

  /** Run one of a target's `validateDuring` checks; rejects with its message. */
  async validate(target: string, check: string): Promise<void> {
    await this.#peer.request("target.validate", { target, check });
  }

  /** Ask for the named target's extra cache key. */
  async cacheKey(target: string): Promise<string> {
    return parseCacheKey(
      await this.#peer.request("target.cacheKey", { target }),
      target,
    );
  }

  /**
   * Run one target's body in the worker, serving the calls it makes until it
   * settles. Rejects with the worker's message when the body fails.
   */
  async runTarget(name: string, ctx: TargetContext): Promise<void> {
    let grace: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      void this.#peer.notify("run.cancel", { target: name });
      // A body that ignores the cancel is cut off after the grace period; the
      // closed peer then rejects the request, so the loop cannot hang.
      grace = setTimeout(() => this.kill(), this.#graceMs);
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    try {
      await this.#attend(
        name,
        { signal: ctx.signal, ctx },
        () =>
          this.#peer.request("target.run", {
            target: name,
            runId: ctx.runId,
            dryRun: ctx.dryRun,
          }),
      );
    } finally {
      clearTimeout(grace);
      ctx.signal.removeEventListener("abort", onAbort);
    }
  }

  /** Start a service in the worker; its start phase may `exec`. */
  async serviceStart(target: string): Promise<string> {
    return parseHandle(
      await this.#phase(
        target,
        () => this.#peer.request("service.start", { target }),
      ),
      target,
    );
  }

  /** Ask whether a started service is ready. */
  async serviceReady(target: string, handle: string): Promise<boolean> {
    return parseBooleanAnswer(
      "service.ready",
      await this.#phase(
        target,
        () => this.#peer.request("service.ready", { target, handle }),
      ),
      target,
    );
  }

  /** Stop a started service; its stop phase may `exec`. */
  async serviceStop(target: string, handle: string): Promise<void> {
    await this.#phase(
      target,
      () => this.#peer.request("service.stop", { target, handle }),
    );
  }

  /** A service phase: served like a body, with no body context. */
  #phase(target: string, request: () => Promise<unknown>): Promise<unknown> {
    return this.#attend(target, { signal: this.#aborter.signal }, request);
  }

  /**
   * Make `request` and, until it settles, serve the calls the worker makes for
   * `name` inside `scope`: each runs here, in this async context, so the
   * ambient dry-run echo, cancel signal and redactor reach it.
   */
  async #attend(
    name: string,
    scope: Scope,
    request: () => Promise<unknown>,
  ): Promise<unknown> {
    const channel = new Channel();
    this.#channels.set(name, channel);
    const finished = request().finally(() => channel.close());
    finished.catch(() => {}); // Observed below; never an unhandled rejection.
    try {
      for await (const call of channel) {
        call.settle(() => call.run(scope));
      }
      return await finished;
    } finally {
      this.#channels.delete(name);
    }
  }

  /**
   * Tell the worker the run is over, or suspended at a gate, wait for it to
   * exit, release everything.
   */
  async finish(code: number, suspended = false): Promise<void> {
    await this.#peer.notify("run.exit", { code, suspended });
    this.#peer.close();
    const exited = this.#child.status.then(() => true);
    if (!(await Promise.race([exited, after(this.#graceMs)]))) {
      await stopChild(this.#child, this.#graceMs);
    }
    await this.#background.catch(() => {});
  }

  /** Kill the worker outright, and whatever its service phases spawned. */
  kill(): void {
    this.#aborter.abort();
    this.#peer.close();
    signal(this.#child, "SIGTERM");
  }

  #enqueue(
    target: string,
    run: (scope: Scope) => Promise<unknown>,
  ): Promise<unknown> {
    const channel = this.#channels.get(target);
    if (channel === undefined) {
      throw new RpcFailure(-32000, `target "${target}" has no body running`);
    }
    return new Promise((resolve, reject) => {
      channel.push({ run, settle: (run) => run().then(resolve, reject) });
    });
  }

  async #exec(request: ExecRequest, signal: AbortSignal): Promise<unknown> {
    // shortcut: the engine's own environment is not cleared, so a variable the
    // worker lacks but the engine has still reaches the child; add clearEnv
    // once a worker needs an exact environment.
    let command = new Command([...request.argv])
      .cwd(request.cwd ?? this.#hello.cwd)
      .env({ ...this.#hello.env, ...request.env })
      .noThrow()
      .signal(signal);
    if (request.stdin !== undefined) command = command.stdin(request.stdin);
    const output = await command;
    if (signal.aborted) throw new RpcFailure(CANCELLED, "cancelled");
    return { code: output.code, stdout: output.stdout, stderr: output.stderr };
  }
}
