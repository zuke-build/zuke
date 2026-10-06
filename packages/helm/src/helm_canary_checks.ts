// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The checks `helmCanary` runs on the releases it acts on and on a recorded
 * revision: a release name is a positional argument, so it is held to the
 * shape helm accepts, in which a leading `-` cannot be read as a flag. The
 * candidate's own checks are in `helm_canary_candidate.ts`. Internal to the
 * package: not exported from `mod.ts`.
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

/** The releases every call acts on, checked: the rollout's identity. */
export interface ReleaseNames {
  /** The release serving today. */
  readonly stable: string;
  /** The release the candidate runs as. */
  readonly canary: string;
  /** The namespace both live in, unless helm's default. */
  readonly namespace: string | undefined;
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
  return { stable, canary, namespace };
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
