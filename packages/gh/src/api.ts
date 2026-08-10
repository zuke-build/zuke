/**
 * The REST transport the API-backed operations in this package share — the
 * bound caller, its typed error, and the guards that keep a caller-supplied
 * name from redirecting a token-bearing request.
 *
 * Extracted rather than copied. An earlier arrangement had a second copy of
 * this transport living outside the package, and every fix made here — ref
 * validation, path encoding, a typed status on failures — had to be made twice
 * or silently was not. One copy is the point of the file.
 *
 * @module
 */

/** GitHub's REST root. */
export const DEFAULT_BASE_URL = "https://api.github.com";

/**
 * A GitHub REST call that did not succeed, carrying the status.
 *
 * The status is the point. Callers recover from specific failures — a missing
 * ref, a pull request that already exists — and doing that on a bare `catch`
 * would swallow an expired token or a missing permission and retry it as
 * though it were the expected case.
 */
export class GhApiError extends Error {
  /** The error name. */
  override name = "GhApiError";
  /** The HTTP status of the failing response. */
  readonly status: number;
  /** Build the error from the failing call's method, path, status and body. */
  constructor(method: string, path: string, status: number, body: string) {
    // The token is deliberately absent: it never leaves the request header.
    super(`${method} ${path} failed: ${status}. ${body.slice(0, 400)}`);
    this.status = status;
  }
}

/**
 * Reject a branch or tag name that git itself would.
 *
 * Not cosmetic. These names are interpolated into request paths, and URL
 * normalisation resolves `..` before the request is sent — so
 * `../../../user/repos` as a branch turns `/repos/o/n/git/ref/heads/<branch>`
 * into `/repos/o/n/user/repos`, sending a write-scoped token somewhere the
 * caller never named. Validating here rather than trusting every caller is the
 * difference between an API that is safe to hand a string and one that is safe
 * only when used carefully.
 *
 * The rules are git's own (see `git check-ref-format`), minus those that only
 * matter for multi-level refs.
 */
export function assertRefName(name: string, what: string): void {
  const bad = name === "" ||
    name.includes("..") ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.startsWith("-") ||
    name.endsWith(".lock") ||
    name.endsWith(".") ||
    /[~^:?*[\\]/.test(name) ||
    // Control characters and space, by codepoint rather than a regex range: a
    // regex spelling them out trips `no-control-regex`, and suppressing that
    // to keep a check git itself makes would be the wrong way round.
    [...name].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x20 || code === 0x7f;
    });
  if (bad) {
    throw new Error(
      `refusing to use ${JSON.stringify(name)} as a ${what}: it is not a ` +
        `valid git ref name. These are interpolated into request paths, so a ` +
        `name containing \`..\` would redirect the call somewhere else ` +
        `entirely — with the token attached.`,
    );
  }
}

/**
 * Percent-encode each slash-separated segment of a ref or repository path.
 *
 * Validation alone was not enough, and the gap was exactly the one the
 * validator claims to close. It rejects a literal `..`, but `%` is legal in a
 * git ref, so `%2e%2e` passes it — and the URL parser decodes that to a
 * double-dot segment and resolves it, redirecting the request. Encoding turns
 * it into `%252e%252e`, an ordinary segment name.
 *
 * Segment-wise rather than wholesale, because a slash inside a branch name is
 * meaningful — `chore/action-v1.0.3` must stay three path segments, not one
 * escaped blob.
 *
 * Belt and braces on purpose: the validator still runs, because a name git
 * would reject deserves the clearer error, and because a second reader of this
 * code should not have to notice the encoding to conclude it is safe.
 */
export function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

/**
 * Reject a repository slug that is not exactly `owner/name`.
 *
 * Two things, and the second used to be missing. A slug with the wrong number
 * of segments silently changes which endpoint is called: `a/b/c` builds
 * `/repos/a/b/c/git/trees`, sending a token-bearing request somewhere the
 * caller never named.
 *
 * And the segments have to be checked, not just counted. `encodePath` does not
 * save us here the way it does for `%2e%2e`: a *literal* `..` is left alone by
 * `encodeURIComponent`, so `../x` passes a count-only check and the URL parser
 * then resolves `/repos/../x/commits/…` to `/x/commits/…` — a different
 * endpoint, with the token attached. GitHub's own names are alphanumerics,
 * dot, dash and underscore, so requiring exactly that costs nothing and makes
 * the guard mean what it says.
 */
export function assertRepoSlug(slug: string): void {
  const parts = slug.split("/");
  const wellFormed = parts.length === 2 &&
    parts.every((part) =>
      /^[A-Za-z0-9._-]+$/.test(part) && part !== "." && part !== ".."
    );
  if (!wellFormed) {
    throw new Error(
      `invalid repository ${JSON.stringify(slug)}: expected "owner/name" ` +
        `(letters, digits, ".", "-", "_"), and neither segment may be "." ` +
        `or "..".`,
    );
  }
}

/** Whether a parsed JSON value is an object that can be indexed. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read a nested string out of an API response, or say which call returned
 * something else.
 *
 * The alternative was asserting the response shape with a type assertion,
 * which this repository forbids and which would have been the wrong thing
 * anyway: a field that is missing or renamed would surface as `undefined`
 * flowing into a request path, not as an error naming the call that returned
 * it.
 */
export function readString(
  value: unknown,
  path: string[],
  what: string,
): string {
  let cursor = value;
  for (const key of path) {
    if (!isRecord(cursor)) {
      throw new Error(`the ${what} response has no ${path.join(".")}`);
    }
    cursor = cursor[key];
  }
  if (typeof cursor !== "string") {
    throw new Error(`the ${what} response has no ${path.join(".")}`);
  }
  return cursor;
}

/** Read a number out of an API response, or say which call returned junk. */
export function readNumber(
  value: unknown,
  key: string,
  what: string,
): number {
  if (!isRecord(value) || typeof value[key] !== "number") {
    throw new Error(`the ${what} response has no ${key}`);
  }
  return value[key];
}

/** A bound REST caller for one repository. */
export type GhCall = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<unknown>;

/** A caller bound to one repository, so each call site names only its path. */
export function caller(
  baseUrl: string,
  repo: string,
  token: string,
  fetchImpl: typeof fetch,
): GhCall {
  // Once, here, rather than in each settings class: every request routes
  // through this caller, so a check anywhere else could be one path short.
  assertRepoSlug(repo);
  return async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await fetchImpl(
      `${baseUrl}/repos/${encodePath(repo)}${path}`,
      {
        method,
        headers: {
          // A header, not a credential store: this exists for the length of the
          // request and nowhere else.
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      // GitHub's own message is the useful half. A status alone rarely says
      // which field or which permission was the problem, and this runs
      // unattended — the log is all anyone will have.
      throw new GhApiError(method, path, response.status, text);
    }
    if (text === "") return {};
    try {
      return JSON.parse(text);
    } catch {
      // A 2xx that is not JSON is a proxy or gateway answering instead of
      // GitHub. Left bare it surfaces as a SyntaxError naming no call, which
      // is the same dead end `readString` exists to avoid — and the body is
      // the evidence of who actually answered, so a prefix of it comes along.
      // Deliberately not a GhApiError: that type means GitHub refused, and
      // callers read its status to decide whether to recover. A parse failure
      // is neither, and must not be mistaken for one.
      throw new Error(
        `${method} ${path} returned ${response.status} with a body that is ` +
          `not JSON. ${text.slice(0, 400)}`,
      );
    }
  };
}

/**
 * Read an environment variable, tolerating a denied permission.
 *
 * The fallbacks to `GITHUB_REPOSITORY` and `GITHUB_TOKEN` are a convenience for
 * jobs that already have them, so a build running without `--allow-env` should
 * get the settings class's own "requires .repo(...)" message rather than a
 * permission failure from underneath it.
 */
export function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}
