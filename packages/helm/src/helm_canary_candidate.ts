// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The candidate `helmCanary` stages — charts, versions, values files, keys,
 * image and replica count — and the one set of checks it passes, whether it
 * comes from configuration or is read back from the rollout's record. Each
 * value is interpolated into an argv token helm parses further (`key=value`
 * for `--set`, a CSV list for `--values`, a positional chart), so each is held
 * to a shape in which a `,`, `=`, quote or leading `-` cannot change what the
 * token means. Internal to the package: not exported from `mod.ts`.
 *
 * @module
 */

import type { HelmCanarySettings } from "./helm_canary_settings.ts";
import { isWholeNumber } from "./whole_number.ts";

/**
 * A values path such as `image.tag` or `replicaCount`: dotted plain segments,
 * with no `=`, `,`, `[`, `\` or quote that `--set` would read as syntax.
 */
const KEY_SHAPE =
  /^[A-Za-z0-9_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/;

/**
 * An image reference or tag: the characters an OCI reference uses (a tag may
 * start with `_`), so a `,` (which `--set-string` splits on), a `\`, a `{` or
 * a `=` cannot reach the value parser.
 */
const IMAGE_SHAPE = /^[A-Za-z0-9_][A-Za-z0-9._/:@-]*$/;

/**
 * Characters a `--values` path may not carry: helm reads the flag as a CSV
 * list, so a comma splits it and a quote or line break changes how it is
 * parsed. They are refused rather than CSV-quoted — no real values file
 * needs them, and a refusal is simpler to trust than an escape.
 */
const VALUES_FILE_SYNTAX = /[,"\r\n]/;

/**
 * A chart reference helm reads as a local path: one starting with `.` or
 * `/`, or a Windows drive path such as `C:\charts\api`.
 */
const LOCAL_CHART = /^(?:[./]|[A-Za-z]:[\\/])/;

/** What `stage` installs and every later call renders, before any check. */
export interface UncheckedCandidate {
  /** The candidate's chart. */
  readonly chart: string | undefined;
  /** The candidate chart's version, if pinned. */
  readonly version: string | undefined;
  /** The chart the stable release's replica moves render. */
  readonly stableChart: string | undefined;
  /** That chart's version, if pinned. */
  readonly stableVersion: string | undefined;
  /** The values files for the canary release and the promotion. */
  readonly values: readonly string[];
  /** The values path the image is set on. */
  readonly imageKey: string;
  /** The values path the replica count is set on. */
  readonly replicasKey: string;
  /** The candidate image. */
  readonly image: string | undefined;
  /** The total replica count across both releases. */
  readonly total: number | undefined;
}

/** What `stage` installs and every later call renders, checked. */
export interface Candidate {
  /** The candidate's chart. */
  readonly chart: string;
  /** The candidate chart's version, if pinned. */
  readonly version: string | undefined;
  /** The chart the stable release's replica moves render. */
  readonly stableChart: string;
  /** That chart's version, if pinned. */
  readonly stableVersion: string | undefined;
  /** The values files for the canary release and the promotion. */
  readonly values: readonly string[];
  /** The values path the image is set on. */
  readonly imageKey: string;
  /** The values path the replica count is set on. */
  readonly replicasKey: string;
  /** The candidate image. */
  readonly image: string;
  /** The total replica count across both releases. */
  readonly total: number;
}

/**
 * Refuses a candidate: `problem` says what is wrong, `fix` the setting that
 * puts it right — which only helps when the value came from configuration.
 */
type Refuse = (problem: string, fix: string) => never;

/** A refusal of configured values, naming the setter to change. */
const refuseConfigured: Refuse = (problem, fix) => {
  throw new Error(`helmCanary: ${problem} — ${fix}.`);
};

/** A refusal of recorded values: the record is damaged, not the settings. */
const refuseRecorded: Refuse = (problem) => {
  throw new Error(
    `helmCanary: the rollout's record of the staged candidate is damaged: ` +
      `${problem}. Roll the rollout back and stage it again.`,
  );
};

/**
 * The candidate as configured: the stable release renders the candidate's
 * chart and version unless {@link HelmCanarySettings.stableChart} names its
 * own. A chart that is not a local path must be pinned with a version, or
 * each step would render whatever the repository serves as latest — and the
 * promotion could install a chart that was never analysed.
 */
export function configuredCandidate(settings: HelmCanarySettings): Candidate {
  const named = settings.stableChart_;
  return checkedCandidate({
    chart: settings.chart_,
    version: settings.version_,
    stableChart: named ?? settings.chart_,
    stableVersion: settings.stableVersion_ ??
      (named === undefined ? settings.version_ : undefined),
    values: settings.values_,
    imageKey: settings.imageKey_,
    replicasKey: settings.replicasKey_,
    image: settings.image_,
    total: settings.replicas_,
  }, refuseConfigured);
}

/**
 * The candidate read back from the rollout's record, held to every check a
 * configured one passes; a refusal says the record is damaged.
 */
export function recheckedCandidate(parts: UncheckedCandidate): Candidate {
  return checkedCandidate(parts, refuseRecorded);
}

/** Every part of a candidate, checked, refused through `refuse`. */
function checkedCandidate(
  parts: UncheckedCandidate,
  refuse: Refuse,
): Candidate {
  const chart = checkedChart(parts.chart, "chart", "chart", refuse);
  const stableChart = checkedChart(
    parts.stableChart,
    "stableChart",
    "stable chart",
    refuse,
  );
  const version = checkedVersion(parts.version, "version", "chart", refuse);
  const stableVersion = checkedVersion(
    parts.stableVersion,
    "stableVersion",
    "stable chart",
    refuse,
  );
  const imageKey = checkedKey(parts.imageKey, "imageKey", refuse);
  const replicasKey = checkedKey(parts.replicasKey, "replicasKey", refuse);
  for (const file of parts.values) {
    if (file === "" || VALUES_FILE_SYNTAX.test(file)) {
      refuse(
        `the values file ${JSON.stringify(file)} cannot be passed to helm, ` +
          "which reads --values as a comma-separated list, so a comma, " +
          "quote or line break changes it",
        "rename or move the file",
      );
    }
  }
  const image = checkedImage(imageKey, parts.image, refuse);
  const total = checkedTotal(parts.total, refuse);
  checkPinned(chart, version, "version", "chart", refuse);
  checkPinned(
    stableChart,
    stableVersion,
    "stableVersion",
    "stable chart",
    refuse,
  );
  return {
    chart,
    version,
    stableChart,
    stableVersion,
    values: [...parts.values],
    imageKey,
    replicasKey,
    image,
    total,
  };
}

/** A chart reference that cannot be read as a flag. */
function checkedChart(
  ref: string | undefined,
  setter: string,
  noun: string,
  refuse: Refuse,
): string {
  if (ref === undefined || ref === "" || ref.startsWith("-")) {
    return refuse(
      ref === undefined
        ? `no ${noun} is set`
        : `the ${noun} ${JSON.stringify(ref)} is not a usable chart reference`,
      `add h.${setter}('./charts/api'), the chart the release is rendered ` +
        "from",
    );
  }
  return ref;
}

/** A chart version, unless it is empty. */
function checkedVersion(
  value: string | undefined,
  setter: string,
  noun: string,
  refuse: Refuse,
): string | undefined {
  if (value === "") {
    refuse(
      `the ${noun}'s version is empty`,
      `drop h.${setter}(""), or give the version`,
    );
  }
  return value;
}

/** Refuse a chart that is neither a local path nor pinned to a version. */
function checkPinned(
  chart: string,
  version: string | undefined,
  setter: string,
  noun: string,
  refuse: Refuse,
): void {
  if (version === undefined && !LOCAL_CHART.test(chart)) {
    refuse(
      `the ${noun} ${JSON.stringify(chart)} is not a local path and has no ` +
        "version, so every step would render the repository's latest chart " +
        "— and the promotion one that was never analysed",
      `add h.${setter}(...) with the chart's version, or name a local chart ` +
        "starting with ./ or /",
    );
  }
}

/** A values path `--set` reads as a plain dotted path. */
function checkedKey(key: string, setter: string, refuse: Refuse): string {
  if (!KEY_SHAPE.test(key)) {
    refuse(
      `"${key}" is not a values path this platform sets`,
      `use dotted plain names like image.tag in h.${setter}(...)`,
    );
  }
  return key;
}

/** A candidate image, checked against `--set-string` syntax and its key. */
function checkedImage(
  key: string,
  image: string | undefined,
  refuse: Refuse,
): string {
  if (image === undefined) {
    return refuse(
      "no candidate image is set",
      `add h.image(...), the value set at ${key}`,
    );
  }
  if (!IMAGE_SHAPE.test(image)) {
    refuse(
      `"${image}" is not an image reference or tag: letters, digits and ` +
        '"_ . / : @ -" only, starting with a letter, digit or "_"',
      "set an image that is one with h.image(...)",
    );
  }
  const at = image.indexOf("@");
  const name = at === -1 ? image : image.slice(0, at);
  if (/(^|\.)tag$/.test(key) && (image.includes("/") || name.includes(":"))) {
    refuse(
      `"${image}" looks like a full image reference, but ${key} takes a ` +
        "tag (optionally with an @digest)",
      "pass just the tag, or point h.imageKey(...) at the key your chart " +
        "reads a full reference from",
    );
  }
  return image;
}

/** A total replica count: a whole number from 1 up. */
function checkedTotal(total: number | undefined, refuse: Refuse): number {
  if (total === undefined || !isWholeNumber(total)) {
    return refuse(
      `the total replica count must be a whole number from 1 up (got ${total})`,
      "set it with h.replicas(10)",
    );
  }
  return total;
}
