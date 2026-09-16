// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Create a GitHub release for a tag that has none, without ever touching one
 * that does.
 *
 * The operation a pipeline needs when the tag line and the release line can
 * drift apart. A release is cut by tagging, and the release *record* — the
 * thing the releases page, the "Latest release" pointer and the Marketplace
 * listing all read — is a separate write that nothing forces to happen. When
 * that second write is left to a human it eventually does not happen, and
 * nothing fails: the tag is correct, so every later run reports success while
 * everything keyed on the release quietly does nothing.
 *
 * ```ts
 * await GhTasks.ensureRelease((s) =>
 *   s.tag("v1.2.3").name("Zuke Build v1.2.3").body(notes).latest()
 * );
 * ```
 *
 * Idempotent, and non-destructive with it: a tag that already has a release is
 * reported as `exists` and nothing is written. That is what makes it safe to
 * run unconditionally on every push — and it is also what keeps a maintainer's
 * hand-written notes. Generated notes are a floor, not a correction.
 *
 * {@link "./gh.ts".GhTasks.releaseCreate} is the other way to do this, through
 * `gh release create`. It needs the `gh` binary and its own credentials; this
 * needs a token and nothing else, which is what an unattended job minting an
 * app installation token already has.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import {
  assertRefName,
  caller,
  DEFAULT_BASE_URL,
  encodePath,
  GhApiError,
  readNumber,
  readString,
} from "./api.ts";
import { resolveAuthToken, resolveRepoSlug } from "./credentials.ts";

/** What became of a {@link GhReleaseEnsureApi.ensureRelease} call. */
export interface GhReleaseEnsureResult {
  /**
   * `created` when this call published the release; `exists` when the tag
   * already had one and nothing was written.
   */
  state: "created" | "exists";
  /** The tag the release is attached to. */
  tag: string;
  /** The release's id. */
  releaseId: number;
  /** The release's page, for a log line a human can follow. */
  url: string;
}

/**
 * Settings for ensuring a release exists.
 *
 * `owner/repo` and the token fall back to the Actions environment, so a job
 * that already has them names only the release.
 */
export class GhReleaseEnsureSettings {
  /** The tag to release. Set by {@link tag}. */
  tag_?: string;
  /** The release title. Set by {@link name}. */
  name_?: string;
  /** The release notes. Set by {@link body}. */
  body_?: string;
  /** Whether to move the "Latest release" pointer. Set by {@link latest}. */
  latest_ = false;
  /** `owner/repo`. Set by {@link repo}. */
  repo_?: string;
  /** The token. Set by {@link token}. */
  token_?: string;
  /** The API root. Set by {@link baseUrl}. */
  baseUrl_: string = DEFAULT_BASE_URL;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;

  /**
   * The tag to release (required).
   *
   * It should already exist. GitHub creates a missing tag on the default
   * branch rather than refusing, so a typo here publishes a tag as well as a
   * release — which is why the caller that reconciles a backlog reads its tags
   * from git rather than composing them.
   */
  tag(value: string): this {
    this.tag_ = value;
    return this;
  }

  /** The release title (required), e.g. `Zuke Build v1.2.3`. */
  name(text: string): this {
    this.name_ = text;
    return this;
  }

  /** The release notes (required); pass `""` for a release with none. */
  body(text: string): this {
    this.body_ = text;
    return this;
  }

  /**
   * Move the repository's "Latest release" pointer onto this release.
   *
   * Off unless asked, which is the opposite of GitHub's own default — it
   * treats a new release as latest unless told otherwise. The default is
   * inverted because the first thing this is used for is back-filling
   * releases a pipeline missed, and those are created oldest-first: taking
   * GitHub's default would walk the pointer backwards through the backlog and
   * leave it on whichever release was created last, which is the oldest one.
   * Naming it explicitly costs the one caller that wants it a method call, and
   * costs the ones that do not want it nothing at all.
   */
  latest(value = true): this {
    this.latest_ = value;
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
    return resolveRepoSlug(this.repo_, "ensuring a release exists");
  }

  /** The effective token, from the setting or the environment. */
  authToken_(): string {
    return resolveAuthToken(
      this.token_,
      "ensuring a release exists",
      " with contents: write.",
    );
  }
}

/** The ensure-release operation {@link GhTasks} exposes. */
export interface GhReleaseEnsureApi {
  /**
   * Publish a release for `.tag(...)` unless it already has one.
   *
   * Reads the tag's release first and returns `state: "exists"` when there is
   * one, writing nothing — so an unattended pipeline can run this on every
   * push without overwriting notes a maintainer wrote by hand. Needs a token
   * with `contents: write`.
   */
  ensureRelease(
    configure?: Configure<GhReleaseEnsureSettings>,
  ): Promise<GhReleaseEnsureResult>;
}

/** Perform the configured ensure-release call. */
export async function ensureRelease(
  configure?: Configure<GhReleaseEnsureSettings>,
): Promise<GhReleaseEnsureResult> {
  const settings = configure?.(new GhReleaseEnsureSettings()) ??
    new GhReleaseEnsureSettings();
  // One check each rather than a loop over the field names: a loop is not
  // something the compiler can narrow through, so it would have to be followed
  // by a second, unreachable guard to get the three values typed.
  const { tag_: tag, name_: name, body_: body } = settings;
  if (tag === undefined) {
    throw new Error("ensuring a release exists requires .tag(...).");
  }
  if (name === undefined) {
    throw new Error("ensuring a release exists requires .name(...).");
  }
  if (body === undefined) {
    throw new Error("ensuring a release exists requires .body(...).");
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

  // Look before writing. A release that exists is the steady state, not an
  // error, and re-publishing over it would replace notes somebody wrote.
  try {
    const existing = await call("GET", `/releases/tags/${encodePath(tag)}`);
    return {
      state: "exists",
      tag,
      releaseId: readNumber(existing, "id", "release lookup"),
      url: readString(existing, ["html_url"], "release lookup"),
    };
  } catch (error) {
    if (!(error instanceof GhApiError) || error.status !== 404) throw error;
  }

  // `make_latest` is a string enum in the REST API, not a boolean — the same
  // wrinkle `markReleaseLatest` handles on the PATCH.
  const created = await call("POST", "/releases", {
    tag_name: tag,
    name,
    body,
    make_latest: settings.latest_ ? "true" : "false",
  });
  return {
    state: "created",
    tag,
    releaseId: readNumber(created, "id", "release creation"),
    url: readString(created, ["html_url"], "release creation"),
  };
}
