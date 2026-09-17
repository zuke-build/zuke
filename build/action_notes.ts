// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The release notes the Marketplace action's own releases carry.
 *
 * Derived from the diff rather than written, because the release that needs
 * notes is the one nobody is present for. `actionRelease` runs unattended on a
 * push to master; the alternative to generating something is a release with an
 * empty body.
 *
 * What a reader of the releases page actually needs is narrow, and all of it is
 * recoverable from two revisions of `action.yml`:
 *
 * - which pinned action moved, since that is what almost every release is;
 * - whether any input changed, since that is the only thing here that can break
 *   a caller's workflow;
 * - the commit to pin, since pinning the moving `v1` is what these notes have
 *   advised against since the first release.
 *
 * Anything finer — *why* a step was reordered — is not in the file, so this says
 * plainly that it is not and links the compare view rather than inventing a
 * summary. Generated notes are a floor, not a correction:
 * {@link "../packages/gh/src/release_ensure.ts".ensureRelease} never overwrites
 * a release, so a maintainer who writes something better keeps it.
 *
 * A formatter and nothing else. The inputs arrive already parsed, by
 * `declaredInputs` in {@link "./action_release.ts"} — the reader the gate
 * depends on. A second parser here would be a copy that drifts, and the drift
 * would be invisible: both would keep producing a plausible list.
 *
 * @module
 */

import { usesPins } from "./action_uses.ts";

/** A release of the action, as the notes need to describe it. */
export interface ActionReleaseChange {
  /** The repository, as a consumer writes it in `uses:`. */
  slug: string;
  /** The version being released, e.g. `v1.0.6`. */
  version: string;
  /** The commit it is cut from. */
  sha: string;
  /** `action.yml` as this release contains it. */
  source: string;
  /** The inputs this release declares, from `declaredInputs`. */
  inputs: readonly string[];
  /** The release this one follows, absent for the first release of all. */
  previous?: ActionReleaseBase;
}

/** The release a set of notes diffs against. */
export interface ActionReleaseBase {
  /** Its tag, e.g. `v1.0.5`. */
  tag: string;
  /** `action.yml` as that release contains it. */
  source: string;
  /** The inputs it declares, from `declaredInputs`. */
  inputs: readonly string[];
}

/** The title a release carries on the releases page. */
export function actionReleaseTitle(version: string): string {
  return `Zuke Build ${version}`;
}

/**
 * What a `# vX.Y.Z` comment has to look like to be quoted as a version.
 *
 * The comment is free text — anything after `#` on the `uses:` line — and it is
 * rendered into the notes. Dependabot writes a version there and nothing else
 * does, so a value that is not one means the pin was hand-edited, and the SHA
 * below is the honest thing to print instead. It also keeps a stray backtick
 * out of a body that quotes the value inside backticks.
 */
const VERSION_COMMENT = /^v?\d[\w.+-]*$/;

/** Each pinned action this release moves, as a sentence, sorted. */
function bumpLines(previous: string, current: string): string[] {
  const before = usesPins(previous);
  const lines: string[] = [];
  for (const [action, pin] of usesPins(current)) {
    const was = before.get(action);
    if (was === undefined || was.ref === pin.ref) continue;
    // The `# vX.Y.Z` comment is what Dependabot maintains beside the SHA, so it
    // is the reader-friendly half — but a pin may carry none, and claiming a
    // version that is not written down would be worse than naming the commit.
    const named = pin.version !== undefined &&
      VERSION_COMMENT.test(pin.version);
    lines.push(
      named
        ? `Updates \`${action}\` to ${pin.version}.`
        : `Updates \`${action}\` to \`${pin.ref.split("@")[1]}\`.`,
    );
  }
  // Sorted so the same diff always renders the same body, whatever order the
  // file happens to list its steps in.
  return lines.sort();
}

/** The paragraph describing what happened to the action's inputs. */
function inputParagraph(
  before: readonly string[],
  after: readonly string[],
): string {
  const had = new Set(before);
  const added = after.filter((name) => !had.has(name));
  const removed = before.filter((name) => !after.includes(name));

  if (added.length === 0 && removed.length === 0) {
    return `Nothing about the action's interface changes: the same ` +
      `${after.length} inputs, the same behaviour, the same ordering.`;
  }
  const quoted = (names: readonly string[]) =>
    names.map((name) => `\`${name}\``).join(", ");
  const changes: string[] = [];
  if (added.length > 0) changes.push(`adds ${quoted(added)}`);
  if (removed.length > 0) changes.push(`removes ${quoted(removed)}`);
  const sentence = `This release ${changes.join(" and ")}, for ` +
    `${after.length} inputs in total.`;
  if (removed.length === 0) return sentence;
  // Worth spelling out: this is the only change described here that can break
  // a caller who did nothing, and it breaks them quietly.
  return `${sentence} A workflow still passing a removed input will not ` +
    `fail — GitHub warns and carries on — so the step runs with it absent.`;
}

/**
 * The notes for one release of the action.
 *
 * Deterministic: the same two revisions always produce the same text, so a
 * re-run cannot make the body churn.
 */
export function actionReleaseNotes(change: ActionReleaseChange): string {
  const { slug, version, sha, source, inputs, previous } = change;
  const paragraphs: string[] = [];

  if (previous === undefined) {
    paragraphs.push(
      `The first release of the Zuke Build composite action, declaring ` +
        `${inputs.length} inputs.`,
    );
  } else {
    const bumps = bumpLines(previous.source, source);
    paragraphs.push(
      bumps.length > 0
        // Honest about the limit when there is nothing to name. Everything this
        // module can read is unchanged, so whatever moved was a step, a guard
        // or a description — and the diff is the only place that says which.
        ? bumps.join("\n")
        : `Changes \`action.yml\` without changing an input or a pinned ` +
          `action — a step, a guard, or the wording of a description. The ` +
          `compare view below is the diff.`,
    );
    paragraphs.push(inputParagraph(previous.inputs, inputs));
    paragraphs.push(
      `This exists so the change reaches anyone using ${slug}@v1 — a pinned ` +
        `action only ships a fix when the tag it is pinned to moves.`,
    );
    paragraphs.push(
      `Full diff: https://github.com/${slug}/compare/${previous.tag}...${version}`,
    );
  }

  paragraphs.push(
    `Pin the full commit SHA rather than the moving v1 tag: \`${slug}@${sha}\``,
  );
  return paragraphs.join("\n\n");
}
