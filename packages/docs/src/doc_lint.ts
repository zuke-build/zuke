/**
 * Parsing and classification for `deno doc --lint` output — the pure core of
 * the documentation-quality gate.
 *
 * `deno doc --lint` reports two rules this project cares about: `missing-jsdoc`
 * (an exported symbol or public member lacks a JSDoc comment) and
 * `private-type-ref` (a public signature references a non-exported type). Per
 * the repo's coding guidelines, a `private-type-ref` to a **first-party** type
 * (one declared in the package itself) is a real defect — the type must be
 * exported — while a ref to a type merely **imported from another `@zuke/*`
 * package** (e.g. `PathLike`, `CommandOutput` from `@zuke/core`) is an accepted
 * residual: that dependency documents the type and JSR links to it, so
 * re-exporting it locally just to silence the lint is forbidden.
 *
 * These functions are pure (no subprocess, no I/O): the caller runs
 * `deno doc --lint` and supplies the output text plus the set of type names the
 * package imports from another `@zuke/*` package, keeping `@zuke/docs` free of
 * any `deno` dependency. The classifier's safe default is to FLAG: a
 * `private-type-ref` is a defect unless the referenced type is one of those
 * accepted cross-package imports, so a first-party leak in any form (a named
 * type, a `typeof`-of-a-`const`, a namespace member, a multi-line generic
 * alias) is caught rather than enumerated.
 *
 * @module
 */

/** A single diagnostic parsed from `deno doc --lint` output. */
export interface DocLintDiagnostic {
  /** The lint rule, e.g. `"missing-jsdoc"` or `"private-type-ref"`. */
  kind: string;
  /** The diagnostic's headline message. */
  message: string;
  /**
   * For a `private-type-ref`, the referenced type's name (the `'Y'` in
   * "references private type 'Y'"); absent for other rules.
   */
  referencedType?: string;
}

/** Strip ANSI colour escapes so output is parsed the same coloured or not. */
function stripAnsi(text: string): string {
  // deno doc colours its diagnostics; NO_COLOR isn't always honoured, so remove
  // the CSI SGR sequences (ESC [ … m) before matching.
  return text.replace(/\[[0-9;]*m/g, "");
}

/**
 * Parse `deno doc --lint` textual output into one {@link DocLintDiagnostic} per
 * reported error. Lines that are not an `error[...]:` header (source excerpts,
 * hints, blank lines, the trailing `Checked N file(s)`) are ignored.
 */
export function parseDocLint(output: string): DocLintDiagnostic[] {
  const diagnostics: DocLintDiagnostic[] = [];
  for (const line of stripAnsi(output).split("\n")) {
    const header = line.match(/^error\[([a-z-]+)\]:\s*(.+)$/);
    if (header === null) continue;
    const kind = header[1];
    const message = header[2].trim();
    const ref = message.match(/references private type '([^']+)'/);
    diagnostics.push(
      ref === null ? { kind, message } : {
        kind,
        message,
        referencedType: ref[1],
      },
    );
  }
  return diagnostics;
}

/**
 * From parsed diagnostics, return the ones that are real defects: every
 * non-`private-type-ref` diagnostic (a `missing-jsdoc`, say), plus every
 * `private-type-ref` whose referenced type is **not** an accepted cross-package
 * import. `acceptedTypes` is the set of local names the package imports from
 * another `@zuke/*` package (guideline 4's sanctioned residual). Anything else
 * a `private-type-ref` names — a first-party type in any declaration form — is
 * flagged, so the classifier fails safe. A namespace-qualified reference
 * (`core.PathLike`) is accepted when its leading binding (`core`) is such an
 * import.
 */
export function docLintDefects(
  diagnostics: readonly DocLintDiagnostic[],
  acceptedTypes: ReadonlySet<string>,
): DocLintDiagnostic[] {
  return diagnostics.filter((d) => {
    if (d.referencedType === undefined) return true;
    const head = d.referencedType.split(".")[0];
    return !acceptedTypes.has(d.referencedType) && !acceptedTypes.has(head);
  });
}
