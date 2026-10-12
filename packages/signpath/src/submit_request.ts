// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Validating {@link SignPathSubmitSettings} into a {@link SubmitRequest} — the
 * one shape both submission routes take — before anything is sent, so a
 * misconfigured build fails with a message naming the setter rather than with
 * a SignPath 400.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import type { SignPathGitHubOriginSettings } from "./github_origin.ts";
import type { SignPathSubmitSettings } from "./submit_settings.ts";

/** Where the artifact comes from: a local file, or a GitHub Actions run. */
export type ArtifactSource =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "github"; readonly origin: SignPathGitHubOriginSettings };

/** A submission, validated. */
export interface SubmitRequest {
  /** The project's slug. */
  readonly projectSlug: string;
  /** The signing policy's slug. */
  readonly signingPolicySlug: string;
  /** The artifact configuration's slug, when not the project's default. */
  readonly artifactConfigurationSlug: string | undefined;
  /** The request's description, when set. */
  readonly description: string | undefined;
  /** The user-defined parameters. */
  readonly parameters: ReadonlyArray<readonly [string, string]>;
  /** Where the artifact comes from. */
  readonly source: ArtifactSource;
}

/** What a user-defined parameter's name may be — SignPath's own rule. */
const PARAMETER_NAME = /^[A-Za-z0-9._-]+$/;

/** A required, non-empty setting, or an error naming its setter. */
function required(value: string | undefined, setter: string): string {
  if (value === undefined || value === "") {
    throw new Error(`a SignPath submission needs ${setter}.`);
  }
  return value;
}

/** A setting that is unset when empty. */
function optional(value: string | undefined): string | undefined {
  return value === "" ? undefined : value;
}

/** The artifact's source: exactly one of a file and a GitHub origin. */
function sourceOf(settings: SignPathSubmitSettings): ArtifactSource {
  const path = optional(settings.artifact_);
  const origin = settings.gitHubOrigin_;
  if (path !== undefined && origin !== undefined) {
    throw new Error(
      "a SignPath submission takes one artifact source — s.artifact(path) " +
        "uploads a file, s.gitHubOrigin(...) has SignPath fetch it from the " +
        "workflow run; drop one.",
    );
  }
  if (path !== undefined) return { kind: "file", path };
  if (origin !== undefined) return { kind: "github", origin };
  throw new Error(
    "a SignPath submission needs an artifact — s.artifact(path) to upload a " +
      "file, or s.gitHubOrigin((g) => g.artifactId(id)) for a GitHub Actions " +
      "artifact.",
  );
}

/** Validate `settings` into a {@link SubmitRequest}. */
export function submitRequestOf(
  settings: SignPathSubmitSettings,
): SubmitRequest {
  for (const [name] of settings.parameters_) {
    if (!PARAMETER_NAME.test(name)) {
      throw new Error(
        `the SignPath parameter name "${name}" is not valid — use letters, ` +
          `digits, ".", "-" and "_".`,
      );
    }
  }
  return {
    projectSlug: required(settings.projectSlug_, "s.projectSlug(...)"),
    signingPolicySlug: required(
      settings.signingPolicySlug_,
      "s.signingPolicySlug(...)",
    ),
    artifactConfigurationSlug: optional(settings.artifactConfigurationSlug_),
    description: optional(settings.description_),
    parameters: settings.parameters_,
    source: sourceOf(settings),
  };
}
