// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `@zuke/cli` version. Kept in sync with deno.json by release-please.
 *
 * Annotated `string` for the reason `@zuke/core`'s copy is: an inferred
 * literal type is what `deno doc` would record, and a generated doc that
 * pins the version goes stale the moment release-please bumps the marked
 * line. This constant is internal to the package today, so nothing generated
 * reads it — the annotation is what keeps that from mattering if it is ever
 * exported.
 */
export const VERSION: string = "1.5.3"; // x-release-please-version
