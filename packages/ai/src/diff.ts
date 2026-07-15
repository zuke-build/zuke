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

/** The file path of a `diff --git` section header, if it has one. */
function sectionPath(section: string): string | undefined {
  const match = section.match(/^diff --git a\/(\S+) b\//m);
  return match?.[1];
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
      if (path === undefined) return true; // preamble / non-file text
      if (include.length > 0 && !matchesAny(include, path)) return false;
      return !matchesAny(exclude, path);
    })
    .join("");
}

/** Truncate a diff to roughly `maxTokens` (≈4 chars/token), noting the cut. */
export function truncate(diff: string, maxTokens: number): string {
  const limit = maxTokens * 4;
  if (diff.length <= limit) return diff;
  return `${
    diff.slice(0, limit)
  }\n… (diff truncated to fit the token budget) …`;
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
