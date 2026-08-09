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

/**
 * Substrings that mark a query-param name as credential-bearing. Matched as
 * substrings (not exact names) so variants — `client_secret`, `refresh_token`,
 * `x-api-key` — are covered without maintaining an exhaustive list. Over-masking
 * an innocent param (e.g. `monkey`) is harmless; under-masking a secret is not.
 */
const CREDENTIAL_MARKERS = [
  "secret",
  "token",
  "key",
  "password",
  "pwd",
  "auth",
  "sig",
  "credential",
  "session",
];

/** Whether a query-param `name` looks credential-bearing (see {@link CREDENTIAL_MARKERS}). */
function isCredentialParam(name: string): boolean {
  const lower = name.toLowerCase();
  return CREDENTIAL_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Strip userinfo (`user:pass@`) and mask any credential-bearing query param so a
 * URL is safe to put in an error message or log. A string that is not a URL is
 * returned unchanged. Non-goal: a secret embedded in the URL *path* (rare and
 * non-standard) is not redacted — only userinfo and query params are.
 */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (isCredentialParam(key)) url.searchParams.set(key, "REDACTED");
    }
    return url.href;
  } catch {
    return raw;
  }
}

/**
 * Raised when an HTTP request returns a non-2xx status. The URL appears in the
 * message and on {@link url}, so it is passed through {@link redactUrl} first —
 * userinfo and credential query params never reach a log.
 */
export class HttpError extends Error {
  /** The error name. */
  override name = "HttpError";
  /** The HTTP status code of the failing response. */
  readonly status: number;
  /** The requested URL, with any credentials redacted. */
  readonly url: string;
  /**
   * The start of the response body, when there was one.
   *
   * A status alone rarely says which field or which permission was the
   * problem, and an API that explains itself in the body is the common case.
   * Truncated, because this ends up in a build log.
   */
  readonly body?: string;
  /** Build the error from the failing response's status, URL and body. */
  constructor(status: number, url: string, body?: string) {
    const safe = redactUrl(url);
    const detail = body === undefined || body === "" ? "" : `: ${body}`;
    super(`HTTP ${status} for ${safe}${detail}`);
    this.status = status;
    this.url = safe;
    this.body = body;
  }
}

/** Options shared by the HTTP helpers. */
export interface HttpOptions {
  /** Extra request headers (e.g. an `Authorization` token). */
  headers?: Record<string, string>;
  /** The HTTP method. Defaults to `GET`. */
  method?: string;
  /** A request body, already serialised. Sent as-is. */
  body?: string;
  /**
   * The `fetch` implementation to use. Defaults to the global `fetch`;
   * override it to unit-test without network access.
   */
  fetch?: typeof fetch;
}

/** Perform the request and return the response, throwing on a non-2xx status. */
async function request(url: string, options: HttpOptions): Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
  });
  if (!response.ok) {
    // Read rather than cancel: the body is what says *why*, and reading it
    // releases the connection just as well.
    const body = await response.text().catch(() => "");
    throw new HttpError(response.status, url, body.slice(0, 500));
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
