/**
 * Small helpers for reading provider responses — untyped JSON navigated without
 * casting.
 *
 * @module
 */

import { AiReviewError } from "./errors.ts";

/** Read a nested field from an unknown value without casting. */
export function dig(value: unknown, ...path: Array<string | number>): unknown {
  let current = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      if (typeof current !== "object" || current === null) return undefined;
      current = Reflect.get(current, key);
    }
  }
  return current;
}

/** Read a string at `path`, or throw if the response shape is wrong. */
export function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new AiReviewError(`could not read ${label} from the response`);
  }
  return value;
}
