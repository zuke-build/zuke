/**
 * Applying a {@link "./fix.ts".Fix}'s edits to the working tree, behind safety
 * guards: a path allowlist, a set of always-excluded paths, and a cap on the
 * number of files touched. Edits are validated as a set first — if any single
 * edit is disallowed, nothing is written (no partial application).
 *
 * @module
 */

import { globToRegExp } from "@zuke/core";
import type { FileEdit } from "./fix.ts";
import { AiReviewError } from "./errors.ts";

/**
 * Paths a fix may never write, regardless of the allowlist: lockfiles, the git
 * directory, CI workflow definitions, key material, and env files.
 */
export const DEFAULT_FIX_EXCLUDES: string[] = [
  "**/*.lock",
  ".git/**",
  "**/.git/**", // a nested .git (e.g. a vendored checkout), not just the root
  "**/.github/workflows/**",
  "**/*.pem",
  "**/.env",
  "**/.env.*",
];

/** The guards governing which edits may be written, and how many. */
export interface ApplyGuards {
  /** Allowlist globs an edit's path must match (default: everything). */
  allow: string[];
  /** Extra globs to exclude, on top of {@link DEFAULT_FIX_EXCLUDES}. */
  exclude: string[];
  /** Maximum number of files a single fix may touch. */
  maxEdits: number;
}

/**
 * Whether `path` matches any of the glob `patterns`. With `ci`, both sides are
 * lowercased. Excludes match case-insensitively (`ci: true`) because macOS and
 * Windows filesystems are case-insensitive, so a case-sensitive guard would let
 * `.Env` or `.GitHub/workflows/ci.yml` slip past an exclude for `.env` /
 * `.github/...`. The allowlist matches case-sensitively (`ci: false`): a
 * case-insensitive allow would *widen* it on a case-sensitive filesystem —
 * `SRC/x` would pass an `allow: ["src/**"]` yet be written to a sibling `SRC/`
 * directory the user never allowlisted.
 */
function matchesAny(patterns: string[], path: string, ci: boolean): boolean {
  const target = ci ? path.toLowerCase() : path;
  return patterns.some((p) =>
    globToRegExp(ci ? p.toLowerCase() : p).test(target)
  );
}

/**
 * Canonicalise an edit path to a clean, repo-relative form, or reject it.
 * Back-slashes are unified to `/` first (so Windows `..\..\` / `C:\` / UNC paths
 * can't bypass the guards), then `.`/`..` segments are fully resolved: an
 * absolute path, a Windows drive, or any `..` that escapes the repo root is
 * rejected outright rather than written.
 *
 * A path whose first segment begins with `:` is rejected too: git reserves a
 * leading `:` for pathspec *magic* (`:(glob)`, `:/`, `:(exclude)`, …), which
 * `git add -- <path>` does **not** disable, so a magic path would later stage
 * the whole tree rather than the one file (see {@link "./commit.ts".commitAndPush}).
 * No trackable repo-relative path starts with `:`, so this can only be an attempt
 * to smuggle a pathspec through the fixer's write/commit seam.
 */
function normalizePath(path: string): string {
  const unified = path.replaceAll("\\", "/");
  if (
    unified === "" ||
    unified.startsWith("/") || // POSIX-absolute, or a `\\…` UNC path
    /^[A-Za-z]:/.test(unified) // a Windows drive (e.g. `C:\…`)
  ) {
    throw new AiReviewError(`refusing to write outside the repo: ${path}`);
  }
  const segments: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // A `..` with nothing to pop would resolve above the repo root.
      if (segments.length === 0) {
        throw new AiReviewError(`refusing to write outside the repo: ${path}`);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    throw new AiReviewError(`refusing to write outside the repo: ${path}`);
  }
  if (segments[0].startsWith(":")) {
    throw new AiReviewError(`refusing a git pathspec-magic path: ${path}`);
  }
  return segments.join("/");
}

/**
 * Validate the full edit set against the guards, throwing an
 * {@link AiReviewError} naming the first violation. Returns the normalised
 * paths in order when every edit is allowed.
 */
export function checkEdits(edits: FileEdit[], guards: ApplyGuards): string[] {
  if (edits.length > guards.maxEdits) {
    throw new AiReviewError(
      `fix touches ${edits.length} files, over the limit of ${guards.maxEdits}`,
    );
  }
  const excludes = [...DEFAULT_FIX_EXCLUDES, ...guards.exclude];
  const allow = guards.allow.length > 0 ? guards.allow : ["**"];
  return edits.map((edit) => {
    const path = normalizePath(edit.path);
    if (matchesAny(excludes, path, true)) { // case-insensitive: catch case tricks
      throw new AiReviewError(`refusing to write an excluded path: ${path}`);
    }
    if (!matchesAny(allow, path, false)) { // case-sensitive: never widen the allow
      throw new AiReviewError(`path is outside the allowlist: ${path}`);
    }
    return path;
  });
}

/**
 * Default write: create the file's parent directory (if any) then write it, so
 * a fix that adds a file in a new directory doesn't fail with a missing-parent
 * error. Paths are already normalised to `/`-separated, repo-relative form by
 * {@link normalizePath}, so splitting on the last `/` yields the parent.
 */
async function writeEnsuringDir(path: string, content: string): Promise<void> {
  const slash = path.lastIndexOf("/");
  if (slash > 0) await Deno.mkdir(path.slice(0, slash), { recursive: true });
  await Deno.writeTextFile(path, content);
}

/**
 * Validate and apply the edits, writing each file's full new contents. Returns
 * the list of written paths. Throws (writing nothing) when any edit violates a
 * guard. The default write creates missing parent directories; the `write` seam
 * is overridable for tests.
 */
export async function applyEdits(
  edits: FileEdit[],
  guards: ApplyGuards,
  write: (path: string, content: string) => Promise<void> = writeEnsuringDir,
): Promise<string[]> {
  const paths = checkEdits(edits, guards);
  // Writes are sequential and not transactional: if a later write fails (e.g. a
  // permission error), files written earlier stay written. caveat: no rollback
  // — the fixer's output is human-reviewed and the run is re-runnable, so atomic
  // multi-file application (temp + rename) isn't worth the complexity here.
  for (let i = 0; i < edits.length; i++) {
    await write(paths[i], edits[i].content);
  }
  return paths;
}
