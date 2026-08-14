// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The review-thread side channel as a phase: resolve the host's thread
 * operations and this reviewer's existing threads ({@link prepareThreads}),
 * then open, answer and resolve this round's threads ({@link postThreads}).
 *
 * `threads.ts` decides *what* should happen (pure planning); this module talks
 * to the host and reports what did. Module-internal — the
 * {@link "./reviewer.ts".Reviewer} is its only caller.
 *
 * @module
 */

import { stableHash } from "./hash.ts";
import { detectReviewHost, type EnvReader } from "./hosts.ts";
import type { FindingThread, ReviewThreads } from "./hosts/types.ts";
import {
  findingMarker,
  findingThreads,
  listIds,
  MAX_NEW_THREADS,
  outcomeMarker,
  planThreads,
  type ThreadAction,
  type ThreadInputs,
  threadOutcomeBody,
  threadRootBody,
} from "./threads.ts";

/** What the phase needs from the reviewer that configured it. */
export interface ThreadPhaseSettings {
  /** The reviewer's diagnostic name — also the seed for its thread markers. */
  readonly name: string;
  /** Whether `.quiet()` is set: no console notes when it is. */
  readonly quiet: boolean;
  /** The reviewer's environment reader, for host detection. */
  readonly env: EnvReader;
  /** The `fetch` implementation host calls go through. */
  readonly doFetch: typeof fetch;
  /** Resolve the comment-posting token for the detected host. */
  readonly token: (host: { defaultTokenEnv: string }) => string;
}

/** The host's thread operations plus this reviewer's threads already on the PR. */
export interface ThreadContext {
  /** The host's review-thread operations for the active pull request. */
  readonly ops: ReviewThreads;
  /** This reviewer's existing threads, keyed by finding id. */
  readonly threads: Map<string, FindingThread>;
}

/**
 * The reviewer's own review threads on this pull request, or `undefined` when
 * the host cannot do them, there is no PR context, or the listing failed.
 *
 * A failed listing disables the whole phase rather than degrading it: without
 * knowing which threads exist, every finding would look new and the reviewer
 * would post a duplicate thread for each one. The id-quoting discussion
 * channel is unaffected either way.
 */
export async function prepareThreads(
  settings: ThreadPhaseSettings,
): Promise<ThreadContext | undefined> {
  const host = detectReviewHost(settings.env);
  if (host?.reviewThreads === undefined) {
    if (!settings.quiet) {
      console.warn(
        `[${settings.name}] inline review threads are not available on ` +
          `${host?.label ?? "this host"} — findings stay in the summary table`,
      );
    }
    return undefined;
  }
  const ops = host.reviewThreads(settings.token(host), settings.env);
  if (ops === undefined) return undefined; // no PR context (local run)
  try {
    const threads = await findingThreads(
      await ops.list(settings.doFetch),
      stableHash(settings.name),
    );
    return { ops, threads };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!settings.quiet) {
      console.warn(
        `[${settings.name}] could not list review threads: ${message}`,
      );
    }
    return undefined;
  }
}

/**
 * Open, answer and resolve this round's review threads, returning the notes
 * the report must carry.
 *
 * Total by construction: one catch around the whole phase, every write
 * classified rather than thrown, and an immediate halt when the host says to
 * back off. A commenting failure must never break a build, and every finding
 * stays in the summary table regardless of what happened here — so the worst
 * outcome is a run that reads exactly like one with threads switched off.
 */
export async function postThreads(
  settings: ThreadPhaseSettings,
  context: ThreadContext,
  inputs: ThreadInputs,
): Promise<string[]> {
  const notes: string[] = [];
  const doFetch = settings.doFetch;
  const nameHash = stableHash(settings.name);
  try {
    const plan = planThreads(inputs);
    if (plan.unanchored.length > 0) {
      notes.push(
        `${plan.unanchored.length} finding(s) could not be anchored to a ` +
          `line in the reviewed diff (${listIds(plan.unanchored)}) — they ` +
          `are listed in the table above`,
      );
    }
    if (plan.capped > 0) {
      notes.push(
        `${plan.capped} finding(s) did not get a review thread this run ` +
          `(cap ${MAX_NEW_THREADS}) — the next run opens them`,
      );
    }
    const opens = plan.actions.filter((action) => action.kind === "open");
    const sha = opens.length === 0
      ? undefined
      : await context.ops.headSha(doFetch);
    if (opens.length > 0 && sha === undefined) {
      notes.push(
        "could not resolve the pull request's head commit — no new review " +
          "threads were opened; findings stay in the table",
      );
    }
    let posted = 0;
    let stopped = false;
    const rejected: string[] = [];
    for (const action of plan.actions) {
      if (stopped) break;
      // Replies first is not an ordering accident: an outcome the maintainer
      // can read matters more than a thread that exists, so the closing half
      // of the round is never starved by the opening half.
      const result = action.kind === "reply"
        ? await context.ops.reply(
          doFetch,
          action.rootId ?? 0,
          threadBody(nameHash, action),
        )
        : sha === undefined || action.anchor === undefined
        ? "rejected"
        : await context.ops.open(
          doFetch,
          sha,
          action.anchor.path,
          action.anchor.line,
          threadBody(nameHash, action),
        );
      if (result === "created") posted++;
      else if (result === "rejected") rejected.push(action.id);
      else stopped = true;
    }
    // A thread whose outcome reply the host refused must not be resolved: a
    // collapsed thread carrying no explanation is worse than an open one.
    const explained = (target: { id: string }) => !rejected.includes(target.id);
    plan.resolve = plan.resolve.filter(explained);
    if (rejected.length > 0) {
      notes.push(
        `${rejected.length} review thread(s) were rejected by the host ` +
          `(${listIds(rejected)}) — those findings stay in the table`,
      );
    }
    if (stopped) {
      notes.push(
        `posted ${posted} of ${plan.actions.length} review thread updates ` +
          `before the host asked us to back off — the next run resumes`,
      );
    }
    // Resolution last, and only after its outcome reply landed: a collapsed
    // thread with no explanation is worse than one left open.
    if (!stopped && plan.resolve.length > 0) {
      const done = await context.ops.setResolved(
        doFetch,
        plan.resolve.map((target) => target.rootId),
        true,
      );
      if (done < plan.resolve.length) {
        notes.push(
          `could not resolve ${plan.resolve.length - done} review thread(s) ` +
            `— the outcome was still posted in the thread`,
        );
      }
    }
    if (!stopped && plan.unresolve.length > 0) {
      const done = await context.ops.setResolved(
        doFetch,
        plan.unresolve.map((target) => target.rootId),
        false,
      );
      if (done < plan.unresolve.length) {
        // The asymmetric one: a live finding behind a collapsed thread is the
        // outcome to shout about, so it names the ids.
        notes.push(
          `could not reopen the review thread(s) for ` +
            `${listIds(plan.unresolve.map((t) => t.id))} — the finding is ` +
            `reported in the table above and still gates`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(
      `review threads unavailable this run (${message}) — findings stay ` +
        `in the table`,
    );
  }
  return notes;
}

/** The body of a thread root or outcome reply, with its marker leading. */
function threadBody(nameHash: string, action: ThreadAction): string {
  if (action.kind === "open") {
    return `${findingMarker(nameHash, action.id)}\n${threadRootBody(action)}`;
  }
  const outcome = action.outcome ?? "upheld";
  return `${outcomeMarker(nameHash, action.id, outcome)}\n${
    threadOutcomeBody(outcome, action.reason)
  }`;
}
