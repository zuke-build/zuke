/**
 * Open a pull request through the API, without a git credential on disk.
 *
 * The companion to {@link commitFiles}: that builds a branch server-side, this
 * proposes it. Together they let an unattended job put a change up for review
 * holding nothing but a request header — no checkout that persists a token into
 * `.git/config`, where it would outlive the step that needed it.
 *
 * @module
 */

import {
  assertRefName,
  caller,
  DEFAULT_BASE_URL,
  env,
  GhApiError,
  isRecord,
  readNumber,
  readString,
} from "./api.ts";

/** The pull request a {@link GhPullRequestApi.pullRequest} call resolved to. */
export interface GhPullRequestResult {
  /** Its number. */
  number: number;
  /** Its web URL. */
  url: string;
  /**
   * Whether this call opened it, as opposed to finding one already open.
   *
   * Worth reporting rather than hiding: "proposed" and "already proposed" are
   * different things to a human reading a build log, even though neither is a
   * failure.
   */
  created: boolean;
}

/**
 * Settings for opening a pull request.
 *
 * `owner/repo` and the token fall back to the Actions environment, so a job
 * that already has them needs to name only what it is proposing.
 */
export class GhPullRequestSettings {
  /** The branch being proposed. Set by {@link head}. */
  head_?: string;
  /** The branch it targets. Set by {@link base}. */
  base_?: string;
  /** The title. Set by {@link title}. */
  title_?: string;
  /** The body. Set by {@link body}. */
  body_ = "";
  /** `owner/repo`. Set by {@link repo}. */
  repo_?: string;
  /** The token. Set by {@link token}. */
  token_?: string;
  /** The API root. Set by {@link baseUrl}. */
  baseUrl_: string = DEFAULT_BASE_URL;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;

  /** The branch being proposed. */
  head(branch: string): this {
    this.head_ = branch;
    return this;
  }

  /** The branch it targets. */
  base(branch: string): this {
    this.base_ = branch;
    return this;
  }

  /** The pull request's title. */
  title(text: string): this {
    this.title_ = text;
    return this;
  }

  /** The pull request's body. */
  body(text: string): this {
    this.body_ = text;
    return this;
  }

  /** `owner/repo`. Defaults to `GITHUB_REPOSITORY`. */
  repo(slug: string): this {
    this.repo_ = slug;
    return this;
  }

  /** The token to authenticate with. Defaults to `GITHUB_TOKEN`. */
  token(value: string): this {
    this.token_ = value;
    return this;
  }

  /** The API root, for GitHub Enterprise. */
  baseUrl(url: string): this {
    this.baseUrl_ = url.replace(/\/+$/, "");
    return this;
  }

  /** Override the `fetch` implementation (a test seam). */
  fetch(fn: typeof fetch): this {
    this.fetch_ = fn;
    return this;
  }

  /** The effective `owner/repo`, from the setting or the environment. */
  repoSlug_(): string {
    const slug = this.repo_ ?? env("GITHUB_REPOSITORY");
    if (slug === undefined) {
      throw new Error(
        "opening a pull request requires .repo('owner/name') (or " +
          "GITHUB_REPOSITORY).",
      );
    }
    return slug;
  }

  /** The effective token, from the setting or the environment. */
  authToken_(): string {
    const token = this.token_ ?? env("GITHUB_TOKEN");
    if (token === undefined) {
      throw new Error(
        "opening a pull request requires .token(...) (or GITHUB_TOKEN).",
      );
    }
    return token;
  }
}

/** The pull-request operation {@link GhTasks} exposes. */
export interface GhPullRequestApi {
  /**
   * Open a pull request from `.head(...)` onto `.base(...)`, or return the one
   * already open for that branch.
   *
   * Idempotent on purpose. An unattended job that proposes the same branch
   * twice — because a later step failed and the whole thing ran again — should
   * find its existing proposal rather than fail on it.
   */
  pullRequest(
    configure?: (settings: GhPullRequestSettings) => GhPullRequestSettings,
  ): Promise<GhPullRequestResult>;
}

/** Perform the configured pull request. */
export async function openPullRequest(
  configure?: (settings: GhPullRequestSettings) => GhPullRequestSettings,
): Promise<GhPullRequestResult> {
  const settings = configure?.(new GhPullRequestSettings()) ??
    new GhPullRequestSettings();
  const head = settings.head_;
  const base = settings.base_;
  const title = settings.title_;
  if (head === undefined) {
    throw new Error("opening a pull request requires .head(...).");
  }
  if (base === undefined) {
    throw new Error("opening a pull request requires .base(...).");
  }
  if (title === undefined) {
    throw new Error("opening a pull request requires .title(...).");
  }
  // Both end up in a query string on the lookup path below, as well as in the
  // body — the same reason the commit operations validate theirs.
  assertRefName(head, "head branch");
  assertRefName(base, "base branch");

  const repo = settings.repoSlug_();
  const call = caller(
    settings.baseUrl_,
    repo,
    settings.authToken_(),
    settings.fetch_,
  );

  try {
    const pull = await call("POST", "/pulls", {
      title,
      body: settings.body_,
      head,
      base,
    });
    return {
      number: readNumber(pull, "number", "pull request"),
      url: readString(pull, ["html_url"], "pull request"),
      created: true,
    };
  } catch (error) {
    // 422 is what GitHub returns when a pull request for this head already
    // exists — and also what it returns for several unrelated problems, so
    // finding the existing one is what confirms which happened. If the lookup
    // comes back empty the original error is the honest thing to report.
    if (!(error instanceof GhApiError) || error.status !== 422) throw error;
    const existing = await findOpenPullRequest(call, repo, head);
    if (existing === undefined) throw error;
    return existing;
  }
}

/**
 * Find the open pull request for `head`, if there is one.
 *
 * The `head` filter wants `owner:branch`, and the owner is the repository's
 * own: a fork's branch is not something this package can propose, because the
 * commit that produced it was written through this repository's API.
 */
async function findOpenPullRequest(
  call: (method: string, path: string, body?: unknown) => Promise<unknown>,
  repo: string,
  head: string,
): Promise<GhPullRequestResult | undefined> {
  const owner = repo.split("/")[0];
  const query = new URLSearchParams({
    state: "open",
    head: `${owner}:${head}`,
  });
  const found = await call("GET", `/pulls?${query}`);
  if (!Array.isArray(found) || found.length === 0) return undefined;
  const first: unknown = found[0];
  if (!isRecord(first)) return undefined;
  return {
    number: readNumber(first, "number", "pull request"),
    url: readString(first, ["html_url"], "pull request"),
    created: false,
  };
}
