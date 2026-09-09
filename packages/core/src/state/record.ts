// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
import type { RunEvent } from "./types.ts";
import {
  ACTOR_KINDS,
  type ActorKind,
  type RunRecord,
  type TargetRunState,
  type TargetRunStatus,
} from "./types.ts";

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
 * Resolve whether a person or a machine asked for a run, by the same precedence
 * as {@link resolveActor}: the explicit `--actor-kind`, then `ZUKE_ACTOR_KIND`
 * (which the MCP registry runner exports for an authenticated caller), else
 * `"human"`.
 *
 * The default is the conservative one: a service claim is what lets a policy
 * treat a run as unowned machinery, so it must be stated rather than guessed
 * from an actor that happens to look like a bot. An unrecognised value is
 * treated as unstated for the same reason.
 */
export function resolveActorKind(
  explicit: string | undefined,
  readEnv: (name: string) => string | undefined,
): ActorKind {
  const candidate = explicit ?? readEnv("ZUKE_ACTOR_KIND");
  return ACTOR_KINDS.find((kind) => kind === candidate) ?? "human";
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
  /**
   * The build's resolved origin (see
   * {@link "../ownership.ts".resolveBuildId}), when one is set.
   */
  buildId?: string;
  /** The dotted name of the requested (root) target. */
  rootTarget: string;
  /** The resolved run actor — the record's first writer, and its initiator. */
  actor: string;
  /** Whether a person or a machine asked for the run (see {@link resolveActorKind}). */
  actorKind: ActorKind;
  /** ISO-8601 timestamp used for `createdAt` and the initial `updatedAt`. */
  now: string;
  /** The planned targets, in execution/declaration order. */
  order: TargetBuilder[];
  /** All discovered parameters (secrets are skipped when copying values). */
  params: Iterable<AnyParameter>;
  /** ISO-8601 deadline for the whole run, when the build sets one. */
  deadlineAt?: string;
}

/**
 * Build the initial {@link RunRecord} for a run: status `running`, a graph-shape
 * snapshot in declaration order, resolved non-secret parameters, and every
 * planned target seeded `pending`.
 */
/**
 * The parameters a run record carries: every resolved, **non-secret** value,
 * keyed by property name.
 *
 * The exclusion is the record's whole promise about secrets — it holds none by
 * construction — so this projection is the only way parameters reach a record,
 * whether the record is being created or updated by a resume that supplied
 * different values. An unset parameter is omitted rather than stored empty:
 * absent means "never supplied", which an empty string would not.
 */
export function recordedParams(
  params: Iterable<AnyParameter>,
): Record<string, string> {
  const recorded: Record<string, string> = {};
  for (const parameter of params) {
    if (parameter.secret_ || !parameter.isSet_()) continue;
    const value = parameter.stringValue_();
    if (parameter.name_ !== undefined && value !== undefined) {
      recorded[parameter.name_] = value;
    }
  }
  return recorded;
}

export function buildRunRecord(input: RunRecordInput): RunRecord {
  const graph = input.order.map((t) => ({
    name: t.name_ ?? "",
    dependsOn: dependencyNames(t),
  }));

  const params = recordedParams(input.params);

  const targets: Record<string, TargetRunState> = {};
  for (const t of input.order) {
    targets[t.name_ ?? ""] = { status: "pending", meta: {} };
  }

  return {
    id: input.runId,
    build: input.build,
    // Stamped only when resolved, so a record round-trips with the exact key
    // set it was written with and an absent origin stays absent rather than
    // becoming an origin that matches nothing.
    ...(input.buildId === undefined ? {} : { buildId: input.buildId }),
    rootTarget: input.rootTarget,
    status: "running",
    // Stamped here and never again. A deadline that were recomputed on each
    // resume would move forward every time, so a run could never reach it —
    // the same trap the wait deadlines avoid by being recorded once.
    ...(input.deadlineAt === undefined ? {} : { deadlineAt: input.deadlineAt }),
    actor: input.actor,
    // Stamped once, here, and never written again: this is the whole point of
    // the field, since `actor` above is rewritten by every later resume.
    initiator: {
      actor: input.actor,
      kind: input.actorKind,
      at: input.now,
    },
    createdAt: input.now,
    updatedAt: input.now,
    graph,
    params,
    targets,
    signals: {},
    events: [],
    degraded: false,
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

/**
 * The audit event recording that a resume ran with parameter values the launch
 * did not supply — or `undefined` when it supplied the same ones.
 *
 * The values themselves are deliberately **not** written back over
 * {@link RunRecord.params}. That field is not display-only: a cancellation
 * resolves each compensation body's parameters from it, so a run that deployed
 * to `sit` and was resumed with `prod` would have its rollback undo the `sit`
 * deploy against `prod`. A resumed run genuinely executes under two sets of
 * values, and one map cannot hold both — so `params` keeps the launch's, which
 * is what the targets a compensation unwinds actually ran on, and the override
 * is reported here instead. Nothing is overwritten, so a later resume still
 * merges from the launch's values rather than inheriting an earlier resumer's,
 * and a parameter the resumer's build no longer declares is not erased.
 *
 * `after` must already have been through {@link recordedParams}, so secrets are
 * excluded before they reach an event that is stored and displayed.
 */
export function paramOverrideEvent(
  before: Record<string, string>,
  after: Record<string, string>,
  actor: string,
  at: string,
): RunEvent | undefined {
  const changed: Record<string, string> = {};
  for (const [name, value] of Object.entries(after)) {
    if (before[name] !== value) changed[name] = value;
  }
  if (Object.keys(changed).length === 0) return undefined;
  return {
    at,
    tool: "resume",
    actor,
    outcome: "ok",
    args: changed,
    // Rendered into `detail` as well as carried in `args`, because
    // `zuke runs show` prints the detail and not the arguments — and a line
    // saying only that an override happened, without saying to what, would
    // leave a reader no better off than the misreport this replaces.
    detail: Object.entries(changed).map(([n, v]) => `${n}=${v}`).join(" "),
  };
}
