/**
 * Query the [JSR](https://jsr.io) registry's package metadata — the read-side
 * companion to the {@link JsrTasks} CLI wrapper. A publish pipeline uses these
 * to skip versions already on JSR (idempotent re-runs).
 *
 * ```ts
 * import { isPublished, jsrVersions } from "jsr:@zuke/jsr";
 *
 * if (!(await isPublished("@zuke/core", "0.13.0"))) {
 *   // ...publish it
 * }
 * const all = await jsrVersions("@zuke/core"); // Set<string> of versions
 * ```
 *
 * Built on the platform `fetch`, with an injectable `fetch` seam so they can be
 * unit-tested without network access. A missing package (404) is treated as
 * "no versions" rather than an error, so a never-published package reads as
 * not-yet-published instead of throwing.
 *
 * @module
 */

/** Options shared by the JSR registry helpers. */
export interface JsrRegistryOptions {
  /**
   * The `fetch` implementation to use. Defaults to the global `fetch`; override
   * it to unit-test without network access.
   */
  fetch?: typeof fetch;
}

/**
 * The set of version strings present in a JSR `meta.json` payload. Tolerant of
 * malformed input: anything without a `versions` object yields an empty set.
 */
export function publishedVersions(meta: unknown): Set<string> {
  if (typeof meta !== "object" || meta === null) return new Set<string>();
  if (!("versions" in meta)) return new Set<string>();
  const versions = meta.versions;
  if (typeof versions !== "object" || versions === null) {
    return new Set<string>();
  }
  return new Set(Object.keys(versions));
}

/**
 * The set of published versions of `pkg` (a scoped name like `@zuke/core`).
 * Resolves to an empty set if the package is not found on JSR.
 */
export async function jsrVersions(
  pkg: string,
  options: JsrRegistryOptions = {},
): Promise<Set<string>> {
  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(`https://jsr.io/${pkg}/meta.json`);
  if (!res.ok) {
    // Drain the body so the connection can be reused/closed.
    await res.body?.cancel();
    return new Set<string>();
  }
  return publishedVersions(await res.json());
}

/** Whether `pkg@version` (e.g. `@zuke/core`, `0.13.0`) is already on JSR. */
export async function isPublished(
  pkg: string,
  version: string,
  options?: JsrRegistryOptions,
): Promise<boolean> {
  return (await jsrVersions(pkg, options)).has(version);
}
