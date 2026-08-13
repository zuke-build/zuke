// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Which build a run belongs to.
 *
 * A state store is commonly shared by more than one build, and a run listing has
 * no build filter — so every recovery sweep sees every build's runs. Deciding
 * which of them are *this* build's is what this module is for, and it matters
 * because the recovery paths do not merely read a foreign run: a reap hands it
 * back to be resumed, a resume then runs **this** build's target bodies against
 * the other build's record, and a settlement runs this build's compensations.
 *
 * The class name in {@link "./state/types.ts".RunRecord.build} cannot answer it.
 * Half the repositories in an organisation call their build `Ci`, and the
 * shape-based checks that back it up — the root target exists here, the graph
 * agrees — all pass for the case that actually happens: one `zuke.ts` templated
 * across a dozen services, identical target names and edges, different bodies.
 * The resume path never consults the class name at all, only the shape.
 *
 * So a run records an **origin** as well, and a recovery path only touches a run
 * whose origin it shares:
 *
 * - `ZUKE_BUILD_ID`, when the operator sets one. The explicit answer, and what a
 *   container or a cron job wants — it has no repository in its environment.
 * - `GITHUB_REPOSITORY` otherwise, which every GitHub Actions job already has.
 *   Distinct per repository, stable across commits, and free: a build templated
 *   across services is separated with no configuration at all.
 *
 * **An origin only ever narrows.** It is `&&`-ed with the shape checks at every
 * call site, never substituted for them, so it can refuse a run and never claim
 * one. That is what makes the repository default safe where it is coarse: two
 * builds in one repository resolve the same origin, and the build-name and
 * root-target checks separate them exactly as they did before.
 *
 * **A missing origin never blocks anything.** A record written before this
 * existed has none, and a process outside CI with no `ZUKE_BUILD_ID` resolves
 * none, so either side being absent means the comparison abstains and the
 * shape-based checks decide as they did before. That is deliberate: an origin
 * that could *strand* a run would trade a rare wrong execution for a common
 * failure to recover, and a run nobody recovers is the worse outcome — an effect
 * it owed is never driven.
 *
 * @module
 */

import type { RunRecord } from "./state/types.ts";

/**
 * The origin of the build running in this process — `ZUKE_BUILD_ID`, else
 * `GITHUB_REPOSITORY`, else `undefined` when neither is set.
 *
 * Recorded on a run at creation and compared by every recovery path. An empty
 * value counts as unset, so an exported-but-empty variable does not become an
 * origin that matches nothing.
 */
export function resolveBuildId(
  readEnv: (name: string) => string | undefined,
): string | undefined {
  for (const name of ["ZUKE_BUILD_ID", "GITHUB_REPOSITORY"]) {
    const value = readEnv(name);
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

/**
 * Whether a process whose origin is `buildId` may recover `record`.
 *
 * True unless both origins are known and differ — see the module documentation
 * for why an absent origin abstains rather than refusing.
 */
export function ownsRun(
  record: RunRecord,
  buildId: string | undefined,
): boolean {
  if (buildId === undefined || record.buildId === undefined) return true;
  return record.buildId === buildId;
}

/**
 * Thrown when a recovery path is handed a run that a **different** build owns:
 * the run's recorded origin and this process's disagree.
 *
 * A sweep treats it as "not mine" and moves on rather than counting a failure,
 * the same way it treats a run another process has already resumed. A command
 * that named one run reports it, because the operator asked about a run that is
 * not this build's to touch.
 */
export class ForeignRunError extends Error {
  /** The error name. */
  override name = "ForeignRunError";
  /** Build the error from the run and the two disagreeing origins. */
  constructor(
    /** The run that was refused. */
    readonly runId: string,
    /** The origin recorded on the run. */
    readonly owner: string,
    /** The origin of the build in this process. */
    readonly self: string,
  ) {
    super(
      `run ${runId} belongs to build "${owner}", but this process is ` +
        `"${self}". A build only recovers its own runs. Set ZUKE_BUILD_ID to ` +
        `"${owner}" if this process really does own it.`,
    );
  }
}

/**
 * {@link ownsRun}, as an assertion: throws {@link ForeignRunError} when the two
 * origins are known and differ.
 */
export function assertOwnsRun(
  record: RunRecord,
  buildId: string | undefined,
): void {
  // Narrowed here rather than delegating to `ownsRun`, so both origins are
  // `string` by the time the error is built — no unreachable fallback.
  const owner = record.buildId;
  if (owner === undefined || buildId === undefined) return;
  if (owner === buildId) return;
  throw new ForeignRunError(record.id, owner, buildId);
}
