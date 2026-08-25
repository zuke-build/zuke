// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Glob helpers for build scripts: expand patterns like `src/**\/*.ts` to the
 * matching paths, dependency-free (built on `Deno.readDir`).
 *
 * ```ts
 * import { glob } from "jsr:@zuke/core";
 * const sources = await glob("src/**\/*.ts");
 * await DenoTasks.fmt((s) => s.check().paths(...sources));
 * ```
 *
 * Supported syntax: `*` (any run of non-`/`), `**` (any run including `/`),
 * `?` (a single non-`/`), and brace alternation `{a,b}`.
 *
 * @module
 */

import { isAbsolutePath } from "./internal.ts";

/** Escape a literal substring for use inside a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a glob pattern into an anchored {@link RegExp} that matches a full
 * path. Exposed (and pure) for testing and custom matching.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          re += "(?:.*/)?"; // `**/` — zero or more leading directories
          i++;
        } else {
          re += ".*"; // `**` — anything, including `/`
        }
      } else {
        re += "[^/]*"; // `*` — anything except `/`
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
      } else {
        const alts = pattern.slice(i + 1, end).split(",").map(escapeRegExp);
        re += `(?:${alts.join("|")})`;
        i = end;
      }
    } else {
      re += escapeRegExp(c);
    }
  }
  return new RegExp(`${re}$`);
}

/** The leading path of `pattern` with no glob characters (the walk root). */
function staticBase(pattern: string): string {
  const base: string[] = [];
  for (const segment of pattern.split("/")) {
    if (/[*?{}[\]]/.test(segment)) break;
    base.push(segment);
  }
  return base.join("/");
}

/** Options for {@link glob}. */
export interface GlobOptions {
  /**
   * Directory to resolve the pattern against (default: `Deno.cwd()`). Ignored
   * for an absolute pattern, which names its own root.
   */
  cwd?: string;
}

/**
 * Expand a glob pattern to the matching paths, sorted for determinism. The walk
 * starts at the pattern's static prefix, so anchor patterns (e.g.
 * `src/**\/*.ts`) to avoid scanning the whole tree. Symlinked directories are
 * not followed.
 *
 * A relative pattern is resolved against `cwd` and its matches are returned
 * relative to it. An **absolute** pattern (a leading `/`, or a `C:`-style drive)
 * names its own root: `cwd` plays no part and the matches come back absolute.
 */
export async function glob(
  pattern: string,
  options: GlobOptions = {},
): Promise<string[]> {
  const cwd = options.cwd ?? Deno.cwd();
  // An absolute pattern is already rooted. Joining it onto `cwd` would walk a
  // path that exists nowhere and return nothing at all — no files, no error.
  const absolute = isAbsolutePath(pattern);
  const re = globToRegExp(pattern);
  const results: string[] = [];

  const absOf = (rel: string) =>
    absolute ? rel : rel === "" ? cwd : `${cwd}/${rel}`;
  const walk = async (rel: string, isDirectory: boolean) => {
    if (rel !== "" && re.test(rel)) results.push(rel);
    if (!isDirectory) return;
    for await (const entry of Deno.readDir(absOf(rel))) {
      const childRel = rel === "" || rel === "/"
        ? `${rel}${entry.name}`
        : `${rel}/${entry.name}`;
      await walk(childRel, entry.isDirectory);
    }
  };

  // `staticBase` returns "" for a pattern that globs from its very first
  // segment; for an absolute one that root is the filesystem root, not the cwd.
  const staticPrefix = staticBase(pattern);
  const base = absolute && staticPrefix === "" ? "/" : staticPrefix;
  if (base === "") {
    await walk("", true);
  } else {
    try {
      const info = await Deno.stat(absOf(base));
      await walk(base, info.isDirectory);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      // A non-existent base simply matches nothing.
    }
  }
  return results.sort();
}
