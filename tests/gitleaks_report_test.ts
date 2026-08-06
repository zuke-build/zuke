/**
 * Unit tests for the gitleaks report formatter — the job-summary section that
 * replaced the workflow's artifact upload.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../packages/core/tests/_assert.ts";
import {
  gitleaksSummary,
  parseGitleaksReport,
} from "../build/gitleaks_report.ts";

/** One finding in gitleaks' own capitalised JSON shape. */
const FINDING = {
  RuleID: "generic-api-key",
  File: "src/config.ts",
  StartLine: 42,
  Commit: "0123456789abcdef0123",
  Fingerprint: "src/config.ts:generic-api-key:42",
  Secret: "REDACTED",
};

Deno.test("a clean scan parses to no findings, however it is written", () => {
  // gitleaks writes `[]` on a clean scan; an absent report reaches us as "".
  assertEquals(parseGitleaksReport("[]"), []);
  assertEquals(parseGitleaksReport(""), []);
  assertEquals(parseGitleaksReport("   \n"), []);
  assertEquals(parseGitleaksReport("null"), []);
});

Deno.test("a finding is read from gitleaks' field names", () => {
  assertEquals(parseGitleaksReport(JSON.stringify([FINDING])), [{
    rule: "generic-api-key",
    file: "src/config.ts",
    line: 42,
    commit: "0123456789abcdef0123",
    fingerprint: "src/config.ts:generic-api-key:42",
  }]);
});

Deno.test("the lower-cased field spelling is read too", () => {
  const lower = [{
    ruleID: "aws-access-key",
    file: "deploy.sh",
    startLine: 7,
    commit: "abc",
    fingerprint: "fp",
  }];
  assertEquals(parseGitleaksReport(JSON.stringify(lower))[0], {
    rule: "aws-access-key",
    file: "deploy.sh",
    line: 7,
    commit: "abc",
    fingerprint: "fp",
  });
});

Deno.test("an unparseable report throws rather than reading as clean", () => {
  // The dangerous failure mode: a truncated or non-array report silently
  // becoming "no findings" would turn a failed scan into a passing one.
  assertThrows(
    () => parseGitleaksReport("[{ truncated"),
    Error,
    "not valid JSON",
  );
  assertThrows(
    () => parseGitleaksReport('{"findings": []}'),
    Error,
    "not a JSON array",
  );
});

Deno.test("a clean scan renders no summary section at all", () => {
  // A "nothing found" panel on every green run is noise; the build's own table
  // already reports that the scan passed.
  assertEquals(gitleaksSummary([]), null);
});

Deno.test("the summary names the location, the rule, and the fingerprint", () => {
  const summary = gitleaksSummary(
    parseGitleaksReport(JSON.stringify([FINDING])),
  );
  if (summary === null) throw new Error("expected a summary");
  assertStringIncludes(summary, "## 🔑 gitleaks — 1 finding");
  assertStringIncludes(summary, "`src/config.ts`");
  assertStringIncludes(summary, "| 42 |");
  assertStringIncludes(summary, "`generic-api-key`");
  assertStringIncludes(summary, "src/config.ts:generic-api-key:42");
  // The commit is abbreviated, and the secret itself never appears.
  assertStringIncludes(summary, "`0123456789ab`");
  assertEquals(summary.includes("REDACTED"), false);
});

Deno.test("the count is pluralised and a missing line renders as a dash", () => {
  const summary = gitleaksSummary([
    { rule: "a", file: "x", line: 0, commit: "", fingerprint: "f1" },
    { rule: "b", file: "y", line: 3, commit: "c", fingerprint: "f2" },
  ]);
  if (summary === null) throw new Error("expected a summary");
  assertStringIncludes(summary, "2 findings");
  assertStringIncludes(summary, "| — |");
});

Deno.test("a pipe in a value cannot break out of the table cell", () => {
  const summary = gitleaksSummary([
    { rule: "r", file: "a|b.ts", line: 1, commit: "c", fingerprint: "f" },
  ]);
  if (summary === null) throw new Error("expected a summary");
  assertStringIncludes(summary, "a\\|b.ts");
});

Deno.test("a backtick in a path cannot end its code span early", () => {
  // A path may contain a backtick, and this table is the only place a failing
  // scan reports where a secret is — a row garbled by its own filename would
  // hide the location it exists to show.
  const summary = gitleaksSummary([
    { rule: "r", file: "we`ird.ts", line: 1, commit: "c", fingerprint: "f" },
  ]);
  if (summary === null) throw new Error("expected a summary");
  // Delimited by two backticks, so the single one inside cannot close it.
  assertStringIncludes(summary, "``we`ird.ts``");
  // The row still has exactly five cells: the span never leaked into the table.
  const row = summary.split("\n").find((l) => l.includes("we`ird.ts"));
  assertEquals(row?.split("|").length, 7); // 5 cells + the leading/trailing pipes
});

Deno.test("a value that begins or ends with a backtick is padded, not broken", () => {
  const summary = gitleaksSummary([
    { rule: "r", file: "`quoted`", line: 1, commit: "c", fingerprint: "f" },
  ]);
  if (summary === null) throw new Error("expected a summary");
  // CommonMark strips one leading and trailing space, so the padding keeps the
  // span valid without changing what a reader sees.
  assertStringIncludes(summary, "`` `quoted` ``");
});

Deno.test("a run of backticks is out-sized by the delimiter", () => {
  const summary = gitleaksSummary([
    { rule: "a``b", file: "f.ts", line: 1, commit: "c", fingerprint: "f" },
  ]);
  if (summary === null) throw new Error("expected a summary");
  assertStringIncludes(summary, "```a``b```");
});
