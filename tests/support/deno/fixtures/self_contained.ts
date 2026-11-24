// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A module that imports nothing, so building its graph with `deno info` needs
 * no network and no lockfile resolution. Used by the `moduleGraph` reader's
 * end-to-end tests, which address it by `file://` URL — the one form of
 * module reference that is byte-identical on every OS, with no path
 * separator, drive letter or short-name ambiguity.
 */

/** The value the fixture exports; nothing reads it, the graph is the point. */
export const answer = 42;
