// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Whether a pull request has changed a file that decides what the security
 * scanners look for — and therefore what they can be told to miss.
 *
 * The scanners read their rules and their exclusions from the working tree, so
 * a branch that adds one of these files chooses the configuration its own diff
 * is scanned by. None of them exists in this repository, which is deliberate:
 * the scanners run on their defaults, and the appearance of one is the event
 * worth failing on.
 *
 * @module
 */

/**
 * The files whose content configures a scanner's rules or its exclusions.
 *
 * Both spellings are listed where a tool accepts either, since a check that
 * knew only one of them would be walked around by using the other.
 */
export const SCANNER_CONFIG_FILES: readonly string[] = [
  ".gitleaks.toml",
  ".gitleaksignore",
  ".github/zizmor.yml",
  ".github/zizmor.yaml",
  ".github/actionlint.yaml",
  ".github/actionlint.yml",
];

/**
 * The scanner configuration files among `changed`, listed in the order of
 * {@link SCANNER_CONFIG_FILES} so a refusal reads the same way twice.
 *
 * `changed` is the output of a `git diff --name-only`, so entries are
 * repository-relative and one per line; blank lines and surrounding whitespace
 * are ignored rather than treated as a path.
 */
export function changedScannerConfigs(
  changed: readonly string[],
): string[] {
  const names = new Set(
    changed.map((path) => path.trim()).filter((path) => path !== ""),
  );
  return SCANNER_CONFIG_FILES.filter((file) => names.has(file));
}

/**
 * A refusal naming the scanner configuration a pull request changed, or `null`
 * when it changed none.
 *
 * The message is deliberately explicit that this is not a complete defence. The
 * gate runs the pull request's own `zuke.ts`, so a branch can delete the scanner
 * call outright and no in-tree pinning can stop it. What this buys is that a
 * configuration change becomes a named failure a reviewer sees, rather than a
 * silent narrowing of what the scan covers — and that the scheduled and
 * post-merge scans are protected from a file that merged unnoticed.
 */
export function scannerConfigDenial(
  changed: readonly string[],
): string | null {
  const found = changedScannerConfigs(changed);
  if (found.length === 0) return null;
  const list = found.map((file) => `  - ${file}`).join("\n");
  return `This pull request changes scanner configuration:\n${list}\n\n` +
    `Those files decide what the secret and workflow scanners report, so a ` +
    `change to them narrows the scan that is judging this very diff. None of ` +
    `them exists on the default branch: the scanners run on their defaults ` +
    `deliberately.\n\n` +
    `If the change is legitimate — a rule the project genuinely wants — land ` +
    `it on its own, so it is reviewed as a change to the gate rather than as ` +
    `a detail of an unrelated pull request.`;
}
