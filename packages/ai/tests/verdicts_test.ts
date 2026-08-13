// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { AiReviewError } from "../mod.ts";
import { parseVerdicts } from "../src/verdicts.ts";

Deno.test("parseVerdicts keeps only well-formed, in-vocabulary verdicts", () => {
  const text = JSON.stringify({
    verdicts: [
      { id: "a", verdict: "confirmed", reason: "traced the path" },
      { id: "b", verdict: "refuted" },
      // Fail-safe: an out-of-vocabulary verdict is dropped, not coerced — the
      // finding it targeted stays in its more-visible state.
      { id: "c", verdict: "dismissed" },
      { id: 42, verdict: "confirmed" },
      { verdict: "refuted" },
      "junk",
    ],
  });
  const verdicts = parseVerdicts(text, ["confirmed", "refuted"]);
  assertEquals([...verdicts.keys()], ["a", "b"]);
  assertEquals(verdicts.get("a")?.reason, "traced the path");
  assertEquals(verdicts.get("b")?.reason, undefined);
});

Deno.test("parseVerdicts tolerates fenced JSON and a missing array", () => {
  const fenced = "```json\n" +
    JSON.stringify({ verdicts: [{ id: "x", verdict: "upheld" }] }) + "\n```";
  assertEquals(parseVerdicts(fenced, ["upheld", "dismissed"]).size, 1);
  assertEquals(parseVerdicts("{}", ["upheld"]).size, 0);
  assertEquals(
    parseVerdicts(JSON.stringify({ verdicts: "nope" }), ["upheld"]).size,
    0,
  );
});

Deno.test("parseVerdicts throws AiReviewError on invalid JSON", async () => {
  await assertRejects(
    () => Promise.resolve(parseVerdicts("not json at all", ["confirmed"])),
    AiReviewError,
    "verdict JSON",
  );
});
