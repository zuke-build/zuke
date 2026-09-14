// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Where a fixer is allowed to run: on a developer's machine, on CI, or both.
 *
 * The scope is a single axis with three states, selected by one setter, so the
 * effective value never depends on the order two flags were called in. That
 * shape is deliberate: the property it controls is whether a fixer may rewrite
 * and commit the tree it is pointed at, which is not a property to leave to
 * call order.
 *
 * Both {@link "./fixer.ts".AiFixer} and {@link "./agent_fixer.ts".AgentFixer}
 * gate on this one rule. Until this module they each carried their own copy of
 * it — the same field and the same host comparison, differing only in
 * the sentence they wrapped around the refusal — which is the near-copy
 * AGENTS.md guideline 12 treats as a copy-paste.
 *
 * {@link outOfScope} returns the refusal as parts rather than a finished
 * sentence, because the two fixers say different things about it: one skips
 * outright, the other has already diagnosed and is explaining why it will not
 * write. Both need the same two facts — which side of the boundary this run is
 * on, and which scope would permit it here.
 *
 * @module
 */

import { isCI } from "@zuke/core";
import type { EnvReader } from "./hosts.ts";

/**
 * Where a fixer may run, set with `.runOnly(...)`.
 *
 * - `"local"` — apply on a developer's machine, refuse on CI. The default, and
 *   what a fixer has when `.runOnly(...)` is never called.
 * - `"ci"` — apply on CI, and do not run at all off it. The scope a
 *   repository's own build wants: heal a pull request without ever rewriting a
 *   working tree someone is editing.
 * - `"both"` — apply on either host. What `.allowCI()` selects.
 *
 * "On CI" means any CI system, not only the four Zuke names it can generate
 * pipelines for: `isCI` recognises GitHub Actions, GitLab CI, Azure Pipelines
 * and Bitbucket Pipelines by their own variables, and Jenkins, Buildkite,
 * CircleCI, Travis, TeamCity and the generic `CI` convention by theirs.
 *
 * Reading one of those as a developer's machine would fail in the dangerous
 * direction for both of the other scopes, which is why the broader test is the
 * right one: `"ci"` would silently skip every run, and `"local"` — the default
 * — would apply and commit changes to what it believed was a working tree
 * someone was editing. Jenkins is the case that matters most, since it sets
 * none of the four and does not set `CI` either.
 */
export type RunScope = "local" | "ci" | "both";

/** Why a scope forbids running on the host this build is on. */
export interface ScopeRefusal {
  /** Which side of the boundary this run is on: `"on CI"` or `"outside CI"`. */
  where: string;
  /** The scope that would permit it here, named for the message. */
  hint: string;
}

/**
 * The refusal for running under `scope` on the host this build is on, or
 * `undefined` when it is permitted.
 *
 * What a caller does with a refusal is its own decision: a fixer restricted to
 * CI has nothing useful to do off it and skips, while the default scope on CI
 * still diagnoses and only declines to write.
 */
export function outOfScope(
  scope: RunScope,
  env: EnvReader,
): ScopeRefusal | undefined {
  if (scope === "both") return undefined;
  const onCi = isCI(env);
  if (scope === "local") {
    return onCi
      ? { where: "on CI", hint: '.runOnly("ci") or .runOnly("both")' }
      : undefined;
  }
  return onCi
    ? undefined
    : { where: "outside CI", hint: '.runOnly("both") to also run locally' };
}
