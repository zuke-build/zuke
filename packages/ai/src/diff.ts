/**
 * Sourcing and filtering the unified diff a reviewer assesses.
 *
 * @module
 */

import { globToRegExp } from "@zuke/core";

/** Diff sections matching these globs are dropped from review by default. */
export const DEFAULT_EXCLUDES = ["**/*.lock"];

/** Whether `path` matches any of the glob `patterns` (reusing core's matcher). */
function matchesAny(patterns: string[], path: string): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}

/** Whether a section is a file diff (has a `diff --git` header) at all. */
function isFileSection(section: string): boolean {
  return /^diff --git /m.test(section);
}

/**
 * The file path of a diff section. Read from the unambiguous `+++ b/<path>`
 * line (everything to end-of-line or a trailing tab), so a path containing
 * spaces parses correctly — the space-separated `diff --git a/… b/…` header is
 * ambiguous for such paths. Falls back to that header (tolerant of spaces via a
 * greedy match) for a section with no `+++` line (a pure rename/mode change).
 */
function sectionPath(section: string): string | undefined {
  const plus = section.match(/^\+\+\+ b\/(.*)$/m);
  if (plus) return plus[1].replace(/\t.*$/, "");
  // caveat: this greedy fallback only fires for a section with no `+++` line
  // (a pure rename/mode change, which carries no content), and mis-splits a path
  // that itself contains ` b/` — a genuinely ambiguous git header. Acceptable:
  // no reviewable body is at stake. Reach for `git diff -z` if it ever matters.
  const git = section.match(/^diff --git a\/(.+) b\//m);
  return git?.[1];
}

/** Drop diff sections whose file is excluded (or not included). */
export function filterDiff(
  diff: string,
  include: string[],
  exclude: string[],
): string {
  const sections = diff.split(/(?=^diff --git )/m);
  return sections
    .filter((section) => {
      const path = sectionPath(section);
      if (path === undefined) {
        // Non-file preamble is kept. A file section whose path we could not
        // parse is dropped when any filter is active — fail safe: we cannot
        // confirm it is included, nor that it is not excluded, so we do not
        // review it rather than leak a possibly-excluded file.
        if (!isFileSection(section)) return true;
        return include.length === 0 && exclude.length === 0;
      }
      if (include.length > 0 && !matchesAny(include, path)) return false;
      return !matchesAny(exclude, path);
    })
    .join("");
}

/**
 * The distinct file paths a (filtered) diff touches, in diff order — the
 * post-image paths, so a deleted file (whose `+++` line is `/dev/null`) is
 * omitted. Used to pull full-file context for the reviewer.
 */
export function changedPaths(diff: string): string[] {
  const paths: string[] = [];
  for (const section of diff.split(/(?=^diff --git )/m)) {
    if (!isFileSection(section)) continue;
    if (/^\+\+\+ \/dev\/null$/m.test(section)) continue;
    const path = sectionPath(section);
    if (path !== undefined && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

/** A hunk header, capturing the post-image start line (`@@ -a,b +c,d @@`). */
const HUNK_RIGHT = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * The right-side (post-image) line numbers a unified diff exposes, per file:
 * every added and context line inside a hunk. These are exactly the lines a
 * pull-request review comment may anchor to on the `RIGHT` side — a removed
 * line exists only on the left, and a line outside every hunk is not part of
 * the diff at all, so anchoring to either is rejected by the host.
 *
 * Computed from the same filtered, truncated diff the model was shown, which
 * makes the result an allowlist rather than a hint: a finding naming a path
 * `.exclude(...)` removed, an absolute path, a traversal, or a file the diff
 * never touched simply finds nothing here.
 */
export function anchorableLines(diff: string): Map<string, Set<number>> {
  const anchors = new Map<string, Set<number>>();
  let path: string | undefined;
  let inHunk = false;
  let right = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      path = undefined;
      inHunk = false;
      continue;
    }
    // The `+++ b/` header only appears before a hunk; the `!inHunk` guard stops
    // an added line that happens to begin `++ b/` from being read as one.
    if (!inHunk && line.startsWith("+++ ")) {
      const target = line.slice("+++ ".length).trim();
      path = target.startsWith("b/")
        ? target.slice(2).replace(/\t.*$/, "")
        : undefined; // `/dev/null` — a deleted file anchors nothing
      continue;
    }
    const hunk = line.match(HUNK_RIGHT);
    if (hunk) {
      right = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || path === undefined) continue;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("-")) continue; // left side only; does not advance
    // An added line, a context line, or the bare empty line git emits for a
    // blank context line — all exist on the right at `right`.
    let lines = anchors.get(path);
    if (lines === undefined) {
      lines = new Set<number>();
      anchors.set(path, lines);
    }
    lines.add(right);
    right++;
  }
  return anchors;
}

/**
 * Truncate text to roughly `maxTokens` (≈4 chars/token), noting the cut.
 * `what` names the text in the truncation note (default `"diff"`).
 */
export function truncate(
  diff: string,
  maxTokens: number,
  what = "diff",
): string {
  const limit = maxTokens * 4;
  if (diff.length <= limit) return diff;
  return `${
    diff.slice(0, limit)
  }\n… (${what} truncated to fit the token budget) …`;
}

/**
 * The base-branch fetch a {@link DiffSettings.fetchBase} requested — the remote
 * to fetch from and the branch (auto-detected from CI when unset).
 */
export interface DiffFetch {
  /** The branch to fetch, or `undefined` to auto-detect it from the CI env. */
  readonly branch?: string;
  /** The remote to fetch from (default `"origin"`). */
  readonly remote: string;
}

/** Fluent diff source configuration passed to {@link "./reviewer.ts".Reviewer.diff}. */
export class DiffSettings {
  #base?: string;
  #staged = false;
  #text?: string;
  #fetchRequested = false;
  #fetchRemote = "origin";
  #fetchBranch?: string;

  /** Review the diff against `ref` (e.g. `"origin/main"`). */
  base(ref: string): this {
    this.#base = ref;
    return this;
  }

  /** Review the staged changes (`git diff --cached`). */
  staged(): this {
    this.#staged = true;
    return this;
  }

  /** Review a diff supplied directly, bypassing `git` (useful in tests). */
  text(diff: string): this {
    this.#text = diff;
    return this;
  }

  /**
   * Fetch the base branch (a shallow, tag-less `git fetch`) before diffing, and
   * diff against it — so CI needs no manual `git fetch` step. With no `branch`,
   * the base is auto-detected from the CI environment (GitHub's `GITHUB_BASE_REF`
   * — the pull request's base branch). Honoured by the {@link
   * "./fixer.ts".AiFixer}; if the fetch fails it falls back to the working-tree
   * diff.
   */
  fetchBase(branch?: string, remote = "origin"): this {
    this.#fetchRequested = true;
    this.#fetchBranch = branch;
    this.#fetchRemote = remote;
    return this;
  }

  /** The literal diff text supplied via {@link DiffSettings.text}, if any. */
  text_(): string | undefined {
    return this.#text;
  }

  /** The base ref supplied via {@link DiffSettings.base}, if any. */
  base_(): string | undefined {
    return this.#base;
  }

  /**
   * The base-branch fetch requested via {@link DiffSettings.fetchBase}, or
   * `undefined` when none was requested.
   */
  fetch_(): DiffFetch | undefined {
    return this.#fetchRequested
      ? { branch: this.#fetchBranch, remote: this.#fetchRemote }
      : undefined;
  }

  /** The `git` argv this diff source resolves to. */
  argv_(): string[] {
    const argv = ["git", "diff"];
    if (this.#staged) argv.push("--cached");
    if (this.#base !== undefined) argv.push(this.#base);
    return argv;
  }
}

/**
 * Whether a value is safe to pass as a positional `git` argument: non-empty and
 * not option-like (a leading `-` could be misread as a flag — e.g. an injected
 * `--upload-pack=...` — so such values are rejected rather than fetched).
 */
function safeGitArg(value: string): boolean {
  return value !== "" && !value.startsWith("-");
}

/**
 * Honour a {@link DiffSettings.fetchBase} request: fetch the base branch
 * ourselves (a shallow, tag-less `git fetch`, auto-detecting the branch from
 * `GITHUB_BASE_REF` when unset) and return the diff against `FETCH_HEAD`, so a
 * CI job needs no manual `git fetch` step. Returns `undefined` — leaving the
 * caller to fall back to its normal diff source — when no fetch was requested,
 * the branch can't be determined, a `remote`/`branch` argument is unsafe, or the
 * fetch/diff fails (offline, not a PR, ref unavailable). Shared by the reviewer
 * and the {@link "./fixer.ts".AiFixer} so both resolve `fetchBase` identically.
 */
export async function fetchBaseDiff(
  diff: DiffSettings,
  run: (argv: string[]) => Promise<string>,
  env: (name: string) => string | undefined,
): Promise<string | undefined> {
  const fetch = diff.fetch_();
  if (fetch === undefined) return undefined;
  const branch = fetch.branch ?? env("GITHUB_BASE_REF");
  const remote = fetch.remote;
  if (branch === undefined || !safeGitArg(branch) || !safeGitArg(remote)) {
    return undefined;
  }
  try {
    await run(["git", "fetch", "--no-tags", "--depth=1", remote, branch]);
    return await run(["git", "diff", "FETCH_HEAD"]);
  } catch {
    return undefined; // offline, not a PR, or the ref is unavailable
  }
}
