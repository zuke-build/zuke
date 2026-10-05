// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Review progress as reactions on the pull-request description: 👀 while a
 * review runs, then one verdict — 👍 passed, 🤏 findings under the failing
 * threshold, 👎 failed, or 🎉 when it passes a pull request the previous run
 * failed.
 *
 * A host keeps one reaction of each kind per account, and the reviewers on a
 * pull request usually post under one account, so they share these reactions.
 * {@link ReviewProgress} is what keeps them from talking over each other: per
 * build run and pull request it counts the reviewers in flight, so 👀 stays
 * until the last one finishes, and it keeps the **worst** verdict any of them
 * reached, so a clean second review cannot paper over the first one's
 * findings. The first reviewer of a run to start on a pull request clears the
 * verdict a previous run left — and notes whether that verdict was 👎.
 *
 * Every step for one pull request runs in order on one promise chain, so two
 * reviewers in flight at once cannot interleave their adds and removes.
 *
 * @module
 */

import type { ReviewReactions, ReviewSignal } from "./hosts/types.ts";

/**
 * How one review ended, as far as its progress signal goes: a verdict, or
 * `skipped` (no key, budget exhausted, an error tolerated under
 * `onError("warn")`) — which withdraws 👀 without claiming a verdict.
 */
export type ReviewOutcome = Verdict | "skipped";

/** The verdicts a review reaches, in increasing severity. */
type Verdict = "passed" | "minor" | "failed";

/** Every verdict, least severe first — the order {@link worse} ranks by. */
const VERDICTS: readonly Verdict[] = ["passed", "minor", "failed"];

/**
 * Every signal that stands for a finished run on the description — what a new
 * run clears before it starts. 🚀 (`fixed`) is not one: it records that a fix
 * was pushed, which stays true.
 */
const SHOWN: readonly ReviewSignal[] = [...VERDICTS, "recovered"];

/** The more severe of two verdicts; `current` is absent before the first. */
function worse(current: Verdict | undefined, next: Verdict): Verdict {
  if (current === undefined) return next;
  return VERDICTS.indexOf(next) > VERDICTS.indexOf(current) ? next : current;
}

/** What one pull request's reviewers have signalled so far in one run. */
interface PullProgress {
  /** Reviewers that started and have not yet finished. */
  active: number;
  /** Whether the run before this one had left 👎 on the description. */
  recovering: boolean;
  /** The worst verdict any of them reached — absent while none has. */
  worst?: Verdict;
  /** The signal on the description now — behind `worst` when a post failed. */
  shown?: ReviewSignal;
  /** The tail of this pull request's serialized reaction steps. */
  chain: Promise<void>;
}

/**
 * Coordinates the progress reactions of every reviewer in this process, per
 * build run and pull request (the run's id and {@link ReviewReactions.key}),
 * so a process that executes several runs — `zuke mcp` — starts each one
 * afresh instead of holding the next run to the last one's verdict.
 */
export class ReviewProgress {
  readonly #pulls = new Map<string, PullProgress>();

  /**
   * Signal that a review in run `run` is starting — clearing the verdict an
   * earlier run left when it is the first on this pull request — and return
   * the function that signals how it ended. That function answers whether
   * the run, so far, **reviewed nothing**: this was the last reviewer in
   * flight and none of the run's reached a verdict — what a command that
   * started the run is owed a 😕 for, rather than one reviewer's skip while
   * another reviewed. Neither step throws: a reaction is a courtesy, never a
   * failed review.
   */
  async start(
    run: string,
    reactions: ReviewReactions,
    doFetch: typeof fetch,
  ): Promise<(outcome: ReviewOutcome) => Promise<boolean>> {
    const key = `${run}\n${reactions.key}`;
    const existing = this.#pulls.get(key);
    const pull: PullProgress = existing ??
      { active: 0, recovering: false, chain: Promise.resolve() };
    if (existing === undefined) this.#pulls.set(key, pull);
    const step = (work: () => Promise<void>): Promise<void> => {
      // A step that throws must not poison the ones queued behind it, nor
      // replace the review's own error in the caller's `finally`.
      pull.chain = pull.chain.then(work).catch(() => {});
      return pull.chain;
    };
    pull.active++;
    await step(async () => {
      // 👀 first: on GitHub the reviewer's own reaction is how it learns which
      // account it reacts as, and so which stale verdicts are its to clear.
      await reactions.add("reviewing", doFetch);
      if (existing !== undefined) return;
      for (const signal of SHOWN) {
        const removed = await reactions.remove(signal, doFetch);
        if (removed && signal === "failed") pull.recovering = true;
      }
    });
    return async (outcome) => {
      let unreviewed = false;
      await step(async () => {
        pull.active--;
        if (outcome !== "skipped") pull.worst = worse(pull.worst, outcome);
        const worst = pull.worst;
        const signal: ReviewSignal | undefined =
          worst === "passed" && pull.recovering ? "recovered" : worst;
        if (signal !== undefined && signal !== pull.shown) {
          // The new verdict goes up before the old one comes down, so the
          // description is never without one once a review has finished. The
          // old one comes down even when the new one did not go up: no verdict
          // is better than a wrong one, and the next reviewer retries.
          const posted = await reactions.add(signal, doFetch);
          if (pull.shown !== undefined) {
            await reactions.remove(pull.shown, doFetch);
          }
          pull.shown = posted ? signal : undefined;
        }
        if (pull.active === 0) {
          unreviewed = pull.worst === undefined;
          await reactions.remove("reviewing", doFetch);
        }
      });
      return unreviewed;
    };
  }
}
