// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The checks `helmCanary` runs on every value it hands helm: each one is
 * interpolated into an argv token helm parses further (`key=value` for
 * `--set`, a CSV list for `--values`, a positional name), so each is held to
 * a shape in which a `,`, `=`, quote or leading `-` cannot change what the
 * token means. Internal to the package: not exported from `mod.ts`.
 *
 * @module
 */

import type { JsonValue } from "@zuke/core";
import type { HelmCanarySettings } from "./helm_canary_settings.ts";
import { isWholeNumber } from "./whole_number.ts";

/**
 * A Helm release name: a DNS subdomain of at most 53 characters, as helm
 * itself requires. It is a positional argument, so this also keeps a leading
 * `-` from being read as a flag.
 */
const RELEASE_SHAPE =
  /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?(?:\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?)*$/;

/** The longest release name helm accepts. */
const RELEASE_MAX = 53;

/** A Kubernetes namespace: a DNS-1123 label of at most 63 characters. */
const NAMESPACE_SHAPE = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

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

/** The two release names every call needs, checked. */
export interface ReleaseNames {
  /** The release serving today. */
  readonly stable: string;
  /** The release the candidate runs as. */
  readonly canary: string;
}

/** The release names and the namespace, checked. */
export function checkedReleases(settings: HelmCanarySettings): ReleaseNames {
  const stable = settings.stableRelease_;
  if (stable === undefined) {
    throw new Error(
      "helmCanary: no stable release named — add h.stableRelease('api'). " +
        "The release must already exist; the canary amends it.",
    );
  }
  checkReleaseName(stable, "h.stableRelease(...)");
  const named = settings.canaryRelease_;
  const canary = named ?? `${stable}-canary`;
  checkReleaseName(
    canary,
    named === undefined
      ? `the default canary release name "<stable>-canary" — name a shorter ` +
        "one with h.canaryRelease(...)"
      : "h.canaryRelease(...)",
  );
  if (stable === canary) {
    throw new Error(
      `helmCanary: the canary release cannot be the stable release ` +
        `"${stable}" — name a second release with h.canaryRelease(...).`,
    );
  }
  const namespace = settings.namespace_;
  if (namespace !== undefined && !NAMESPACE_SHAPE.test(namespace)) {
    throw new Error(
      `helmCanary: "${namespace}" is not a Kubernetes namespace — lowercase ` +
        'letters, digits and "-", at most 63 characters, set with ' +
        "h.namespace(...).",
    );
  }
  return { stable, canary };
}

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
 * The candidate as configured: the stable release renders the candidate's
 * chart and version unless {@link HelmCanarySettings.stableChart} names its
 * own, and a stable chart that is not a local path must be pinned, or each
 * replica move would render whatever the repository serves as latest.
 */
export function configuredCandidate(settings: HelmCanarySettings): Candidate {
  const named = settings.stableChart_;
  const candidate = checkedCandidate({
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
  });
  if (
    named !== undefined && candidate.stableVersion === undefined &&
    !/^[./]/.test(named)
  ) {
    throw new Error(
      `helmCanary: the stable chart ${JSON.stringify(named)} is not a local ` +
        "path, so without a version every replica move on the stable " +
        "release would render the repository's latest chart — add " +
        "h.stableVersion(...), the version the stable release runs, or name " +
        "a local chart starting with ./ or /.",
    );
  }
  return candidate;
}

/**
 * Every part of a candidate, checked — the one check for a configured
 * candidate and for one read back from the rollout's record.
 */
export function checkedCandidate(parts: UncheckedCandidate): Candidate {
  const chart = checkedChart(parts.chart, "chart");
  const stableChart = checkedChart(parts.stableChart, "stableChart");
  const version = checkedVersion(parts.version, "version");
  const stableVersion = checkedVersion(parts.stableVersion, "stableVersion");
  const imageKey = checkedKey(parts.imageKey, "imageKey");
  const replicasKey = checkedKey(parts.replicasKey, "replicasKey");
  for (const file of parts.values) {
    if (file === "" || VALUES_FILE_SYNTAX.test(file)) {
      throw new Error(
        `helmCanary: the values file ${JSON.stringify(file)} cannot be ` +
          "passed to helm — --values is read as a comma-separated list, so " +
          "a comma, quote or line break changes it. Rename or move the file.",
      );
    }
  }
  return {
    chart,
    version,
    stableChart,
    stableVersion,
    values: [...parts.values],
    imageKey,
    replicasKey,
    image: checkedImage(imageKey, parts.image),
    total: checkedTotal(parts.total),
  };
}

/** A chart version, unless it is empty. */
function checkedVersion(
  value: string | undefined,
  setter: string,
): string | undefined {
  if (value === "") {
    throw new Error(
      `helmCanary: h.${setter}("") names no chart version — drop it, or ` +
        "give the version.",
    );
  }
  return value;
}

/** A values path `--set` reads as a plain dotted path. */
function checkedKey(key: string, setter: string): string {
  if (!KEY_SHAPE.test(key)) {
    throw new Error(
      `helmCanary: "${key}" is not a values path this platform sets — ` +
        `use dotted plain names like image.tag in h.${setter}(...).`,
    );
  }
  return key;
}

/** `name` if it is a release name helm accepts, else an error naming `where`. */
function checkReleaseName(name: string, where: string): void {
  if (name.length > RELEASE_MAX || !RELEASE_SHAPE.test(name)) {
    throw new Error(
      `helmCanary: "${name}" is not a Helm release name — lowercase letters, ` +
        `digits, "-" and ".", at most ${RELEASE_MAX} characters. It comes ` +
        `from ${where}.`,
    );
  }
}

/** A chart reference, or a friendly error naming the setter. */
function checkedChart(ref: string | undefined, setter: string): string {
  if (ref === undefined || ref === "" || ref.startsWith("-")) {
    throw new Error(
      `helmCanary: no usable chart — add h.${setter}('./charts/api'), the ` +
        "chart the release is rendered from.",
    );
  }
  return ref;
}

/** A candidate image, checked against `--set-string` syntax and its key. */
function checkedImage(key: string, image: string | undefined): string {
  if (image === undefined) {
    throw new Error(
      `helmCanary: no candidate image — add h.image(...), the value set at ` +
        `${key}.`,
    );
  }
  if (!IMAGE_SHAPE.test(image)) {
    throw new Error(
      `helmCanary: "${image}" is not an image reference or tag — letters, ` +
        'digits and "_ . / : @ -" only, starting with a letter, digit or "_".',
    );
  }
  const at = image.indexOf("@");
  const name = at === -1 ? image : image.slice(0, at);
  if (/(^|\.)tag$/.test(key) && (image.includes("/") || name.includes(":"))) {
    throw new Error(
      `helmCanary: "${image}" looks like a full image reference, but ${key} ` +
        "takes a tag (optionally with an @digest). Pass just the tag, or " +
        "point h.imageKey(...) at the key your chart reads a full reference " +
        "from.",
    );
  }
  return image;
}

/** A total replica count, or a friendly error naming the fix. */
function checkedTotal(total: number | undefined): number {
  if (total === undefined || !isWholeNumber(total)) {
    throw new Error(
      `helmCanary: the total replica count must be a whole number from 1 up ` +
        `(got ${total}) — set it with h.replicas(10).`,
    );
  }
  return total;
}

/** A revision helm could have, from configuration or the rollout's record. */
export function checkedRevision(revision: JsonValue): number {
  if (typeof revision !== "number" || !isWholeNumber(revision)) {
    const shown = typeof revision === "number"
      ? String(revision)
      : JSON.stringify(revision);
    throw new Error(
      `helmCanary: ${shown} is not a Helm revision — a whole number from 1 up.`,
    );
  }
  return revision;
}
