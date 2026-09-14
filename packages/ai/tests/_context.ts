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
