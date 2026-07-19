/**
 * `GcsTasks` — read, write, and list JSON objects in Google Cloud Storage over
 * its JSON REST API, without a Google SDK. Auth is a bearer token from an
 * injected {@link "./auth.ts".AccessTokenProvider} (default:
 * `gcloud auth print-access-token`).
 *
 * ```ts
 * import { GcsTasks } from "jsr:@zuke/gcloud";
 *
 * await GcsTasks.writeJson("my-bucket", "state/deploy.json", { slot: "sit-7" });
 * const state = await GcsTasks.readJson<{ slot: string }>(
 *   "my-bucket",
 *   "state/deploy.json",
 * );
 * const keys = await GcsTasks.list("my-bucket", { prefix: "state/" });
 * ```
 *
 * @module
 */

import { httpJson } from "@zuke/core";
import { type AccessTokenProvider, resolveAccessToken } from "./auth.ts";
import { gcpJson, isRecord, readArray, readString } from "./rest.ts";

/** The GCS JSON/upload API roots (overridable only via the `fetch` seam in tests). */
const STORAGE_BASE = "https://storage.googleapis.com/storage/v1";
const UPLOAD_BASE = "https://storage.googleapis.com/upload/storage/v1";

/** Auth + transport options common to every {@link GcsTasks} call. */
export interface GcsOptions {
  /** A pre-resolved OAuth token; when omitted, {@link tokenProvider} supplies one. */
  token?: string;
  /** Resolves the token when `token` is omitted (default: {@link "./auth.ts".gcloudAccessToken}). */
  tokenProvider?: AccessTokenProvider;
  /** The `fetch` implementation; defaults to the global. Overridable for tests. */
  fetch?: typeof fetch;
}

/** Options for {@link GcsTasksApi.list}: the auth/transport plus an object-name prefix. */
export interface GcsListOptions extends GcsOptions {
  /** Keep only objects whose name starts with this prefix. */
  prefix?: string;
}

/** The shape of {@link GcsTasks}. */
export interface GcsTasksApi {
  /** Read object `object` from `bucket` and parse its body as JSON. */
  readJson<T = unknown>(
    bucket: string,
    object: string,
    options?: GcsOptions,
  ): Promise<T>;
  /** Write `data` (JSON-serialised) as object `object` in `bucket`. */
  writeJson(
    bucket: string,
    object: string,
    data: unknown,
    options?: GcsOptions,
  ): Promise<void>;
  /** List object names in `bucket` (optionally filtered by `prefix`). */
  list(bucket: string, options?: GcsListOptions): Promise<string[]>;
}

/** Typed Google Cloud Storage JSON operations. */
export const GcsTasks: GcsTasksApi = {
  async readJson<T = unknown>(
    bucket: string,
    object: string,
    options: GcsOptions = {},
  ): Promise<T> {
    const token = await resolveAccessToken(options);
    const url = `${STORAGE_BASE}/b/${encodeURIComponent(bucket)}/o/${
      encodeURIComponent(object)
    }?alt=media`;
    return await httpJson<T>(url, {
      headers: { authorization: `Bearer ${token}` },
      fetch: options.fetch,
    });
  },

  async writeJson(
    bucket: string,
    object: string,
    data: unknown,
    options: GcsOptions = {},
  ): Promise<void> {
    const token = await resolveAccessToken(options);
    const url = `${UPLOAD_BASE}/b/${
      encodeURIComponent(bucket)
    }/o?uploadType=media&name=${encodeURIComponent(object)}`;
    await gcpJson(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      },
      { token, fetch: options.fetch },
    );
  },

  async list(bucket: string, options: GcsListOptions = {}): Promise<string[]> {
    const token = await resolveAccessToken(options);
    const query = options.prefix === undefined
      ? ""
      : `?prefix=${encodeURIComponent(options.prefix)}`;
    const url = `${STORAGE_BASE}/b/${encodeURIComponent(bucket)}/o${query}`;
    const body = await gcpJson(url, { method: "GET" }, {
      token,
      fetch: options.fetch,
    });
    const root = isRecord(body) ? body : {};
    return readArray(root, "items").flatMap((item) => {
      const name = isRecord(item) ? readString(item, "name") : undefined;
      return name === undefined ? [] : [name];
    });
  },
};
