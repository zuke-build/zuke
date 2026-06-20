/**
 * Coverage-gate internals for {@link DenoTasks.coverage}. `deno coverage` has no
 * built-in fail-under flag, so the wrapper parses the LCOV report it emits and
 * enforces line/branch thresholds on top.
 *
 * Only {@link CoverageThresholdError} is part of the public API (so callers can
 * catch a gate failure); the parsing helpers are internal.
 *
 * @module
 */

/** Raised when measured coverage falls below a configured threshold. */
export class CoverageThresholdError extends Error {
  override name = "CoverageThresholdError";
  constructor(
    /** One human-readable message per metric that fell short. */
    readonly failures: string[],
  ) {
    super(`coverage gate failed: ${failures.join("; ")}`);
  }
}

/** Line and branch percentage floors; an omitted metric is not enforced. */
export interface CoverageThresholds {
  /** Minimum line-coverage percentage (0–100). */
  lines?: number;
  /** Minimum branch-coverage percentage (0–100). */
  branches?: number;
}

interface CoverageTotals {
  linesFound: number;
  linesHit: number;
  branchesFound: number;
  branchesHit: number;
}

/** Sum the LF/LH/BRF/BRH records across every file in an LCOV report. */
export function parseLcov(lcov: string): CoverageTotals {
  const totals: CoverageTotals = {
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

const fmt = (n: number): string => n.toFixed(1);

/**
 * Parse `lcov`, log a one-line coverage summary, and enforce `thresholds`.
 * Returns the metrics that fell short (empty when the gate passes). When there
 * are shortfalls and `throwOnFailure` is set, raises a
 * {@link CoverageThresholdError} instead of returning.
 */
export function enforceCoverage(
  lcov: string,
  thresholds: CoverageThresholds,
  throwOnFailure: boolean,
): string[] {
  const t = parseLcov(lcov);
  const lines = pct(t.linesHit, t.linesFound);
  const branches = pct(t.branchesHit, t.branchesFound);
  console.log(
    `Coverage — lines: ${fmt(lines)}% (${t.linesHit}/${t.linesFound}), ` +
      `branches: ${fmt(branches)}% (${t.branchesHit}/${t.branchesFound})`,
  );

  const failures: string[] = [];
  if (thresholds.lines !== undefined && lines < thresholds.lines) {
    failures.push(`line coverage ${fmt(lines)}% < ${thresholds.lines}%`);
  }
  if (thresholds.branches !== undefined && branches < thresholds.branches) {
    failures.push(
      `branch coverage ${fmt(branches)}% < ${thresholds.branches}%`,
    );
  }

  if (failures.length === 0) {
    console.log("✔ coverage gate passed");
    return failures;
  }
  if (throwOnFailure) throw new CoverageThresholdError(failures);
  console.error(`✘ coverage gate failed: ${failures.join("; ")}`);
  return failures;
}
