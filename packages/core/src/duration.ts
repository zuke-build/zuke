/**
 * Parse a human duration string like `"4h"` or `"500ms"` into milliseconds.
 *
 * Used by lock TTLs (and, later, external-event wait timeouts) so a build author
 * writes `ttl: "4h"` instead of `14_400_000`. A plain number is treated as
 * milliseconds and returned unchanged.
 *
 * @module
 */

/** Milliseconds per supported unit. */
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a duration to milliseconds. Accepts a number (already milliseconds) or a
 * string of a non-negative amount and a unit — `ms`, `s`, `m`, `h`, or `d`
 * (e.g. `"90s"`, `"4h"`, `"1.5h"`). Throws a friendly error on anything else.
 */
export function parseDuration(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `invalid duration ${value} — expected a non-negative number of ms`,
      );
    }
    return value;
  }
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(value.trim());
  if (match === null) {
    throw new Error(
      `invalid duration "${value}" — use an amount and a unit, e.g. ` +
        `"500ms", "90s", "30m", "4h", "1d".`,
    );
  }
  return Number(match[1]) * UNIT_MS[match[2]];
}
