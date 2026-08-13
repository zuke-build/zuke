// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  adoptCanonicalIds,
  dedupCapNote,
  dedupNotes,
  eligible,
  MAX_DEDUP_PAIRS,
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

/** A decided entry the review state already holds. */
function prior(
  id: string,
  overrides: Partial<StoredFinding> = {},
): StoredFinding {
  return {
    id,
    title: `prior ${id}`,
    severity: "high",
    status: "dismissed",
    file: "src/app.ts",
    ...overrides,
  };
}

/** The verdict map a pass would return for these labels. */
function verdicts(...entries: Array<[string, string]>): Map<string, Verdict> {
  return new Map(
    entries.map(([id, verdict]) => [id, { id, verdict }]),
  );
}

Deno.test("planDedup offers only same-file pairs", () => {
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

Deno.test("planDedup skips a pair when either side has no file", () => {
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

Deno.test("planDedup refuses to let a lower-severity decision cover a higher one", () => {
  // A dismissed `low` nit must not launder a `critical` finding into silence.
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
  const plan = planDedup(candidates, priors, 4);
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
  const plan = planDedup([candidate("c1")], priors, MAX_DEDUP_PAIRS, 2);
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
  // rather than inheriting a dismissal. If a candidate could fall through to
  // its next match when the first prior is already taken, that preference
  // would reverse — and the finding would be silenced instead of reported.
  const fixed = prior("fx", { status: "fixed" });
  const dismissed = prior("dx", { status: "dismissed" });
  const plan = planDedup(
    [candidate("c1"), candidate("c2")],
    [fixed, dismissed],
  );
  // An over-matching model answers "same" to everything.
  const resolved = sameAs(
    plan,
    verdicts(...plan.pairs.map((p): [string, string] => [p.label, "same"])),
  );
  assertEquals(resolved.matches.get("c1")?.id, "fx");
  // c2's first match was the fixed entry, already claimed — so it keeps its own
  // identity and is reported, rather than sliding onto the dismissal.
  assertEquals(resolved.matches.has("c2"), false);
  assertEquals(resolved.ambiguous.includes("c2"), true); // and it is surfaced
});

Deno.test("eligible is the one gate both resolution paths share", () => {
  // The free path resolves by fingerprint, which encodes kind, title and file
  // but NOT severity — so the same wording can return more severe than the
  // decision its alias points at. Both paths must consult this.
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
