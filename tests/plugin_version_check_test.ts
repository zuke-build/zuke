// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the gate's plugin-version check.
 *
 * The decision is separated from the git reads behind {@link GitHistory}, so
 * every case here runs against a fake history — no repository, no subprocess,
 * no network. What is asserted is the property that matters: the check fails
 * exactly when the published skills moved and the version did not, and it
 * reports itself *skipped* rather than passing when it cannot compare.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import {
  bumpFailure,
  checkPluginVersionBump,
  type GitHistory,
  isSkillPath,
  manifestVersion,
  PLUGIN_MANIFEST,
  resolveBaseRef,
  skillPaths,
  VERSIONED_MANIFESTS,
} from "../build/plugin_version_check.ts";

/** A fake history: a fixed changed-file list and a fixed base manifest. */
function fakeGit(options: {
  refs?: string[];
  changed?: string[];
  baseFiles?: Record<string, string>;
}): GitHistory {
  const refs = options.refs ?? ["origin/master"];
  return {
    hasRef: (ref) => Promise.resolve(refs.includes(ref)),
    changedSince: () => Promise.resolve(options.changed ?? []),
    fileAt: (_ref, path) => Promise.resolve(options.baseFiles?.[path] ?? null),
  };
}

/** A head reader serving one manifest version. */
function headAt(
  version: string | null,
): (path: string) => Promise<string | null> {
  return () =>
    Promise.resolve(version === null ? null : JSON.stringify({ version }));
}

Deno.test("skill paths are the two trees the marketplace serves", () => {
  assertEquals(isSkillPath("skills/zuke-write-build/SKILL.md"), true);
  assertEquals(isSkillPath("plugins/zuke/skills/zuke-setup/SKILL.md"), true);
  // The manifests themselves are not "skills" — changing only the version must
  // not itself demand another bump.
  assertEquals(isSkillPath(PLUGIN_MANIFEST), false);
  assertEquals(isSkillPath("docs/mcp.md"), false);
  assertEquals(isSkillPath("packages/core/src/mcp/server.ts"), false);
  assertEquals(
    skillPaths(["docs/a.md", "skills/x.md", "README.md"]),
    ["skills/x.md"],
  );
});

Deno.test("a manifest version is read, or reported missing rather than thrown", () => {
  assertEquals(manifestVersion('{"version":"0.3.0"}'), "0.3.0");
  assertEquals(manifestVersion(null), undefined);
  assertEquals(manifestVersion("not json{"), undefined);
  assertEquals(manifestVersion('{"version":3}'), undefined);
  assertEquals(manifestVersion("[]"), undefined);
});

Deno.test("skills changed and the version did not — the check fails", async () => {
  const verdict = await checkPluginVersionBump(
    fakeGit({
      changed: ["skills/zuke-write-build/SKILL.md", "plugins/zuke/skills/x.md"],
      baseFiles: { [PLUGIN_MANIFEST]: '{"version":"0.3.0"}' },
    }),
    "origin/master",
    headAt("0.3.0"),
  );
  assertEquals(verdict.checked, true);
  assertEquals(verdict.bumped, false);
  assertEquals(verdict.changed.length, 2);

  // The message has to name the fix — every version-carrying manifest, since
  // a bump landed in only some of them ships disagreeing listings — and what
  // actually changed.
  const message = bumpFailure(verdict);
  assertStringIncludes(message, "still 0.3.0");
  assertStringIncludes(message, "skills/zuke-write-build/SKILL.md");
  for (const manifest of VERSIONED_MANIFESTS) {
    assertStringIncludes(message, manifest);
  }
  assertStringIncludes(message, ".claude-plugin/marketplace.json");
  assertStringIncludes(message, "plugins/zuke/.codex-plugin/plugin.json");
  assertStringIncludes(message, "gemini-extension.json");
});

Deno.test("skills changed and the version moved — the check passes", async () => {
  const verdict = await checkPluginVersionBump(
    fakeGit({
      changed: ["skills/zuke-write-build/references/cheatsheet.md"],
      baseFiles: { [PLUGIN_MANIFEST]: '{"version":"0.2.0"}' },
    }),
    "origin/master",
    headAt("0.3.0"),
  );
  assertEquals(verdict.checked, true);
  assertEquals(verdict.bumped, true);
  assertEquals(verdict.baseVersion, "0.2.0");
  assertEquals(verdict.headVersion, "0.3.0");
});

Deno.test("a change that touches no skill needs no bump", async () => {
  // The common case: an ordinary source PR must not be asked to bump a plugin
  // it never touched.
  const verdict = await checkPluginVersionBump(
    fakeGit({
      changed: ["packages/core/src/mcp/server.ts", "docs/mcp.md"],
      baseFiles: { [PLUGIN_MANIFEST]: '{"version":"0.3.0"}' },
    }),
    "origin/master",
    headAt("0.3.0"),
  );
  assertEquals(verdict.checked, true);
  assertEquals(verdict.changed, []);
  assertEquals(verdict.bumped, false); // and the caller treats this as a pass
});

Deno.test("a missing base ref is reported skipped, never passed", async () => {
  // The one honest skip. It must not look like a success: `checked` is false,
  // and the caller prints the reason rather than a green line.
  const verdict = await checkPluginVersionBump(
    fakeGit({ refs: [], changed: ["skills/x.md"] }),
    "origin/master",
    headAt("0.3.0"),
  );
  assertEquals(verdict.checked, false);
  assertEquals(verdict.bumped, false);
  assertStringIncludes(verdict.reason ?? "", "origin/master");
});

Deno.test("a plugin absent at the base is new, so no bump is demanded", async () => {
  // Introducing the plugin on a branch: there is no previous version for the
  // new one to differ from, and demanding a bump would be unsatisfiable.
  const verdict = await checkPluginVersionBump(
    fakeGit({ changed: ["skills/x.md"], baseFiles: {} }),
    "origin/master",
    headAt("0.1.0"),
  );
  assertEquals(verdict.checked, true);
  assertEquals(verdict.bumped, true);
  assertEquals(verdict.baseVersion, undefined);
});

Deno.test("an unreadable head manifest fails the check, it does not skip it", async () => {
  // The working tree's manifest is the one file that must always be readable.
  // Treating it as "nothing to compare" would let a corrupted manifest through.
  const verdict = await checkPluginVersionBump(
    fakeGit({ changed: ["skills/x.md"] }),
    "origin/master",
    headAt(null),
  );
  assertEquals(verdict.checked, true);
  assertEquals(verdict.headVersion, undefined);
  assertStringIncludes(verdict.reason ?? "", PLUGIN_MANIFEST);
});

Deno.test("the base ref follows the PR base, then an override, then master", () => {
  const env = (values: Record<string, string>) => (name: string) =>
    values[name];
  assertEquals(resolveBaseRef(env({})), "origin/master");
  // On a GitHub PR the base is a bare branch name; a CI checkout has it as a
  // remote-tracking ref, so it is qualified.
  assertEquals(
    resolveBaseRef(env({ GITHUB_BASE_REF: "release-1" })),
    "origin/release-1",
  );
  // An explicit override wins, so a local clone can point at whatever it has.
  assertEquals(
    resolveBaseRef(
      env({ GITHUB_BASE_REF: "master", ZUKE_PLUGIN_BASE_REF: "HEAD~3" }),
    ),
    "HEAD~3",
  );
  // An empty value is not a value.
  assertEquals(resolveBaseRef(env({ GITHUB_BASE_REF: "" })), "origin/master");
});
