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

import {
  type AwsCredentials,
  signSigV4,
  UNSIGNED_PAYLOAD,
} from "./aws_sigv4.ts";
import { HttpError } from "./http.ts";
import { sha256Hex } from "./internal.ts";
import { uploadInParts } from "./part_upload.ts";
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

/** `text` as XML character data. */
function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * A {@link RemoteCacheStore} over an S3-compatible bucket: the HTTP store's
 * `GET`/`PUT <url>/<key>`, each request carrying `x-amz-content-sha256` and
 * a SigV4 `Authorization` for the service `s3`.
 *
 * A miss is a `404`, which S3 answers only to a caller allowed `s3:ListBucket`
 * on the bucket; without it a missing key is a `403`, reported as a lookup
 * failure (and a rebuild) rather than a miss. Grant `s3:GetObject`,
 * `s3:PutObject` and `s3:ListBucket`; a streamed upload larger than one part
 * is a multipart upload, aborted on failure, which needs `s3:AbortMultipartUpload`
 * to clean up (add a lifecycle rule aborting incomplete multipart uploads as
 * a backstop). Entries are never evicted by the store:
 * put a lifecycle rule on the prefix.
 */
export class S3CacheStore implements RemoteCacheStore {
  readonly #http: HttpCacheStore;
  readonly #signed: typeof fetch;
  readonly #base: string;
  /** The most an artifact may decompress to; see {@link RemoteCacheStore.maxInflatedBytes}. */
  readonly maxInflatedBytes?: number;

  /** Build the store from the bucket URL, region, credentials and seams. */
  constructor(options: S3CacheStoreOptions) {
    const doFetch = options.fetch ?? fetch;
    const now = options.now ?? Date.now;
    const signing: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, name) => {
        headers[name] = value;
      });
      // A part is sent `UNSIGNED-PAYLOAD`, so it is not read back to be hashed.
      const unsigned = headers["x-amz-content-sha256"] === UNSIGNED_PAYLOAD;
      const body = unsigned ? new Uint8Array(0) : await bodyBytes(init?.body);
      if (!unsigned) headers["x-amz-content-sha256"] = await sha256Hex(body);
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
    this.#signed = signing;
    this.#base = options.url.replace(/\/+$/, "");
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

  /** The archive stored under `key` as a stream, or `null` if there is none. */
  getStream(
    key: string,
  ): Promise<ReadableStream<Uint8Array<ArrayBuffer>> | null> {
    return this.#http.getStream(key);
  }

  /** Store `artifact` (a gzipped tar of a target's outputs) under `key`. */
  put(key: string, artifact: Uint8Array): Promise<void> {
    return this.#http.put(key, artifact);
  }

  /**
   * Store the archive `artifact` streams under `key`. A stream that fits one
   * 8 MiB part is a single `PUT`; a larger one is a multipart upload, each
   * part signed `UNSIGNED-PAYLOAD`, so memory stays at a few parts. If any
   * request fails, the upload is aborted, so no parts are left to be billed.
   */
  putStream(
    key: string,
    artifact: ReadableStream<Uint8Array<ArrayBuffer>>,
  ): Promise<void> {
    return uploadInParts(
      artifact,
      (whole) => this.put(key, whole),
      (parts) =>
        this.#multipart(`${this.#base}/${encodeURIComponent(key)}`, parts),
    );
  }

  /** One signed request to the object at `url`; the body of a success is returned. */
  async #send(
    method: string,
    url: string,
    init: { body?: Blob; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const response = await this.#signed(url, { method, ...init });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, url);
    }
    return response;
  }

  /** Upload `parts` to the object at `url` as a multipart upload. */
  async #multipart(
    url: string,
    parts: AsyncIterable<Uint8Array<ArrayBuffer>>,
  ): Promise<void> {
    const created = await (await this.#send("POST", `${url}?uploads`)).text();
    const id = /<UploadId>([^<]+)<\/UploadId>/.exec(created)?.[1];
    if (id === undefined) {
      throw new Error("remote cache: S3 did not return an upload id.");
    }
    const upload = `uploadId=${encodeURIComponent(id)}`;
    try {
      const etags: string[] = [];
      for await (const part of parts) {
        const response = await this.#send(
          "PUT",
          `${url}?partNumber=${etags.length + 1}&${upload}`,
          {
            body: new Blob([part]),
            headers: { "x-amz-content-sha256": UNSIGNED_PAYLOAD },
          },
        );
        await response.body?.cancel();
        const etag = response.headers.get("etag");
        if (etag === null) {
          throw new Error("remote cache: S3 returned no ETag for a part.");
        }
        etags.push(etag);
      }
      const list = etags.map((etag, i) =>
        `<Part><PartNumber>${i + 1}</PartNumber><ETag>${
          escapeXml(etag)
        }</ETag></Part>`
      ).join("");
      const done = await (await this.#send("POST", `${url}?${upload}`, {
        body: new Blob([
          `<CompleteMultipartUpload>${list}</CompleteMultipartUpload>`,
        ]),
        headers: { "content-type": "application/xml" },
      })).text();
      // S3 can answer a failed completion with 200 and an error document.
      if (done.includes("<Error>")) {
        throw new Error("remote cache: S3 failed to complete the upload.");
      }
    } catch (error) {
      await this.#send("DELETE", `${url}?${upload}`).catch(() => {}); // best effort
      throw error;
    }
  }
}
