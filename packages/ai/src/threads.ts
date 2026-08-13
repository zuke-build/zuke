// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Findings as pull-request review threads: which finding gets a thread, which
 * thread is ours, which reply is a rebuttal, and what the reviewer owes each
 * thread this round.
 *
 * Everything here is pure. The host performs the writes ({@link
 * "./hosts/types.ts".ReviewThreads}); this module decides what they should be,
 * so the decisions are unit-testable and the failure directions are visible in
 * one place.
 *
 * Two rules run through all of it. A thread is the reviewer's own only when its
 * root carries our marker **and** the host attributes the author to us — a
 * pasted marker buys nothing. And a reply is a rebuttal for the finding its
 * **thread** names, never for one its text mentions, so contesting a finding
 * means replying where it lives rather than quoting an id.
 *
 * @module
 */

import type { AssessmentFinding } from "./types.ts";
import type {
  FindingThread,
  HostComment,
  ReviewComments,
  ThreadOutcome,
} from "./hosts/types.ts";
import { ownAuthor } from "./hosts/types.ts";
import { rank } from "./severity.ts";

/**
 * Cap on threads opened in one run. A finding that does not fit is not lost —
 * it stays in the summary table, and the next run opens it, because a thread's
 * existence is read back from the pull request rather than remembered.
 */
export const MAX_NEW_THREADS = 20;

/** Every outcome an own reply can declare, in the order the pattern lists them. */
const OUTCOMES: readonly ThreadOutcome[] = [
  "fixed",
  "dismissed",
  "upheld",
  "reopened",
];

/** How deep a reply-to-a-reply chain is walked back to its root. */
const MAX_PARENT_HOPS = 16;

/** The hidden marker that opens a finding thread's root comment. */
export function findingMarker(nameHash: string, id: string): string {
  return `<!-- zuke-ai-finding:${nameHash}:${id} -->`;
}

/** The hidden marker that opens one of the reviewer's own outcome replies. */
export function outcomeMarker(
  nameHash: string,
  id: string,
  kind: ThreadOutcome,
): string {
  return `<!-- zuke-ai-outcome:${nameHash}:${id}:${kind} -->`;
}

/**
 * The two marker patterns, anchored to the start of a body and constrained to
 * the fingerprint alphabet on every capture. No permissive capture appears
 * here on purpose: a marker is parsed back into an id the reviewer then acts
 * on, so arbitrary text must never be able to come out of one.
 */
const FINDING_MARKER =
  /^<!-- zuke-ai-finding:([0-9a-z]{1,16}):([0-9a-z]{1,16}) -->/;
const OUTCOME_MARKER =
  /^<!-- zuke-ai-outcome:([0-9a-z]{1,16}):([0-9a-z]{1,16}):(fixed|dismissed|upheld|reopened) -->/;

/**
 * The finding id a root body declares for this reviewer, or `undefined`. The
 * name hash must match: two reviewers on one pull request (a security and a
 * general review) must never adopt each other's threads.
 */
export function parseFindingMarker(
  nameHash: string,
  body: string,
): string | undefined {
  const match = body.match(FINDING_MARKER);
  if (match === null || match[1] !== nameHash) return undefined;
  return match[2];
}

/** The outcome an own reply declares for this reviewer, or `undefined`. */
export function parseOutcomeMarker(
  nameHash: string,
  body: string,
): { id: string; kind: ThreadOutcome } | undefined {
  const match = body.match(OUTCOME_MARKER);
  if (match === null || match[1] !== nameHash) return undefined;
  // The pattern's alternation already restricts the kind to the four outcomes,
  // so it needs no second check here — only the narrowing the compiler wants.
  const kind = OUTCOMES.find((known) => known === match[3]);
  return kind === undefined ? undefined : { id: match[2], kind };
}

/**
 * The (path, line) a finding may anchor to, or `undefined` when it cannot: no
 * file, no line, a file the diff does not touch, or a line the diff does not
 * expose on the right side (one the model invented, or one that exists only as
 * a removal).
 *
 * Exact match only — never the nearest line, never the enclosing hunk's start.
 * A thread on the wrong line is worse than no thread: it attributes a finding
 * to code it is not about, and an unanchored finding is still reported in the
 * summary table.
 */
export function anchorFor(
  finding: AssessmentFinding,
  anchors: ReadonlyMap<string, Set<number>>,
): { path: string; line: number } | undefined {
  const { file, line } = finding;
  if (file === undefined || line === undefined) return undefined;
  return anchors.get(file)?.has(line) === true
    ? { path: file, line }
    : undefined;
}

/** Walk a reply's parent chain to the comment it ultimately hangs from. */
function rootOf(id: number, parents: ReadonlyMap<number, number>): number {
  let current = id;
  for (let hop = 0; hop < MAX_PARENT_HOPS; hop++) {
    const parent = parents.get(current);
    if (parent === undefined) return current;
    current = parent;
  }
  return current;
}

/**
 * The reviewer's own finding threads, keyed by canonical finding id.
 *
 * A root is ours only when all four hold: the marker opens the body, the name
 * hash is ours, the comment is a root rather than a reply, and the host
 * attributes the author to us. A human who pastes a perfect marker therefore
 * gets a thread the reviewer never adopts — it reads no rebuttals from it,
 * never replies into it, and never resolves it.
 *
 * The reviewer's own replies are separated from everyone else's: their outcome
 * markers become {@link FindingThread.outcomes}, so the reviewer can never read
 * its own answer back as a maintainer's rebuttal. The bot filter alone does not
 * cover that — under a personal token the reviewer's replies are human-authored
 * and carry the maintainer's own association.
 */
export async function findingThreads(
  raw: ReviewComments,
  nameHash: string,
): Promise<Map<string, FindingThread>> {
  const threads = new Map<string, FindingThread>();
  const byRoot = new Map<number, FindingThread>();
  const candidates = raw.comments.filter((comment) =>
    !raw.parents.has(comment.id) &&
    parseFindingMarker(nameHash, comment.body) !== undefined
  );
  // Consult the token's identity when any comment carrying one of our markers —
  // a root or one of our own outcome replies — is not already flagged as a bot.
  //
  // Replies have to count here, not just roots. A run under an Actions token
  // writes bot-authored roots, while a later run under a personal token writes
  // replies that are ordinary user comments; judging the need from roots alone
  // would leave `self` unresolved, and the reviewer's own outcome reply would
  // then be filed as somebody else's — read straight back as a maintainer's
  // rebuttal, by an author the trust filter accepts. The reviewer must never
  // argue with itself.
  const ours = raw.comments.filter((comment) =>
    parseFindingMarker(nameHash, comment.body) !== undefined ||
    parseOutcomeMarker(nameHash, comment.body) !== undefined
  );
  const self = ours.some((comment) => !comment.bot)
    ? await raw.resolveSelf()
    : undefined;
  for (const comment of candidates) {
    if (!ownAuthor(comment, self)) continue;
    const id = parseFindingMarker(nameHash, comment.body);
    if (id === undefined || threads.has(id)) continue;
    const thread: FindingThread = {
      id,
      rootId: comment.id,
      outcomes: [],
      replies: [],
    };
    threads.set(id, thread);
    byRoot.set(comment.id, thread);
  }
  for (const comment of raw.comments) {
    if (!raw.parents.has(comment.id)) continue;
    const thread = byRoot.get(rootOf(comment.id, raw.parents));
    if (thread === undefined) continue;
    const outcome = ownAuthor(comment, self)
      ? parseOutcomeMarker(nameHash, comment.body)
      : undefined;
    if (outcome !== undefined) thread.outcomes.push(outcome.kind);
    else if (!ownAuthor(comment, self)) thread.replies.push(comment);
  }
  return threads;
}

/** Every reply the reviewer did not write, across all its threads. */
export function allReplies(
  threads: ReadonlyMap<string, FindingThread>,
): HostComment[] {
  return [...threads.values()].flatMap((thread) => thread.replies);
}

/**
 * The id-quoting rebuttals plus the thread replies among `budgeted`, merged.
 *
 * A reply's finding comes from the marker on the thread it sits in — code the
 * reviewer wrote, on a comment proved to be its own — never from the reply's
 * text. So a maintainer contests a finding by replying where it lives, and a
 * reply that happens to quote some other finding's id still answers the one
 * whose thread it is in. Replies have already passed the same trust gate and
 * the same token budget as the id-quoting channel.
 */
export function withThreadRebuttals(
  rebuttals: Map<string, HostComment[]>,
  budgeted: readonly HostComment[],
  threads: ReadonlyMap<string, FindingThread>,
  ids: readonly string[],
): Map<string, HostComment[]> {
  const owner = new Map<number, string>();
  for (const thread of threads.values()) {
    for (const reply of thread.replies) owner.set(reply.id, thread.id);
  }
  const merged = new Map(rebuttals);
  for (const comment of budgeted) {
    if (comment.kind !== "review") continue;
    const id = owner.get(comment.id);
    if (id === undefined || !ids.includes(id)) continue;
    const existing = merged.get(id) ?? [];
    // A reply that also quotes its own finding's id must not count twice.
    if (
      existing.some((seen) => seen.kind === "review" && seen.id === comment.id)
    ) {
      continue;
    }
    merged.set(id, [...existing, comment]);
  }
  return merged;
}

/** One thread write the reviewer owes this round. */
export interface ThreadAction {
  /** The canonical finding id the action is about. */
  id: string;
  /** What to do: open a new thread, or reply into an existing one. */
  kind: "open" | "reply";
  /** The outcome to reply with, for a `"reply"` action. */
  outcome?: ThreadOutcome;
  /** The root comment id to reply into, for a `"reply"` action. */
  rootId?: number;
  /** Where to anchor a new thread, for an `"open"` action. */
  anchor?: { path: string; line: number };
  /** The finding the action speaks about. */
  finding?: AssessmentFinding;
  /** The adjudicator's or verifier's one-line reason, when there is one. */
  reason?: string;
}

/** A thread to resolve or reopen, and the finding it belongs to. */
export interface ThreadTarget {
  /** The canonical finding id — what a note about this thread should name. */
  id: string;
  /** The root comment id the host addresses the thread by. */
  rootId: number;
}

/** What one round owes its threads. */
export interface ThreadPlan {
  /** New threads to open and outcomes to reply, in a deterministic order. */
  actions: ThreadAction[];
  /** Threads to resolve — a finding answered for good this round. */
  resolve: ThreadTarget[];
  /** Threads to reopen — a finding that is live again. */
  unresolve: ThreadTarget[];
  /** Findings that wanted a thread but could not be anchored to a line. */
  unanchored: string[];
  /** New threads the per-run cap left for the next round. */
  capped: number;
}

/** The inputs a round's thread plan is derived from. */
export interface ThreadInputs {
  /** The findings still standing after verify, adjudication and suppression. */
  open: AssessmentFinding[];
  /** Findings dismissed this round, with the accepted reason. */
  dismissed: Array<{ id: string; reason?: string }>;
  /** Ids dismissed in an earlier round — already answered and resolved then. */
  dismissedPrior: ReadonlySet<string>;
  /** Findings recorded as fixed this round. */
  fixed: string[];
  /** Ids already recorded fixed in an earlier round. */
  fixedPrior: ReadonlySet<string>;
  /** Ids upheld against a rebuttal this round, with the adjudicator's reason. */
  upheld: ReadonlyMap<string, string>;
  /** The reviewer's existing threads, keyed by finding id. */
  threads: ReadonlyMap<string, FindingThread>;
  /** The right-side lines each file exposes in the reviewed diff. */
  anchors: ReadonlyMap<string, Set<number>>;
}

/**
 * Whether the reviewer has already closed this thread — the newest outcome is
 * one that resolves it (`fixed` or `dismissed`), or a `reopened` whose own
 * unresolve may not have landed. An unanswered thread, or one last left
 * `upheld`, was never resolved and needs no reopening.
 */
function closedBefore(thread: FindingThread): boolean {
  const newest = thread.outcomes.at(-1);
  return newest !== undefined && newest !== "upheld";
}

/** Whether `thread`'s newest outcome is already `kind`. */
function answered(thread: FindingThread, kind: ThreadOutcome): boolean {
  return thread.outcomes.at(-1) === kind;
}

/**
 * What the reviewer owes its threads this round.
 *
 * The rules that are easy to get wrong, stated once here rather than spread
 * through the caller:
 *
 * - **Silence means "still open".** An open finding whose thread exists and
 *   whose status did not change gets nothing — a reviewer that re-announces
 *   every finding every push is noise a maintainer learns to ignore.
 * - **A thread is opened on absence, not on newness**, so a finding that could
 *   not be anchored, was rejected, or hit the cap is picked up next round.
 * - **A sticky dismissal is never re-answered.** It was replied to and resolved
 *   in the round it was decided.
 * - **An outcome is not repeated** when it is already the thread's newest, so a
 *   crashed run does not double-reply — while `fixed → reopened → fixed` still
 *   posts all three.
 * - **Only new threads are capped.** Dropping a reply or a resolution would
 *   leave a decided finding looking undecided, which is the failure that
 *   misleads.
 */
export function planThreads(inputs: ThreadInputs): ThreadPlan {
  const plan: ThreadPlan = {
    actions: [],
    resolve: [],
    unresolve: [],
    unanchored: [],
    capped: 0,
  };
  const opens: ThreadAction[] = [];
  for (const finding of inputs.open) {
    const id = finding.id;
    if (id === undefined || id === "") continue;
    const thread = inputs.threads.get(id);
    if (thread === undefined) {
      const anchor = anchorFor(finding, inputs.anchors);
      if (anchor === undefined) plan.unanchored.push(id);
      else opens.push({ id, kind: "open", anchor, finding });
      continue;
    }
    // A finding that was answered and closed, and is live again: say so in its
    // thread and reopen it, rather than leaving it behind a resolved thread
    // where nobody will look.
    //
    // Two triggers, because one alone leaves a hole. `fixedPrior` catches the
    // round the finding comes back in — but this same run then records it open
    // again, so that trigger is gone by the next round. The thread's own
    // outcome history lives on the pull request and therefore survives, which
    // is what retries a reopen that did not land (a refused mutation, or a
    // phase a rate limit halted). Reopening is idempotent, so retrying costs
    // nothing; announcing it twice would be noise, hence the separate check.
    if (inputs.fixedPrior.has(id) || closedBefore(thread)) {
      if (!answered(thread, "reopened")) {
        plan.actions.push({
          id,
          kind: "reply",
          outcome: "reopened",
          rootId: thread.rootId,
          finding,
        });
      }
      plan.unresolve.push({ id, rootId: thread.rootId });
      continue;
    }
    const reason = inputs.upheld.get(id);
    if (reason !== undefined && !answered(thread, "upheld")) {
      plan.actions.push({
        id,
        kind: "reply",
        outcome: "upheld",
        rootId: thread.rootId,
        finding,
        ...(reason !== "" ? { reason } : {}),
      });
    }
  }
  for (const entry of inputs.dismissed) {
    // Dismissed in an earlier round: answered then, and answering again every
    // push would reopen a conversation the maintainer already closed.
    if (inputs.dismissedPrior.has(entry.id)) continue;
    const thread = inputs.threads.get(entry.id);
    if (thread === undefined) continue;
    if (!answered(thread, "dismissed")) {
      plan.actions.push({
        id: entry.id,
        kind: "reply",
        outcome: "dismissed",
        rootId: thread.rootId,
        ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      });
    }
    plan.resolve.push({ id: entry.id, rootId: thread.rootId });
  }
  for (const id of inputs.fixed) {
    if (inputs.fixedPrior.has(id)) continue;
    const thread = inputs.threads.get(id);
    if (thread === undefined) continue;
    if (!answered(thread, "fixed")) {
      plan.actions.push({
        id,
        kind: "reply",
        outcome: "fixed",
        rootId: thread.rootId,
      });
    }
    plan.resolve.push({ id, rootId: thread.rootId });
  }
  // Cap only the new threads, worst findings first, so what is dropped is the
  // least severe and the choice is deterministic across identical runs.
  opens.sort((a, b) =>
    rank(b.finding?.severity ?? "low") - rank(a.finding?.severity ?? "low")
  );
  if (opens.length > MAX_NEW_THREADS) {
    plan.capped = opens.length - MAX_NEW_THREADS;
    opens.length = MAX_NEW_THREADS;
  }
  plan.actions.push(...opens);
  return plan;
}

/**
 * Neutralise a model-supplied value before it is posted into a thread body.
 * A thread comment is written by the reviewer, so text laundered through one
 * would inherit the reviewer's own authorship — the very property the state
 * block's trust rests on. Mirrors the summary comment's own escaping.
 */
function safe(value: string): string {
  return value.replaceAll("<!--", "&lt;!--").replaceAll("-->", "--&gt;");
}

/** Up to ten ids for a note, with a count standing in for the rest. */
export function listIds(ids: readonly string[]): string {
  const shown = ids.slice(0, 10).join(", ");
  return ids.length <= 10 ? shown : `${shown}, +${ids.length - 10} more`;
}

/** The opening body of a finding's thread: what was found, and its id. */
export function threadRootBody(action: ThreadAction): string {
  const finding = action.finding;
  const severity = finding?.severity ?? "low";
  const title = safe(finding?.title ?? "");
  const detail = finding?.detail === undefined
    ? ""
    : `\n\n${safe(finding.detail)}`;
  return `🤖 **[Zuke](https://zuke.build) AI review** — **${severity}**\n\n` +
    `${title}${detail}\n\n` +
    `Reply in this thread to contest it. \`${action.id}\``;
}

/** The reviewer's reply announcing what became of a finding. */
export function threadOutcomeBody(
  outcome: ThreadOutcome,
  reason?: string,
): string {
  const because = reason === undefined || reason === ""
    ? ""
    : ` — ${safe(reason)}`;
  switch (outcome) {
    case "fixed":
      return "✅ **Fixed** — this no longer reproduces against the current diff.";
    case "dismissed":
      return `🚫 **Dismissed via discussion**${because}`;
    case "reopened":
      return "↩️ **Reopened** — reported again against the current diff.";
    case "upheld":
      return `⚠️ **Upheld** — the rebuttal did not hold${because}`;
  }
}
