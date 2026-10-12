// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Create or update one file in a repository through GitHub's contents API —
 * `PUT /repos/{owner}/{repo}/contents/{path}` — and do nothing at all when the
 * file already holds exactly the new content.
 *
 * ```ts
 * const result = await GhTasks.createOrUpdateFile((s) =>
 *   s.repo("acme/homebrew-tap").path("Formula/app.rb").content(ruby)
 *     .branch("main").message("app 1.2.3")
 * );
 * // result.state is "created", "updated" or "unchanged"
 * ```
 *
 * The no-op is the point. A release pipeline that publishes the same file on
 * every run — a Homebrew formula, a version manifest — must not mint an empty
 * commit each time, and must not fail because the file is already there. The
 * comparison is by git blob SHA: the contents API reports the current file's
 * blob SHA, and hashing the new content the way git does gives the same value
 * exactly when the bytes match. That works for a file of any size, where the
 * base64 body the API returns is omitted above 1 MB.
 *
 * {@link "./commit.ts".GhCommitApi.commit} is the other way to write files. It
 * takes several files at once and builds the tree itself, but it always
 * commits; this is the one-file, look-before-writing form.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import {
  assertRefName,
  caller,
  DEFAULT_BASE_URL,
  encodePath,
  GhApiError,
  type GhCall,
  isRecord,
  readString,
} from "./api.ts";
import { base64 } from "./base64.ts";
import { resolveAuthToken, resolveRepoSlug } from "./credentials.ts";

/** The operation's name, as its error messages open with it. */
const OPERATION = "writing a file through the contents API";

/** What became of a {@link GhContentsApi.createOrUpdateFile} call. */
export interface GhContentsResult {
  /**
   * `created` when the file did not exist, `updated` when it held other
   * content, `unchanged` when it already held exactly this content and nothing
   * was written.
   */
  state: "created" | "updated" | "unchanged";
  /** The repository-relative path that was written (or left alone). */
  path: string;
  /** The commit that wrote the file; absent when the state is `unchanged`. */
  commitSha?: string;
  /** The file's git blob SHA after the call. */
  blobSha: string;
}

/**
 * Settings for creating or updating one file.
 *
 * `owner/repo` and the token fall back to the Actions environment, so a job
 * that already has them names only the file.
 */
export class GhContentsSettings {
  /** The repository-relative file path. Set by {@link path}. */
  path_?: string;
  /** The new file content. Set by {@link content}. */
  content_?: string;
  /** The commit message. Set by {@link message}. */
  message_?: string;
  /** The branch to write on. Set by {@link branch}. */
  branch_?: string;
  /** `owner/repo`. Set by {@link repo}. */
  repo_?: string;
  /** The token. Set by {@link token}. */
  token_?: string;
  /** The API root. Set by {@link baseUrl}. */
  baseUrl_: string = DEFAULT_BASE_URL;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;

  /**
   * The file's path inside the repository, e.g. `Formula/app.rb` (required).
   * Relative, `/`-separated, with no `.` or `..` segment.
   */
  path(value: string): this {
    this.path_ = value;
    return this;
  }

  /** The file's new content, as text (required). Written as UTF-8. */
  content(text: string): this {
    this.content_ = text;
    return this;
  }

  /** The commit message (required). */
  message(text: string): this {
    this.message_ = text;
    return this;
  }

  /** The branch to write on. Defaults to the repository's default branch. */
  branch(name: string): this {
    this.branch_ = name;
    return this;
  }

  /** `owner/repo`. Defaults to `GITHUB_REPOSITORY`. */
  repo(slug: string): this {
    this.repo_ = slug;
    return this;
  }

  /**
   * The token to authenticate with — needs `contents: write` on the
   * repository. Defaults to `GITHUB_TOKEN`.
   */
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
    return resolveRepoSlug(this.repo_, OPERATION);
  }

  /** The effective token, from the setting or the environment. */
  authToken_(): string {
    return resolveAuthToken(this.token_, OPERATION, " with contents: write.");
  }
}

/** The create-or-update-file operation {@link GhTasks} exposes. */
export interface GhContentsApi {
  /**
   * Write one file through the contents API, creating it or replacing its
   * content — or, when it already holds exactly this content, writing nothing
   * and reporting `unchanged`.
   *
   * A write that loses a race (the file changed between the read and the
   * write) is read once more: if the file now holds this content the result is
   * `unchanged`, otherwise the conflict is raised rather than overwritten.
   */
  createOrUpdateFile(
    configure?: Configure<GhContentsSettings>,
  ): Promise<GhContentsResult>;
}

/**
 * Reject a file path that could leave the contents endpoint.
 *
 * The path is interpolated into the request path, and URL normalisation would
 * resolve a `..` segment before the request is sent — the same redirect
 * {@link assertRefName} guards against for refs. Segments are percent-encoded
 * as well, so `%2e%2e` cannot be decoded back into one.
 */
function assertFilePath(path: string): void {
  const segments = path.split("/");
  const bad = segments.some((segment) =>
    segment === "" || segment === "." || segment === ".." ||
    [...segment].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f || character === "\\";
    })
  );
  if (bad) {
    throw new Error(
      `refusing to write ${JSON.stringify(path)}: a contents path must be ` +
        `relative and "/"-separated, with no empty, "." or ".." segment and ` +
        `no backslash or control character.`,
    );
  }
}

/** The git blob SHA of `text` as UTF-8 — what git and GitHub call the file. */
async function blobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header);
  bytes.set(body, header.length);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The current file's blob SHA, or `undefined` when there is no file.
 *
 * Anything else at the path — a directory listing (an array), a symlink or a
 * submodule — is refused: replacing it is not what "update a file" means.
 */
async function currentSha(
  call: GhCall,
  endpoint: string,
  query: string,
): Promise<string | undefined> {
  let current: unknown;
  try {
    current = await call("GET", `${endpoint}${query}`);
  } catch (error) {
    if (error instanceof GhApiError && error.status === 404) return undefined;
    throw error;
  }
  if (!isRecord(current) || Array.isArray(current) || current.type !== "file") {
    throw new Error(
      `${OPERATION}: ${endpoint} is not a regular file in the repository, ` +
        `so it is left alone.`,
    );
  }
  return readString(current, ["sha"], "contents lookup");
}

/** Whether a failed write lost a race with another writer. */
function isConflict(error: unknown): boolean {
  // 409: the sha sent is no longer the file's. 422: a create raced another
  // create, so the file now exists and GitHub wanted its sha.
  return error instanceof GhApiError &&
    (error.status === 409 || error.status === 422);
}

/** Perform the configured create-or-update. */
export async function createOrUpdateFile(
  configure?: Configure<GhContentsSettings>,
): Promise<GhContentsResult> {
  const settings = configure?.(new GhContentsSettings()) ??
    new GhContentsSettings();
  const { path_: path, content_: content, message_: message } = settings;
  if (path === undefined) throw new Error(`${OPERATION} requires .path(...).`);
  if (content === undefined) {
    throw new Error(`${OPERATION} requires .content(...).`);
  }
  if (message === undefined) {
    throw new Error(`${OPERATION} requires .message(...).`);
  }
  assertFilePath(path);
  const branch = settings.branch_;
  if (branch !== undefined) assertRefName(branch, "branch");
  const call = caller(
    settings.baseUrl_,
    settings.repoSlug_(),
    settings.authToken_(),
    settings.fetch_,
  );
  const endpoint = `/contents/${encodePath(path)}`;
  const query = branch === undefined
    ? ""
    : `?ref=${encodeURIComponent(branch)}`;
  const wanted = await blobSha(content);

  const existing = await currentSha(call, endpoint, query);
  if (existing === wanted) {
    return { state: "unchanged", path, blobSha: wanted };
  }
  try {
    const written = await call("PUT", endpoint, {
      message,
      content: base64(new TextEncoder().encode(content)),
      ...(existing === undefined ? {} : { sha: existing }),
      ...(branch === undefined ? {} : { branch }),
    });
    return {
      state: existing === undefined ? "created" : "updated",
      path,
      commitSha: readString(written, ["commit", "sha"], "contents write"),
      blobSha: readString(written, ["content", "sha"], "contents write"),
    };
  } catch (error) {
    if (!isConflict(error)) throw error;
    // Another writer got there between the read and the write. Read once more
    // only to tell "it wrote the same thing" — an `unchanged` result — from a
    // real conflict. Never write again: the file now holds someone else's
    // content, and replacing it is exactly what the sha check exists to stop.
    if (await currentSha(call, endpoint, query) === wanted) {
      return { state: "unchanged", path, blobSha: wanted };
    }
    throw error;
  }
}
