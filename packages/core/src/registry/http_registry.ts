/**
 * {@link HttpBuildRegistry} — a {@link BuildRegistry} backed by a hosted HTTP
 * service, the production path for the build catalog. It rides the same REST
 * contract as {@link "../state/http_store.ts".HttpStateStore} (see
 * `docs/state-api.md`), adding a `/builds` collection beside `/runs`, so one
 * service can host both.
 *
 * Compare-and-swap rides on HTTP preconditions: `GET /builds/:id` returns the
 * descriptor and an `ETag`; `PUT /builds/:id` sends `If-Match: <etag>` (or
 * `If-None-Match: *` to create), and the server answers `412 Precondition
 * Failed` when the version has moved on. The option shape mirrors the state
 * backend — `{ url, token?, fetch? }`, the `fetch` seam keeping tests hermetic.
 *
 * @module
 */

import { HttpError } from "../http.ts";
import {
  type BuildDescriptor,
  type BuildQuery,
  type BuildSummary,
  parseBuildDescriptor,
  parseBuildSummary,
  stringifyBuildDescriptor,
} from "./descriptor.ts";
import type { BuildRegistry, PutBuildResult } from "./registry.ts";

/** Configuration for an {@link HttpBuildRegistry}. */
export interface HttpBuildRegistryOptions {
  /** The base URL build endpoints are built under (any trailing slash is ignored). */
  url: string;
  /** A bearer token sent as `Authorization: Bearer <token>`, if set. */
  token?: string;
  /** The `fetch` implementation; defaults to the global. Overridable for tests. */
  fetch?: typeof fetch;
}

/**
 * A {@link BuildRegistry} backed by HTTP.
 *
 * **Security.** The `url` and `token` are *trusted configuration* — build
 * descriptors (structural CLI metadata plus a launch location) are sent to that
 * host, so point it only at a service you control and prefer a secret parameter
 * or environment variable over a hard-coded value.
 */
export class HttpBuildRegistry implements BuildRegistry {
  readonly #base: string;
  readonly #token?: string;
  readonly #fetch: typeof fetch;

  /** Build the registry from its URL, optional token, and `fetch` seam. */
  constructor(options: HttpBuildRegistryOptions) {
    this.#base = options.url.replace(/\/+$/, "");
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  #buildUrl(id: string): string {
    return `${this.#base}/builds/${encodeURIComponent(id)}`;
  }

  #headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.#token !== undefined && this.#token !== "") {
      headers.Authorization = `Bearer ${this.#token}`;
    }
    return headers;
  }

  /** `GET /builds/:id` → descriptor + `ETag`; a `404` is a miss. */
  async getBuild(
    id: string,
  ): Promise<{ descriptor: BuildDescriptor; version: string } | null> {
    const url = this.#buildUrl(id);
    const response = await this.#fetch(url, { headers: this.#headers() });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, url);
    }
    const version = response.headers.get("etag");
    const text = await response.text();
    if (version === null) {
      throw new Error(`registry: ${url} did not return an ETag`);
    }
    return { descriptor: parseBuildDescriptor(text), version };
  }

  /** `PUT /builds/:id` guarded by `If-Match` / `If-None-Match`; `412` → conflict. */
  async register(
    descriptor: BuildDescriptor,
    expectedVersion: string | null,
  ): Promise<PutBuildResult> {
    const url = this.#buildUrl(descriptor.id);
    const precondition: Record<string, string> = expectedVersion === null
      ? { "If-None-Match": "*" }
      : { "If-Match": expectedVersion };
    const response = await this.#fetch(url, {
      method: "PUT",
      headers: this.#headers({
        "content-type": "application/json",
        ...precondition,
      }),
      body: stringifyBuildDescriptor(descriptor),
    });
    if (response.status === 412) {
      await response.body?.cancel();
      return { ok: false, conflict: true };
    }
    await response.body?.cancel();
    if (!response.ok) throw new HttpError(response.status, url);
    const version = response.headers.get("etag");
    if (version === null) {
      throw new Error(`registry: ${url} did not return an ETag on write`);
    }
    return { ok: true, version };
  }

  /** `DELETE /builds/:id`; a missing build (`404`) is not an error. */
  async deregister(id: string): Promise<void> {
    const url = this.#buildUrl(id);
    const response = await this.#fetch(url, {
      method: "DELETE",
      headers: this.#headers(),
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) {
      throw new HttpError(response.status, url);
    }
  }

  /** `GET /builds?name=&since=` → an array of {@link BuildSummary}. */
  async listBuilds(query: BuildQuery): Promise<BuildSummary[]> {
    const params = new URLSearchParams();
    if (query.name !== undefined) params.set("name", query.name);
    if (query.since !== undefined) params.set("since", query.since);
    const qs = params.toString();
    const url = `${this.#base}/builds${qs === "" ? "" : `?${qs}`}`;
    const response = await this.#fetch(url, { headers: this.#headers() });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, url);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      throw new Error(`registry: ${url} did not return valid JSON`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`registry: ${url} did not return a JSON array`);
    }
    return parsed.map(parseBuildSummary);
  }
}
