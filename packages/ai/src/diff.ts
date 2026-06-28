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

/** Fluent diff source configuration passed to {@link "./reviewer.ts".Reviewer.diff}. */
export class DiffSettings {
  base_?: string;
  staged_ = false;
  text_?: string;
  fetchRequested_ = false;
  fetchRemote_ = "origin";
  fetchBranch_?: string;

  /** Review the diff against `ref` (e.g. `"origin/main"`). */
  base(ref: string): this {
    this.base_ = ref;
    return this;
  }

  /** Review the staged changes (`git diff --cached`). */
  staged(): this {
    this.staged_ = true;
    return this;
  }

  /** Review a diff supplied directly, bypassing `git` (useful in tests). */
  text(diff: string): this {
    this.text_ = diff;
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
    this.fetchRequested_ = true;
    this.fetchBranch_ = branch;
    this.fetchRemote_ = remote;
    return this;
  }

  /** The `git` argv this diff source resolves to. */
  argv_(): string[] {
    const argv = ["git", "diff"];
    if (this.staged_) argv.push("--cached");
    if (this.base_ !== undefined) argv.push(this.base_);
    return argv;
  }
}
