import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import {
  CoverageThresholdError,
  enforceCoverage,
  parseLcov,
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

Deno.test("enforceCoverage treats zero-found as fully covered", () => {
  assertEquals(
    enforceCoverage("LF:0\nLH:0\n", { lines: 100, branches: 100 }, true),
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
