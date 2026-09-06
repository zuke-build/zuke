// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The role model behind MCP authorization: what a caller holds, what a call
 * needs, and the default policy that decides between them.
 *
 * Three built-in roles are **ordered** — `read` < `run` < `operator` — so an
 * operator satisfies a requirement for `run` without being granted it
 * separately. Any other role name is matched by exact membership, because an
 * identity provider's own group names (`sre`, `release-manager`) do not sort
 * into three tiers and must still be usable with `requiresRole`.
 *
 * A run-scoped mutation is the one decision that is not about roles alone: it
 * asks whether this caller *owns* the run, which is what
 * {@link "../state/types.ts".RunRecord.initiator} records.
 *
 * @module
 */

import type { RunSummary } from "../state/types.ts";
import type { McpIdentity } from "./auth.ts";
import { isMutatingRunTool } from "./runtools.ts";

/**
 * The built-in roles, least to most privileged. A caller holding one satisfies
 * a requirement for any role at or below it.
 */
export const ROLE_TIERS: readonly string[] = ["read", "run", "operator"];

/**
 * Whether a caller holding `held` satisfies a requirement for `required`.
 *
 * A built-in role is satisfied by any built-in at or above it; anything else is
 * satisfied only by holding that exact name. The two rules cannot be collapsed:
 * ordering a name the model does not know would mean guessing where an identity
 * provider's group sits in a hierarchy it never agreed to.
 */
export function satisfiesRole(
  held: readonly string[],
  required: string,
): boolean {
  const rank = ROLE_TIERS.indexOf(required);
  if (rank === -1) return held.includes(required);
  return held.some((role) => {
    const heldRank = ROLE_TIERS.indexOf(role);
    return heldRank !== -1 && heldRank >= rank;
  });
}

/** What is being authorized — one MCP tool call, described for a policy. */
export interface McpCall {
  /** The tool name, e.g. `run:deploy`, `cancel_run`, `list_runs`. */
  tool: string;
  /** The target a `run:` call names, when it names one. */
  target?: string;
  /**
   * Every role declared with `.requiresRole(...)` **anywhere in the plan** this
   * call would execute — not just on the target it names.
   *
   * Invoking a target runs its dependencies, so a requirement that only guarded
   * the entry point would be bypassed by invoking anything that depends on it.
   * This mirrors `--protect`, which is enforced across the whole plan for the
   * same reason. The caller must satisfy all of them.
   */
  requiredRoles?: readonly string[];
  /**
   * The run a run-scoped call acts on, when it acts on one. Absent for a sweep
   * over every run, which no single run's owner can authorize.
   */
  run?: RunSummary;
}

/** A policy's verdict on one call. */
export type McpAuthorization =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string };

/** Allow, as a shared constant — every allow is identical. */
const ALLOW: McpAuthorization = Object.freeze({ allow: true as const });

/** Deny, with the reason that is audited and returned to the caller. */
function deny(reason: string): McpAuthorization {
  return { allow: false, reason };
}

/** The tools that only read, and so need no more than `read`. */
function isReadOnlyTool(tool: string): boolean {
  return tool.startsWith("list_") || tool.startsWith("show_") ||
    tool.startsWith("describe_") || tool === "graph";
}

/**
 * The tools that act on **one** run, and so ask who owns it — the mutating
 * run-state tools, whose membership `runtools.ts` already owns so the two
 * classifications cannot drift apart. `resume_check` is among them; without a
 * run named it sweeps every run and is handled as an operator action.
 */
function isRunScopedTool(tool: string): boolean {
  return isMutatingRunTool(tool);
}

/**
 * The shipped default policy.
 *
 * | Call | Needs |
 * | --- | --- |
 * | `list_*` / `show_*` / `describe_*` | `read` |
 * | `run:<target>` | `run`, **and** the target's `requiresRole` when it declares one |
 * | a run-scoped mutation | the run's initiator, or `operator` |
 * | a sweep over every run | `operator` |
 *
 * A run whose initiator is a **service** may be steered by any caller holding
 * `run`: a scheduler's run has no person to ask, and treating the scheduler as
 * its owner would mean nobody could intervene. Documented, and overridable by
 * `Build.mcpAuthorize`.
 */
export function defaultMcpAuthorize(
  identity: McpIdentity,
  call: McpCall,
): McpAuthorization {
  // An identity that claimed no roles at all does not speak roles — a
  // header-trusting `mcpIdentity()` hook, which predates them. There is nothing
  // to decide with, so this policy allows and the server's own gates stand
  // alone. The server settles an `mcpAuth()` identity's absent list to empty
  // before calling, so that case denies here rather than arriving unclaimed:
  // less information must never buy more privilege.
  const held = identity.roles;
  if (held === undefined) return ALLOW;

  if (isReadOnlyTool(call.tool)) {
    return satisfiesRole(held, "read")
      ? ALLOW
      : deny(`${call.tool} needs the "read" role`);
  }

  if (isRunScopedTool(call.tool)) {
    // A run-scoped call still executes whatever the run's plan declares, so a
    // target's own requirement applies here exactly as it does to `run:`.
    for (const required of call.requiredRoles ?? []) {
      if (!satisfiesRole(held, required)) {
        return deny(`${call.tool} needs the "${required}" role`);
      }
    }
    // No run named: a sweep touches every run at once, which no single run's
    // owner is in a position to authorize.
    if (call.run === undefined) {
      return satisfiesRole(held, "operator")
        ? ALLOW
        : deny(`${call.tool} over every run needs the "operator" role`);
    }
    if (satisfiesRole(held, "operator")) return ALLOW;
    if (!satisfiesRole(held, "run")) {
      return deny(`${call.tool} needs at least the "run" role`);
    }
    const initiator = call.run.initiator;
    // A service-initiated run is machinery: any `run` caller may steer it,
    // because the alternative is that nobody can.
    if (initiator?.kind === "service") return ALLOW;
    const owner = initiator?.actor ?? call.run.actor;
    return owner === identity.actor ? ALLOW : deny(
      `${call.tool} on a run started by "${owner}" needs that initiator ` +
        `or the "operator" role`,
    );
  }

  // Everything else runs build code: `run:<target>`, and any future tool that
  // executes rather than reads. `run` is the floor for all of them.
  if (!satisfiesRole(held, "run")) {
    return deny(`${call.tool} needs the "run" role`);
  }
  // Each declared requirement is checked *in addition*, so they can only raise
  // the bar. Requiring one instead of `run` would let `requiresRole("read")`
  // hand a read-only caller the ability to execute build code — a declaration
  // in the build silently widening what the server exposes.
  for (const required of call.requiredRoles ?? []) {
    if (!satisfiesRole(held, required)) {
      return deny(`${call.tool} needs the "${required}" role`);
    }
  }
  return ALLOW;
}
