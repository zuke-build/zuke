// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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

import {
  assertRefName,
  caller,
  DEFAULT_BASE_URL,
  encodePath,
  env,
  GhApiError,
  readString,
} from "./api.ts";
import { resolveAuthToken, resolveRepoSlug } from "./credentials.ts";

export { assertRefName, GhApiError };

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
  /** Whether an existing {@link branch} is reset. Set by {@link replace}. */
  replace_ = false;
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

  /**
   * Reset {@link branch} onto {@link from} when it already exists, rather than
   * failing because it does.
   *
   * For a branch only one automated caller ever writes, and whose contents are
   * regenerated in full each time. Without this, a job that creates the branch
   * and then fails before opening its pull request can never retry: the second
   * run is refused because the ref it wants to create is already there, and the
   * work is stuck until someone deletes the branch by hand.
   *
   * Deliberately not the default. Discarding commits on a branch that already
   * exists is exactly what should not happen to a branch someone is working on,
   * so it stays something the caller asks for.
   */
  replace(): this {
    this.replace_ = true;
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
    return resolveRepoSlug(this.repo_, "committing");
  }

  /** The effective token, from the setting or the environment. */
  authToken_(): string {
    return resolveAuthToken(this.token_, "committing");
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
    return resolveRepoSlug(this.repo_, "tagging");
  }

  /** The effective token, from the setting or the environment. */
  authToken_(): string {
    return resolveAuthToken(this.token_, "tagging");
  }
}

/** The commit and tag operations {@link GhTasks} exposes. */
export interface GhCommitApi {
  /**
   * Commit files through the API, with no git credential on disk.
   *
   * Commits onto `.branch(...)`, or creates it from `.from(...)` when that is
   * set. The ref update is not forced, so a commit landing between reading the
   * head and writing it is rejected rather than silently overwritten — unless
   * `.replace()` is set, which resets an existing branch onto its base and
   * discards whatever was on it.
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
  if (settings.replace_ && settings.from_ === undefined) {
    // Silently ignoring it would be the worst of both: the caller asked for a
    // branch to be reset, the safe path runs instead, and nothing says so.
    throw new Error(
      ".replace() only applies together with .from(...): it resets an " +
        "existing .branch(...) onto the base it would be created from. " +
        "Committing onto a branch that already exists is what .branch(...) " +
        "does on its own.",
    );
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
  const head = await call("GET", `/git/ref/heads/${encodePath(source)}`);
  const parent = readString(head, ["object", "sha"], "ref");
  const parentCommit = await call("GET", `/git/commits/${parent}`);
  // Contents ride inline: the trees API accepts them, so there is no separate
  // blob to create and nothing orphaned if a later call fails.
  const tree = await call("POST", "/git/trees", {
    base_tree: readString(parentCommit, ["tree", "sha"], "commit"),
    tree: [...settings.files_].map(([path, content]) => ({
      path,
      mode: FILE_MODE,
      type: "blob",
      content,
    })),
  });
  const commit = await call("POST", "/git/commits", {
    message: settings.message_,
    tree: readString(tree, ["sha"], "tree"),
    parents: [parent],
  });
  const commitSha = readString(commit, ["sha"], "commit");

  if (settings.from_ === undefined) {
    await call("PATCH", `/git/refs/heads/${encodePath(branch)}`, {
      sha: commitSha,
    });
  } else {
    try {
      await call("POST", "/git/refs", {
        ref: `refs/heads/${branch}`,
        sha: commitSha,
      });
    } catch (error) {
      // 422 is what GitHub returns for a ref that is already there. Only that,
      // and only when the caller asked for it: a bare catch would turn a
      // permission failure into a force-update attempt and report whichever of
      // the two failed second.
      const exists = error instanceof GhApiError && error.status === 422;
      if (!exists || !settings.replace_) throw error;
      await call("PATCH", `/git/refs/heads/${encodePath(branch)}`, {
        sha: commitSha,
        force: true,
      });
    }
  }
  return { sha: commitSha, branch };
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
  const object = await call("POST", "/git/tags", {
    tag: name,
    message: settings.message_ ?? name,
    object: sha,
    type: "commit",
  });
  const tagObject = readString(object, ["sha"], "tag object");
  if (!settings.move_) {
    await call("POST", "/git/refs", {
      ref: `refs/tags/${name}`,
      sha: tagObject,
    });
    return;
  }
  try {
    await call("PATCH", `/git/refs/tags/${encodePath(name)}`, {
      sha: tagObject,
      force: true,
    });
  } catch (error) {
    // Only a missing ref means "create it instead" — the first release of a
    // major, where moving and creating are the same intent. Anything else is a
    // real failure: a bare catch here would swallow an expired token or a
    // missing permission and retry it as a create, reporting a confusing error
    // about the tag and hiding the one that mattered.
    const missing = error instanceof GhApiError &&
      (error.status === 404 || error.status === 422);
    if (!missing) throw error;
    await call("POST", "/git/refs", {
      ref: `refs/tags/${name}`,
      sha: tagObject,
    });
  }
}
