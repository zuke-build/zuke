/**
 * Ergonomic, immutable file paths for build scripts.
 *
 * TypeScript has no operator overloading, so Zuke cannot mimic NUKE's
 * `RootDirectory / "src" / "Project.csproj"` literally. {@link absolutePath}
 * gets as close as the language allows: the returned {@link AbsolutePath} is
 * **callable**, so appending segments reads almost like the original — and a
 * `.join(...)` method does the same thing explicitly.
 *
 * ```ts
 * import { absolutePath } from "jsr:@zuke/core";
 *
 * const root = absolutePath("/app");
 * const main = root("src", "main.ts");      // /app/src/main.ts  (callable)
 * const test = root.join("tests", "x.ts");  // /app/tests/x.ts   (explicit)
 *
 * main.name;        // "main.ts"
 * main.stem;        // "main"
 * main.extension;   // ".ts"
 * main.parent();    // AbsolutePath -> /app/src
 * main.relativeTo(root); // "src/main.ts"
 * `${main}`;        // "/app/src/main.ts" (toString — drops into $`` and args())
 * ```
 *
 * Paths are normalised to forward slashes with `.`/`..` segments resolved; a
 * Windows drive prefix (`C:/…`) is preserved. Instances are immutable: every
 * operation returns a new {@link AbsolutePath}.
 *
 * @module
 */

/** The separated form of a path: its root (`""` if relative) and clean parts. */
interface PathParts {
  /** `"/"`, a drive root like `"C:/"`, or `""` for a relative path. */
  root: string;
  /** Path segments with `.`/empty removed and `..` resolved where possible. */
  parts: string[];
}

/** Split a path string into its root and normalised segments. */
function toParts(input: string): PathParts {
  const slashed = input.replace(/\\/g, "/");
  let root = "";
  let rest = slashed;
  if (slashed.startsWith("/")) {
    root = "/";
    rest = slashed.slice(1);
  } else {
    const drive = /^([A-Za-z]:)\/?/.exec(slashed);
    if (drive !== null) {
      root = `${drive[1]}/`;
      rest = slashed.slice(drive[0].length);
    }
  }
  const parts: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      const top = parts[parts.length - 1];
      if (parts.length > 0 && top !== "..") parts.pop();
      else if (root === "") parts.push("..");
      // An absolute path can't climb above its root: drop the "..".
    } else {
      parts.push(segment);
    }
  }
  return { root, parts };
}

/** Re-render separated parts back into a path string. */
function render({ root, parts }: PathParts): string {
  if (root !== "") return root + parts.join("/");
  return parts.length > 0 ? parts.join("/") : ".";
}

/** Normalise any path string (relative or absolute) to its canonical form. */
function clean(input: string): string {
  return render(toParts(input));
}

/** The base name (last segment) of a path, or `""` for a root. */
function baseName(parts: string[]): string {
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

/** The extension of a base name including the dot, or `""` if none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/**
 * An immutable, absolute filesystem path with a fluent, NUKE-inspired API.
 *
 * Build one with {@link absolutePath}. The value itself is **callable** —
 * `path(...segments)` returns a new path with those segments appended — and the
 * equivalent {@link AbsolutePath.join} method does the same. `toString()`
 * yields the path string, so an `AbsolutePath` can be interpolated into the
 * `$` shell helper and passed straight to tool `args()`.
 */
export interface AbsolutePath {
  /** Append path segments, returning a new path (the callable form of {@link join}). */
  (...segments: string[]): AbsolutePath;
  /** The normalised path string (forward slashes, `.`/`..` resolved). */
  readonly path: string;
  /** The final segment, e.g. `"main.ts"` (or `""` for a root). */
  readonly name: string;
  /** The final segment without its extension, e.g. `"main"` (`".gitignore"` has none). */
  readonly stem: string;
  /** The extension including the dot, e.g. `".ts"` (or `""` if none). */
  readonly extension: string;
  /** Whether this path is a filesystem root (`"/"`, `"C:/"`). */
  readonly isRoot: boolean;
  /** Append path segments, returning a new path. */
  join(...segments: string[]): AbsolutePath;
  /** The parent directory; a root is its own parent. */
  parent(): AbsolutePath;
  /** This path expressed relative to `base` (e.g. `"src/main.ts"`, `"../lib"`). */
  relativeTo(base: AbsolutePath | string): string;
  /** Whether `other` resolves to the same normalised path. */
  equals(other: AbsolutePath | string): boolean;
  /** The normalised path string. */
  toString(): string;
}

/**
 * Build an {@link AbsolutePath} from one or more segments. The first segment
 * (after joining) must be absolute — start with `/` or a drive letter, or build
 * from an absolute base — otherwise an error is thrown.
 *
 * ```ts
 * const root = absolutePath("/app");
 * root("src", "main.ts").path;       // "/app/src/main.ts"
 * root.join("..", "shared").path;    // "/shared"
 * absolutePath("C:\\repo", "x").path; // "C:/repo/x"
 * ```
 *
 * @param first The first path segment; must make the result absolute.
 * @param rest Additional segments to append.
 */
export function absolutePath(first: string, ...rest: string[]): AbsolutePath {
  const joined = [first, ...rest].join("/");
  const split = toParts(joined);
  if (split.root === "") {
    throw new Error(
      `absolutePath: expected an absolute path, got "${joined}". ` +
        `Start with "/" or a drive letter (e.g. "C:/"), or join onto an ` +
        `absolute base.`,
    );
  }
  const value = render(split);
  const name = baseName(split.parts);
  const extension = extensionOf(name);

  const call = (...segments: string[]): AbsolutePath =>
    absolutePath(value, ...segments);

  // A function's own `name` is read-only; unlock it so the path's own `name`
  // (the final segment) can shadow it via the assignment below.
  Object.defineProperty(call, "name", { writable: true, configurable: true });

  return Object.assign(call, {
    path: value,
    name,
    stem: extension === "" ? name : name.slice(0, -extension.length),
    extension,
    isRoot: split.parts.length === 0,
    join: (...segments: string[]): AbsolutePath =>
      absolutePath(value, ...segments),
    parent: (): AbsolutePath =>
      absolutePath(
        render({ root: split.root, parts: split.parts.slice(0, -1) }),
      ),
    relativeTo: (base: AbsolutePath | string): string => {
      const from = toParts(String(base));
      if (from.root !== split.root) {
        throw new Error(
          `relativeTo: cannot relate paths with different roots ` +
            `("${from.root || "<relative>"}" vs "${split.root}").`,
        );
      }
      let common = 0;
      while (
        common < from.parts.length &&
        common < split.parts.length &&
        from.parts[common] === split.parts[common]
      ) {
        common++;
      }
      const up = from.parts.length - common;
      const segments = [
        ...new Array<string>(up).fill(".."),
        ...split.parts.slice(common),
      ];
      return segments.length > 0 ? segments.join("/") : ".";
    },
    equals: (other: AbsolutePath | string): boolean =>
      value === clean(String(other)),
    toString: (): string => value,
  });
}
