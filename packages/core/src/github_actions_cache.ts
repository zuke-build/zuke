// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A {@link RemoteCacheStore} backed by the GitHub Actions cache service — the
 * store `actions/cache` uses — reached with the credentials every job already
 * holds, so a workflow shares target outputs across runs with no server and no
 * secret of its own.
 *
 * The service is a Twirp API (`CacheService`) that hands out signed blob URLs:
 * `GetCacheEntryDownloadURL` resolves a key to a URL to `GET`, and
 * `CreateCacheEntry` + `FinalizeCacheEntryUpload` bracket a `PUT` of the
 * archive. An entry is immutable once finalized, and the service evicts by age
 * and by the repository's cache quota.
 *
 * The runner exposes `ACTIONS_RUNTIME_TOKEN` and `ACTIONS_RESULTS_URL` to a
 * JavaScript action's process only — never to a `run:` step. The
 * `actions-cache` input of the `zuke-build/zuke` action (`bootstrap:
 * { actionsCache: true }` in `cicd`) exports them to the job, which is what
 * lets {@link "./remote_cache.ts".envCacheStore} pick this store up.
 *
 * @module
 */

import { HttpError } from "./http.ts";
import { readBytesBounded, sha256Hex } from "./internal.ts";
import type { RemoteCacheStore } from "./remote_cache.ts";

/** Configuration for a {@link GitHubActionsCacheStore}. */
export interface GitHubActionsCacheStoreOptions {
  /** The cache service's base URL: the job's `ACTIONS_RESULTS_URL`. */
  url: string;
  /** The job's `ACTIONS_RUNTIME_TOKEN`, sent as a bearer token to the service. */
  token: string;
  /** The `fetch` implementation; defaults to the global. Overridable for tests. */
  fetch?: typeof fetch;
  /**
   * The most a fetched artifact may weigh on the wire, in bytes, before it is
   * refused. Defaults to 2 GiB — larger than the HTTP store's 512 MiB, because
   * this store is written only by the repository's own workflows and the
   * outputs worth caching here are the big ones (a 1.5 GB SDK). What the bytes
   * *decompress* to is bounded separately, by `restoreOutputs`.
   */
  maxArtifactBytes?: number;
  /**
   * The most a fetched artifact may decompress to, in bytes — see
   * {@link RemoteCacheStore.maxInflatedBytes}. Defaults to 2 GiB.
   */
  maxInflatedBytes?: number;
}

/** The Twirp route every `CacheService` call is `POST`ed to, under the base URL. */
const SERVICE_PATH = "twirp/github.actions.results.api.v1.CacheService/";

/**
 * The wire cap, matched to the inflated bound `restoreOutputs` applies: an
 * archive the service holds for this repository is worth buffering whole.
 */
const DEFAULT_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;

/** The first string among `names` on `record`, or `undefined`. */
function stringField(
  record: Record<string, unknown>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/**
 * A {@link RemoteCacheStore} over the GitHub Actions cache service. A `get`
 * asks the service for the entry's signed download URL and fetches it; a `put`
 * reserves the entry, uploads the archive to the signed upload URL it is given,
 * and finalizes it. A key another job finalized first is left as it is: entries
 * are immutable, and both jobs built the same outputs from the same inputs.
 *
 * Restores are subject to the Actions cache's own scoping — a run sees entries
 * written on its branch and on the default branch — and the service's eviction,
 * so a miss after a quiet week is normal and costs one rebuild.
 */
export class GitHubActionsCacheStore implements RemoteCacheStore {
  readonly #base: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #maxArtifactBytes: number;
  /** The most an artifact may decompress to; see {@link RemoteCacheStore.maxInflatedBytes}. */
  readonly maxInflatedBytes?: number;

  /** Build the store from the service URL, the runtime token, and the `fetch` seam. */
  constructor(options: GitHubActionsCacheStoreOptions) {
    this.maxInflatedBytes = options.maxInflatedBytes;
    this.#base = options.url.replace(/\/+$/, "");
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
    this.#maxArtifactBytes = options.maxArtifactBytes ??
      DEFAULT_MAX_ARTIFACT_BYTES;
  }

  /**
   * The entry version the service pairs with a key. `actions/cache` derives it
   * from the cached paths and the compression; here the key already carries the
   * fingerprint, so a digest of the key keeps the pair unique per entry in the
   * hex form the service expects.
   */
  #version(key: string): Promise<string> {
    return sha256Hex(`zuke-remote-cache:${key}`);
  }

  /** `POST` one `CacheService` call and return its JSON body. */
  async #call(
    method: string,
    body: Record<string, string | string[]>,
  ): Promise<Record<string, unknown>> {
    const url = `${this.#base}/${SERVICE_PATH}${method}`;
    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${this.#token}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, url);
    }
    const parsed: unknown = await response.json();
    return typeof parsed === "object" && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  }

  /** Fetch the archived outputs stored under `key`, or `null` if there are none. */
  async get(key: string): Promise<Uint8Array | null> {
    let entry: Record<string, unknown>;
    try {
      entry = await this.#call("GetCacheEntryDownloadURL", {
        key,
        version: await this.#version(key),
      });
    } catch (error) {
      // The service answers a miss with `ok: false`; an older one answered
      // `not_found`, which Twirp carries as a 404.
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
    // Field names are accepted in both the proto (`signed_download_url`) and
    // the JSON (`signedDownloadUrl`) spelling, since a Twirp server may emit
    // either.
    const url = stringField(entry, "signed_download_url", "signedDownloadUrl");
    if (entry.ok !== true || url === undefined) return null;
    // The signed URL carries its own credential, so the bearer token stays
    // with the service it was issued for.
    const response = await this.#fetch(url);
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, url);
    }
    const bytes = await readBytesBounded(response.body, this.#maxArtifactBytes);
    if (bytes === null) {
      throw new Error(
        `remote cache: refusing an artifact larger than ` +
          `${this.#maxArtifactBytes} bytes from the GitHub Actions cache.`,
      );
    }
    return bytes;
  }

  /** Store `artifact` (a gzipped tar of a target's outputs) under `key`. */
  async put(key: string, artifact: Uint8Array): Promise<void> {
    const version = await this.#version(key);
    let reserved: Record<string, unknown>;
    try {
      reserved = await this.#call("CreateCacheEntry", { key, version });
    } catch (error) {
      // `already_exists`: another job finalized this key first. Entries are
      // immutable, so there is nothing left to upload.
      if (error instanceof HttpError && error.status === 409) return;
      throw error;
    }
    const upload = stringField(
      reserved,
      "signed_upload_url",
      "signedUploadUrl",
    );
    if (reserved.ok !== true || upload === undefined) {
      throw new Error(
        `remote cache: the GitHub Actions cache service refused to reserve ` +
          `an entry for "${key}".`,
      );
    }
    // shortcut: one Put Blob request, which the blob service caps at 5000 MiB;
    // upload in blocks if an artifact ever has to exceed that.
    const response = await this.#fetch(upload, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "content-type": "application/octet-stream",
      },
      body: new Blob([new Uint8Array(artifact)]),
    });
    await response.body?.cancel();
    if (!response.ok) throw new HttpError(response.status, upload);
    await this.#call("FinalizeCacheEntryUpload", {
      key,
      version,
      size_bytes: String(artifact.byteLength),
    });
  }
}
