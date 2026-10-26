// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A {@link "./remote_cache.ts".RemoteCacheStore} over S3-compatible object
 * storage: AWS S3, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces,
 * and Google Cloud Storage through its HMAC interoperability mode. It is the
 * store for every CI without a cache service of its own — GitLab, Azure
 * Pipelines, Buildkite, CircleCI, Jenkins, a self-hosted runner.
 *
 * The protocol is the HTTP store's — `GET`/`PUT <url>/<key>` — so this is
 * {@link "./remote_cache.ts".HttpCacheStore} over a `fetch` that signs each
 * request with {@link "./aws_sigv4.ts".signSigV4} for the service `s3`: one
 * HTTP store, one signer, nothing re-implemented.
 *
 * @module
 */

import { type AwsCredentials, signSigV4 } from "./aws_sigv4.ts";
import { sha256Hex } from "./internal.ts";
import { HttpCacheStore, type RemoteCacheStore } from "./remote_cache.ts";

/** Configuration for an {@link S3CacheStore}. */
export interface S3CacheStoreOptions {
  /**
   * The bucket URL keys are appended to, with any prefix:
   * `https://my-bucket.s3.eu-west-1.amazonaws.com/zuke-cache` on AWS, or
   * `https://<account>.r2.cloudflarestorage.com/my-bucket` (path-style) on
   * R2, MinIO and the like.
   */
  url: string;
  /** The signing region: the bucket's on AWS, `auto` on R2. */
  region: string;
  /** The access key the requests are signed with. */
  credentials: AwsCredentials;
  /** The `fetch` implementation; defaults to the global. Overridable for tests. */
  fetch?: typeof fetch;
  /** The clock the signatures are dated by (epoch ms); defaults to `Date.now`. */
  now?: () => number;
  /**
   * The most a fetched artifact may weigh on the wire, in bytes, before it is
   * refused. Defaults to 512 MiB — see
   * {@link "./remote_cache.ts".HttpCacheStoreOptions.maxArtifactBytes}.
   */
  maxArtifactBytes?: number;
  /**
   * The most a fetched artifact may decompress to, in bytes — see
   * {@link RemoteCacheStore.maxInflatedBytes}. Defaults to 2 GiB.
   */
  maxInflatedBytes?: number;
}

/** The request body as bytes: the HTTP store sends a `Blob` or nothing. */
async function bodyBytes(
  body: BodyInit | null | undefined,
): Promise<Uint8Array> {
  return body instanceof Blob
    ? new Uint8Array(await body.arrayBuffer())
    : new Uint8Array(0);
}

/**
 * A {@link RemoteCacheStore} over an S3-compatible bucket: the HTTP store's
 * `GET`/`PUT <url>/<key>`, each request carrying `x-amz-content-sha256` and
 * a SigV4 `Authorization` for the service `s3`.
 *
 * A miss is a `404`, which S3 answers only to a caller allowed `s3:ListBucket`
 * on the bucket; without it a missing key is a `403`, reported as a lookup
 * failure (and a rebuild) rather than a miss. Grant `s3:GetObject`,
 * `s3:PutObject` and `s3:ListBucket`. Entries are never evicted by the store:
 * put a lifecycle rule on the prefix.
 */
export class S3CacheStore implements RemoteCacheStore {
  readonly #http: HttpCacheStore;
  /** The most an artifact may decompress to; see {@link RemoteCacheStore.maxInflatedBytes}. */
  readonly maxInflatedBytes?: number;

  /** Build the store from the bucket URL, region, credentials and seams. */
  constructor(options: S3CacheStoreOptions) {
    const doFetch = options.fetch ?? fetch;
    const now = options.now ?? Date.now;
    const signing: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = await bodyBytes(init?.body);
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, name) => {
        headers[name] = value;
      });
      headers["x-amz-content-sha256"] = await sha256Hex(body);
      const signed = await signSigV4(
        { method: init?.method ?? "GET", url, headers, body },
        options.credentials,
        options.region,
        "s3",
        now(),
      );
      return await doFetch(url, {
        ...init,
        headers: { ...headers, ...signed.headers },
      });
    };
    this.#http = new HttpCacheStore({
      url: options.url,
      fetch: signing,
      maxArtifactBytes: options.maxArtifactBytes,
    });
    this.maxInflatedBytes = options.maxInflatedBytes;
  }

  /** Fetch the archived outputs stored under `key`, or `null` if there are none. */
  get(key: string): Promise<Uint8Array | null> {
    return this.#http.get(key);
  }

  /** Store `artifact` (a gzipped tar of a target's outputs) under `key`. */
  put(key: string, artifact: Uint8Array): Promise<void> {
    return this.#http.put(key, artifact);
  }
}
