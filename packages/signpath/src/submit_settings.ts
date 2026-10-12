// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link SignPathSubmitSettings} — everything `SignPathTasks.submit` needs:
 * the connection, the project and signing policy, where the artifact comes
 * from, how long to wait, and where to put the signed result.
 *
 * @module
 */

import { parseDuration, type PathLike } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { SignPathConnectionSettings } from "./connection.ts";
import { wholeAtLeast } from "./limits.ts";
import { SignPathGitHubOriginSettings } from "./github_origin.ts";

/**
 * How long `submit` waits for a request to finish when no
 * {@link SignPathSubmitSettings.timeout} is set — the ten minutes SignPath's
 * own GitHub action waits.
 */
const DEFAULT_TIMEOUT_MS = 600_000;

/** How often `submit` polls when no {@link SignPathSubmitSettings.pollInterval} is set. */
const DEFAULT_POLL_INTERVAL_MS = 10_000;

/** Settings for `SignPathTasks.submit`. */
export class SignPathSubmitSettings extends SignPathConnectionSettings {
  /** The project's slug (set by {@link projectSlug}). */
  projectSlug_?: string;
  /** The signing policy's slug (set by {@link signingPolicySlug}). */
  signingPolicySlug_?: string;
  /** The artifact configuration's slug (set by {@link artifactConfigurationSlug}). */
  artifactConfigurationSlug_?: string;
  /** The request's description (set by {@link description}). */
  description_?: string;
  /** User-defined parameters, in the order set (set by {@link parameter}). */
  readonly parameters_: Array<readonly [string, string]> = [];
  /** A local file to upload (set by {@link artifact}). */
  artifact_?: string;
  /** A GitHub Actions artifact to fetch (set by {@link gitHubOrigin}). */
  gitHubOrigin_?: SignPathGitHubOriginSettings;
  /** Where to write the signed artifact (set by {@link output}). */
  output_?: string;
  /** How long to wait for the request to finish, in ms (set by {@link timeout}). */
  timeout_: number = DEFAULT_TIMEOUT_MS;
  /** How often to poll its status, in ms (set by {@link pollInterval}). */
  pollInterval_: number = DEFAULT_POLL_INTERVAL_MS;

  /** The SignPath project's slug. Required. */
  projectSlug(slug: string): this {
    this.projectSlug_ = slug;
    return this;
  }

  /**
   * The signing policy's slug, such as `release-signing` — it decides the
   * certificate and whether an approver must sign off. Required.
   */
  signingPolicySlug(slug: string): this {
    this.signingPolicySlug_ = slug;
    return this;
  }

  /**
   * The artifact configuration's slug — which files inside the artifact are
   * signed, and how. The project's default configuration when unset.
   */
  artifactConfigurationSlug(slug: string): this {
    this.artifactConfigurationSlug_ = slug;
    return this;
  }

  /** A description shown on the request, such as the version being released. */
  description(text: string): this {
    this.description_ = text;
    return this;
  }

  /**
   * A user-defined parameter the artifact configuration reads (a version
   * number to stamp, say). Names are letters, digits, `.`, `-` and `_`.
   * Repeatable.
   */
  parameter(name: string, value: string): this {
    this.parameters_.push([name, value]);
    return this;
  }

  /**
   * Upload this local file as the artifact (`SubmitWithArtifact`). Exactly one
   * of `artifact` and {@link gitHubOrigin} is required.
   *
   * SignPath's open-source programme accepts only builds whose origin it can
   * verify, so for it use {@link gitHubOrigin} instead.
   */
  artifact(path: PathLike): this {
    this.artifact_ = String(path);
    return this;
  }

  /**
   * Have SignPath fetch the artifact from a GitHub Actions workflow run and
   * verify its origin. Exactly one of {@link artifact} and `gitHubOrigin` is
   * required.
   */
  gitHubOrigin(configure: Configure<SignPathGitHubOriginSettings>): this {
    this.gitHubOrigin_ = configure(new SignPathGitHubOriginSettings());
    return this;
  }

  /**
   * Download the signed artifact to this file once the request completes; its
   * directory is created when missing. Without it, `submit` only waits.
   */
  output(path: PathLike): this {
    this.output_ = String(path);
    return this;
  }

  /**
   * Fail with a `SignPathTimeoutError` when the request is not final after
   * this long (`"30m"`, or ms); default ten minutes. A policy that needs a
   * manual approval wants longer.
   */
  timeout(duration: string | number): this {
    this.timeout_ = wholeAtLeast(parseDuration(duration), 0, "timeout");
    return this;
  }

  /**
   * Poll the request's status this often (`"5s"`, or ms; at least one second);
   * default ten seconds.
   */
  pollInterval(duration: string | number): this {
    this.pollInterval_ = wholeAtLeast(
      parseDuration(duration),
      1000,
      "pollInterval",
    );
    return this;
  }
}
