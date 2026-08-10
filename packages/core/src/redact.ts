/**
 * Secret redaction for reporter output.
 *
 * A {@link Redactor} collects the resolved values of `secret` parameters and
 * rewrites any line that contains one, replacing every occurrence with
 * {@link REDACTED}. The executor wraps its {@link Reporter} in a redactor so a
 * secret can never surface in Zuke's own output — a banner, a target status, a
 * summary, or an error message — on any platform, not just under a CI host that
 * happens to mask logs.
 *
 * Matching is a plain substring replace (never a regex), so a secret with
 * regex-significant characters is redacted literally and there is no injection
 * surface. A **multi-line** secret registers each of its lines as well as the
 * whole value, because the rewrite happens a line at a time and the whole value
 * matches no single line of itself — without that, a PEM key would be masked on
 * its header and printed in the clear from the second line on. The guarantee
 * covers everything Zuke prints through the reporter; a
 * subprocess a target spawns writes to its own stdout/stderr directly, so a
 * command that deliberately echoes a secret is outside this boundary (GitHub
 * Actions still masks it via `::add-mask::`, which the executor also emits).
 *
 * @module
 */

/** The placeholder a {@link Redactor} substitutes for each secret value. */
export const REDACTED = "[redacted]";

/**
 * The shortest line of a multi-line secret worth masking on its own.
 *
 * Every line of a secret is registered as its own pattern (see
 * {@link maskPatterns}), and a very short one would mask ordinary text wherever
 * it appeared — a two-character line turns every `ok` in the log into
 * `[redacted]`. Eight characters is long enough that an accidental collision
 * with meaningful output is rare, and short enough to still cover a line that
 * carries real key material. The value as a whole is always registered
 * regardless, so nothing is lost for output that contains it intact.
 */
const MIN_LINE_LENGTH = 8;

/**
 * Every pattern that masking `value` must match: the value itself, plus — when
 * it spans lines — each of its lines that clears {@link MIN_LINE_LENGTH}.
 *
 * Redaction is applied **per line**: a reporter masks one line at a time, and a
 * CI host's own masker reads a directive to the end of the line. So a
 * whole-value pattern never matches any single line of a multi-line secret, and
 * a PEM registered only as one string has every line after its header printed
 * in the clear. Lines are trimmed, so the pattern matches the content whatever
 * indentation surrounds it.
 */
export function maskPatterns(value: string): string[] {
  const patterns: string[] = [];
  if (value.length > 0) patterns.push(value);
  if (!value.includes("\n")) return patterns;
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length >= MIN_LINE_LENGTH && !patterns.includes(trimmed)) {
      patterns.push(trimmed);
    }
  }
  return patterns;
}

/**
 * Collects secret values and masks them in text. Register a value with
 * {@link Redactor.add} and rewrite a line with {@link Redactor.redact}; empty
 * strings are ignored (they would match everywhere) and duplicates are recorded
 * once. Longer secrets are applied first so a secret that contains another is
 * masked whole rather than partially.
 */
export class Redactor {
  readonly #secrets: string[] = [];

  /**
   * Register a secret value to mask. Ignores empty strings and duplicates.
   *
   * A **multi-line** value registers each of its lines as well as the whole
   * string, because redaction runs a line at a time and a whole-value pattern
   * can never match one line of it. Lines are trimmed, and a very short one is
   * skipped so it cannot mask ordinary text wherever it appears.
   */
  add(value: string): void {
    for (const pattern of maskPatterns(value)) this.#addPattern(pattern);
  }

  /** Register one already-derived pattern, ignoring empties and duplicates. */
  #addPattern(pattern: string): void {
    if (pattern.length === 0 || this.#secrets.includes(pattern)) return;
    this.#secrets.push(pattern);
    // Keep the list longest-first so a secret that is a substring of another
    // never masks only the inner part, leaving the rest exposed.
    this.#secrets.sort((a, b) => b.length - a.length);
  }

  /** Replace every registered secret in `line` with {@link REDACTED}. */
  redact(line: string): string {
    let out = line;
    for (const secret of this.#secrets) out = out.split(secret).join(REDACTED);
    return out;
  }

  /**
   * The number of distinct patterns registered. A single-line secret
   * contributes one; a multi-line secret contributes the whole value plus each
   * of its qualifying lines.
   */
  get size(): number {
    return this.#secrets.length;
  }
}
