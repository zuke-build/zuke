// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Planning a run before any body executes: resolving the build's declared
 * parameters, evaluating the up-front conditions that prune targets, narrowing
 * the plan to the targets a change can reach, and flagging ordering edges that
 * can never apply.
 *
 * Sequencing itself belongs to `./graph.ts`; this module holds the decisions
 * {@link "./executor.ts".execute} makes around that plan.
 *
 * @module
 */

import type { Build } from "./build.ts";
import type { TargetBuilder } from "./target.ts";
import type { OrderingEdge } from "./graph.ts";
import type { Reporter } from "./reporter.ts";
import type { Redactor } from "./redact.ts";
import {
  type AnyParameter,
  discoverParameters,
  resolveParameters,
} from "./params.ts";
import {
  type AffectedOptions,
  affectedTargets,
  gitChangedFiles,
} from "./affected.ts";
import { isCI } from "./host.ts";

/** Prompt for a missing required parameter, only at an interactive (non-CI) TTY. */
export function defaultPrompt(
  flag: string,
  description: string | undefined,
): string | undefined {
  let interactive = false;
  try {
    interactive = Deno.stdin.isTerminal();
  } catch {
    interactive = false;
  }
  if (!interactive || isCI()) return undefined;
  const label = description ? `--${flag} (${description})` : `--${flag}`;
  return prompt(`${label}:`) ?? undefined;
}

/**
 * Resolve every declared parameter (CLI value → environment → default) and
 * register each secret's resolved value with the redactor.
 */
export async function resolveRunParameters(
  build: Build,
  values: Record<string, string>,
  readEnv: (name: string) => string | undefined,
  prompt: (flag: string, description: string | undefined) => string | undefined,
  redactor: Redactor,
): Promise<{ params: Map<string, AnyParameter>; errors: string[] }> {
  // Resolve declared parameters (CLI value → environment → default) before any
  // target runs, so a target body can read `this.param.value`. A missing
  // required parameter or an invalid value fails the build before it starts.
  const params = discoverParameters(build);
  const errors = await resolveParameters(
    params,
    values,
    readEnv,
    prompt,
    redactor,
  );
  // Register each secret's final parsed value too — its raw form was already
  // added during resolution, but a source that trims or a parser that
  // normalises could yield a slightly different printed string.
  for (const p of params.values()) {
    if (!p.secret_) continue;
    const value = p.stringValue_();
    if (value !== undefined && value !== "") redactor.add(value);
  }
  return { params, errors };
}

/**
 * Report ordering edges that can never apply: an endpoint that is neither in
 * this run's execution set nor a declared build target.
 */
export function reportDanglingEdges(
  extraEdges: readonly OrderingEdge[],
  order: readonly TargetBuilder[],
  declared: Iterable<TargetBuilder>,
  reporter: Reporter,
): void {
  // Flag ordering edges that can never apply: an endpoint that is neither in this
  // run's execution set nor a declared build target is dead weight (silently
  // dropped otherwise). A declared target simply not in this run — a conditional
  // target — is legitimately ignored, so it is not flagged. This catches feeding
  // ad-hoc or fan-out per-item names into orderWith/extraEdges: per-item fan-out
  // ordering is not expressible (order whole fan-out waves with .dependsOn).
  if (extraEdges.length > 0) {
    const inRun = new Set(order);
    const declaredSet = new Set(declared);
    const dangling = new Set<string>();
    for (const edge of extraEdges) {
      for (const endpoint of edge) {
        // `endpoint &&` tolerates a malformed edge (a consumer bypassing the
        // OrderingEdge type to pass a nullish endpoint) instead of crashing on
        // `.name_`, matching planEdges' silent tolerance of such edges.
        if (endpoint && !inRun.has(endpoint) && !declaredSet.has(endpoint)) {
          dangling.add(endpoint.name_ ?? "<unnamed>");
        }
      }
    }
    for (const name of dangling) {
      reporter.info(
        `ordering: an edge references "${name}", which is not a target in this ` +
          `build — the edge is ignored. orderWith/extraEdges see only ` +
          `class-field targets, not fan-out sub-targets (order whole fan-out ` +
          `waves with .dependsOn instead).`,
      );
    }
  }
}

/**
 * Evaluate up-front conditions for `whenSkipped("skip-dependencies")` targets;
 * return the names to skip — those targets plus any dependencies that no other
 * target in the plan needs.
 */
export async function conditionSkips(
  root: TargetBuilder,
  order: TargetBuilder[],
): Promise<Set<string>> {
  const pruned = new Set<TargetBuilder>();
  for (const t of order) {
    if (!t.skipDependencies_ || t.onlyWhen_.length === 0) continue;
    let run = true;
    for (const condition of t.onlyWhen_) {
      if (!(await condition())) {
        run = false;
        break;
      }
    }
    if (!run) pruned.add(t);
  }
  if (pruned.size === 0) return new Set();

  // Everything still reachable from the root without pulling dependencies in
  // *through* a pruned target.
  const kept = new Set<TargetBuilder>();
  const walk = (node: TargetBuilder) => {
    if (node === undefined || kept.has(node)) return;
    kept.add(node);
    if (pruned.has(node)) return;
    for (const dep of node.dependsOn_) walk(dep);
    for (const trigger of node.triggers_) walk(trigger);
  };
  walk(root);

  const names = new Set<string>();
  for (const t of pruned) names.add(t.name_ ?? "");
  for (const t of order) if (!kept.has(t)) names.add(t.name_ ?? "");
  return names;
}

/**
 * Narrow the plan to the targets a change can reach, adding every unaffected
 * planned target's name to `skip` (CLI `--affected`).
 */
export async function applyAffectedSkips(
  options: AffectedOptions,
  order: readonly TargetBuilder[],
  skip: Set<string>,
  reporter: Reporter,
): Promise<void> {
  const base = options.base ?? "HEAD";
  const changedFiles = options.changedFiles ?? gitChangedFiles;
  const affected = affectedTargets(order, await changedFiles(base));
  for (const t of order) {
    if (!affected.has(t)) skip.add(t.name_ ?? "<unnamed>");
  }
  if (affected.size === 0) {
    reporter.info(`No targets affected by changes since ${base}.`);
  }
}
