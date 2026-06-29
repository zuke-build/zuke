/**
 * Learned false-positive suppression: a file-backed set of finding fingerprints
 * that the reviewer uses to drop findings a human has already dismissed.
 *
 * Each finding gets a stable {@link findingFingerprint} derived from its
 * assessment kind, its normalised title, and its file — deliberately
 * independent of the line number so the id survives as surrounding code shifts.
 * Recording a fingerprint in the suppress list (a JSON file, by default
 * `.zuke/ai-suppress.json`) teaches the reviewer to skip that finding on later
 * runs, so a known false positive doesn't keep re-surfacing.
 *
 * The list is read best-effort: a missing file, a parse error, or an
 * unrecognised shape yields no fingerprints rather than failing a build. Both a
 * bare JSON array (`["abc","def"]`) and an object wrapper
 * (`{ "fingerprints": ["abc","def"] }`) are accepted, and inline fingerprints
 * added with {@link Suppressions.add} are merged with whatever the file holds.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { readTextOrUndefined } from "./context.ts";
import { stableHash } from "./hash.ts";
import type { AssessmentFinding, AssessmentType } from "./types.ts";

/** The default path of the JSON suppress list, relative to the project root. */
const DEFAULT_FILE = ".zuke/ai-suppress.json";

/**
 * A stable fingerprint for a finding: hash of the assessment kind, the
 * normalised title (trimmed, lowercased, whitespace collapsed), and the file.
 * Independent of line number so a finding keeps its id as code shifts.
 */
export function findingFingerprint(
  assessment: AssessmentType,
  finding: AssessmentFinding,
): string {
  const normTitle = finding.title.trim().toLowerCase().replace(/\s+/g, " ");
  return stableHash(`${assessment} ${normTitle} ${finding.file ?? ""}`);
}

/** Whether `value` is a non-null object (so its properties can be read). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Keep only the string elements of an array; anything else yields `[]`. */
function onlyStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Extract the string fingerprints from already-parsed JSON, accepting either a
 * bare array or a `{ fingerprints: [...] }` wrapper and ignoring any non-string
 * elements. Any other shape yields an empty list.
 */
function fingerprintsFrom(parsed: unknown): string[] {
  if (Array.isArray(parsed)) return onlyStrings(parsed);
  if (isRecord(parsed)) return onlyStrings(parsed.fingerprints);
  return [];
}

/**
 * Parse a suppress-file body into its fingerprints, best-effort: a malformed
 * JSON document or an unrecognised shape yields an empty list rather than
 * throwing.
 */
function parseFingerprints(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  return fingerprintsFrom(parsed);
}

/**
 * A file-backed set of suppressed finding fingerprints. The effective set is
 * the union of the fingerprints read from {@link Suppressions.file} and any
 * added inline with {@link Suppressions.add}; the reviewer drops a finding whose
 * {@link findingFingerprint} is in that set.
 */
export class Suppressions {
  /** Path of the JSON suppress list. */
  private file_ = DEFAULT_FILE;
  /** Fingerprints added inline, beyond whatever the file holds. */
  private inline_: string[] = [];
  /** Reader seam for the suppress file. */
  private read_: (path: string) => Promise<string | undefined> =
    readTextOrUndefined;

  /** Path of the JSON suppress list (default ".zuke/ai-suppress.json"). */
  file(path: string): this {
    this.file_ = path;
    return this;
  }

  /** Add fingerprints inline (in addition to any from the file). */
  add(...fingerprints: string[]): this {
    this.inline_.push(...fingerprints);
    return this;
  }

  /** Reader seam for the suppress file (default reads from disk, missing -> undefined). */
  reader(read: (path: string) => Promise<string | undefined>): this {
    this.read_ = read;
    return this;
  }

  /** INTERNAL: the effective set of suppressed fingerprints (file ∪ inline). */
  async load_(): Promise<Set<string>> {
    const suppressed = new Set<string>(this.inline_);
    const text = await this.read_(this.file_);
    if (text !== undefined) {
      for (const fingerprint of parseFingerprints(text)) {
        suppressed.add(fingerprint);
      }
    }
    return suppressed;
  }
}

/**
 * Construct a {@link Suppressions}, applying an optional configure lambda so the
 * file and inline fingerprints can be set inline — e.g.
 * `suppressions((s) => s.file(".zuke/suppress.json").add("abc"))`.
 */
export function suppressions(
  configure?: Configure<Suppressions>,
): Suppressions {
  const s = new Suppressions();
  return configure ? configure(s) : s;
}
