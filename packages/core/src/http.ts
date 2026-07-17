/**
 * HTTP helpers for build scripts: download a URL to a file, or fetch its body
 * as text or JSON. Built on the platform `fetch`, with an injectable `fetch`
 * seam so they can be unit-tested without network access.
 *
 * ```ts
 * import { httpDownload, httpJson } from "jsr:@zuke/core";
 *
 * await httpDownload("https://example.com/tool.tar.gz", ".zuke/tool.tar.gz");
 * const release = await httpJson<{ tag_name: string }>(
 *   "https://api.github.com/repos/zuke-build/zuke/releases/latest",
 * );
 * ```
 *
 * A non-2xx response throws an {@link HttpError} carrying the status.
 *
 * @module
 */

import type { PathLike } from "./path.ts";

/** Raised when an HTTP request returns a non-2xx status. */
export class HttpError extends Error {
  /** The error name. */
  override name = "HttpError";
  /** Build the error from the failing response's status and URL. */
  constructor(
    /** The HTTP status code of the failing response. */
    readonly status: number,
    /** The requested URL. */
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

/** Options shared by the HTTP helpers. */
export interface HttpOptions {
  /** Extra request headers (e.g. an `Authorization` token). */
  headers?: Record<string, string>;
  /**
   * The `fetch` implementation to use. Defaults to the global `fetch`;
   * override it to unit-test without network access.
   */
  fetch?: typeof fetch;
}

/** Perform the request and return the response, throwing on a non-2xx status. */
async function request(url: string, options: HttpOptions): Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(url, { headers: options.headers });
  if (!response.ok) {
    // Drain the body so the connection can be reused/closed.
    await response.body?.cancel();
    throw new HttpError(response.status, url);
  }
  return response;
}

/**
 * Download `url` to `dest`, streaming the response body to the file. Creates or
 * truncates `dest`. Throws {@link HttpError} on a non-2xx status.
 */
export async function httpDownload(
  url: string,
  dest: PathLike,
  options: HttpOptions = {},
): Promise<void> {
  const response = await request(url, options);
  const file = await Deno.open(String(dest), {
    write: true,
    create: true,
    truncate: true,
  });
  if (response.body === null) {
    file.close();
    return;
  }
  await response.body.pipeTo(file.writable); // closes the file when done
}

/** Fetch `url` and return its body as text. Throws {@link HttpError} on non-2xx. */
export async function httpText(
  url: string,
  options: HttpOptions = {},
): Promise<string> {
  const response = await request(url, options);
  return await response.text();
}

/** Fetch `url` and parse its body as JSON. Throws {@link HttpError} on non-2xx. */
export async function httpJson<T = unknown>(
  url: string,
  options: HttpOptions = {},
): Promise<T> {
  const response = await request(url, options);
  return await response.json() as T;
}
