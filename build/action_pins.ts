/**
 * Where the pinned GitHub Action SHAs come from once the workflows are
 * generated: the root `action.yml` manifest, which the generator never writes.
 *
 * This exists to keep one piece of working automation working. Dependabot bumps
 * SHA-pinned actions weekly, and it can only see `.github/workflows/*.yml` and a
 * root `action.yml` — a TypeScript constant is invisible to it. Had the pins
 * lived in code, generating the workflows would have silently ended those bumps,
 * and stale pins mean missing the security fixes the actions themselves ship.
 *
 * So the pins live in the one file Dependabot can see that is *not* generated.
 * A bot edits `action.yml`, this module reads it, and the generator writes the
 * workflows from it — one direction, no file that is the source of its own
 * pins.
 *
 * A generated workflow is still read, for any action the manifest does not
 * mention, and {@link SEED_PINS} covers an action neither has yet. Those two
 * paths keep working for a build that has no manifest, but the manifest is the
 * arrangement worth having: it is the only one where nothing the generator wrote
 * feeds back into what it writes.
 *
 * @module
 */

import type { CiActionRef } from "@zuke/core";
import { ACTION_PIN, ACTION_SLUG } from "./action_release.ts";

/** Where the committed workflows live. */
const WORKFLOW_DIR = ".github/workflows";

/**
 * The root composite action, which is the repository's pinned-action manifest.
 *
 * This is the file that makes the arrangement one-directional. Dependabot scans
 * `.github/workflows` and a root `action.yml`; the generator *writes* the former
 * and only ever *reads* the latter, so a bot's bump to `action.yml` can never be
 * reverted by a regeneration. Pins found here therefore win over pins found in a
 * generated workflow.
 */
const ACTION_MANIFEST = "action.yml";

/**
 * A `uses:` line: the action (with any subpath), its pinned SHA, and the version
 * comment beside it. Anchored to `uses:` so a SHA mentioned in prose is ignored.
 */
const USES_LINE =
  /^\s*(?:-\s+)?uses:\s*([\w.-]+\/[\w.\-/]+)@([0-9a-f]{40})\s*(?:#\s*(\S+))?/;

/**
 * The pins to fall back on when no committed workflow mentions an action yet —
 * declaring a brand-new workflow, or generating into an empty repository.
 *
 * These go stale by design: they are a starting point, not the source of truth.
 * Once a generated file carries the action, that file wins and Dependabot's
 * bumps flow from it. Keep the list to actions the build actually declares.
 */
export const SEED_PINS: Readonly<Record<string, CiActionRef>> = {
  "actions/checkout": {
    ref: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    version: "v7.0.1",
  },
  "step-security/harden-runner": {
    ref: "step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920",
    version: "v2.20.0",
  },
  "denoland/setup-deno": {
    ref: "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed",
    version: "v2.0.5",
  },
  "ossf/scorecard-action": {
    ref: "ossf/scorecard-action@2d1146689b8cda280b9bc96326124645441f03bc",
    version: "v2.4.4",
  },
  // The two halves of one action are pinned separately because pins are keyed
  // by the full `uses:` path, subpath included — and must agree, since they
  // ship as one release.
  "github/codeql-action/init": {
    ref: "github/codeql-action/init@5595ccaf912efad79be6eef63a5619ff05969be3",
    version: "v4.37.6",
  },
  "github/codeql-action/analyze": {
    ref:
      "github/codeql-action/analyze@5595ccaf912efad79be6eef63a5619ff05969be3",
    version: "v4.37.6",
  },
};

/** One action's pin, and which file it was read from (for error messages). */
interface FoundPin extends CiActionRef {
  /** The workflow the pin came from. */
  source: string;
}

/** Read every `uses:` pin in `text`, keyed by action. */
function pinsIn(text: string, source: string): Map<string, FoundPin> {
  const found = new Map<string, FoundPin>();
  for (const line of text.split("\n")) {
    const match = USES_LINE.exec(line);
    if (match === null) continue;
    const [, action, sha, version] = match;
    found.set(action, { ref: `${action}@${sha}`, version, source });
  }
  return found;
}

/** A file's text, or `""` when it does not exist. */
function readFileOrEmpty(path: string): string {
  try {
    return Deno.readTextFileSync(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "";
    throw error;
  }
}

/** Every workflow file's text, keyed by path, sorted for deterministic errors. */
function readWorkflows(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  let entries: string[];
  try {
    entries = [...Deno.readDirSync(dir)]
      .filter((e) => e.isFile && /\.ya?ml$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch (error) {
    // No workflow directory yet: every pin comes from the seed.
    if (error instanceof Deno.errors.NotFound) return files;
    throw error;
  }
  for (const name of entries) {
    files.set(`${dir}/${name}`, Deno.readTextFileSync(`${dir}/${name}`));
  }
  return files;
}

/**
 * Collect the pin for every action the committed workflows reference.
 *
 * @throws if two files pin the same action to different SHAs. That means a bump
 * landed in some files but not others, and picking one silently would either
 * revert the bump or spread a half-applied one. Naming both files says what to
 * do: finish the bump, or regenerate.
 */
export function collectActionPins(
  dir: string = WORKFLOW_DIR,
  manifest: string = ACTION_MANIFEST,
): Map<string, CiActionRef> {
  const pins = new Map<string, FoundPin>();

  // The manifest first, and authoritatively: the generator never writes it, so a
  // bump landing there cannot be undone by regenerating. A generated workflow
  // disagreeing with it is not a conflict to report but a file about to be
  // rewritten, so the manifest simply wins.
  const manifestText = readFileOrEmpty(manifest);
  const fromManifest = pinsIn(manifestText, manifest);
  for (const [action, pin] of fromManifest) pins.set(action, pin);

  for (const [path, text] of readWorkflows(dir)) {
    for (const [action, pin] of pinsIn(text, path)) {
      // This repository's own action is never sourced from a workflow — see
      // {@link actionPin}, which answers it from `build/action_version.json`
      // before consulting anything here. Collecting it anyway made a release
      // brick the build: `actionRelease` rewrites the workflows, and between
      // the first file and the last they disagree, so the throw below fired
      // while the build's fields were still initialising and *every* target
      // failed, including the ones that would have finished the job.
      if (action === ACTION_SLUG) continue;
      // Already pinned by the manifest: that value stands, and this file will be
      // regenerated from it.
      if (fromManifest.has(action)) continue;
      const seen = pins.get(action);
      if (seen !== undefined && seen.ref !== pin.ref) {
        throw new Error(
          `action pins disagree for ${action}:\n  ${seen.source}: ${seen.ref}\n` +
            `  ${pin.source}: ${pin.ref}\n` +
            `A bump reached one file but not the other, so there is no single ` +
            `pin to generate from — and guessing would either revert the bump ` +
            `or spread a half-applied one. Edit the workflow YAML so both name ` +
            `the same SHA (keep the newer one unless you know otherwise), then ` +
            `regenerate — or pin it in ${ACTION_MANIFEST}, which wins over ` +
            `every generated file.`,
        );
      }
      // Same SHA in both, but only one names the version: keep the one that
      // does. Otherwise a file that omits the comment would shadow a file that
      // has it, and the version Dependabot tracks would be dropped purely
      // because of the order the directory happens to list.
      if (seen === undefined || (seen.version === undefined && pin.version)) {
        pins.set(action, pin);
      }
    }
  }
  return new Map(
    [...pins].map(([action, { ref, version }]) => [action, { ref, version }]),
  );
}

/**
 * The pins in force for this repository, read once and then cached.
 *
 * Read on first use and cached, because the read must happen before a run
 * rewrites the generated files — caching the first result keeps every later call
 * seeing what was *committed* rather than what this run just wrote.
 *
 * Note that a disagreement (see {@link collectActionPins}) therefore fails the
 * whole run, not just generation: the pins are requested while the build's
 * fields initialise. That is the intended trade — two workflows pinning one
 * action to different commits is a supply-chain inconsistency, and a gate that
 * kept going would be reporting on a repository state nobody chose.
 */
let pins: Map<string, CiActionRef> | undefined;

/** The committed pins, read on first use. */
function committedPins(): Map<string, CiActionRef> {
  if (pins === undefined) pins = collectActionPins();
  return pins;
}

/**
 * The pinned reference for `action`, as committed. Falls back to
 * {@link SEED_PINS} when no workflow mentions it yet.
 *
 * @throws if the action is neither committed nor seeded, since generating
 * `uses:` with no pin would emit a floating reference that supply-chain scanners
 * reject — better to fail than to quietly unpin an action.
 */
export function actionPin(action: string): CiActionRef {
  // This repository's own action is the one pin that cannot come from here.
  // `action.yml` is the manifest for every *other* action and cannot pin itself,
  // and reading it back out of a generated workflow is the feedback loop this
  // module exists to prevent. It lives in `build/action_version.json`, written
  // only when the action is actually tagged.
  if (action === ACTION_SLUG) return ACTION_PIN;
  const committed = committedPins().get(action);
  const seed = SEED_PINS[action];
  // A committed pin wins, but it may predate comment support and carry no
  // version. Borrow the seed's version only when the SHA is byte-identical —
  // once a bump moves the SHA, the seed's version describes a different commit
  // and attaching it would state the wrong version rather than none.
  const pinned = committed !== undefined &&
      committed.version === undefined && seed?.ref === committed.ref
    ? seed
    : committed ?? seed;
  if (pinned === undefined) {
    throw new Error(
      `no pinned SHA for "${action}": it appears in no committed workflow and ` +
        `has no entry in SEED_PINS (build/action_pins.ts). Add one with the ` +
        `full commit SHA and its version, then regenerate.`,
    );
  }
  return pinned;
}
