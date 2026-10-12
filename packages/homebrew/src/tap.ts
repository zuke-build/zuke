// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tap names, in both the spellings Homebrew users meet them.
 *
 * `brew tap owner/x` is a shortcut for the GitHub repository
 * `owner/homebrew-x`: Homebrew adds the prefix itself. So a tap is written
 * `owner/x` in every `brew` command and `owner/homebrew-x` on GitHub, and a
 * build that publishes to one will have whichever spelling its author thought
 * of first. Both are accepted, and both mean the same repository.
 *
 * @module
 */

/** A GitHub owner or repository name segment. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The prefix GitHub tap repositories carry. */
const PREFIX = "homebrew-";

/**
 * Resolve `owner/x` or `owner/homebrew-x` to the tap's GitHub repository,
 * `owner/homebrew-x`.
 *
 * @throws {Error} when the value is not exactly two segments of letters,
 *   digits, `.`, `-` and `_` — a third segment or a `..` would point the
 *   token-bearing write at some other repository — or when the tap part is
 *   empty once the prefix is removed.
 */
export function tapRepository(value: string): string {
  const parts = value.split("/");
  const [owner, repository] = parts;
  const wellFormed = parts.length === 2 &&
    parts.every((part) => SEGMENT.test(part) && !part.includes(".."));
  const tap = repository?.startsWith(PREFIX)
    ? repository.slice(PREFIX.length)
    : repository;
  if (!wellFormed || tap === undefined || !SEGMENT.test(tap)) {
    throw new Error(
      `invalid tap ${JSON.stringify(value)}: expected "owner/homebrew-name" ` +
        `or brew's short "owner/name" (letters, digits, ".", "-", "_").`,
    );
  }
  return `${owner}/${PREFIX}${tap}`;
}
