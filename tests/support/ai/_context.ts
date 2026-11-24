// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The {@link ValidationContext} these tests hand a reviewer when they drive
 * `validate(...)` directly rather than through a run.
 *
 * The redactor is the identity, because these tests are about everything else
 * — scoring, gating, budgets, the discussion loop. Named rather than inlined so
 * that a test running without redaction is a visible choice and not an
 * oversight, and so the day a test wants a real one there is a single place
 * that decides what "no redaction" looks like.
 *
 * @module
 */

import type { ValidationContext } from "@zuke/core";

/** A context for `validate(...)` whose redactor leaves the text untouched. */
export function noRedactionContext(target: string): ValidationContext {
  return { target, redact: (text) => text };
}

/**
 * A context whose redactor masks `secret`, standing in for the run redactor
 * core installs for a value the build declared.
 *
 * The counterpart to {@link noRedactionContext}, for the tests that are about
 * the masking itself: with a real masker in place, a `secret` still reaching
 * the `fetch` seam is the defect.
 */
export function maskingContext(
  target: string,
  secret: string,
): ValidationContext {
  return { target, redact: (text) => text.replaceAll(secret, "***") };
}
