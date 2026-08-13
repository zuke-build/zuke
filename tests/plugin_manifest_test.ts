// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the Claude Code plugin's two manifests — the plugin's own
 * `plugins/zuke/.claude-plugin/plugin.json` and the marketplace entry in
 * `.claude-plugin/marketplace.json` that points at it.
 *
 * These are asserted here because nothing else fails when they disagree.
 * `pluginSyncCheck` guards the skills *content* (that the committed copies match
 * `skills/`), and release-please does not manage `plugins/` at all — so the
 * version is bumped by hand, in two files, and a bump applied to one of them
 * ships a marketplace listing whose advertised version does not match the
 * plugin it installs. A stale version is worse than a wrong one: clients use it
 * to decide whether an installed plugin needs re-fetching, so skills edited
 * without a bump simply never reach the agents that already have the old copy.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";

/** The plugin's own manifest. */
const PLUGIN: Record<string, unknown> = JSON.parse(
  Deno.readTextFileSync("plugins/zuke/.claude-plugin/plugin.json"),
);

/** The marketplace manifest that lists it. */
const MARKETPLACE: Record<string, unknown> = JSON.parse(
  Deno.readTextFileSync(".claude-plugin/marketplace.json"),
);

/** Whether a parsed JSON value is a plain object, narrowing it for field reads. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The marketplace's entry for the `zuke` plugin. */
function entry(): Record<string, unknown> {
  const plugins = MARKETPLACE.plugins;
  if (!Array.isArray(plugins)) throw new Error("marketplace has no plugins[]");
  const found = plugins.filter(isRecord).find((p) => p.name === "zuke");
  if (found === undefined) throw new Error("no marketplace entry named zuke");
  return found;
}

Deno.test("the plugin and its marketplace entry declare the same version", () => {
  // The bump is manual and lives in two files. Missing one publishes a listing
  // that advertises a version the plugin does not carry.
  assertEquals(
    entry().version,
    PLUGIN.version,
    "plugin.json and marketplace.json disagree on the plugin version",
  );
});

Deno.test("the plugin version is a plain semver triple", () => {
  // Clients compare these to decide whether an install is stale, so a
  // pre-release or a two-part version is not worth discovering at publish time.
  assertEquals(
    /^\d+\.\d+\.\d+$/.test(String(PLUGIN.version)),
    true,
    `plugin version is not a semver triple: ${String(PLUGIN.version)}`,
  );
});

Deno.test("the marketplace entry points at the plugin directory in this repo", () => {
  // A source that drifts from the real path resolves to nothing, and the
  // listing installs an empty plugin rather than failing loudly.
  assertEquals(entry().source, "./plugins/zuke");
  assertEquals(PLUGIN.name, "zuke");
});
