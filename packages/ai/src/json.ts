// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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

/**
 * Parse the JSON object a model returned, tolerating the two things models do to
 * it: wrapping it in a Markdown code fence, and framing it with prose. The fence
 * is stripped and the outermost `{`…`}` isolated before `JSON.parse`, so a reply
 * that is *almost* pure JSON still parses.
 *
 * Throws an {@link AiReviewError} naming `label` ("the model did not return
 * valid JSON") when nothing parses — every pass reports the same way, and the
 * fence-stripping regex, a parsing hole if it drifts, exists once.
 */
export function parseJsonObject(text: string, label = "JSON"): unknown {
  const unfenced = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const open = unfenced.indexOf("{");
  const close = unfenced.lastIndexOf("}");
  const isolated = open >= 0 && close > open
    ? unfenced.slice(open, close + 1)
    : unfenced;
  try {
    return JSON.parse(isolated);
  } catch {
    throw new AiReviewError(`the model did not return valid ${label}`);
  }
}
