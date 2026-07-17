/**
 * Building a {@link RunRecord} from a planned build, and the small mappings the
 * executor needs to keep the record current.
 *
 * Secrets are excluded structurally: only non-secret parameter values are
 * copied into {@link RunRecord.params}. The record's per-target status is a
 * different vocabulary from the executor's {@link TargetStatus} — see
 * {@link recordStatusOf}.
 *
 * @module
 */

import type { TargetStatus } from "../build.ts";
import type { AnyParameter } from "../params.ts";
import type { TargetBuilder } from "../target.ts";
import type { RunRecord, TargetRunState, TargetRunStatus } from "./types.ts";

/** Map an executor {@link TargetStatus} onto a {@link TargetRunStatus}. */
export function recordStatusOf(status: TargetStatus): TargetRunStatus {
  switch (status) {
    case "passed":
    case "cached":
      return "succeeded";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
  }
}

/**
 * Resolve who a run is attributed to: the explicit `--actor`, then
 * `ZUKE_ACTOR`, then the CI actor (`GITHUB_ACTOR`), else `"anonymous"`. A later
 * milestone widens this to bearer-token and MCP-client identities.
 */
export function resolveActor(
  explicit: string | undefined,
  readEnv: (name: string) => string | undefined,
): string {
  const candidates = [explicit, readEnv("ZUKE_ACTOR"), readEnv("GITHUB_ACTOR")];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== "") return candidate;
  }
  return "anonymous";
}

/** The inputs needed to build a run's initial {@link RunRecord}. */
export interface RunRecordInput {
  /** The run's unique id. */
  runId: string;
  /** The build class name. */
  build: string;
  /** The dotted name of the requested (root) target. */
  rootTarget: string;
  /** The resolved run actor. */
  actor: string;
  /** ISO-8601 timestamp used for `createdAt` and the initial `updatedAt`. */
  now: string;
  /** The planned targets, in execution/declaration order. */
  order: TargetBuilder[];
  /** All discovered parameters (secrets are skipped when copying values). */
  params: Iterable<AnyParameter>;
}

/**
 * Build the initial {@link RunRecord} for a run: status `running`, a graph-shape
 * snapshot in declaration order, resolved non-secret parameters, and every
 * planned target seeded `pending`.
 */
export function buildRunRecord(input: RunRecordInput): RunRecord {
  const graph = input.order.map((t) => ({
    name: t.name_ ?? "",
    dependsOn: dependencyNames(t),
  }));

  const params: Record<string, string> = {};
  for (const parameter of input.params) {
    if (parameter.secret_ || !parameter.isSet_()) continue;
    const value = parameter.stringValue_();
    if (parameter.name_ !== undefined && value !== undefined) {
      params[parameter.name_] = value;
    }
  }

  const targets: Record<string, TargetRunState> = {};
  for (const t of input.order) {
    targets[t.name_ ?? ""] = { status: "pending", meta: {} };
  }

  return {
    id: input.runId,
    build: input.build,
    rootTarget: input.rootTarget,
    status: "running",
    actor: input.actor,
    createdAt: input.now,
    updatedAt: input.now,
    graph,
    params,
    targets,
  };
}

/** The dotted names of a target's direct dependencies (undefined names dropped). */
function dependencyNames(target: TargetBuilder): string[] {
  const names: string[] = [];
  for (const dependency of target.dependsOn_) {
    if (dependency.name_ !== undefined) names.push(dependency.name_);
  }
  return names;
}
