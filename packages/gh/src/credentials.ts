// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The repository and token resolution every API-backed settings class in this
 * package shares: the setting if it was named, the Actions environment if it
 * was not, and a friendly error naming the setter if neither.
 *
 * One copy, for the same reason `api.ts` holds one transport. Eight settings
 * classes each resolved these two values themselves, and each spelled the
 * "requires .repo('owner/name') (or GITHUB_REPOSITORY)" message again — so the
 * empty-string handling drifted between copies and a change to what "unset"
 * means had to be made in seven places or silently was not.
 *
 * Functions rather than a base class on purpose: the settings classes are
 * public, and an unexported superclass of an exported class is a first-party
 * `private-type-ref` — while exporting one would widen this package's API for
 * an implementation detail.
 *
 * @module
 */

import { env } from "./api.ts";

/**
 * The effective `owner/repo`, from the setting or `GITHUB_REPOSITORY`.
 *
 * `operation` is the gerund the caller's error message opens with — "posting a
 * check run", "committing" — so the message names what failed rather than
 * making the reader guess which of a build's GitHub calls it came from.
 */
export function resolveRepoSlug(
  repo: string | undefined,
  operation: string,
): string {
  const slug = repo ?? env("GITHUB_REPOSITORY");
  if (slug === undefined) {
    throw new Error(
      `${operation} requires .repo('owner/name') (or GITHUB_REPOSITORY).`,
    );
  }
  return slug;
}

/**
 * The effective token, from the setting or `GITHUB_TOKEN`.
 *
 * `hint` closes the sentence, and defaults to a full stop. An operation that
 * needs a specific permission spells it there — a 403 from GitHub names the
 * endpoint, not the scope the token was missing, so the error raised before the
 * call is the only place that can say it.
 */
export function resolveAuthToken(
  token: string | undefined,
  operation: string,
  hint = ".",
): string {
  const value = token ?? env("GITHUB_TOKEN");
  if (value === undefined) {
    throw new Error(
      `${operation} requires .token(...) (or GITHUB_TOKEN)${hint}`,
    );
  }
  return value;
}
