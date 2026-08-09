/**
 * Committing to GitHub through its REST API, so nothing needs a git credential
 * on disk.
 *
 * The usual way to have CI commit something is `actions/checkout` with
 * `persist-credentials`, then `git commit` and `git push`. That writes the
 * token into `.git/config`, where it outlives the step that needed it: every
 * later step in the job can read it, and anything archiving the workspace
 * carries it out. Blocking a job's egress does not substitute — the token is a
 * GitHub credential and GitHub is necessarily reachable, so an allowlist bounds
 * where it could be *sent*, not what it could *do*.
 *
 * Git's data API takes file contents inline, so the commit is built
 * server-side and a ref pointed at it. The token becomes a request header and
 * nothing more.
 *
 * What this does not claim: the token is still readable by code running in the
 * step that uses it, because that step is what uses it. Nothing short of not
 * having a token avoids that. What it removes is the credential's persistence
 * beyond its use.
 *
 * @module
 */

import { httpJson } from "@zuke/core";

/** Read an environment variable, tolerating a denied permission. */
function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** GitHub's public API root. */
const DEFAULT_BASE_URL = "https://api.github.com";

/** Blob mode for a non-executable file, as git's tree API spells it. */
const FILE_MODE = "100644";

/** The commit a {@link GhTasksApi.commit} call created. */
export interface GhCommitResult {
  /** The new commit's SHA. */
  sha: string;
  /** The branch it landed on. */
  branch: string;
}

/**
 * Settings for committing files through the API.
 *
 * `owner/repo` and the token fall back to the Actions environment, so a job
 * that already has them needs to name only what it is committing.
 */
export class GhCommitSettings {
  /** The files to write, by path. */
  files_: Map<string, string> = new Map();
  /** The branch to commit onto. Set by {@link branch}. */
  branch_?: string;
  /** The branch to create from, when creating one. Set by {@link from}. */
  from_?: string;
  /** The commit message. Set by {@link message}. */
  message_?: string;
  /** `owner/repo`. Set by {@link repo}. */
  repo_?: string;
  /** The token. Set by {@link token}. */
  token_?: string;
  /** The API root. Set by {@link baseUrl}. */
  baseUrl_: string = DEFAULT_BASE_URL;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;

  /** Add a file to the commit, replacing any earlier one at the same path. */
  file(path: string, content: string): this {
    this.files_.set(path, content);
    return this;
  }

  /** The branch to commit onto. It must exist unless {@link from} is set. */
  branch(name: string): this {
    this.branch_ = name;
    return this;
  }

  /**
   * Create {@link branch} from this one rather than committing onto an
   * existing branch. Creating a ref and moving one are different calls, and
   * which is wanted is the caller's to say rather than something to infer.
   */
  from(base: string): this {
    this.from_ = base;
    return this;
  }

  /** The commit message. */
  message(text: string): this {
    this.message_ = text;
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
        "committing requires .repo('owner/name') (or GITHUB_REPOSITORY).",
      );
    }
    return slug;
  }

  /** The effective token, from the setting or the environment. */
  authToken_(): string {
    const token = this.token_ ?? env("GITHUB_TOKEN");
    if (token === undefined) {
      throw new Error("committing requires .token(...) (or GITHUB_TOKEN).");
    }
    return token;
  }
}

/** Settings for pointing a tag at a commit. */
export class GhTagSettings {
  /** The tag name. Set by {@link name}. */
  name_?: string;
  /** The commit the tag points at. Set by {@link commit}. */
  commit_?: string;
  /** The annotation message. Set by {@link message}. */
  message_?: string;
  /** Whether to move an existing tag. Set by {@link move}. */
  move_: boolean = false;
  /** `owner/repo`. Set by {@link repo}. */
  repo_?: string;
  /** The token. Set by {@link token}. */
  token_?: string;
  /** The API root. Set by {@link baseUrl}. */
  baseUrl_: string = DEFAULT_BASE_URL;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;

  /** The tag name, e.g. `v1.2.3`. */
  name(value: string): this {
    this.name_ = value;
    return this;
  }

  /** The commit SHA to tag. Defaults to `GITHUB_SHA`. */
  commit(sha: string): this {
    this.commit_ = sha;
    return this;
  }

  /** The annotation message. Defaults to the tag name. */
  message(text: string): this {
    this.message_ = text;
    return this;
  }

  /**
   * Move the tag if it already exists, rather than failing.
   *
   * Forced by necessity: pointing a major tag at a newer release is a
   * non-fast-forward by definition. A tag that does not exist yet is created,
   * since for the first release of a major those are the same intent.
   */
  move(): this {
    this.move_ = true;
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
        "tagging requires .repo('owner/name') (or GITHUB_REPOSITORY).",
      );
    }
    return slug;
  }

  /** The effective token, from the setting or the environment. */
  authToken_(): string {
    const token = this.token_ ?? env("GITHUB_TOKEN");
    if (token === undefined) {
      throw new Error("tagging requires .token(...) (or GITHUB_TOKEN).");
    }
    return token;
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

/** The commit and tag operations {@link GhTasks} exposes. */
export interface GhCommitApi {
  /**
   * Commit files through the API, with no git credential on disk.
   *
   * Commits onto `.branch(...)`, or creates it from `.from(...)` when that is
   * set. The ref update is not forced, so a commit landing between reading the
   * head and writing it is rejected rather than silently overwritten.
   */
  commit(
    configure?: (settings: GhCommitSettings) => GhCommitSettings,
  ): Promise<GhCommitResult>;
  /** Point an annotated tag at a commit, creating or moving its ref. */
  tag(
    configure?: (settings: GhTagSettings) => GhTagSettings,
  ): Promise<void>;
}

/** Perform the configured commit. */
export async function commitFiles(
  configure?: (settings: GhCommitSettings) => GhCommitSettings,
): Promise<GhCommitResult> {
  const settings = configure?.(new GhCommitSettings()) ??
    new GhCommitSettings();
  const branch = settings.branch_;
  if (branch === undefined) {
    throw new Error("committing requires .branch(...).");
  }
  if (settings.message_ === undefined) {
    throw new Error("committing requires .message(...).");
  }
  assertRefName(branch, "branch");
  if (settings.from_ !== undefined) {
    assertRefName(settings.from_, "base branch");
  }

  const call = caller(
    settings.baseUrl_,
    settings.repoSlug_(),
    settings.authToken_(),
    settings.fetch_,
  );
  // The commit's parent: the branch being extended, or the one it is created
  // from.
  const source = settings.from_ ?? branch;
  const head = await call<{ object: { sha: string } }>(
    "GET",
    `/git/ref/heads/${source}`,
  );
  const parent = head.object.sha;
  const parentCommit = await call<{ tree: { sha: string } }>(
    "GET",
    `/git/commits/${parent}`,
  );
  // Contents ride inline: the trees API accepts them, so there is no separate
  // blob to create and nothing orphaned if a later call fails.
  const tree = await call<{ sha: string }>("POST", "/git/trees", {
    base_tree: parentCommit.tree.sha,
    tree: [...settings.files_].map(([path, content]) => ({
      path,
      mode: FILE_MODE,
      type: "blob",
      content,
    })),
  });
  const commit = await call<{ sha: string }>("POST", "/git/commits", {
    message: settings.message_,
    tree: tree.sha,
    parents: [parent],
  });

  if (settings.from_ === undefined) {
    await call("PATCH", `/git/refs/heads/${branch}`, { sha: commit.sha });
  } else {
    await call("POST", "/git/refs", {
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
  }
  return { sha: commit.sha, branch };
}

/** Perform the configured tag. */
export async function tagCommit(
  configure?: (settings: GhTagSettings) => GhTagSettings,
): Promise<void> {
  const settings = configure?.(new GhTagSettings()) ?? new GhTagSettings();
  const name = settings.name_;
  if (name === undefined) throw new Error("tagging requires .name(...).");
  assertRefName(name, "tag");
  const sha = settings.commit_ ?? env("GITHUB_SHA");
  if (sha === undefined) {
    throw new Error("tagging requires .commit(...) (or GITHUB_SHA).");
  }

  const call = caller(
    settings.baseUrl_,
    settings.repoSlug_(),
    settings.authToken_(),
    settings.fetch_,
  );
  const object = await call<{ sha: string }>("POST", "/git/tags", {
    tag: name,
    message: settings.message_ ?? name,
    object: sha,
    type: "commit",
  });
  if (!settings.move_) {
    await call("POST", "/git/refs", {
      ref: `refs/tags/${name}`,
      sha: object.sha,
    });
    return;
  }
  try {
    await call("PATCH", `/git/refs/tags/${name}`, {
      sha: object.sha,
      force: true,
    });
  } catch {
    // No such ref yet — the first release of a major, where moving and
    // creating are the same intent.
    await call("POST", "/git/refs", {
      ref: `refs/tags/${name}`,
      sha: object.sha,
    });
  }
}

/** A caller bound to one repository, so each call site names only its path. */
function caller(
  baseUrl: string,
  repo: string,
  token: string,
  fetchImpl: typeof fetch,
) {
  return async function call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return await httpJson<T>(`${baseUrl}/repos/${repo}${path}`, {
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
      fetch: fetchImpl,
    });
  };
}
