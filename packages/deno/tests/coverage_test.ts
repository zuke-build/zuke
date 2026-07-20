import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import {
  CoverageThresholdError,
  enforceCoverage,
  parseLcov,
  parseLcovPerFile,
} from "../src/coverage.ts";
import { DenoTasks } from "../src/deno.ts";

Deno.test("parseLcov sums LF/LH/BRF/BRH across files, skipping other tags", () => {
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
  const t = parseLcov(lcov);
  assertEquals(t, {
    linesFound: 30,
    linesHit: 29,
    branchesFound: 10,
    branchesHit: 9,
  });
});

Deno.test("enforceCoverage passes when metrics meet the thresholds", () => {
  assertEquals(
    enforceCoverage("LF:10\nLH:10\nBRF:4\nBRH:4\n", {
      lines: 95,
      branches: 95,
    }, true),
    [],
  );
});

Deno.test("enforceCoverage fails when no data was measured (an empty report)", () => {
  // An empty report is not 100% covered — nothing ran. A gated metric with zero
  // found must fail, not pass vacuously.
  const err = assertThrows(
    () =>
      enforceCoverage(
        "LF:0\nLH:0\nBRF:0\nBRH:0\n",
        { lines: 95, branches: 95 },
        true,
      ),
    CoverageThresholdError,
    "no coverage data measured",
  );
  if (err instanceof CoverageThresholdError) {
    assertEquals(err.failures.length, 1); // one clear "nothing measured" message
  }
});

Deno.test("enforceCoverage passes branchless code that is fully line-covered", () => {
  // A module with no conditionals reports BRF:0. Under a combined threshold that
  // must NOT fail as "no branch data" — the branch score is vacuously 100%.
  assertEquals(
    enforceCoverage(
      "SF:a.ts\nLF:5\nLH:5\nBRF:0\nBRH:0\nend_of_record\n",
      { lines: 95, branches: 95 },
      true,
    ),
    [],
  );
});

Deno.test("enforceCoverage throws on a line shortfall", () => {
  const err = assertThrows(
    () => enforceCoverage("LF:10\nLH:5\n", { lines: 90 }, true),
    CoverageThresholdError,
    "line coverage",
  );
  assertEquals((err as CoverageThresholdError).failures.length, 1);
});

Deno.test("enforceCoverage throws on a branch shortfall", () => {
  assertThrows(
    () => enforceCoverage("BRF:10\nBRH:5\n", { branches: 90 }, true),
    CoverageThresholdError,
    "branch coverage",
  );
});

Deno.test("enforceCoverage returns failures instead of throwing when not enforcing", () => {
  const failures = enforceCoverage(
    "LF:10\nLH:5\nBRF:10\nBRH:5\n",
    { lines: 90, branches: 90 },
    false,
  );
  assertEquals(failures.length, 2);
});

Deno.test("parseLcovPerFile splits totals per file, keeping colon-bearing paths", () => {
  const lcov = [
    "SF:C:/win/a.ts", // a Windows drive path — the colon must survive
    "LF:10",
    "LH:9",
    "BRF:2",
    "BRH:1",
    "end_of_record",
    "SF:b.ts",
    "LF:4",
    "LH:4",
    "end_of_record",
  ].join("\n");
  const files = parseLcovPerFile(lcov);
  assertEquals(files.length, 2);
  assertEquals(files[0].file, "C:/win/a.ts");
  assertEquals(files[0].linesFound, 10);
  assertEquals(files[0].linesHit, 9);
  assertEquals(files[1].file, "b.ts");
  assertEquals(files[1].linesHit, 4);
});

Deno.test("the per-file floor fails a single low file even when the aggregate passes", () => {
  // Aggregate is 90/100 = 90% (passes a 90 line gate), but one file is at 20%.
  const lcov = [
    "SF:good.ts",
    "LF:90",
    "LH:88",
    "end_of_record",
    "SF:bad.ts",
    "LF:10",
    "LH:2",
    "end_of_record",
  ].join("\n");
  const err = assertThrows(
    () => enforceCoverage(lcov, { lines: 90, perFile: 50 }, true),
    CoverageThresholdError,
    "per-file line floor",
  );
  if (err instanceof CoverageThresholdError) {
    // Only the aggregate-passing-but-file-failing case trips: bad.ts (20%).
    assertEquals(err.failures.length, 1);
    assertStringIncludes(err.failures[0], "bad.ts");
  }
});

Deno.test("the per-file floor skips files with no measurable lines", () => {
  const lcov = [
    "SF:types.ts", // a declaration-only file: zero lines found
    "LF:0",
    "LH:0",
    "end_of_record",
    "SF:code.ts",
    "LF:10",
    "LH:10",
    "end_of_record",
  ].join("\n");
  assertEquals(enforceCoverage(lcov, { perFile: 80 }, true), []); // no failure
});

/**
 * Build a real coverage profile from a tiny module with one branch. When
 * `covered` is false the negative branch is never exercised, so both line and
 * branch coverage fall below 100%.
 */
async function makeProfile(
  covered: boolean,
): Promise<{ dir: string; profile: string }> {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/mod.ts`,
    "export function sign(n: number): string {\n" +
      '  if (n >= 0) return "pos";\n' +
      '  return "neg";\n' +
      "}\n",
  );
  const checks = covered
    ? '  if (sign(1) !== "pos") throw new Error("x");\n' +
      '  if (sign(-1) !== "neg") throw new Error("y");'
    : '  if (sign(1) !== "pos") throw new Error("x");';
  await Deno.writeTextFile(
    `${dir}/mod_test.ts`,
    `import { sign } from "./mod.ts";\n` +
      `Deno.test("sign", () => {\n${checks}\n});\n`,
  );
  const profile = `${dir}/profile`;
  await new Deno.Command(Deno.execPath(), {
    args: ["test", "-A", `--coverage=${profile}`, dir],
    stdout: "null",
    stderr: "null",
  }).output();
  return { dir, profile };
}

Deno.test("coverage passes above the threshold, reading the output file", async () => {
  const { dir, profile } = await makeProfile(true);
  try {
    const out = await DenoTasks.coverage((s) =>
      s.dir(profile).output(`${dir}/c.lcov`).threshold(100).quiet()
    );
    assertEquals(out.code, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("coverage throws below the threshold, reading stdout", async () => {
  const { dir, profile } = await makeProfile(false);
  try {
    await assertRejects(
      () => DenoTasks.coverage((s) => s.dir(profile).threshold(100)),
      CoverageThresholdError,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("coverage with noThrow reports a shortfall without throwing", async () => {
  const { dir, profile } = await makeProfile(false);
  try {
    const out = await DenoTasks.coverage((s) =>
      s.dir(profile).threshold(100).noThrow().quiet()
    );
    assertEquals(out.code, 0); // deno coverage itself succeeded
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a per-file floor alone gates the run and fails a low file", async () => {
  // No aggregate threshold — only .perFileThreshold(). It must still force
  // --lcov and enforce, so the under-covered single file trips the gate.
  const { dir, profile } = await makeProfile(false);
  try {
    await assertRejects(
      () => DenoTasks.coverage((s) => s.dir(profile).perFileThreshold(100)),
      CoverageThresholdError,
      "per-file line floor",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
