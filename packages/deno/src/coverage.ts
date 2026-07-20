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
  /** The error name, `"CoverageThresholdError"`. */
  override name = "CoverageThresholdError";
  /** Construct the error from one message per metric that fell short. */
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
  /**
   * Minimum **per-file** line-coverage percentage (0–100). Unlike {@link lines}
   * (an aggregate over the whole report), this fails the gate when any single
   * **instrumented** file falls below the floor — so an under-tested file can't
   * hide inside a healthy repo-wide average. Files with no measurable lines are
   * skipped. Note the coverage tool's limit: `deno coverage` only reports files
   * that were *loaded*, so a source file no test imports at all is invisible to
   * this check (as it is to every coverage metric).
   */
  perFile?: number;
}

interface CoverageTotals {
  linesFound: number;
  linesHit: number;
  branchesFound: number;
  branchesHit: number;
}

/** One source file's coverage totals, from its LCOV `SF:`…`end_of_record` block. */
export interface FileCoverage extends CoverageTotals {
  /** The source file path (the LCOV `SF:` record). */
  file: string;
}

/** Sum the LF/LH/BRF/BRH records across every file in an LCOV report. */
export function parseLcov(lcov: string): CoverageTotals {
  const totals: CoverageTotals = {
    linesFound: 0,
    linesHit: 0,
    branchesFound: 0,
    branchesHit: 0,
  };
  for (const line of lcov.split(/\r?\n/)) {
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

/**
 * Parse an LCOV report into per-file totals, one entry per `SF:`…`end_of_record`
 * block. `SF` paths are read literally (they may contain a Windows drive
 * `C:`), so only the numeric records are colon-split.
 */
export function parseLcovPerFile(lcov: string): FileCoverage[] {
  const files: FileCoverage[] = [];
  let current: FileCoverage | null = null;
  // Split on CRLF or LF so a Windows-authored report doesn't leave a trailing
  // `\r` on the `SF:` path (the numeric records tolerate it — `Number` trims —
  // but the path would carry it into a failure message).
  for (const line of lcov.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      current = {
        file: line.slice(3),
        linesFound: 0,
        linesHit: 0,
        branchesFound: 0,
        branchesHit: 0,
      };
      continue;
    }
    if (line.startsWith("end_of_record")) {
      if (current !== null) files.push(current);
      current = null;
      continue;
    }
    if (current === null) continue;
    const [tag, value] = line.split(":", 2);
    const n = Number(value);
    if (Number.isNaN(n)) continue;
    if (tag === "LF") current.linesFound += n;
    else if (tag === "LH") current.linesHit += n;
    else if (tag === "BRF") current.branchesFound += n;
    else if (tag === "BRH") current.branchesHit += n;
  }
  return files;
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
  const gated = thresholds.lines !== undefined ||
    thresholds.branches !== undefined || thresholds.perFile !== undefined;
  if (gated && t.linesFound === 0 && t.branchesFound === 0) {
    // An empty report is not 100% covered — nothing was instrumented. A gate
    // that passed here would go green on a run that measured no code at all.
    // (Branchless-but-measured code — linesFound > 0, branchesFound === 0 — is a
    // legitimate vacuous 100% branch score, handled below, not an empty report.)
    failures.push("no coverage data measured; gate cannot pass");
  } else {
    if (thresholds.lines !== undefined && lines < thresholds.lines) {
      failures.push(`line coverage ${fmt(lines)}% < ${thresholds.lines}%`);
    }
    // Only enforce branches when some were found: a branchless file is 100%.
    if (
      thresholds.branches !== undefined && t.branchesFound > 0 &&
      branches < thresholds.branches
    ) {
      failures.push(
        `branch coverage ${fmt(branches)}% < ${thresholds.branches}%`,
      );
    }
    if (thresholds.perFile !== undefined) {
      const floor = thresholds.perFile;
      const under = parseLcovPerFile(lcov)
        .filter((f) =>
          f.linesFound > 0 && pct(f.linesHit, f.linesFound) < floor
        )
        .map((f) => `${f.file} (${fmt(pct(f.linesHit, f.linesFound))}%)`);
      if (under.length > 0) {
        failures.push(
          `${under.length} file(s) below the ${floor}% per-file line floor: ` +
            under.join(", "),
        );
      }
    }
  }

  if (failures.length === 0) {
    console.log("✔ coverage gate passed");
    return failures;
  }
  if (throwOnFailure) throw new CoverageThresholdError(failures);
  console.error(`✘ coverage gate failed: ${failures.join("; ")}`);
  return failures;
}
