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

/** The release names and every configured value, checked. */
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
  for (
    const [setter, value] of [
      ["version", settings.version_],
      ["stableVersion", settings.stableVersion_],
    ]
  ) {
    if (value === "") {
      throw new Error(
        `helmCanary: h.${setter}("") names no chart version — drop it, or ` +
          "give the version.",
      );
    }
  }
  for (
    const [setter, key] of [
      ["imageKey", settings.imageKey_],
      ["replicasKey", settings.replicasKey_],
    ]
  ) {
    if (!KEY_SHAPE.test(key)) {
      throw new Error(
        `helmCanary: "${key}" is not a values path this platform sets — ` +
          `use dotted plain names like image.tag in h.${setter}(...).`,
      );
    }
  }
  for (const file of settings.values_) {
    if (file === "" || VALUES_FILE_SYNTAX.test(file)) {
      throw new Error(
        `helmCanary: the values file ${JSON.stringify(file)} cannot be ` +
          "passed to helm — --values is read as a comma-separated list, so " +
          "a comma, quote or line break changes it. Rename or move the file.",
      );
    }
  }
  return { stable, canary };
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
export function checkedChart(ref: string | undefined, setter: string): string {
  if (ref === undefined || ref === "" || ref.startsWith("-")) {
    throw new Error(
      `helmCanary: no usable chart — add h.${setter}('./charts/api'), the ` +
        "chart the release is rendered from.",
    );
  }
  return ref;
}

/** A candidate image, checked against `--set-string` syntax and its key. */
export function checkedImage(key: string, image: string | undefined): string {
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
export function checkedTotal(total: number | undefined): number {
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
