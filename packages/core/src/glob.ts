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
  /** Directory to resolve the pattern against (default: `Deno.cwd()`). */
  cwd?: string;
}

/**
 * Expand a glob pattern to the matching paths, relative to `cwd`, sorted for
 * determinism. The walk starts at the pattern's static prefix, so anchor
 * patterns (e.g. `src/**\/*.ts`) to avoid scanning the whole tree. Symlinked
 * directories are not followed.
 */
export async function glob(
  pattern: string,
  options: GlobOptions = {},
): Promise<string[]> {
  const cwd = options.cwd ?? Deno.cwd();
  const re = globToRegExp(pattern);
  const results: string[] = [];

  const absOf = (rel: string) => rel === "" ? cwd : `${cwd}/${rel}`;
  const walk = async (rel: string, isDirectory: boolean) => {
    if (rel !== "" && re.test(rel)) results.push(rel);
    if (!isDirectory) return;
    for await (const entry of Deno.readDir(absOf(rel))) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      await walk(childRel, entry.isDirectory);
    }
  };

  const base = staticBase(pattern);
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
