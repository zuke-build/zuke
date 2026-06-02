#!/usr/bin/env -S deno run --allow-read
/**
 * Coverage gate. Parses an LCOV report and fails (exit 1) if line or branch
 * coverage falls below a threshold. `deno coverage` has no built-in fail-under
 * flag, so we enforce it here and wire it into CI.
 *
 * Usage:
 *   deno test -A --coverage=cov_profile
 *   deno coverage cov_profile --lcov --exclude=tests/ --output=cov.lcov
 *   deno run --allow-read scripts/check-coverage.ts [cov.lcov] [threshold]
 */

interface Totals {
  linesFound: number;
  linesHit: number;
  branchesFound: number;
  branchesHit: number;
}

/** Sum the LF/LH/BRF/BRH records across every file in an LCOV report. */
function parseLcov(lcov: string): Totals {
  const totals: Totals = {
    linesFound: 0,
    linesHit: 0,
    branchesFound: 0,
    branchesHit: 0,
  };
  for (const line of lcov.split("\n")) {
    const [tag, value] = line.split(":", 2);
    const n = Number(value);
    if (Number.isNaN(n)) continue;
    switch (tag) {
      case "LF":
        totals.linesFound += n;
        break;
      case "LH":
        totals.linesHit += n;
        break;
      case "BRF":
        totals.branchesFound += n;
        break;
      case "BRH":
        totals.branchesHit += n;
        break;
    }
  }
  return totals;
}

/** Percentage hit/found; 100 when nothing was found (vacuously covered). */
function pct(hit: number, found: number): number {
  return found === 0 ? 100 : (hit / found) * 100;
}

function main(): number {
  const path = Deno.args[0] ?? "cov.lcov";
  const threshold = Number(Deno.args[1] ?? "95");

  let lcov: string;
  try {
    lcov = Deno.readTextFileSync(path);
  } catch {
    console.error(`✘ coverage: could not read LCOV report at "${path}".`);
    return 1;
  }

  const t = parseLcov(lcov);
  const linePct = pct(t.linesHit, t.linesFound);
  const branchPct = pct(t.branchesHit, t.branchesFound);

  const fmt = (n: number) => n.toFixed(1);
  console.log(
    `Coverage — lines: ${fmt(linePct)}% (${t.linesHit}/${t.linesFound}), ` +
      `branches: ${fmt(branchPct)}% (${t.branchesHit}/${t.branchesFound})`,
  );

  const failures: string[] = [];
  if (linePct < threshold) {
    failures.push(`line coverage ${fmt(linePct)}% < ${threshold}%`);
  }
  if (branchPct < threshold) {
    failures.push(`branch coverage ${fmt(branchPct)}% < ${threshold}%`);
  }

  if (failures.length > 0) {
    console.error(`✘ coverage gate failed: ${failures.join("; ")}`);
    return 1;
  }
  console.log(`✔ coverage gate passed (threshold ${threshold}%)`);
  return 0;
}

if (import.meta.main) {
  Deno.exit(main());
}

export { parseLcov, pct };
