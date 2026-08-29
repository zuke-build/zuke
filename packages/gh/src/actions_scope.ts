// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What `gh secret` and `gh variable` share: the scope a value is set at, and
 * the two ways of supplying its value.
 *
 * Internal to the package — not exported from `mod.ts`. Both groups spell the
 * same flags (`--org`, `--env`, `--repos`, `--visibility`, `--body`,
 * `--env-file`) and both must refuse the same contradiction, so the rendering
 * and the guard live here once rather than in each settings class.
 *
 * @module
 */

/** Who an organization value is visible to (`--visibility`). */
export type GhScopeVisibility = "all" | "private" | "selected";

/** The scope flags, as the settings classes hold them. */
export interface GhScopeState {
  /** The organization the value belongs to (`--org`). */
  org?: string;
  /** The deployment environment it belongs to (`--env`). */
  environment?: string;
  /** The repositories an organization value is shared with (`--repos`). */
  repositories: string[];
  /** The visibility of an organization value (`--visibility`). */
  visibility?: GhScopeVisibility;
}

/**
 * Render the scope flags, after refusing the combinations gh resolves in its
 * own favour: an organization value cannot also be an environment value, and
 * naming repositories only means anything under `selected` visibility.
 */
export function scopeArgs(task: string, state: GhScopeState): string[] {
  if (state.org !== undefined && state.environment !== undefined) {
    throw new Error(
      `GhTasks.${task}: .org(...) sets an organization value and ` +
        ".environment(...) an environment one — pick one.",
    );
  }
  if (state.repositories.length > 0 && state.org === undefined) {
    throw new Error(
      `GhTasks.${task}: .repositories(...) shares an organization value, so ` +
        "it needs .org(...) — add it, or drop the repositories.",
    );
  }
  if (
    state.repositories.length > 0 && state.visibility !== undefined &&
    state.visibility !== "selected"
  ) {
    throw new Error(
      `GhTasks.${task}: .repositories(...) only applies to ` +
        '.visibility("selected") — set that visibility, or drop the ' +
        "repositories.",
    );
  }
  const argv: string[] = [];
  if (state.org !== undefined) argv.push("--org", state.org);
  if (state.environment !== undefined) argv.push("--env", state.environment);
  if (state.visibility !== undefined) {
    argv.push("--visibility", state.visibility);
  }
  if (state.repositories.length > 0) {
    argv.push("--repos", state.repositories.join(","));
  }
  return argv;
}

/**
 * Render the value flags, after refusing both at once: gh takes one source for
 * a value, and silently preferring one would hide which value was stored.
 */
export function valueArgs(
  task: string,
  body: string | undefined,
  envFile: string | undefined,
): string[] {
  if (body !== undefined && envFile !== undefined) {
    throw new Error(
      `GhTasks.${task}: .body(...) and .envFile(...) are two sources for the ` +
        "same value — pick one.",
    );
  }
  const argv: string[] = [];
  if (body !== undefined) argv.push("--body", body);
  if (envFile !== undefined) argv.push("--env-file", envFile);
  return argv;
}
