/**
 * Renders gitleaks' redacted JSON report as a job-summary table.
 *
 * This is what replaced the `actions/upload-artifact` step in the security
 * workflow. The artifact existed for one reason: a failing scan logs only a
 * count, so without the report a failure could not be diagnosed without
 * reproducing the scan locally. The job summary carries the same information —
 * file, line, rule, fingerprint — and needs no step, no retention policy, and no
 * download.
 *
 * The report stays redacted, so what lands here names *where* a secret is, never
 * what it is.
 *
 * @module
 */

/** One redacted gitleaks finding, as its JSON report describes it. */
export interface GitleaksFinding {
  /** The rule that matched (`generic-api-key`, `github-pat`, …). */
  rule: string;
  /** The file the match is in. */
  file: string;
  /** The line the match starts on, or 0 when the report omits it. */
  line: number;
  /** The commit the match was found in, empty for a working-tree match. */
  commit: string;
  /** gitleaks' stable fingerprint, for allow-listing a known false positive. */
  fingerprint: string;
}

/** Read a string field from a parsed finding, defaulting to `""`. */
function text(entry: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = entry[name];
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

/** Read a numeric field from a parsed finding, defaulting to 0. */
function count(entry: Record<string, unknown>, name: string): number {
  const value = entry[name];
  return typeof value === "number" ? value : 0;
}

/**
 * Parse gitleaks' JSON report. An absent or empty report means no findings —
 * gitleaks writes `[]` (or nothing at all) on a clean scan, and that is not an
 * error.
 *
 * @throws if the file exists but is not the JSON array gitleaks documents, since
 * silently reporting "no findings" for an unparseable report would turn a failed
 * scan into a clean one.
 */
export function parseGitleaksReport(json: string): GitleaksFinding[] {
  const trimmed = json.trim();
  if (trimmed === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `the gitleaks report is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (parsed === null) return [];
  if (!Array.isArray(parsed)) {
    throw new Error("the gitleaks report is not a JSON array of findings.");
  }
  const findings: GitleaksFinding[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = { ...entry };
    findings.push({
      rule: text(record, "RuleID", "ruleID"),
      file: text(record, "File", "file"),
      line: count(record, "StartLine") || count(record, "startLine"),
      commit: text(record, "Commit", "commit"),
      fingerprint: text(record, "Fingerprint", "fingerprint"),
    });
  }
  return findings;
}

/** Escape the one character that would break out of a Markdown table cell. */
function cell(value: string): string {
  return value === "" ? "—" : value.replace(/\|/g, "\\|");
}

/**
 * Render `value` as a Markdown code span, sized so its own content cannot end
 * it early.
 *
 * A path may legitimately contain a backtick, and this table is the only place a
 * failing scan reports *where* a secret is — a row garbled by its own filename
 * would hide the location it exists to show. CommonMark's rule is that a code
 * span delimited by N backticks ends at the next run of exactly N, so a
 * delimiter one longer than the longest run inside always closes correctly. A
 * space pads a value that starts or ends with a backtick, which the renderer
 * strips back out.
 */
function code(value: string): string {
  if (value === "") return "—";
  const longest = Math.max(
    0,
    ...[...value.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = "`".repeat(longest + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${pad}${cell(value)}${pad}${fence}`;
}

/**
 * The job-summary section for a set of findings. Returns `null` for a clean
 * scan: a summary that says "nothing found" on every green run is noise, and the
 * build's own table already reports that the scan passed.
 */
export function gitleaksSummary(
  findings: readonly GitleaksFinding[],
): string | null {
  if (findings.length === 0) return null;
  const rows = findings.map((f) =>
    `| ${code(f.rule)} | ${code(f.file)} | ${f.line > 0 ? f.line : "—"} | ${
      code(f.commit.slice(0, 12))
    } | ${code(f.fingerprint)} |`
  );
  return [
    `## 🔑 gitleaks — ${findings.length} finding${
      findings.length === 1 ? "" : "s"
    }`,
    "",
    "Values are redacted: this names where a secret is, not what it is. To " +
    "dismiss a false positive, add its fingerprint to the gitleaks allowlist.",
    "",
    "| Rule | File | Line | Commit | Fingerprint |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
