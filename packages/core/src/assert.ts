/**
 * Assertions and control-flow helpers for build scripts — fail fast with a
 * clear message when an expectation does not hold.
 *
 * ```ts
 * import { assert, assertExists, fail } from "jsr:@zuke/core";
 *
 * assert(version !== "", "version must not be empty");
 * const token = assertExists(Deno.env.get("TOKEN"), "TOKEN is required");
 * if (broken) fail("refusing to deploy a broken build");
 * ```
 *
 * The filesystem checks ({@link assertFileExists}, {@link assertDirectoryExists})
 * are async; the rest are synchronous and narrow types where possible.
 *
 * @module
 */

import type { PathLike } from "./path.ts";

/** Raised by the assertion helpers when an expectation fails. */
export class AssertionError extends Error {
  override name = "AssertionError";
}

/** Throw an {@link AssertionError} with `message`. Never returns. */
export function fail(message: string): never {
  throw new AssertionError(message);
}

/**
 * Assert that `condition` is truthy, narrowing it for the rest of the scope.
 * Throws an {@link AssertionError} with `message` otherwise.
 */
export function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) fail(message);
}

/**
 * Assert that `value` is neither `null` nor `undefined`, returning it narrowed
 * to its non-nullable type so it can be used inline.
 *
 * ```ts
 * const token = assertExists(Deno.env.get("TOKEN"), "TOKEN is required");
 * ```
 */
export function assertExists<T>(
  value: T,
  message = "Expected a value to be present",
): NonNullable<T> {
  if (value === null || value === undefined) fail(message);
  return value;
}

/** Assert that `path` exists and is a file. Async (stats the filesystem). */
export async function assertFileExists(path: PathLike): Promise<void> {
  const target = String(path);
  let isFile = false;
  try {
    isFile = (await Deno.stat(target)).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      fail(`Expected file to exist: ${target}`);
    }
    throw error;
  }
  if (!isFile) fail(`Expected a file (not a directory): ${target}`);
}

/** Assert that `path` exists and is a directory. Async (stats the filesystem). */
export async function assertDirectoryExists(path: PathLike): Promise<void> {
  const target = String(path);
  let isDirectory = false;
  try {
    isDirectory = (await Deno.stat(target)).isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      fail(`Expected directory to exist: ${target}`);
    }
    throw error;
  }
  if (!isDirectory) fail(`Expected a directory (not a file): ${target}`);
}
