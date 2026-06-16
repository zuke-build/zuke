/**
 * The Zuke project config file and repository-root resolution.
 *
 * `zuke setup` writes a {@link CONFIG_FILE} (`zuke.json`) at the repository
 * root. Its *location* — not any value inside it — marks the root: {@link
 * repoRoot} walks up from the current directory to find it and returns the
 * containing directory as an {@link AbsolutePath}, resolved at runtime. Nothing
 * machine-specific is ever committed.
 *
 * ```ts
 * import { repoRoot } from "jsr:@zuke/core";
 * const main = repoRoot("src", "main.ts"); // <root>/src/main.ts
 * ```
 *
 * @module
 */

import { type AbsolutePath, absolutePath } from "./path.ts";

/** The Zuke config file name; its presence marks a repository root. */
export const CONFIG_FILE = "zuke.json";

/**
 * Whether a filesystem entry exists. A `NotFound` error maps to `false`; any
 * other error (e.g. a permission failure) is rethrown rather than masked.
 */
export function pathExists(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/**
 * Walk up from `start`, returning the first directory that contains
 * {@link CONFIG_FILE}, or `null` if none is found before the filesystem root.
 *
 * @param start An absolute directory to begin the search from.
 * @param exists Existence probe (injectable for testing).
 */
export function findConfigDir(
  start: string,
  exists: (path: string) => boolean = pathExists,
): string | null {
  let dir = absolutePath(start);
  while (true) {
    if (exists(dir(CONFIG_FILE).path)) return dir.path;
    if (dir.isRoot) return null;
    dir = dir.parent();
  }
}

/**
 * Resolve the repository root from an explicit cwd and existence probe, then
 * append `segments`. Pure given its inputs; {@link repoRoot} wires in the real
 * `Deno.cwd()` and filesystem probe.
 *
 * @throws if no {@link CONFIG_FILE} is found in `cwd` or any ancestor.
 */
export function repoRootFrom(
  cwd: string,
  exists: (path: string) => boolean,
  segments: string[],
): AbsolutePath {
  const dir = findConfigDir(cwd, exists);
  if (dir === null) {
    throw new Error(
      `zuke: could not find ${CONFIG_FILE} in the current directory or any ` +
        `parent. Run \`zuke setup\` to create one at your repository root.`,
    );
  }
  const root = absolutePath(dir);
  return segments.length > 0 ? root(...segments) : root;
}

/**
 * The absolute path of the repository root — the directory containing
 * {@link CONFIG_FILE} — with any `segments` appended. The returned value is an
 * {@link AbsolutePath}, so it is itself callable for further joining.
 *
 * ```ts
 * repoRoot();                  // <root>
 * repoRoot("src", "main.ts");  // <root>/src/main.ts
 * repoRoot().join("dist");     // <root>/dist
 * ```
 *
 * The root is located by walking up from the current working directory, so the
 * path is resolved at runtime and never hard-coded into a committed file.
 *
 * @throws if no {@link CONFIG_FILE} is found in the cwd or any ancestor.
 */
export function repoRoot(...segments: string[]): AbsolutePath {
  return repoRootFrom(Deno.cwd(), pathExists, segments);
}
