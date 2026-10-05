// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Review progress as reactions on the pull-request description: 👀 while a
 * review runs, then one verdict — 👍 passed, 🤏 findings under the failing
 * threshold, 👎 failed.
 *
 * A host keeps one reaction of each kind per account, and the reviewers on a
 * pull request usually post under one account, so they share these reactions.
 * {@link ReviewProgress} is what keeps them from talking over each other: per
 * pull request it counts the reviewers in flight, so 👀 stays until the last
 * one finishes, and it keeps the **worst** verdict any of them reached, so a
 * clean second review cannot paper over the first one's findings. The first
 * reviewer to start on a pull request clears the verdict a previous run left.
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

/** The {@link ReviewSignal}s that are verdicts, in increasing severity. */
type Verdict = Exclude<ReviewSignal, "reviewing">;

/** Every verdict, least severe first — the order {@link worse} ranks by. */
const VERDICTS: readonly Verdict[] = ["passed", "minor", "failed"];

/** The more severe of two verdicts; `current` is absent before the first. */
function worse(current: Verdict | undefined, next: Verdict): Verdict {
  if (current === undefined) return next;
  return VERDICTS.indexOf(next) > VERDICTS.indexOf(current) ? next : current;
}

/** What one pull request's reviewers have signalled so far in this process. */
interface PullProgress {
  /** Reviewers that started and have not yet finished. */
  active: number;
  /** The verdict currently shown — the worst any reviewer reached. */
  shown?: Verdict;
  /** The tail of this pull request's serialized reaction steps. */
  chain: Promise<void>;
}

/**
 * Coordinates the progress reactions of every reviewer in this process, per
 * pull request (keyed by {@link ReviewReactions.key}). A build run is one
 * process, so its lifetime is the run's.
 */
export class ReviewProgress {
  readonly #pulls = new Map<string, PullProgress>();

  /**
   * Signal that a review is starting — clearing a previous run's verdict when
   * it is the first on this pull request — and return the function that
   * signals how it ended. Neither step throws: a reaction is a courtesy.
   */
  async start(
    reactions: ReviewReactions,
    doFetch: typeof fetch,
  ): Promise<(outcome: ReviewOutcome) => Promise<void>> {
    const existing = this.#pulls.get(reactions.key);
    const pull: PullProgress = existing ??
      { active: 0, chain: Promise.resolve() };
    if (existing === undefined) this.#pulls.set(reactions.key, pull);
    const step = (work: () => Promise<void>): Promise<void> => {
      pull.chain = pull.chain.then(work);
      return pull.chain;
    };
    pull.active++;
    await step(async () => {
      if (existing === undefined) {
        for (const verdict of VERDICTS) {
          await reactions.remove(verdict, doFetch);
        }
      }
      await reactions.add("reviewing", doFetch);
    });
    return (outcome) =>
      step(async () => {
        pull.active--;
        if (outcome !== "skipped") {
          const verdict = worse(pull.shown, outcome);
          if (verdict !== pull.shown) {
            // The new verdict goes up before the old one comes down, so the
            // description is never without one once a review has finished.
            await reactions.add(verdict, doFetch);
            if (pull.shown !== undefined) {
              await reactions.remove(pull.shown, doFetch);
            }
            pull.shown = verdict;
          }
        }
        if (pull.active === 0) await reactions.remove("reviewing", doFetch);
      });
  }
}
