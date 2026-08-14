// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link HttpJsonCas} — the one HTTP compare-and-swap client both hosted
 * backends ride: {@link "./http_store.ts".HttpStateStore} over `/runs` and
 * {@link "../registry/http_registry.ts".HttpBuildRegistry} over `/builds` (see
 * `docs/state-api.md`). One implementation of the auth headers, the protocol
 * handshake, the `ETag`/`If-Match` preconditions and the 404-tolerant delete, so
 * the two collections cannot drift apart.
 *
 * This module is **internal**: it is not re-exported from `mod.ts` (or any
 * entrypoint), so nothing here is public API — exactly like
 * {@link "./mutex.ts".withFileMutex}'s host-side counterpart.
 *
 * It deals in **raw text**: `get` hands back the undecoded body and `list` an
 * unvalidated array, leaving each backend to run its own parser
 * (`parseRunRecord` / `parseBuildDescriptor`) over the result.
 *
 * @module
 */

import { HttpError } from "../http.ts";
import {
  assertProtocol,
  STATE_PROTOCOL_HEADER,
  STATE_PROTOCOL_VERSION,
} from "./protocol.ts";
import type { PutResult } from "./store.ts";

/** Connection settings for an {@link HttpJsonCas} — the `{ url, token?, fetch? }` both backends expose. */
export interface HttpCasOptions {
  /** The base URL collection endpoints are built under (any trailing slash is ignored). */
  url: string;
  /** A bearer token sent as `Authorization: Bearer <token>`, if set. */
  token?: string;
  /** The `fetch` implementation; defaults to the global. Overridable for tests. */
  fetch?: typeof fetch;
}

/**
 * A compare-and-swap JSON client for one collection of a state-api service.
 *
 * Versions are HTTP `ETag`s: {@link HttpJsonCas.get} returns the current one and
 * {@link HttpJsonCas.put} sends it back as `If-Match` (or `If-None-Match: *` to
 * create), so the server answers `412 Precondition Failed` when the version has
 * moved on.
 */
export class HttpJsonCas {
  /** The base URL with any trailing slashes stripped — also the root of sibling paths (e.g. `/locks`). */
  readonly base: string;
  readonly #token?: string;
  readonly #fetch: typeof fetch;
  readonly #scope: string;
  readonly #collection: string;

  /**
   * Build the client over `options`. `scope` prefixes every error message
   * (`state` / `registry`, as {@link assertProtocol} takes it) and `collection`
   * is the path segment items live under (`runs` / `builds`).
   */
  constructor(
    options: HttpCasOptions,
    scope: string,
    collection: string,
  ) {
    this.base = options.url.replace(/\/+$/, "");
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
    this.#scope = scope;
    this.#collection = collection;
  }

  #itemUrl(id: string): string {
    return `${this.base}/${this.#collection}/${encodeURIComponent(id)}`;
  }

  /** The protocol header plus the bearer token (when set), merged over `extra`. */
  headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      ...extra,
      [STATE_PROTOCOL_HEADER]: STATE_PROTOCOL_VERSION,
    };
    if (this.#token !== undefined && this.#token !== "") {
      headers.Authorization = `Bearer ${this.#token}`;
    }
    return headers;
  }

  /** Fetch and reject a response that declares an incompatible protocol version. */
  async request(url: string, init?: RequestInit): Promise<Response> {
    const response = await this.#fetch(url, init);
    assertProtocol(response, this.#scope);
    return response;
  }

  /** `GET /<collection>/:id` → the raw body + its `ETag`; a `404` is a miss. */
  async get(id: string): Promise<{ text: string; version: string } | null> {
    const url = this.#itemUrl(id);
    const response = await this.request(url, { headers: this.headers() });
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
      throw new Error(`${this.#scope}: ${url} did not return an ETag`);
    }
    return { text, version };
  }

  /** `PUT /<collection>/:id` guarded by `If-Match` / `If-None-Match`; `412` → conflict. */
  async put(
    id: string,
    body: string,
    expectedVersion: string | null,
  ): Promise<PutResult> {
    const url = this.#itemUrl(id);
    const precondition: Record<string, string> = expectedVersion === null
      ? { "If-None-Match": "*" }
      : { "If-Match": expectedVersion };
    const response = await this.request(url, {
      method: "PUT",
      headers: this.headers({
        "content-type": "application/json",
        ...precondition,
      }),
      body,
    });
    if (response.status === 412) {
      await response.body?.cancel();
      return { ok: false, conflict: true };
    }
    await response.body?.cancel();
    if (!response.ok) throw new HttpError(response.status, url);
    const version = response.headers.get("etag");
    if (version === null) {
      throw new Error(`${this.#scope}: ${url} did not return an ETag on write`);
    }
    return { ok: true, version };
  }

  /** `DELETE /<collection>/:id`; a missing item (`404`) is not an error. */
  async remove(id: string): Promise<void> {
    const url = this.#itemUrl(id);
    const response = await this.request(url, {
      method: "DELETE",
      headers: this.headers(),
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) {
      throw new HttpError(response.status, url);
    }
  }

  /**
   * `GET /<collection>?<params>` → the decoded JSON array, element shapes
   * unvalidated (the caller's parser does that). A body that is not JSON, or is
   * JSON but not an array, is a descriptive error rather than a raw
   * `SyntaxError` — a proxy's HTML error page arrives with a `200` often enough
   * to be worth naming.
   */
  async list(params: URLSearchParams): Promise<unknown[]> {
    const qs = params.toString();
    const url = `${this.base}/${this.#collection}${qs === "" ? "" : `?${qs}`}`;
    const response = await this.request(url, { headers: this.headers() });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, url);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      throw new Error(`${this.#scope}: ${url} did not return valid JSON`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`${this.#scope}: ${url} did not return a JSON array`);
    }
    return parsed;
  }
}
