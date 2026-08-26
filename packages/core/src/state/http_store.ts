// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
import { HttpJsonCas } from "./http_cas.ts";
import type { LockResult, PutResult, StateStore } from "./store.ts";
import {
  parseRunRecord,
  parseRunSummary,
  type RunQuery,
  type RunRecord,
  type RunSummary,
  stringifyRunRecord,
} from "./types.ts";
import {
  type HeldLockEntry,
  type LockHolder,
  parseLockHolder,
} from "./lock.ts";
import { asObject } from "../json_shape.ts";

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
  readonly #cas: HttpJsonCas;

  /** Build the store from its URL, optional token, and `fetch` seam. */
  constructor(options: HttpStateStoreOptions) {
    this.#cas = new HttpJsonCas(options, "state", "runs");
  }

  /** `GET /runs/:id` → record + `ETag`; a `404` is a miss. */
  async getRun(
    id: string,
  ): Promise<{ record: RunRecord; version: string } | null> {
    const hit = await this.#cas.get(id);
    return hit === null
      ? null
      : { record: parseRunRecord(hit.text), version: hit.version };
  }

  /** `PUT /runs/:id` guarded by `If-Match` / `If-None-Match`; `412` → conflict. */
  async putRun(
    record: RunRecord,
    expectedVersion: string | null,
  ): Promise<PutResult> {
    return await this.#cas.put(
      record.id,
      stringifyRunRecord(record),
      expectedVersion,
    );
  }

  /** `GET /runs?status=&target=&since=` → an array of {@link RunSummary}. */
  async listRuns(query: RunQuery): Promise<RunSummary[]> {
    const params = new URLSearchParams();
    if (query.status !== undefined) params.set("status", query.status);
    if (query.target !== undefined) params.set("target", query.target);
    if (query.since !== undefined) params.set("since", query.since);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    return (await this.#cas.list(params)).map(parseRunSummary);
  }

  /** `DELETE /runs/:id`; a missing run (`404`) is not an error. */
  deleteRun(id: string): Promise<void> {
    return this.#cas.remove(id);
  }

  #lockUrl(key: string): string {
    return `${this.#cas.base}/locks/${encodeURIComponent(key)}`;
  }

  /** `POST /locks/:key` → `201 { token }`, or `409` with the current holder. */
  async acquireLock(
    key: string,
    holder: LockHolder,
    ttlMs: number,
  ): Promise<LockResult> {
    const url = this.#lockUrl(key);
    const response = await this.#cas.request(url, {
      method: "POST",
      headers: this.#cas.headers({ "content-type": "application/json" }),
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
    const response = await this.#cas.request(url, {
      method: "PUT",
      headers: this.#cas.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ token, ttlMs }),
    });
    await response.body?.cancel();
    if (response.status === 409 || response.status === 404) return false;
    if (!response.ok) throw new HttpError(response.status, url);
    return true;
  }

  /**
   * `GET /locks` → the live locks the server holds. A server that has not
   * implemented the endpoint (`404`/`501`) is told apart from one that holds
   * nothing: an empty listing is an answer, and a missing endpoint is not.
   */
  async listLocks(): Promise<HeldLockEntry[]> {
    const url = `${this.#cas.base}/locks`;
    const response = await this.#cas.request(url, {
      headers: this.#cas.headers({}),
    });
    if (response.status === 404 || response.status === 501) {
      await response.body?.cancel();
      throw new Error(
        `state: ${url} is not implemented by this server, so its locks ` +
          `cannot be listed — see docs/state-api.md.`,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, url);
    }
    return parseLockListing(await response.json(), url);
  }

  /** `DELETE /locks/:key` releases; a missing lock (`404`) is not an error. */
  async releaseLock(key: string, token: string): Promise<void> {
    const url = this.#lockUrl(key);
    const response = await this.#cas.request(url, {
      method: "DELETE",
      headers: this.#cas.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ token }),
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) {
      throw new HttpError(response.status, url);
    }
  }
}

/**
 * Parse a `GET /locks` body: an array of `{ key, holder, expiresAt }`. The
 * server is a remote party, so every field is checked rather than trusted, and
 * an entry that does not parse fails the call instead of being dropped — a
 * listing that silently loses a held lock is worse than one that errors.
 */
export function parseLockListing(body: unknown, url: string): HeldLockEntry[] {
  if (!Array.isArray(body)) {
    throw new Error(`state: ${url} did not return an array of locks`);
  }
  return body.map((entry) => {
    const object = asObject(entry);
    if (object === null) {
      throw new Error(`state: ${url} returned a lock that is not an object`);
    }
    const { key, expiresAt } = object;
    if (typeof key !== "string" || key === "") {
      throw new Error(`state: ${url} returned a lock with no key`);
    }
    if (typeof expiresAt !== "number") {
      throw new Error(`state: ${url} returned lock "${key}" with no expiry`);
    }
    return { key, holder: parseLockHolder(object.holder), expiresAt };
  });
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
