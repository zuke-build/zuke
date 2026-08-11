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
 * The environment variable that opts a deployment out of {@link
 * assertSecureBackendUrl}'s `https:` requirement, for a plaintext endpoint on a
 * network the operator has decided to trust.
 */
export const ALLOW_INSECURE_ENV = "ZUKE_ALLOW_INSECURE_URL";

/** Whether a hostname is loopback, so no network path exists to sit on. */
export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Raised by {@link assertSecureBackendUrl} when a backend is configured with a
 * plaintext URL. A distinct type so the CLI can report it as the configuration
 * mistake it is — a named message and exit code 1 — rather than letting a stack
 * trace escape as if the build had crashed.
 */
export class InsecureBackendUrlError extends Error {
  /** The error name. */
  override name = "InsecureBackendUrlError";
  /** The environment variable (or setting) carrying the plaintext URL. */
  readonly setting: string;
  /** Build the error from the offending setting and the full explanation. */
  constructor(setting: string, message: string) {
    super(message);
    this.setting = setting;
  }
}

/**
 * Refuse a plaintext URL for a backend Zuke both authenticates to and *trusts
 * the answers from* — the state service, the build registry, and the remote
 * cache.
 *
 * Confidentiality is the obvious half: a bearer token sent over `http:` is
 * readable by anyone on the path, and that token can forge run records, the
 * audit trail, and the cross-run locks two deploys rely on being exclusive.
 *
 * **Integrity is the half that matters more**, and it does not need a token at
 * all. A registry descriptor is a launch command the MCP host will spawn, and a
 * cache artifact is a file tree restored into the workspace — so an on-path
 * attacker who can answer a plaintext request reaches code execution without
 * stealing anything. That is why this refuses `http:` whether or not a
 * credential is configured.
 *
 * Loopback is exempt: there is no path to sit on, and a local dev service on
 * `http://localhost` is the ordinary way to work on one. A deliberate plaintext
 * endpoint elsewhere is still reachable by setting {@link ALLOW_INSECURE_ENV},
 * which is an explicit decision rather than a silent default.
 *
 * This guards the **environment** path — the `ZUKE_*_URL` variables, which are
 * set by whoever configures the CI job or the shell. Constructing a store in
 * code (`new HttpStateStore({ url })`, a `stateStore()` override) is deliberately
 * left alone: that URL is first-party source in the build file, so writing it is
 * itself the trust decision, and a build author who means to talk plaintext to a
 * service on their own network should not have to also set an env var.
 *
 * @throws {InsecureBackendUrlError} naming the variable that relaxes it, when
 *   `raw` is neither `https:` nor loopback and the opt-out is unset.
 */
export function assertSecureBackendUrl(
  raw: string,
  what: string,
  readEnv: (name: string) => string | undefined,
): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not a URL at all: leave the complaint to whoever tries to use it, which
    // reports the malformed value with its own context.
    return;
  }
  if (url.protocol === "https:" || isLoopbackHost(url.hostname)) return;
  const optOut = readEnv(ALLOW_INSECURE_ENV);
  if (optOut !== undefined && optOut !== "") return;
  throw new InsecureBackendUrlError(
    what,
    `${what} must use https: ${
      redactUrl(raw)
    } is plaintext, so anyone on the ` +
      `path can read the token it is sent with and — worse — choose the ` +
      `answer it gets back. Use an https URL, or set ${ALLOW_INSECURE_ENV}=1 ` +
      `to accept the risk on a network you trust. Loopback needs no opt-out.`,
  );
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
  /** Build the error from the failing response's status and URL. */
  constructor(status: number, url: string) {
    const safe = redactUrl(url);
    super(`HTTP ${status} for ${safe}`);
    this.status = status;
    this.url = safe;
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
