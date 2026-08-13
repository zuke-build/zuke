// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The gate's plugin-version check.
 *
 * `plugins/zuke` is published to a Claude Code plugin marketplace, and clients
 * use its declared version to decide whether an installed copy is stale. It is
 * not a workspace package — it has no `deno.json` and release-please does not
 * manage it — so the bump is manual, across every manifest in
 * {@link VERSIONED_MANIFESTS} (the Claude and Codex plugin manifests, the
 * marketplace entry, and the Gemini extension manifest), and nothing
 * downstream complains when it is missed. The failure is silent in the worst way: the PR
 * is green, the skills are correct in the repository, and every agent that
 * already holds the old version simply never sees them.
 *
 * `pluginSyncCheck` guards the other half — that the committed copies under
 * `plugins/zuke/skills/` match `skills/`. It cannot help here, because both
 * sides move together and the version sits outside them.
 *
 * This check needs history, which is what makes it different from the rest of
 * the gate: "the content changed but the version did not" is not a property of
 * one snapshot. It compares against a base ref, so it does real work in CI (and
 * in any clone that has the base) and honestly reports itself skipped when
 * there is nothing to compare against — never silently passing, which would
 * make it a check that cannot fail.
 *
 * @module
 */

import { GitTasks } from "@zuke/git";

/** The skills tree that is the source of truth for the plugin. */
export const SKILLS_DIR = "skills/";

/** The committed copy the plugin ships. */
export const PLUGIN_SKILLS_DIR = "plugins/zuke/skills/";

/** The plugin's own manifest, whose version the marketplace reads. */
export const PLUGIN_MANIFEST = "plugins/zuke/.claude-plugin/plugin.json";

/** The marketplace manifest listing the plugin. */
export const MARKETPLACE_MANIFEST = ".claude-plugin/marketplace.json";

/** The Codex-native copy of the plugin manifest. */
export const CODEX_PLUGIN_MANIFEST = "plugins/zuke/.codex-plugin/plugin.json";

/** The Gemini CLI extension manifest at the repo root. */
export const GEMINI_EXTENSION_MANIFEST = "gemini-extension.json";

/**
 * Every manifest that carries the plugin version. The bump is manual and must
 * land in all of them — `tests/plugin_manifest_test.ts` fails when they
 * disagree, and {@link bumpFailure} names them so the fix is one edit away.
 */
export const VERSIONED_MANIFESTS: readonly string[] = [
  PLUGIN_MANIFEST,
  CODEX_PLUGIN_MANIFEST,
  MARKETPLACE_MANIFEST,
  GEMINI_EXTENSION_MANIFEST,
];

/** Whether a changed path is part of what the plugin publishes. */
export function isSkillPath(path: string): boolean {
  return path.startsWith(SKILLS_DIR) || path.startsWith(PLUGIN_SKILLS_DIR);
}

/** The subset of `paths` that would change what the marketplace serves. */
export function skillPaths(paths: readonly string[]): string[] {
  return paths.filter(isSkillPath);
}

/**
 * Read `$.version` from a plugin manifest's text, or `undefined` when the text
 * is absent or carries no string version. A malformed manifest is reported as
 * missing rather than throwing: the caller decides whether that is fatal, and
 * for the *base* side it legitimately is not (the file may be new).
 */
export function manifestVersion(text: string | null): string | undefined {
  if (text === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return undefined;
    const version = parsed.version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a parsed JSON value is a plain object, narrowing it for field reads. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The git reads this check needs, injectable so the decision is testable. */
export interface GitHistory {
  /** Whether `ref` resolves in this clone. */
  hasRef(ref: string): Promise<boolean>;
  /** Paths differing between the merge base with `ref` and the working tree. */
  changedSince(ref: string): Promise<string[]>;
  /** A file's text at `ref`, or `null` when it did not exist there. */
  fileAt(ref: string, path: string): Promise<string | null>;
}

/** What {@link checkPluginVersionBump} concluded, for the caller to report. */
export interface BumpVerdict {
  /** Whether the comparison actually ran. `false` means nothing was proven. */
  checked: boolean;
  /** Why the comparison was skipped, when it was. */
  reason?: string;
  /** The skill files that changed against the base. */
  changed: string[];
  /** The plugin version at the base ref, when it could be read. */
  baseVersion?: string;
  /** The plugin version in the working tree. */
  headVersion?: string;
  /** Whether the version moved. Meaningless unless `checked` and `changed`. */
  bumped: boolean;
}

/**
 * Decide whether the plugin version was bumped alongside the skills it ships.
 *
 * Returns a verdict rather than throwing so the caller owns the message; see
 * {@link bumpFailure} for the failing case's text.
 */
export async function checkPluginVersionBump(
  git: GitHistory,
  base: string,
  readHead: (path: string) => Promise<string | null>,
): Promise<BumpVerdict> {
  if (!(await git.hasRef(base))) {
    return {
      checked: false,
      reason: `the base ref "${base}" is not present in this clone`,
      changed: [],
      bumped: false,
    };
  }
  const changed = skillPaths(await git.changedSince(base));
  const headVersion = manifestVersion(await readHead(PLUGIN_MANIFEST));
  if (headVersion === undefined) {
    // The working tree's manifest is the one thing that must always be
    // readable. An unreadable one is a real problem, not a reason to skip.
    return {
      checked: true,
      reason: `${PLUGIN_MANIFEST} has no readable string version`,
      changed,
      bumped: false,
    };
  }
  if (changed.length === 0) {
    return { checked: true, changed, headVersion, bumped: false };
  }
  const baseVersion = manifestVersion(await git.fileAt(base, PLUGIN_MANIFEST));
  // No manifest at the base means the plugin is new on this branch; there is
  // no previous version to differ from, so the bump requirement cannot apply.
  const bumped = baseVersion === undefined || baseVersion !== headVersion;
  return { checked: true, changed, baseVersion, headVersion, bumped };
}

/** The failure message for a verdict whose skills moved without a bump. */
export function bumpFailure(verdict: BumpVerdict): string {
  const listed = verdict.changed.slice(0, 5).map((p) => `  ${p}`).join("\n");
  const more = verdict.changed.length > 5
    ? `\n  …and ${verdict.changed.length - 5} more`
    : "";
  return [
    `The published skills changed but the plugin version did not (still ` +
    `${verdict.headVersion}).`,
    "",
    "Changed:",
    `${listed}${more}`,
    "",
    "Clients use this version to decide whether an installed plugin is stale,",
    "so skills shipped without a bump never reach agents holding the old copy.",
    "",
    `Bump the version in ALL of these manifests (they must agree):`,
    ...VERSIONED_MANIFESTS.map((path) => `  ${path}`),
    "Additive skill content is a minor bump; a correction is a patch.",
  ].join("\n");
}

/** Whether a failed git invocation means the ref simply is not there. */
function missingRef(stderr: string): boolean {
  return /unknown revision|bad revision|not a valid object name|ambiguous argument/i
    .test(stderr);
}

/** A {@link GitHistory} backed by the real `git` in the working directory. */
export function defaultGitHistory(): GitHistory {
  return {
    async hasRef(ref) {
      const out = await GitTasks.run((s) =>
        s.command("rev-parse", "--verify", `${ref}^{commit}`).noThrow().quiet()
      );
      return out.code === 0;
    },
    async changedSince(ref) {
      // Resolve the merge base first, then diff from it *without* the three-dot
      // form. Both exclude commits that landed on the base branch after this
      // one forked, which is the point — but `diff a...b` compares two commits
      // and so ignores the working tree entirely. That would make the check
      // pass locally for the person about to commit a skill edit with no bump,
      // fail only once CI saw it committed: green here, red there, which is the
      // exact failure mode the gate exists to prevent.
      const base = await GitTasks.run((s) =>
        s.command("merge-base", ref, "HEAD").noThrow().quiet()
      );
      if (base.code !== 0) {
        throw new Error(
          `git merge-base ${ref} HEAD failed: ${base.stderr.trim()}`,
        );
      }
      const out = await GitTasks.run((s) =>
        s.command("diff", "--name-only", base.stdout.trim()).noThrow().quiet()
      );
      if (out.code !== 0) {
        throw new Error(`git diff against ${ref} failed: ${out.stderr.trim()}`);
      }
      return out.stdout.split("\n").map((l) => l.trim()).filter((l) =>
        l !== ""
      );
    },
    async fileAt(ref, path) {
      const out = await GitTasks.run((s) =>
        s.command("show", `${ref}:${path}`).noThrow().quiet()
      );
      if (out.code === 0) return out.stdout;
      // A path absent at the base is an ordinary answer; anything else is not.
      if (/does not exist|exists on disk, but not in/i.test(out.stderr)) {
        return null;
      }
      if (missingRef(out.stderr)) return null;
      throw new Error(
        `git show ${ref}:${path} failed: ${out.stderr.trim()}`,
      );
    },
  };
}

/**
 * The base ref to compare against: GitHub's PR base when running on Actions,
 * else `origin/master`. Returned as a remote-tracking ref, which is what a CI
 * checkout has — `GITHUB_BASE_REF` is a bare branch name.
 */
export function resolveBaseRef(
  readEnv: (name: string) => string | undefined = Deno.env.get,
): string {
  const explicit = readEnv("ZUKE_PLUGIN_BASE_REF");
  if (explicit !== undefined && explicit !== "") return explicit;
  const prBase = readEnv("GITHUB_BASE_REF");
  if (prBase !== undefined && prBase !== "") return `origin/${prBase}`;
  return "origin/master";
}
