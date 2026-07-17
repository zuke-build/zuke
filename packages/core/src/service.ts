/**
 * Service targets: long-lived processes that run **while** other targets
 * execute, rather than running to completion.
 *
 * A {@link service} is declared like a {@link target} and depended on the same
 * way (`dependsOn(this.api)`), but the executor treats it differently: it is
 * **started** and waited on until a readiness check passes, then kept alive
 * while its dependents run, and **stopped** when the build finishes — in
 * reverse start order, in a `finally`, so a failed test never leaks a process.
 * This replaces the fragile "start it, `sleep`, hope it's up, kill it later"
 * shell dance around end-to-end tests.
 *
 * ```ts
 * import { service, target, tcpReachable } from "jsr:@zuke/core";
 * import { $ } from "jsr:@zuke/core/shell";
 *
 * class E2E extends Build {
 *   api = service()
 *     .description("API under test")
 *     .start(() => $`deno run -A server.ts`.spawn())   // spawn, don't await
 *     .readyWhen(() => tcpReachable("localhost:8080")); // polled until ready
 *
 *   test = target()
 *     .dependsOn(this.api)                              // api is up + ready first
 *     .executes(() => DenoTasks.test((s) => s.allowAll()));
 * }
 * ```
 *
 * @module
 */

import { TargetBuilder } from "./target.ts";

/** The default time a service is given to become ready before it fails. */
export const DEFAULT_READY_TIMEOUT_MS = 30_000;

/** How often {@link ServiceBuilder.readyWhen} is polled while waiting. */
export const DEFAULT_POLL_INTERVAL_MS = 200;

/** Raised when a service cannot start or does not become ready in time. */
export class ServiceError extends Error {
  /** The error name. */
  override name = "ServiceError";
}

/**
 * A running service — whatever {@link ServiceBuilder.start} returns. Its
 * {@link ServiceHandle.stop} tears it down; a {@link
 * https://jsr.io/@zuke/core SpawnedProcess} is one, so
 * `.start(() => $\`…\`.spawn())` needs no explicit stop.
 */
export interface ServiceHandle {
  /** Terminate the service. Called on teardown unless `.stop()` overrides it. */
  stop(): void | Promise<void>;
}

/** A started service the executor holds until it tears it down. */
export interface RunningService {
  /** The service's target name, for diagnostics. */
  readonly name: string;
  /** Stop the service; never rejects (failures are the registry's concern). */
  stop(): Promise<void>;
}

/** Sleep for `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returned by {@link within} when the deadline elapses before the promise settles. */
const TIMED_OUT = Symbol("timed-out");

/**
 * Resolve `promise`, or {@link TIMED_OUT} if `ms` elapses first. The timer is
 * always cleared, so a promise that settles first leaks nothing; a promise that
 * never settles is simply abandoned (its result is no longer awaited).
 */
async function within<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A message from an unknown thrown value, without casting. */
function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * A long-lived {@link target}. Configure how it starts ({@link
 * ServiceBuilder.start}), how to tell it is ready ({@link
 * ServiceBuilder.readyWhen}), and — when the started handle is not
 * self-stopping — how it stops ({@link ServiceBuilder.stop}). It inherits the
 * ordering methods (`dependsOn`, `before`, `after`, `description`) from
 * {@link TargetBuilder}; a service has no `.executes` body.
 */
export class ServiceBuilder extends TargetBuilder {
  #start?: () => ServiceHandle | Promise<ServiceHandle>;
  #ready?: () => boolean | Promise<boolean>;
  #stop?: (handle: ServiceHandle) => void | Promise<void>;
  #readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS;
  #pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;

  /**
   * How to start the process. Return a {@link ServiceHandle} (e.g.
   * `$\`…\`.spawn()`) so the service can be stopped on teardown; provide a
   * custom {@link ServiceBuilder.stop} if the handle is not self-stopping.
   */
  start(fn: () => ServiceHandle | Promise<ServiceHandle>): this {
    this.#start = fn;
    return this;
  }

  /**
   * A readiness probe, polled until it returns `true` (or the timeout is hit).
   * Without one, the service is considered ready the moment it starts. See
   * {@link tcpReachable} for the common "is the port accepting connections?".
   */
  readyWhen(fn: () => boolean | Promise<boolean>): this {
    this.#ready = fn;
    return this;
  }

  /** Override how long to wait for {@link ServiceBuilder.readyWhen} (default 30s). */
  readyTimeout(ms: number): this {
    this.#readyTimeoutMs = Math.max(0, Math.floor(ms));
    return this;
  }

  /** Custom teardown, given the handle {@link ServiceBuilder.start} returned. */
  stop(fn: (handle: ServiceHandle) => void | Promise<void>): this {
    this.#stop = fn;
    return this;
  }

  /**
   * INTERNAL: start the service and wait until it is ready, returning a handle
   * the executor stops on teardown. Throws {@link ServiceError} if no start was
   * configured, or if the service does not become ready in time (the
   * just-started process is stopped first so it is not leaked).
   */
  async launch_(name: string): Promise<RunningService> {
    if (this.#start === undefined) {
      throw new ServiceError(
        `Service "${name}" has no start — call .start(...) before running.`,
      );
    }
    const handle = await this.#start();
    try {
      await this.#waitReady(name);
    } catch (error) {
      await this.#teardown(handle);
      throw error;
    }
    return { name, stop: () => this.#teardown(handle) };
  }

  /**
   * Poll {@link ServiceBuilder.readyWhen} until it passes or the timeout
   * elapses. Each probe call is itself bounded by the remaining budget, so the
   * timeout holds even if a predicate hangs and never resolves.
   */
  async #waitReady(name: string): Promise<void> {
    if (this.#ready === undefined) return;
    const probe = this.#ready;
    const deadline = performance.now() + this.#readyTimeoutMs;
    const notReady = () =>
      new ServiceError(
        `Service "${name}" was not ready within ${this.#readyTimeoutMs}ms.`,
      );
    while (true) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw notReady();
      const result = await within(Promise.resolve(probe()), remaining);
      if (result === TIMED_OUT) throw notReady();
      if (result) return;
      await delay(Math.min(this.#pollIntervalMs, deadline - performance.now()));
    }
  }

  /** Stop the handle via the custom `.stop()` or its own `stop()`. */
  #teardown(handle: ServiceHandle): Promise<void> {
    return Promise.resolve(
      this.#stop ? this.#stop(handle) : handle.stop(),
    );
  }
}

/**
 * Create a service target — a long-lived process kept running while its
 * dependents execute. Configure it with {@link ServiceBuilder.start} /
 * {@link ServiceBuilder.readyWhen} and depend on it from a {@link target}.
 */
export function service(): ServiceBuilder {
  return new ServiceBuilder();
}

/**
 * Holds the services started during a run and stops them in reverse order on
 * teardown. Stopping never throws — a failure to stop one service is reported
 * and the rest are still stopped.
 */
export class ServiceRegistry {
  readonly #running: RunningService[] = [];

  /** Record a started service to stop later. */
  register(running: RunningService): void {
    this.#running.push(running);
  }

  /** The number of services currently held. */
  get size(): number {
    return this.#running.length;
  }

  /** Stop every registered service, newest first, reporting each outcome. */
  async stopAll(report: (line: string) => void): Promise<void> {
    for (let i = this.#running.length - 1; i >= 0; i--) {
      const running = this.#running[i];
      try {
        await running.stop();
        report(`■ stopped service ${running.name}`);
      } catch (error) {
        report(`failed to stop service ${running.name}: ${messageOf(error)}`);
      }
    }
    this.#running.length = 0;
  }
}

/**
 * Whether a TCP `host:port` is accepting connections — the usual readiness
 * probe for a server. Resolves `true` once a connection succeeds (it is closed
 * immediately), `false` while the port is still refused/unreachable, so it
 * plugs straight into {@link ServiceBuilder.readyWhen}.
 *
 * ```ts
 * .readyWhen(() => tcpReachable("localhost:5432"))
 * ```
 */
export async function tcpReachable(address: string): Promise<boolean> {
  const { hostname, port } = parseAddress(address);
  try {
    const conn = await Deno.connect({ hostname, port });
    conn.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Split a `host:port` address, or a bracketed IPv6 `[::1]:port`, into its parts.
 * An empty host defaults to `localhost`. Throws {@link ServiceError} on a
 * missing port or an out-of-range one.
 */
function parseAddress(address: string): { hostname: string; port: number } {
  const bad = (detail: string): never => {
    throw new ServiceError(
      `tcpReachable needs a "host:port" address: ${detail}.`,
    );
  };
  let hostname: string;
  let portText: string;
  if (address.startsWith("[")) {
    // Bracketed IPv6, e.g. "[::1]:8080" — the colons inside the brackets are
    // part of the address, so split on the "]:" that follows them.
    const end = address.indexOf("]");
    if (end === -1 || address[end + 1] !== ":") bad(`"${address}"`);
    hostname = address.slice(1, end);
    portText = address.slice(end + 2);
  } else {
    const colon = address.lastIndexOf(":");
    if (colon === -1) bad(`"${address}" has no port`);
    hostname = address.slice(0, colon) || "localhost";
    portText = address.slice(colon + 1);
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    bad(`invalid port "${portText}"`);
  }
  return { hostname, port };
}
