// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Keep a repository's "Latest release" pointer on a chosen release.
 *
 * GitHub moves the pointer to whichever non-prerelease release was published
 * most recently, and surfaces it well beyond the releases page: the
 * Marketplace listing of a repository's action advertises it as the action's
 * current version, and `gemini extensions install` resolves it. In a monorepo
 * whose packages release continuously, every package release drags the pointer
 * away from the release a consumer should see. This operation pins it back,
 * idempotently, from the same pipeline that cut the package releases:
 *
 * ```ts
 * await GhTasks.markReleaseLatest((s) => s.tag("v1.0.2").token(token));
 * ```
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import {
  assertRefName,
  caller,
  DEFAULT_BASE_URL,
  encodePath,
  env,
  GhApiError,
  readNumber,
} from "./api.ts";

/** What became of a {@link GhReleaseLatestApi.markReleaseLatest} call. */
export interface GhReleaseLatestResult {
  /**
   * `marked` when the pointer was moved onto the tag's release;
   * `already-latest` when it was there before the call (nothing was written);
   * `no-release` when the tag has no release to point at — an ordinary
   * outcome for a tag whose release is created by a later, human step.
   */
  state: "marked" | "already-latest" | "no-release";
  /** The tag the call targeted. */
  tag: string;
  /** The id of the tag's release, when one was resolved. */
  releaseId?: number;
}

/**
 * Settings for marking a release as latest.
 *
 * `owner/repo` and the token fall back to the Actions environment, so a job
 * that already has them needs to name only the tag.
 */
export class GhReleaseLatestSettings {
  /** The tag whose release becomes latest. Set by {@link tag}. */
  tag_?: string;
  /** `owner/repo`. Set by {@link repo}. */
  repo_?: string;
  /** The token. Set by {@link token}. */
  token_?: string;
  /** The API root. Set by {@link baseUrl}. */
  baseUrl_: string = DEFAULT_BASE_URL;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;

  /** The tag whose release the pointer should name (required). */
  tag(value: string): this {
    this.tag_ = value;
    return this;
  }

  /** `owner/repo`. Defaults to `GITHUB_REPOSITORY`. */
  repo(slug: string): this {
    this.repo_ = slug;
    return this;
  }

  /** The token to authenticate with — needs `contents: write`. Defaults to `GITHUB_TOKEN`. */
  token(value: string): this {
    this.token_ = value;
    return this;
  }

  /** The API root, for GitHub Enterprise. */
  baseUrl(url: string): this {
    this.baseUrl_ = url.replace(/\/+$/, "");
    return this;
  }

  /** Override the `fetch` implementation (a test seam). */
  fetch(fn: typeof fetch): this {
    this.fetch_ = fn;
    return this;
  }

  /** The effective `owner/repo`, from the setting or the environment. */
  repoSlug_(): string {
    const slug = this.repo_ ?? env("GITHUB_REPOSITORY");
    if (slug === undefined) {
      throw new Error(
        "marking a release as latest requires .repo('owner/name') (or " +
          "GITHUB_REPOSITORY).",
      );
    }
    return slug;
  }

  /** The effective token, from the setting or the environment. */
  authToken_(): string {
    const token = this.token_ ?? env("GITHUB_TOKEN");
    if (token === undefined) {
      throw new Error(
        "marking a release as latest requires .token(...) (or GITHUB_TOKEN) " +
          "with contents: write.",
      );
    }
    return token;
  }
}

/** The mark-latest operation {@link GhTasks} exposes. */
export interface GhReleaseLatestApi {
  /**
   * Point the repository's "Latest release" at the release for `.tag(...)`.
   *
   * Idempotent, and quiet about it: a pointer already on the tag's release is
   * left untouched rather than re-written, so an unattended pipeline can run
   * this unconditionally without churning the release's audit history. A tag
   * with no release resolves to `state: "no-release"` rather than throwing —
   * the release may be cut by a later, human step — while a tag that does not
   * exist at all is an error, because the caller named it. Needs a token with
   * `contents: write`.
   */
  markReleaseLatest(
    configure?: Configure<GhReleaseLatestSettings>,
  ): Promise<GhReleaseLatestResult>;
}

/** Perform the configured mark-latest call. */
export async function markReleaseLatest(
  configure?: Configure<GhReleaseLatestSettings>,
): Promise<GhReleaseLatestResult> {
  const settings = configure?.(new GhReleaseLatestSettings()) ??
    new GhReleaseLatestSettings();
  const tag = settings.tag_;
  if (tag === undefined) {
    throw new Error("marking a release as latest requires .tag(...).");
  }
  // The tag is interpolated into a request path — the same reason the commit
  // operations validate theirs.
  assertRefName(tag, "release tag");
  const call = caller(
    settings.baseUrl_,
    settings.repoSlug_(),
    settings.authToken_(),
    settings.fetch_,
  );

  // Resolve the tag's release first: "no release yet" is the expected soft
  // outcome, and nothing should be written when it holds.
  let release: unknown;
  try {
    release = await call("GET", `/releases/tags/${encodePath(tag)}`);
  } catch (error) {
    if (error instanceof GhApiError && error.status === 404) {
      return { state: "no-release", tag };
    }
    throw error;
  }
  const releaseId = readNumber(release, "id", "release lookup");

  // Skip the write when the pointer is already right. A repository whose
  // latest-release lookup 404s has the pointer on nothing — GitHub hides
  // drafts and prereleases from it — so the write below is what sets it.
  let latestId: number | undefined;
  try {
    latestId = readNumber(
      await call("GET", "/releases/latest"),
      "id",
      "latest-release lookup",
    );
  } catch (error) {
    if (!(error instanceof GhApiError) || error.status !== 404) throw error;
  }
  if (latestId === releaseId) {
    return { state: "already-latest", tag, releaseId };
  }

  // `make_latest` is a string enum in the REST API, not a boolean.
  await call("PATCH", `/releases/${releaseId}`, { make_latest: "true" });
  return { state: "marked", tag, releaseId };
}
