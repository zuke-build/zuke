/**
 * Open a pull request carrying a set of files, without ever holding a git
 * credential.
 *
 * The obvious way to do this is `actions/checkout` with `persist-credentials`,
 * a local commit, and `git push`. That writes the token into `.git/config`,
 * where it outlives the step that needed it: every later step in the job can
 * read it, and anything that archives the workspace carries it out.
 *
 * The commit is built server-side instead. Git's data API takes file contents
 * directly in a tree, so a branch can be created from nothing but HTTP calls —
 * the token stays in the environment of the one step that uses it, and no file
 * on disk ever contains it.
 *
 * Note what this does *not* claim. The token is still readable by code running
 * in that step, because the step is what uses it; no arrangement short of not
 * having a token avoids that. What it removes is the credential's persistence
 * beyond its use.
 *
 * @module
 */

/** A file to include in the proposed commit. */
export interface ProposedFile {
  /** Repository-relative path, e.g. `build/action_version.json`. */
  path: string;
  /** The file's full contents. */
  content: string;
}

/** What {@link createTag} and {@link moveTag} need. */
export interface RefOptions {
  /** `owner/name`. */
  repo: string;
  /** A token with `contents: write`. */
  token: string;
  /** Injected for tests; defaults to the global. */
  fetch?: typeof fetch;
}

/** What {@link proposeChange} needs to talk to GitHub. */
export interface ProposeOptions extends RefOptions {
  /** The branch to base the change on, and target the pull request at. */
  base: string;
  /** The branch to create. */
  branch: string;
  /** Commit and pull-request subject. */
  subject: string;
  /** Pull-request body. */
  body: string;
  /** The files to write. */
  files: readonly ProposedFile[];
}

/** The pull request {@link proposeChange} opened. */
export interface ProposedPullRequest {
  /** Its number. */
  number: number;
  /** Its web URL. */
  url: string;
}

/** The GitHub REST root. */
const API = "https://api.github.com";

/** Blob mode for a non-executable file, as git's tree API spells it. */
const FILE_MODE = "100644";

/**
 * Create `branch` from `base` with `files` applied, and open a pull request.
 *
 * @throws if any call fails, with the status and GitHub's own message — a
 * half-created branch is far easier to reason about than a silent no-op.
 */
export async function proposeChange(
  options: ProposeOptions,
): Promise<ProposedPullRequest> {
  const call = apiCaller(options);

  // The commit the branch will sit on, and the tree it starts from.
  const baseRef = await call("GET", `/git/ref/heads/${options.base}`);
  const baseSha = stringField(baseRef, ["object", "sha"], "base ref");
  const baseCommit = await call("GET", `/git/commits/${baseSha}`);
  const baseTree = stringField(baseCommit, ["tree", "sha"], "base commit");

  // Contents go inline: the trees API accepts them, so there is no separate
  // blob to create and nothing to clean up if a later call fails.
  const tree = await call("POST", "/git/trees", {
    base_tree: baseTree,
    tree: options.files.map((file) => ({
      path: file.path,
      mode: FILE_MODE,
      type: "blob",
      content: file.content,
    })),
  });
  const treeSha = stringField(tree, ["sha"], "tree");

  const commit = await call("POST", "/git/commits", {
    message: options.subject,
    tree: treeSha,
    parents: [baseSha],
  });
  const commitSha = stringField(commit, ["sha"], "commit");

  await call("POST", "/git/refs", {
    ref: `refs/heads/${options.branch}`,
    sha: commitSha,
  });

  const pull = await call("POST", "/pulls", {
    title: options.subject,
    body: options.body,
    head: options.branch,
    base: options.base,
  });
  return {
    number: numberField(pull, "number"),
    url: stringField(pull, ["html_url"], "pull request"),
  };
}

/** A bound caller for one repository, so each call site names only its path. */
function apiCaller(options: RefOptions) {
  const doFetch = options.fetch ?? fetch;
  return async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await doFetch(`${API}/repos/${options.repo}${path}`, {
      method,
      headers: {
        // Bearer, not the credential store: this header exists for the length
        // of the request and nowhere else.
        authorization: `Bearer ${options.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      // GitHub's own message is the useful half; the status alone rarely says
      // which permission or which field was the problem.
      throw new Error(
        `${method} ${path} failed: ${response.status} ${response.statusText}. ` +
          `${text.slice(0, 400)}`,
      );
    }
    return text === "" ? {} : JSON.parse(text);
  };
}

/** Read a nested string from a response, or say which call returned junk. */
function stringField(value: unknown, path: string[], what: string): string {
  let cursor: unknown = value;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null) {
      throw new Error(`the ${what} response has no ${path.join(".")}`);
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (typeof cursor !== "string") {
    throw new Error(`the ${what} response has no ${path.join(".")}`);
  }
  return cursor;
}

/** Read a number from a response, or say which call returned junk. */
function numberField(value: unknown, key: string): number {
  if (typeof value !== "object" || value === null) {
    throw new Error(`the pull request response is not an object`);
  }
  const field = (value as Record<string, unknown>)[key];
  if (typeof field !== "number") {
    throw new Error(`the pull request response has no ${key}`);
  }
  return field;
}

/**
 * Create an annotated tag at `sha`.
 *
 * Two calls, as git itself does it: the tag object carries the message, and the
 * ref points at it. A lightweight ref would resolve identically for `uses:`,
 * but the tags this repository already published are annotated and a reader
 * comparing them should not find one that is not.
 */
export async function createTag(
  options: RefOptions,
  tag: string,
  sha: string,
  message: string,
): Promise<void> {
  const call = apiCaller(options);
  const object = await call("POST", "/git/tags", {
    tag,
    message,
    object: sha,
    type: "commit",
  });
  await call("POST", "/git/refs", {
    ref: `refs/tags/${tag}`,
    sha: stringField(object, ["sha"], "tag object"),
  });
}

/**
 * Point an existing tag ref at `sha`, creating it if it is not there yet.
 *
 * `force` on the update, because moving `v1` onto a newer release is the whole
 * point of it and git calls that a non-fast-forward.
 */
export async function moveTag(
  options: RefOptions,
  tag: string,
  sha: string,
  message: string,
): Promise<void> {
  const call = apiCaller(options);
  const object = await call("POST", "/git/tags", {
    tag,
    message,
    object: sha,
    type: "commit",
  });
  const objectSha = stringField(object, ["sha"], "tag object");
  try {
    await call("PATCH", `/git/refs/tags/${tag}`, {
      sha: objectSha,
      force: true,
    });
  } catch {
    // Not there yet — the first release of a major.
    await call("POST", "/git/refs", {
      ref: `refs/tags/${tag}`,
      sha: objectSha,
    });
  }
}
