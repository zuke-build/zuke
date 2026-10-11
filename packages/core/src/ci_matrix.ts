// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Build matrices for generated CI: independent axes, plus the `include` and
 * `exclude` rows that make a matrix sparse.
 *
 * GitHub renders the three parts natively. GitLab and Azure cannot express
 * `exclude` (and Azure has no axes at all, only named configurations), so for
 * them the matrix is expanded here, into exactly the combinations GitHub would
 * run. Expanding is what keeps one declaration meaning the same jobs on every
 * provider rather than quietly widening to a cartesian product.
 *
 * @module
 */

/** A matrix's independent axes: each key fans out over its values. */
export type CiMatrixAxes = Record<string, Array<string | number>>;

/**
 * One matrix combination, as an `include` or `exclude` entry spells it:
 * `{ node: "26", os: "macos-latest" }`.
 */
export type CiMatrixRow = Record<string, string | number>;

/** The three parts of a matrix, as a job declares them. */
export interface MatrixSpec {
  /** The independent axes. */
  matrix?: CiMatrixAxes;
  /** Rows added to (or extending) the combinations. */
  matrixInclude?: CiMatrixRow[];
  /** Rows removed from the axes' combinations. */
  matrixExclude?: CiMatrixRow[];
}

/** Whether a job declares a matrix in any of its three parts. */
export function hasMatrix(spec: MatrixSpec): boolean {
  return spec.matrix !== undefined || spec.matrixInclude !== undefined ||
    spec.matrixExclude !== undefined;
}

/** Whether a job's matrix needs more than its axes to describe. */
export function isSparse(spec: MatrixSpec): boolean {
  return spec.matrixInclude !== undefined || spec.matrixExclude !== undefined;
}

/** Every combination of the axes' values, in declaration order. */
function product(axes: CiMatrixAxes): CiMatrixRow[] {
  const keys = Object.keys(axes);
  // No axes is no combinations, not one empty one: GitHub builds an
  // include-only matrix from its rows alone.
  if (keys.length === 0) return [];
  let combos: CiMatrixRow[] = [{}];
  for (const key of keys) {
    const expanded: CiMatrixRow[] = [];
    for (const combo of combos) {
      for (const value of axes[key]) expanded.push({ ...combo, [key]: value });
    }
    combos = expanded;
  }
  return combos;
}

/** Whether `combo` carries every key/value `row` names (a partial match). */
function matches(combo: CiMatrixRow, row: CiMatrixRow): boolean {
  return Object.entries(row).every(([key, value]) => combo[key] === value);
}

/**
 * The combinations a job's matrix runs, under GitHub's rules — the semantics
 * every provider is held to.
 *
 * The axes' cartesian product is taken first and `exclude` rows (each a partial
 * match) removed from it. Each `include` row is then merged into every remaining
 * combination it does not contradict on an *original* axis value; a row that
 * fits none becomes a combination of its own. Rows created that way are not
 * extended by later `include` rows — exactly as GitHub documents it.
 *
 * Throws for what GitHub would reject or misread when the workflow runs: an
 * axis named `include` or `exclude`, an `exclude` key that is not an axis, and
 * a matrix with no combinations left.
 */
export function expandMatrix(jobId: string, spec: MatrixSpec): CiMatrixRow[] {
  const axes = spec.matrix ?? {};
  const original = Object.keys(axes);
  // GitHub reads these two keys of `strategy.matrix` as its own row lists, so
  // an axis by either name would be silently reinterpreted there.
  const reserved = { include: "matrixInclude", exclude: "matrixExclude" };
  for (const [name, field] of Object.entries(reserved)) {
    if (original.includes(name)) {
      throw new Error(
        `cicd: job "${jobId}" has a matrix axis named "${name}", which GitHub ` +
          `reads as its own row list — rename the axis, or declare the rows ` +
          `with \`${field}\`.`,
      );
    }
  }
  for (const row of spec.matrixExclude ?? []) {
    for (const key of Object.keys(row)) {
      if (!original.includes(key)) {
        throw new Error(
          `cicd: job "${jobId}" excludes on "${key}", which is not one of its ` +
            `matrix axes — an exclude row can only remove combinations the ` +
            `axes produce. Add "${key}" to \`matrix\`, or drop it from the row.`,
        );
      }
    }
  }
  const combos = product(axes).filter((combo) =>
    !(spec.matrixExclude ?? []).some((row) => matches(combo, row))
  );
  const added: CiMatrixRow[] = [];
  for (const row of spec.matrixInclude ?? []) {
    let merged = false;
    for (const combo of combos) {
      // Only an original axis value is protected; a value an earlier include
      // row added may be overwritten by a later one.
      const fits = original.every((key) =>
        !(key in row) || row[key] === combo[key]
      );
      if (fits) {
        Object.assign(combo, row);
        merged = true;
      }
    }
    if (!merged) added.push({ ...row });
  }
  const rows = [...combos, ...added];
  if (rows.length === 0) {
    throw new Error(
      `cicd: job "${jobId}" declares a matrix with no combinations left to ` +
        `run — every axis needs at least one value, and the exclude rows must ` +
        `leave something (or add rows with \`matrixInclude\`).`,
    );
  }
  return rows;
}
