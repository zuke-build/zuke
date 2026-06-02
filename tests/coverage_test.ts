import { assertEquals } from "./_assert.ts";
import { parseLcov, pct } from "../scripts/check-coverage.ts";

Deno.test("parseLcov sums LF/LH/BRF/BRH across files", () => {
  const lcov = [
    "SF:a.ts",
    "FNF:2",
    "FNH:2",
    "BRF:4",
    "BRH:3",
    "LF:10",
    "LH:9",
    "end_of_record",
    "SF:b.ts",
    "BRF:6",
    "BRH:6",
    "LF:20",
    "LH:20",
    "end_of_record",
  ].join("\n");

  const totals = parseLcov(lcov);
  assertEquals(totals.linesFound, 30);
  assertEquals(totals.linesHit, 29);
  assertEquals(totals.branchesFound, 10);
  assertEquals(totals.branchesHit, 9);
});

Deno.test("pct computes percentages and treats zero-found as 100", () => {
  assertEquals(pct(9, 10), 90);
  assertEquals(pct(0, 0), 100);
  assertEquals(pct(1, 4), 25);
});
