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
 * surface. The guarantee covers everything Zuke prints through the reporter; a
 * subprocess a target spawns writes to its own stdout/stderr directly, so a
 * command that deliberately echoes a secret is outside this boundary (GitHub
 * Actions still masks it via `::add-mask::`, which the executor also emits).
 *
 * @module
 */

/** The placeholder a {@link Redactor} substitutes for each secret value. */
export const REDACTED = "[redacted]";

/**
 * Collects secret values and masks them in text. Register a value with
 * {@link Redactor.add} and rewrite a line with {@link Redactor.redact}; empty
 * strings are ignored (they would match everywhere) and duplicates are recorded
 * once. Longer secrets are applied first so a secret that contains another is
 * masked whole rather than partially.
 */
export class Redactor {
  readonly #secrets: string[] = [];

  /** Register a secret value to mask. Ignores empty strings and duplicates. */
  add(value: string): void {
    if (value.length === 0 || this.#secrets.includes(value)) return;
    this.#secrets.push(value);
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

  /** The number of distinct secret values registered. */
  get size(): number {
    return this.#secrets.length;
  }
}
