// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `@zuke/core` version — the framework version a run reports in its
 * opening banner.
 *
 * Core is what actually executes a build, and it is the only Zuke package a
 * project is guaranteed to have: `deno run -A zuke.ts` never loads
 * `@zuke/cli`. So this, not the CLI's version, is what identifies the
 * framework in a log.
 *
 * @module
 */

/** The `@zuke/core` version. Kept in sync with deno.json by release-please. */
export const VERSION = "1.56.0"; // x-release-please-version
