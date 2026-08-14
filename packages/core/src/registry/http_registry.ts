// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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

import { HttpJsonCas } from "../state/http_cas.ts";
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
  readonly #cas: HttpJsonCas;

  /** Build the registry from its URL, optional token, and `fetch` seam. */
  constructor(options: HttpBuildRegistryOptions) {
    this.#cas = new HttpJsonCas(options, "registry", "builds");
  }

  /** `GET /builds/:id` → descriptor + `ETag`; a `404` is a miss. */
  async getBuild(
    id: string,
  ): Promise<{ descriptor: BuildDescriptor; version: string } | null> {
    const hit = await this.#cas.get(id);
    return hit === null
      ? null
      : { descriptor: parseBuildDescriptor(hit.text), version: hit.version };
  }

  /** `PUT /builds/:id` guarded by `If-Match` / `If-None-Match`; `412` → conflict. */
  async register(
    descriptor: BuildDescriptor,
    expectedVersion: string | null,
  ): Promise<PutBuildResult> {
    return await this.#cas.put(
      descriptor.id,
      stringifyBuildDescriptor(descriptor),
      expectedVersion,
    );
  }

  /** `DELETE /builds/:id`; a missing build (`404`) is not an error. */
  deregister(id: string): Promise<void> {
    return this.#cas.remove(id);
  }

  /** `GET /builds?name=&since=` → an array of {@link BuildSummary}. */
  async listBuilds(query: BuildQuery): Promise<BuildSummary[]> {
    const params = new URLSearchParams();
    if (query.name !== undefined) params.set("name", query.name);
    if (query.since !== undefined) params.set("since", query.since);
    return (await this.#cas.list(params)).map(parseBuildSummary);
  }
}
