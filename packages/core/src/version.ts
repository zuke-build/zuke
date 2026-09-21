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

/**
 * The `@zuke/core` version. Kept in sync with deno.json by release-please.
 *
 * Annotated `string` rather than left to inference on purpose. Without the
 * annotation the declared type is the version itself, as a string literal
 * type, and `deno doc` records a declared type verbatim — so the version
 * would be baked into `llms-full.txt` and the package README. release-please
 * rewrites the marked line below when it cuts a release but cannot run
 * `deno doc`, so those generated files would drift on every bump and
 * `apiDocsCheck` would fail on the release PR itself. Widening keeps a
 * version bump a self-contained edit.
 */
export const VERSION: string = "1.57.0"; // x-release-please-version
