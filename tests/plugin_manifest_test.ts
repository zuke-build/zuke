// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the manifests that distribute the skills to the three
 * harnesses: the Claude Code plugin manifest and its marketplace entry, the
 * Codex-native copies of both, and the Gemini CLI extension manifest at the
 * repo root.
 *
 * These are asserted here because nothing else fails when they disagree.
 * `pluginSyncCheck` guards the skills *content* (that the committed copies match
 * `skills/`), and release-please does not manage `plugins/` at all — so the
 * version is bumped by hand, across every file in `VERSIONED_MANIFESTS`, and a
 * bump applied to only some of them ships a listing whose advertised version
 * does not match the plugin it installs. A stale version is worse than a wrong
 * one: clients use it to decide whether an installed plugin needs re-fetching,
 * so skills edited without a bump simply never reach the agents that already
 * have the old copy.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import {
  CODEX_PLUGIN_MANIFEST,
  GEMINI_EXTENSION_MANIFEST,
  MARKETPLACE_MANIFEST,
  PLUGIN_MANIFEST,
} from "../build/plugin_version_check.ts";

/** Parse one of the repo's JSON manifests. */
function readManifest(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Deno.readTextFileSync(path));
  if (!isRecord(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed;
}

/** The Claude plugin's own manifest. */
const PLUGIN = readManifest(PLUGIN_MANIFEST);

/** The Codex-native copy of the plugin manifest. */
const CODEX_PLUGIN = readManifest(CODEX_PLUGIN_MANIFEST);

/** The Claude marketplace manifest that lists the plugin. */
const MARKETPLACE = readManifest(MARKETPLACE_MANIFEST);

/** The Codex-native marketplace catalog. */
const CODEX_MARKETPLACE = readManifest(".agents/plugins/marketplace.json");

/** The Gemini CLI extension manifest at the repo root. */
const GEMINI = readManifest(GEMINI_EXTENSION_MANIFEST);

/** Whether a parsed JSON value is a plain object, narrowing it for field reads. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A marketplace manifest's entry for the `zuke` plugin. */
function entry(marketplace: Record<string, unknown>): Record<string, unknown> {
  const plugins = marketplace.plugins;
  if (!Array.isArray(plugins)) throw new Error("marketplace has no plugins[]");
  const found = plugins.filter(isRecord).find((p) => p.name === "zuke");
  if (found === undefined) throw new Error("no marketplace entry named zuke");
  return found;
}

Deno.test("every version-carrying manifest declares the same version", () => {
  // The bump is manual and lives in four files. Missing one publishes a
  // listing that advertises a version the plugin does not carry.
  const version = PLUGIN.version;
  assertEquals(
    entry(MARKETPLACE).version,
    version,
    "plugin.json and marketplace.json disagree on the plugin version",
  );
  assertEquals(
    CODEX_PLUGIN.version,
    version,
    ".codex-plugin/plugin.json disagrees with .claude-plugin/plugin.json",
  );
  assertEquals(
    GEMINI.version,
    version,
    "gemini-extension.json disagrees with the plugin version",
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

Deno.test("both marketplace manifests point at the plugin directory in this repo", () => {
  // A source that drifts from the real path resolves to nothing, and the
  // listing installs an empty plugin rather than failing loudly.
  assertEquals(entry(MARKETPLACE).source, "./plugins/zuke");
  assertEquals(PLUGIN.name, "zuke");

  // Codex's native catalog uses the structured source form; its path is
  // relative to the marketplace root (the repo root), same as Claude's.
  const source = entry(CODEX_MARKETPLACE).source;
  if (!isRecord(source)) throw new Error("codex entry source is not an object");
  assertEquals(source.source, "local");
  assertEquals(source.path, "./plugins/zuke");
});

Deno.test("the Codex plugin manifest mirrors the Claude one and declares its skills", () => {
  // Codex resolves `.codex-plugin/plugin.json` first when present, so the copy
  // must agree with the Claude manifest it shadows — and unlike hooks, the
  // `skills` path has no documented auto-default, so it is declared.
  assertEquals(CODEX_PLUGIN.name, PLUGIN.name);
  assertEquals(CODEX_PLUGIN.description, PLUGIN.description);
  assertEquals(CODEX_PLUGIN.license, PLUGIN.license);
  assertEquals(CODEX_PLUGIN.skills, "./skills/");
});

Deno.test("the Codex marketplace entry carries the required policy fields", () => {
  // The Codex docs require policy.installation, policy.authentication, and
  // category on every entry; an entry without them is not installable.
  const codexEntry = entry(CODEX_MARKETPLACE);
  const policy = codexEntry.policy;
  if (!isRecord(policy)) throw new Error("codex entry has no policy object");
  assertEquals(policy.installation, "AVAILABLE");
  assertEquals(typeof policy.authentication, "string");
  assertEquals(typeof codexEntry.category, "string");
});

Deno.test("the Gemini extension is named for the repo and finds skills/ at its root", () => {
  // `gemini extensions install` requires the manifest at the repo root, and
  // the extension name must match the installed directory — the repo name.
  assertEquals(GEMINI.name, "zuke");
  assertEquals(
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(GEMINI.name)),
    true,
    "gemini extension names are lowercase with dashes",
  );
  // Gemini auto-discovers `skills/` next to the manifest — the same tree the
  // other harnesses treat as the source of truth. If it moves, the extension
  // silently ships zero skills.
  assertEquals(Deno.statSync("skills/zuke-setup/SKILL.md").isFile, true);
  assertEquals(Deno.statSync("skills/zuke-write-build/SKILL.md").isFile, true);
});
