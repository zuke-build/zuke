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
    case "waiting":
      return "waiting";
  }
}

/**
 * Resolve who a run is attributed to, by precedence: the explicit `--actor`,
 * then `ZUKE_ACTOR`, then the CI actor (`GITHUB_ACTOR`), then any `extra`
 * lower-priority candidates (the MCP server passes a connecting client's
 * `initialize` name here), else `"anonymous"`. `extra` defaults to none, so
 * existing callers are unaffected.
 */
export function resolveActor(
  explicit: string | undefined,
  readEnv: (name: string) => string | undefined,
  extra: readonly (string | undefined)[] = [],
): string {
  const candidates = [
    explicit,
    readEnv("ZUKE_ACTOR"),
    readEnv("GITHUB_ACTOR"),
    ...extra,
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== "") return candidate;
  }
  return "anonymous";
}

/**
 * A URL for the current CI run, when derivable — used as a lock holder's
 * `runUrl` so a conflict can link to who holds it. GitHub Actions only for now
 * (`GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_RUN_ID`); `undefined`
 * elsewhere.
 */
export function ciRunUrl(
  readEnv: (name: string) => string | undefined,
): string | undefined {
  const server = readEnv("GITHUB_SERVER_URL");
  const repo = readEnv("GITHUB_REPOSITORY");
  const runId = readEnv("GITHUB_RUN_ID");
  if (server && repo && runId) {
    return `${server}/${repo}/actions/runs/${runId}`;
  }
  return undefined;
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
    signals: {},
    events: [],
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
