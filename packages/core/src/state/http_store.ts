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
import type { PutResult, StateStore } from "./store.ts";
import {
  parseRunRecord,
  parseRunSummary,
  type RunQuery,
  type RunRecord,
  type RunSummary,
  stringifyRunRecord,
} from "./types.ts";

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
}
