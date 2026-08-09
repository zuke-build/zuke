/**
 * Commit files to GitHub through its API, without a git credential on disk.
 *
 * The usual way to have CI commit something is `actions/checkout` with
 * `persist-credentials`, then `git commit` and `git push`. That writes the
 * token into `.git/config`, where it outlives the step that needed it: every
 * later step in the job can read it, and anything that archives the workspace
 * carries it out with everything else.
 *
 * Git's data API takes file contents inline, so a commit can be built
 * server-side and a ref pointed at it — the token is a request header and
 * nothing more. Blocking a job's egress does not substitute for this: the token
 * is a GitHub credential and GitHub is necessarily reachable, so an allowlist
 * bounds where it could be *sent*, not what it could *do*.
 *
 * What this does not claim: the token is still readable by code running in the
 * step that uses it, because that step is what uses it. Nothing short of not
 * having a token avoids that. What it removes is the credential's persistence
 * beyond its use.
 *
 * @module
 */

import { httpJson } from "./http.ts";

/** A file to write in a commit. */
export interface CommitFile {
  /** Repository-relative path, e.g. `build/action_version.json`. */
  path: string;
  /** The file's full contents. */
  content: string;
}

/** Where to commit, and what to authenticate with. */
export interface GitHubRepoOptions {
  /** `owner/name`. */
  repo: string;
  /** A token with `contents: write` on that repository. */
  token: string;
  /** The API root. Defaults to GitHub's; set it for GitHub Enterprise. */
  api?: string;
  /**
   * The `fetch` implementation to use. Defaults to the global; override it to
   * unit-test without network access.
   */
  fetch?: typeof fetch;
}

/** GitHub's public API root. */
const DEFAULT_API = "https://api.github.com";

/** Blob mode for a non-executable file, as git's tree API spells it. */
const FILE_MODE = "100644";

/** The commit {@link commitFiles} created. */
export interface CreatedCommit {
  /** The new commit's SHA. */
  sha: string;
  /** The branch it was committed to. */
  branch: string;
}

/**
 * Commit `files` onto `branch`, which must already exist.
 *
 * The parent is whatever the branch points at when this runs, so a commit
 * landing between reading and writing is rejected by GitHub rather than
 * silently overwritten — the ref update is not forced.
 *
 * @throws {@link HttpError} carrying GitHub's own message, which is where the
 * useful half of a failure lives.
 */
export async function commitFiles(
  options: GitHubRepoOptions,
  branch: string,
  message: string,
  files: readonly CommitFile[],
): Promise<CreatedCommit> {
  assertRefName(branch, "branch");
  const call = caller(options);
  const head = await call<{ object: { sha: string } }>(
    "GET",
    `/git/ref/heads/${branch}`,
  );
  const parent = head.object.sha;
  const sha = await commitOnto(call, parent, message, files);
  await call("PATCH", `/git/refs/heads/${branch}`, { sha });
  return { sha, branch };
}

/**
 * Create `branch` from `base` with `files` applied, and return the commit.
 *
 * Separate from {@link commitFiles} because creating a ref and moving one are
 * different API calls, and a caller proposing a change wants the first while a
 * caller amending its own branch wants the second.
 */
export async function commitToNewBranch(
  options: GitHubRepoOptions,
  base: string,
  branch: string,
  message: string,
  files: readonly CommitFile[],
): Promise<CreatedCommit> {
  assertRefName(base, "base branch");
  assertRefName(branch, "branch");
  const call = caller(options);
  const baseRef = await call<{ object: { sha: string } }>(
    "GET",
    `/git/ref/heads/${base}`,
  );
  const sha = await commitOnto(call, baseRef.object.sha, message, files);
  await call("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha });
  return { sha, branch };
}

/** Build a tree from `parent` plus `files`, and a commit on top of it. */
async function commitOnto(
  call: ReturnType<typeof caller>,
  parent: string,
  message: string,
  files: readonly CommitFile[],
): Promise<string> {
  const parentCommit = await call<{ tree: { sha: string } }>(
    "GET",
    `/git/commits/${parent}`,
  );
  // Contents ride inline: the trees API accepts them, so there is no separate
  // blob to create and nothing orphaned if a later call fails.
  const tree = await call<{ sha: string }>("POST", "/git/trees", {
    base_tree: parentCommit.tree.sha,
    tree: files.map((file) => ({
      path: file.path,
      mode: FILE_MODE,
      type: "blob",
      content: file.content,
    })),
  });
  const commit = await call<{ sha: string }>("POST", "/git/commits", {
    message,
    tree: tree.sha,
    parents: [parent],
  });
  return commit.sha;
}

/**
 * Create an annotated tag at `sha`, or move it there when `force`.
 *
 * Annotated rather than lightweight: a lightweight ref resolves identically for
 * a `uses:` reference, but a repository whose other tags carry messages should
 * not grow one that does not. Moving is forced by necessity — pointing a major
 * tag at a newer release is a non-fast-forward by definition.
 */
export async function tagCommit(
  options: GitHubRepoOptions,
  tag: string,
  sha: string,
  message: string,
  force = false,
): Promise<void> {
  assertRefName(tag, "tag");
  const call = caller(options);
  const object = await call<{ sha: string }>("POST", "/git/tags", {
    tag,
    message,
    object: sha,
    type: "commit",
  });
  if (!force) {
    await call("POST", "/git/refs", {
      ref: `refs/tags/${tag}`,
      sha: object.sha,
    });
    return;
  }
  try {
    await call("PATCH", `/git/refs/tags/${tag}`, { sha: object.sha, force });
  } catch {
    // No such ref yet — the first release of a major, where moving and
    // creating are the same intent.
    await call("POST", "/git/refs", {
      ref: `refs/tags/${tag}`,
      sha: object.sha,
    });
  }
}

/**
 * Reject a branch or tag name that git itself would.
 *
 * Not cosmetic. These names are interpolated into request paths, and URL
 * normalisation resolves `..` before the request is sent — so
 * `../../../user/repos` as a branch turns
 * `/repos/o/n/git/ref/heads/<branch>` into `/repos/o/n/user/repos`, sending a
 * write-scoped token somewhere the caller never named. Validating here rather
 * than trusting every caller is the difference between a library that is safe
 * to hand a string and one that is safe only when used carefully.
 *
 * The rules are git's own (see `git check-ref-format`), minus the ones that
 * only matter for multi-level refs.
 */
function assertRefName(name: string, what: string): void {
  const bad = name === "" ||
    name.includes("..") ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.startsWith("-") ||
    name.endsWith(".lock") ||
    name.endsWith(".") ||
    /[~^:?*[\\]/.test(name) ||
    // Control characters and space, checked by codepoint rather than by a
    // regex range: a regex spelling them out trips `no-control-regex`, and
    // suppressing that rule to keep a check git itself makes would be the
    // wrong trade.
    [...name].some((c) => {
      const code = c.codePointAt(0) ?? 0;
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

/** A caller bound to one repository, so each call site names only its path. */
function caller(options: GitHubRepoOptions) {
  const root = options.api ?? DEFAULT_API;
  return async function call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return await httpJson<T>(`${root}/repos/${options.repo}${path}`, {
      method,
      headers: {
        // A header, not a credential store: this exists for the length of the
        // request and nowhere else.
        authorization: `Bearer ${options.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      fetch: options.fetch,
    });
  };
}
