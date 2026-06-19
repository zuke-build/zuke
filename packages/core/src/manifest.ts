/**
 * Read fields from a package manifest (a `deno.json`/`package.json`). Builds
 * that publish or gate on versions need the manifest's `version`; these helpers
 * read it safely, validating the shape instead of trusting `JSON.parse`'s
 * `unknown`.
 *
 * ```ts
 * import { manifestVersion, readVersion } from "jsr:@zuke/core";
 *
 * const v = await manifestVersion("packages/core/deno.json"); // "0.13.0"
 * readVersion(JSON.parse(text)); // validate an already-parsed manifest
 * ```
 *
 * @module
 */

import type { PathLike } from "./path.ts";

/**
 * Validate and return the `version` field of a parsed manifest object. Throws a
 * descriptive error if `value` is not an object, has no `version`, or its
 * `version` is not a string — narrowing `JSON.parse`'s `unknown` to a `string`
 * without an `as` cast.
 */
export function readVersion(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    throw new Error("manifest must be a JSON object.");
  }
  if (!("version" in value)) {
    throw new Error('manifest is missing a "version" field.');
  }
  if (typeof value.version !== "string") {
    throw new Error('manifest "version" must be a string.');
  }
  return value.version;
}

/**
 * Read and parse the JSON manifest at `path` and return its validated `version`
 * (see {@link readVersion}).
 */
export async function manifestVersion(path: PathLike): Promise<string> {
  const text = await Deno.readTextFile(String(path));
  return readVersion(JSON.parse(text));
}
