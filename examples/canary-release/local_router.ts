// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A canary platform that needs nothing but Deno: two versions of a tiny HTTP
 * service on loopback behind one weighted router. It implements the same
 * `CanaryPlatform` interface the Cloud Run, Kubernetes, Helm, Docker Compose,
 * Lambda and Container Apps platforms do, so swapping it for a real one
 * changes one line of the build.
 *
 * Everything lives in the build's own process, so the rollout must run start
 * to finish in one go: no approval gate, no durable bakes.
 */
import type { CanaryContext, CanaryPlatform } from "jsr:@zuke/canary@^1";

/** What the router serves, set through `localRouter((r) => …)`. */
export class LocalRouterSettings {
  /** The port the router listens on; `0` picks a free one. */
  port_ = 8080;
  /** The version serving before the rollout. */
  stable_ = "v1";
  /** The version being rolled out. */
  candidate_ = "v2";
  /** Whether the candidate answers every request with a 500. */
  broken_ = false;

  /** The port the router listens on (`0` picks a free one). */
  port(port: number): this {
    this.port_ = port;
    return this;
  }

  /** The version serving before the rollout. */
  stable(version: string): this {
    this.stable_ = version;
    return this;
  }

  /** The version being rolled out. */
  candidate(version: string): this {
    this.candidate_ = version;
    return this;
  }

  /** Whether the candidate answers every request with a 500. */
  broken(broken: boolean): this {
    this.broken_ = broken;
    return this;
  }
}

/** A weighted router in front of a stable and a candidate version. */
export class LocalRouter implements CanaryPlatform {
  /** The router splits requests exactly, so exposure is a traffic share. */
  readonly exposure = "traffic";
  readonly #configure: (s: LocalRouterSettings) => LocalRouterSettings;
  #settings = new LocalRouterSettings();
  #server: Deno.HttpServer<Deno.NetAddr> | undefined;
  #weight = 0;
  #requests = 0;

  /** A router whose settings `configure` produces when the rollout stages. */
  constructor(configure: (s: LocalRouterSettings) => LocalRouterSettings) {
    this.#configure = configure;
  }

  /** The router's address — what the analysis probes. */
  get url(): string {
    if (this.#server === undefined) {
      throw new Error("The local router is not running; stage starts it.");
    }
    return `http://127.0.0.1:${this.#server.addr.port}/`;
  }

  /** `"local router"`, for the build summary. */
  describe(): string {
    return "local router";
  }

  /** Start the router with the candidate beside the stable version, at 0 %. */
  async stage(ctx: CanaryContext): Promise<void> {
    this.#settings = this.#configure(new LocalRouterSettings());
    const port = this.#settings.port_;
    try {
      this.#server = Deno.serve(
        { hostname: "127.0.0.1", port, onListen: () => {} },
        () => this.#route(),
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.AddrInUse)) throw error;
      throw new Error(
        `Port ${port} is already in use — pass --port <n> for another one, ` +
          "or --port 0 for a free one.",
      );
    }
    this.#weight = 0;
    await ctx.state.set({
      stable: this.#settings.stable_,
      candidate: this.#settings.candidate_,
    });
    ctx.reportSummary({ Router: this.url });
  }

  /** Send `percent` of the requests to the candidate. */
  expose(percent: number): Promise<number> {
    this.#weight = percent;
    return Promise.resolve(percent);
  }

  /** Send every request to the candidate. */
  promote(): Promise<void> {
    this.#weight = 100;
    return Promise.resolve();
  }

  /** Send every request back to the stable version. Needs no state. */
  abort(): Promise<void> {
    this.#weight = 0;
    return Promise.resolve();
  }

  /** Stop the router, if it is running. */
  async close(): Promise<void> {
    await this.#server?.shutdown();
    this.#server = undefined;
  }

  /**
   * Answer one request from the stable version or the candidate. The
   * candidate's share is spread evenly — request `n` goes to it whenever its
   * running share crosses a whole request — so 10 % is every tenth request,
   * not the first ten.
   */
  #route(): Response {
    const n = this.#requests++;
    const toCandidate = Math.floor(((n + 1) * this.#weight) / 100) >
      Math.floor((n * this.#weight) / 100);
    const { stable_, candidate_, broken_ } = this.#settings;
    if (!toCandidate) return new Response(`${stable_}\n`);
    return broken_
      ? new Response(`${candidate_} failed\n`, { status: 500 })
      : new Response(`${candidate_}\n`);
  }
}

/** A {@link LocalRouter} configured through its settings lambda. */
export function localRouter(
  configure: (s: LocalRouterSettings) => LocalRouterSettings,
): LocalRouter {
  return new LocalRouter(configure);
}
