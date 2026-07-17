/**
 * {@link HttpStateStore} — a {@link StateStore} backed by a hosted HTTP service,
 * the production path for durable run state. See `docs/state-api.md` for the
 * one-page REST contract a consumer implements.
 *
 * Compare-and-swap rides on HTTP preconditions: `GET /runs/:id` returns the
 * record and an `ETag`; `PUT /runs/:id` sends `If-Match: <etag>` (or
 * `If-None-Match: *` to create), and the server answers `412 Precondition
 * Failed` when the version has moved on. The option shape mirrors
 * {@link "../remote_cache.ts".HttpCacheStore} — `{ url, token?, fetch? }`, the
 * `fetch` seam keeping tests hermetic.
 *
 * @module
 */

import { HttpError } from "../http.ts";
import type { LockResult, PutResult, StateStore } from "./store.ts";
import {
  parseRunRecord,
  parseRunSummary,
  type RunQuery,
  type RunRecord,
  type RunSummary,
  stringifyRunRecord,
} from "./types.ts";
import { type LockHolder, parseLockHolder } from "./lock.ts";

/** Configuration for an {@link HttpStateStore}. */
export interface HttpStateStoreOptions {
  /** The base URL run endpoints are built under (any trailing slash is ignored). */
  url: string;
  /** A bearer token sent as `Authorization: Bearer <token>`, if set. */
  token?: string;
  /** The `fetch` implementation; defaults to the global. Overridable for tests. */
  fetch?: typeof fetch;
}

/**
 * A {@link StateStore} backed by HTTP.
 *
 * **Security.** The `url` and `token` are *trusted configuration* — run
 * records (which include resolved non-secret parameters and target metadata)
 * are sent to that host, so point it only at a service you control and prefer a
 * {@link "../params.ts" | secret parameter} or environment variable over a
 * hard-coded value.
 */
export class HttpStateStore implements StateStore {
  readonly #base: string;
  readonly #token?: string;
  readonly #fetch: typeof fetch;

  /** Build the store from its URL, optional token, and `fetch` seam. */
  constructor(options: HttpStateStoreOptions) {
    this.#base = options.url.replace(/\/+$/, "");
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  #runUrl(id: string): string {
    return `${this.#base}/runs/${encodeURIComponent(id)}`;
  }

  #headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.#token !== undefined && this.#token !== "") {
      headers.Authorization = `Bearer ${this.#token}`;
    }
    return headers;
  }

  /** `GET /runs/:id` → record + `ETag`; a `404` is a miss. */
  async getRun(
    id: string,
  ): Promise<{ record: RunRecord; version: string } | null> {
    const url = this.#runUrl(id);
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
      throw new Error(`state: ${url} did not return an ETag`);
    }
    return { record: parseRunRecord(text), version };
  }

  /** `PUT /runs/:id` guarded by `If-Match` / `If-None-Match`; `412` → conflict. */
  async putRun(
    record: RunRecord,
    expectedVersion: string | null,
  ): Promise<PutResult> {
    const url = this.#runUrl(record.id);
    const precondition: Record<string, string> = expectedVersion === null
      ? { "If-None-Match": "*" }
      : { "If-Match": expectedVersion };
    const response = await this.#fetch(url, {
      method: "PUT",
      headers: this.#headers({
        "content-type": "application/json",
        ...precondition,
      }),
      body: stringifyRunRecord(record),
    });
    if (response.status === 412) {
      await response.body?.cancel();
      return { ok: false, conflict: true };
    }
    await response.body?.cancel();
    if (!response.ok) throw new HttpError(response.status, url);
    const version = response.headers.get("etag");
    if (version === null) {
      throw new Error(`state: ${url} did not return an ETag on write`);
    }
    return { ok: true, version };
  }

  /** `GET /runs?status=&target=&since=` → an array of {@link RunSummary}. */
  async listRuns(query: RunQuery): Promise<RunSummary[]> {
    const params = new URLSearchParams();
    if (query.status !== undefined) params.set("status", query.status);
    if (query.target !== undefined) params.set("target", query.target);
    if (query.since !== undefined) params.set("since", query.since);
    const qs = params.toString();
    const url = `${this.#base}/runs${qs === "" ? "" : `?${qs}`}`;
    const response = await this.#fetch(url, { headers: this.#headers() });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, url);
    }
    const parsed: unknown = JSON.parse(await response.text());
    if (!Array.isArray(parsed)) {
      throw new Error(`state: ${url} did not return a JSON array`);
    }
    return parsed.map(parseRunSummary);
  }

  #lockUrl(key: string): string {
    return `${this.#base}/locks/${encodeURIComponent(key)}`;
  }

  /** `POST /locks/:key` → `201 { token }`, or `409` with the current holder. */
  async acquireLock(
    key: string,
    holder: LockHolder,
    ttlMs: number,
  ): Promise<LockResult> {
    const url = this.#lockUrl(key);
    const response = await this.#fetch(url, {
      method: "POST",
      headers: this.#headers({ "content-type": "application/json" }),
      body: JSON.stringify({ holder, ttlMs }),
    });
    if (response.status === 409) {
      return { ok: false, holder: parseLockHolder(await response.json()) };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, url);
    }
    const token = tokenFrom(await response.json(), url);
    return { ok: true, token };
  }

  /** `PUT /locks/:key` renews; a `409`/`404` means the token lost the lock. */
  async renewLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    const url = this.#lockUrl(key);
    const response = await this.#fetch(url, {
      method: "PUT",
      headers: this.#headers({ "content-type": "application/json" }),
      body: JSON.stringify({ token, ttlMs }),
    });
    await response.body?.cancel();
    if (response.status === 409 || response.status === 404) return false;
    if (!response.ok) throw new HttpError(response.status, url);
    return true;
  }

  /** `DELETE /locks/:key` releases; a missing lock (`404`) is not an error. */
  async releaseLock(key: string, token: string): Promise<void> {
    const url = this.#lockUrl(key);
    const response = await this.#fetch(url, {
      method: "DELETE",
      headers: this.#headers({ "content-type": "application/json" }),
      body: JSON.stringify({ token }),
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) {
      throw new HttpError(response.status, url);
    }
  }
}

/** Extract a string `token` from a lock-acquire response body. */
function tokenFrom(body: unknown, url: string): string {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body)) {
      if (key === "token" && typeof value === "string") return value;
    }
  }
  throw new Error(`state: ${url} did not return a token`);
}
