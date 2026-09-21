// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  adoptCanonicalIds,
  decidedByMaintainer,
  dedupCapNote,
  dedupNotes,
  eligible,
  MAX_DEDUP_PAIRS,
  MAX_PRIORS_PER_CANDIDATE,
  planDedup,
  sameAs,
} from "../src/dedup.ts";
import type { AssessmentFinding } from "../src/types.ts";
import type { StoredFinding } from "../src/state.ts";
import type { Verdict } from "../src/verdicts.ts";

/** A finding this round reported, with a fresh fingerprint. */
function candidate(
  id: string,
  overrides: Partial<AssessmentFinding> = {},
): AssessmentFinding {
  return {
    title: `finding ${id}`,
    severity: "high",
    file: "src/app.ts",
    id,
    ...overrides,
  };
}

/**
 * A decided entry the review state already holds — refuted by the verifier,
 * so an identity the **model** earned, which the same-file rule and the
 * severity ceiling apply to. A maintainer's decision is the lenient case and
 * is spelled out where a test is about it.
 */
function prior(
  id: string,
  overrides: Partial<StoredFinding> = {},
): StoredFinding {
  return {
    id,
    title: `prior ${id}`,
    severity: "high",
    status: "refuted",
    file: "src/app.ts",
    ...overrides,
  };
}

/** A finding a maintainer dismissed through the discussion. */
function dismissed(
  id: string,
  overrides: Partial<StoredFinding> = {},
): StoredFinding {
  return prior(id, {
    status: "dismissed",
    rationale: "argued away",
    author: "maintainer",
    ...overrides,
  });
}

/** The verdict map a pass would return for these labels. */
function verdicts(...entries: Array<[string, string]>): Map<string, Verdict> {
  return new Map(
    entries.map(([id, verdict]) => [id, { id, verdict }]),
  );
}

Deno.test("planDedup offers a model-earned identity only to a same-file candidate", () => {
  const plan = planDedup(
    [candidate("c1"), candidate("c2", { file: "src/other.ts" })],
    [prior("p1"), prior("p2", { file: "src/other.ts" })],
  );
  // Each candidate is offered against its own file's prior — never across.
  assertEquals(plan.pairs.length, 2);
  for (const pair of plan.pairs) {
    assertEquals(pair.candidate.file, pair.prior.file);
  }
});

Deno.test("planDedup skips a model-earned pair when either side has no file", () => {
  // Without a file there is no "same place", so there is nothing to match on.
  assertEquals(
    planDedup([candidate("c1", { file: undefined })], [prior("p1")]).pairs,
    [],
  );
  assertEquals(
    planDedup([candidate("c1")], [prior("p1", { file: undefined })]).pairs,
    [],
  );
});

Deno.test("planDedup refuses to let a lower-severity refutation cover a higher one", () => {
  // A refuted `low` nit must not launder a `critical` finding into silence.
  assertEquals(
    planDedup(
      [candidate("c1", { severity: "critical" })],
      [prior("p1", { severity: "low" })],
    ).pairs,
    [],
  );
  // The reverse is fine: inheriting a decision made about something worse.
  assertEquals(
    planDedup(
      [candidate("c1", { severity: "low" })],
      [prior("p1", { severity: "critical" })],
    ).pairs.length,
    1,
  );
});

Deno.test("planDedup ignores a candidate with no identity of its own", () => {
  for (const id of [undefined, ""]) {
    assertEquals(
      planDedup([candidate("c1", { id })], [prior("p1")]).pairs,
      [],
    );
  }
});

Deno.test("planDedup drops the deepest comparisons first and counts them", () => {
  const candidates = [candidate("c1"), candidate("c2"), candidate("c3")];
  const priors = ["p1", "p2", "p3", "p4", "p5"].map((id) => prior(id));
  const plan = planDedup(candidates, priors, new Set(), 4);
  assertEquals(plan.pairs.length, 4);
  assertEquals(plan.dropped, 15 - 4); // 3 × 5 eligible, 4 compared
  // Round-robin: every candidate gets its first comparison before any second.
  assertEquals(
    plan.pairs.slice(0, 3).map((p) => p.candidate.id),
    ["c1", "c2", "c3"],
  );
});

Deno.test("planDedup caps the priors any one candidate is compared against", () => {
  const priors = ["p1", "p2", "p3", "p4", "p5"].map((id) => prior(id));
  const plan = planDedup(
    [candidate("c1")],
    priors,
    new Set(),
    MAX_DEDUP_PAIRS,
    2,
  );
  assertEquals(plan.pairs.length, 2);
  assertEquals(plan.dropped, 3); // the per-candidate cap's drops are counted too
});

Deno.test("planDedup labels are opaque ordinals carrying no finding text", () => {
  const plan = planDedup(
    [candidate("c1", { title: "secret title" })],
    [prior("p1"), prior("p2")],
  );
  assertEquals(plan.pairs.map((p) => p.label), ["p1", "p2"]);
  for (const pair of plan.pairs) {
    assertEquals(pair.label.includes("secret"), false);
    assertEquals(pair.label.includes(pair.candidate.id ?? ""), false);
  }
});

Deno.test("planDedup is deterministic for the same inputs", () => {
  const build = () =>
    planDedup(
      [candidate("c1"), candidate("c2")],
      [prior("p1"), prior("p2")],
    );
  assertEquals(
    build().pairs.map((p) => `${p.label}:${p.candidate.id}:${p.prior.id}`),
    build().pairs.map((p) => `${p.label}:${p.candidate.id}:${p.prior.id}`),
  );
});

Deno.test("dedupCapNote stays silent only when everything was compared", () => {
  const plan = planDedup([candidate("c1")], [prior("p1")]);
  assertEquals(dedupCapNote(plan), undefined);
  const capped = planDedup(
    [candidate("c1")],
    [prior("p1"), prior("p2"), prior("p3")],
    new Set(),
    1,
  );
  const note = dedupCapNote(capped);
  assertEquals(note?.includes("compared 1 of 3"), true);
  assertEquals(note?.includes("keeps its own identity"), true);
});

Deno.test("sameAs ignores a label the pass never offered", () => {
  const plan = planDedup([candidate("c1")], [prior("p1")]);
  // A fabricated ordinal, a composite of the two real ids, and an empty key:
  // the pair is recovered by lookup, so none of them names anything.
  const forged = verdicts(
    ["p99", "same"],
    ["c1:p1", "same"],
    ["", "same"],
  );
  assertEquals(sameAs(plan, forged).matches.size, 0);
});

Deno.test("sameAs leaves the candidate alone on anything but an explicit match", () => {
  const plan = planDedup([candidate("c1")], [prior("p1")]);
  assertEquals(sameAs(plan, verdicts(["p1", "different"])).matches.size, 0);
  assertEquals(sameAs(plan, new Map()).matches.size, 0); // no verdict at all
});

Deno.test("sameAs keeps the first match and reports the ambiguity", () => {
  const plan = planDedup([candidate("c1")], [prior("p1"), prior("p2")]);
  const resolved = sameAs(plan, verdicts(["p1", "same"], ["p2", "same"]));
  assertEquals(resolved.matches.get("c1")?.id, "p1");
  assertEquals(resolved.ambiguous, ["c1"]);
});

Deno.test("sameAs never collapses two findings onto one identity", () => {
  // Both candidates are matched to the same earlier finding; only one may take
  // it, or a single rebuttal would dismiss two distinct concerns at once.
  const plan = planDedup([candidate("c1"), candidate("c2")], [prior("p1")]);
  const resolved = sameAs(plan, verdicts(["p1", "same"], ["p2", "same"]));
  assertEquals(resolved.matches.size, 1);
  assertEquals(resolved.matches.get("c1")?.id, "p1");
});

Deno.test("adoptCanonicalIds renames the finding and reports the alias", () => {
  const findings = [candidate("c1")];
  const adoptions = adoptCanonicalIds(
    findings,
    new Map([["c1", prior("p1")]]),
  );
  assertEquals(findings[0].id, "p1"); // the finding now carries the old identity
  assertEquals(adoptions.length, 1);
  assertEquals(adoptions[0].alias, "c1");
  assertEquals(adoptions[0].prior.id, "p1");
});

Deno.test("adoptCanonicalIds refuses an id another finding already holds", () => {
  // The model reported both the original wording and a rewording of it. Taking
  // the identity would leave two findings on one id: one state entry, one
  // report row, and one rebuttal dismissing both.
  const findings = [candidate("p1"), candidate("c2")];
  const adoptions = adoptCanonicalIds(
    findings,
    new Map([["c2", prior("p1")]]),
  );
  assertEquals(adoptions, []);
  assertEquals(findings.map((f) => f.id), ["p1", "c2"]); // both keep their own
});

Deno.test("adoptCanonicalIds is a no-op without matches", () => {
  const findings = [candidate("c1")];
  assertEquals(adoptCanonicalIds(findings, new Map()), []);
  assertEquals(findings[0].id, "c1");
});

Deno.test("dedupNotes carries text and file but never status or ids", () => {
  const plan = planDedup(
    [candidate("c1", { title: "new wording", detail: "the detail" })],
    [prior("p1", { title: "old wording" })],
  );
  const notes = dedupNotes(plan);
  assertEquals(notes.length, 1);
  assertEquals(notes[0].label, "p1");
  assertEquals(notes[0].file, "src/app.ts");
  assertEquals(notes[0].title, "new wording");
  assertEquals(notes[0].detail, "the detail");
  assertEquals(notes[0].priorTitle, "old wording");
  // Telling the model the earlier finding was dismissed would bias it toward
  // the answer that silences; the ids would let it address them directly.
  const serialised = JSON.stringify(notes);
  assertEquals(serialised.includes("dismissed"), false);
  assertEquals(serialised.includes("c1"), false);
  assertEquals(serialised.includes("high"), false);
});

Deno.test("dedupNotes bounds the text it carries", () => {
  const plan = planDedup(
    [candidate("c1", { title: "t".repeat(9000), detail: "d".repeat(9000) })],
    [prior("p1", { title: "p".repeat(9000) })],
  );
  const notes = dedupNotes(plan);
  assertEquals(notes[0].title.length <= 241, true);
  assertEquals((notes[0].detail ?? "").length <= 481, true);
  assertEquals(notes[0].priorTitle.length <= 241, true);
});

Deno.test("a candidate is decided by its first match, never demoted to a second", () => {
  // Pairs are offered fixed-entry first so a candidate matching both reopens
  // rather than inheriting the model's refutation. If a candidate could fall
  // through to its next match when the first prior is already taken, that
  // preference would reverse — and the finding would be silenced instead of
  // reported.
  const fixed = prior("fx", { status: "fixed" });
  const refuted = prior("rx");
  const plan = planDedup(
    [candidate("c1"), candidate("c2")],
    [fixed, refuted],
  );
  // An over-matching model answers "same" to everything.
  const resolved = sameAs(
    plan,
    verdicts(...plan.pairs.map((p): [string, string] => [p.label, "same"])),
  );
  assertEquals(resolved.matches.get("c1")?.id, "fx");
  // c2's first match was the fixed entry, already claimed — so it keeps its own
  // identity and is reported, rather than sliding onto the refutation.
  assertEquals(resolved.matches.has("c2"), false);
  assertEquals(resolved.ambiguous.includes("c2"), true); // and it is surfaced
});

Deno.test("eligible is the one gate both resolution paths share", () => {
  // The free path resolves by fingerprint, which encodes kind, title and file
  // but NOT severity — so the same wording can return more severe than the
  // decision its alias points at. Both paths must consult this. These are the
  // model-earned rules; a maintainer's decision is exempt, tested below.
  assertEquals(
    eligible(
      candidate("c1", { severity: "critical" }),
      prior("p1", { severity: "low" }),
    ),
    false,
  );
  assertEquals(
    eligible(
      candidate("c1", { severity: "low" }),
      prior("p1", { severity: "critical" }),
    ),
    true,
  );
  assertEquals(
    eligible(candidate("c1", { file: "other.ts" }), prior("p1")),
    false,
  );
});

Deno.test("dedupNotes carries an empty file for a hand-built file-less pair", () => {
  // planDedup never offers a file-less pair, but the serializer is its own
  // contract: a missing file travels as "", never as the string "undefined".
  const notes = dedupNotes({
    pairs: [{
      label: "p1",
      candidate: candidate("c1", { file: undefined, detail: "why" }),
      prior: prior("p1"),
    }],
    dropped: 0,
  });
  assertEquals(notes, [{
    label: "p1",
    file: "",
    title: "finding c1",
    detail: "why",
    priorTitle: "prior p1",
    priorFile: "src/app.ts", // differs from the candidate's none, so it travels
  }]);
});

Deno.test("planDedup round-robins past a candidate with fewer matches", () => {
  // c1 has two eligible priors, c2 (in another file) has one. At depth two the
  // round-robin must skip c2's exhausted list and still offer c1's second pair.
  const plan = planDedup(
    [candidate("c1"), candidate("c2", { file: "src/other.ts" })],
    [prior("p1"), prior("p2"), prior("p3", { file: "src/other.ts" })],
  );
  assertEquals(
    plan.pairs.map((p) => [p.candidate.id, p.prior.id]),
    [["c1", "p1"], ["c2", "p3"], ["c1", "p2"]],
  );
  assertEquals(plan.dropped, 0);
});

Deno.test("sameAs ignores a hand-built pair whose candidate has no identity", () => {
  // A pair can only enter a plan through planDedup today, but sameAs guards its
  // own input: without a candidate id there is nothing to rename, so a "same"
  // verdict on such a pair must resolve nothing.
  for (const id of [undefined, ""]) {
    const plan = {
      pairs: [{
        label: "p1",
        candidate: candidate("c1", { id }),
        prior: prior("p1"),
      }],
      dropped: 0,
    };
    const result = sameAs(plan, verdicts(["p1", "same"]));
    assertEquals(result.matches.size, 0);
    assertEquals(result.ambiguous, []);
  }
});

Deno.test("adoptCanonicalIds skips a finding that has no id at all", () => {
  const bare = candidate("c1", { id: undefined });
  const matched = candidate("c2");
  const target = prior("p1");
  const adoptions = adoptCanonicalIds(
    [bare, matched],
    new Map([["c2", target]]),
  );
  // Only the identified finding adopts; the bare one is left untouched.
  assertEquals(adoptions, [{ alias: "c2", prior: target }]);
  assertEquals(matched.id, "p1");
  assertEquals(bare.id, undefined);
});

Deno.test("a dismissal is inherited across the files of the diff", () => {
  // The escape on #634: one concern about a change, dismissed on one file,
  // came back on each other file the change touched — a fresh id each time.
  // A maintainer decided the concern, not the file it was pinned to.
  const plan = planDedup(
    [candidate("c1", { file: "src/other.ts" })],
    [dismissed("d1")],
  );
  assertEquals(plan.pairs.length, 1);
  assertEquals(plan.pairs[0].prior.id, "d1");
  // Even a file-less candidate or prior: the file is not the identity.
  assertEquals(
    planDedup([candidate("c1", { file: undefined })], [dismissed("d1")])
      .pairs.length,
    1,
  );
  assertEquals(
    planDedup([candidate("c1")], [dismissed("d1", { file: undefined })])
      .pairs.length,
    1,
  );
});

Deno.test("a dismissal is inherited at any severity", () => {
  // The other escape on #634: low, then medium, then high — each one step
  // above the ceiling of the dismissal it restated. The label the model puts
  // on a decided concern does not reopen it.
  const plan = planDedup(
    [candidate("c1", { severity: "critical" })],
    [dismissed("d1", { severity: "low" })],
  );
  assertEquals(plan.pairs.length, 1);
  assertEquals(
    eligible(
      candidate("c1", { severity: "critical", file: "elsewhere.ts" }),
      dismissed("d1", { severity: "low" }),
    ),
    true,
  );
});

Deno.test("an accepted finding is a maintainer's decision like a dismissal", () => {
  const accepted = prior("a1", { status: "accepted", author: "maintainer" });
  assertEquals(decidedByMaintainer(accepted, new Set()), true);
  assertEquals(
    planDedup(
      [candidate("c1", { severity: "critical", file: "src/other.ts" })],
      [accepted],
    ).pairs.length,
    1,
  );
});

Deno.test("a still-open finding a maintainer contested is lenient for this round", () => {
  // The run that adjudicates a rebuttal is the run the model restates the
  // finding in — one severity up, on the same line — so the restatement must
  // land on the identity the rebuttal names, or the rebuttal answers nothing.
  const open = prior("o1", { status: "open", severity: "low" });
  const contested = new Set(["o1"]);
  assertEquals(decidedByMaintainer(open, contested), true);
  assertEquals(decidedByMaintainer(open, new Set()), false);
  const escalated = candidate("c1", { severity: "high" });
  assertEquals(planDedup([escalated], [open]).pairs.length, 0);
  assertEquals(planDedup([escalated], [open], contested).pairs.length, 1);
});

Deno.test("refuted and fixed identities keep the same-file rule and the ceiling", () => {
  for (const status of ["refuted", "fixed", "open", "upheld"] as const) {
    const earned = prior("e1", { status, severity: "low" });
    assertEquals(decidedByMaintainer(earned, new Set()), false);
    assertEquals(
      planDedup([candidate("c1", { file: "src/other.ts", severity: "low" })], [
        earned,
      ]).pairs.length,
      0,
      `${status}: across files`,
    );
    assertEquals(
      planDedup([candidate("c1", { severity: "high" })], [earned]).pairs
        .length,
      0,
      `${status}: above the ceiling`,
    );
  }
});

Deno.test("maintainer-decided priors are offered first and outside the per-candidate cap", () => {
  // Six dismissals on record, as #634 had: with a cap of three the one
  // comparison that ends the loop must never be the one dropped for budget.
  const decided = ["d1", "d2", "d3", "d4", "d5", "d6"].map((id) =>
    dismissed(id)
  );
  const earned = ["r1", "r2", "r3", "r4"].map((id) => prior(id));
  const plan = planDedup([candidate("c1")], [...earned, ...decided]);
  const offered = plan.pairs.map((p) => p.prior.id);
  // Every dismissal, ahead of the model's own refutations, which are capped.
  assertEquals(offered.slice(0, 6), ["d1", "d2", "d3", "d4", "d5", "d6"]);
  assertEquals(offered.length, 6 + MAX_PRIORS_PER_CANDIDATE);
  assertEquals(plan.dropped, 4 - MAX_PRIORS_PER_CANDIDATE);
  // Only the pass-wide cap still bounds them, and it says so.
  const capped = planDedup([candidate("c1")], decided, new Set(), 2);
  assertEquals(capped.pairs.map((p) => p.prior.id), ["d1", "d2"]);
  assertEquals(capped.dropped, 4);
});

Deno.test("dedupNotes carries the earlier file only when it differs", () => {
  const same = dedupNotes(planDedup([candidate("c1")], [dismissed("d1")]));
  assertEquals(same[0].priorFile, undefined);
  const across = dedupNotes(
    planDedup(
      [candidate("c1", { file: "src/other.ts", title: "new wording" })],
      [dismissed("d1", { title: "old wording" })],
    ),
  );
  assertEquals(across[0].file, "src/other.ts");
  assertEquals(across[0].priorFile, "src/app.ts");
  // Still no status, id or severity travels with it.
  const serialised = JSON.stringify(across);
  assertEquals(serialised.includes("dismissed"), false);
  assertEquals(serialised.includes("c1"), false);
});
