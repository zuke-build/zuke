/**
 * Where the pinned GitHub Action SHAs come from once the workflows are
 * generated: the committed workflow files themselves.
 *
 * This exists to keep one piece of working automation working. Dependabot bumps
 * SHA-pinned actions weekly, and it can only see `.github/workflows/*.yml` and a
 * root `action.yml` — a TypeScript constant is invisible to it. Had the pins
 * lived in code, generating the workflows would have silently ended those bumps,
 * and stale pins mean missing the security fixes the actions themselves ship.
 *
 * So the direction is inverted. Dependabot edits the committed workflow, and the
 * generator reads each action's SHA back out of it, which makes regeneration
 * reproduce whatever Dependabot last wrote: no drift, no human step, and the
 * bump PR lands exactly as it does today.
 *
 * The one oddity is that the generator reads its own output. That is deliberate
 * and narrow — it applies to the pin *only*, which is the single field
 * Dependabot owns. Everything else about a workflow still comes from the
 * declaration in `zuke.ts`, so structure cannot drift while the pin stays
 * current. {@link SEED_PINS} covers the bootstrap case where no committed file
 * has the action yet.
 *
 * @module
 */

import type { CiActionRef } from "@zuke/core";

/** Where the committed workflows live. */
const WORKFLOW_DIR = ".github/workflows";

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
): Map<string, CiActionRef> {
  const pins = new Map<string, FoundPin>();
  for (const [path, text] of readWorkflows(dir)) {
    for (const [action, pin] of pinsIn(text, path)) {
      const seen = pins.get(action);
      if (seen !== undefined && seen.ref !== pin.ref) {
        throw new Error(
          `action pins disagree for ${action}:\n  ${seen.source}: ${seen.ref}\n` +
            `  ${pin.source}: ${pin.ref}\n` +
            `A bump reached one file but not the other, so there is no single ` +
            `pin to generate from — and guessing would either revert the bump ` +
            `or spread a half-applied one. Edit the workflow YAML so both name ` +
            `the same SHA (keep the newer one unless you know otherwise), then ` +
            `regenerate.`,
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
