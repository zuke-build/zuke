// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `ci` list of the manifest: the CI files a build declares, each as
 * `cicd(...)` takes it, with targets named rather than referenced. Parsed
 * field by field like the rest of the manifest, and turned into a `CiFile`
 * once the materialiser can resolve the names, so `generate-ci` renders for a
 * worker-described build exactly what it renders for a `zuke.ts` one.
 *
 * @module
 */

import {
  type CiBootstrap,
  type CiCheckout,
  type CiConcurrency,
  type CiEnvironment,
  CiFile,
  type CiHardenRunner,
  type CiInvocation,
  type CiJob,
  type CiMatrixAxes,
  type CiMatrixRow,
  type CiPathFilter,
  type CiPipeline,
  type CiProvider,
  type CiStep,
  type CiTriggers,
  type CiUses,
  type FanOutOptions,
  type ScheduleEntry,
  type TargetBuilder,
} from "@zuke/core";
import { type Fields, fieldsOf, isRecord } from "./fields.ts";

/** An invoked target as the manifest names it, and the targets it runs after. */
export interface ManifestCiInvocation
  extends Omit<CiInvocation, "target" | "after"> {
  /** The target the job runs. */
  readonly target: string;
  /** Extra `needs:` edges, by target name. */
  readonly after?: readonly string[];
}

/** One CI file the build declares. */
export interface ManifestCi {
  /**
   * The field the file is declared on, which names its default path:
   * `releaseWorkflow` writes `.github/workflows/release.yml`.
   */
  readonly name: string;
  /** The provider to render for; GitHub when omitted. */
  readonly provider?: CiProvider;
  /** The output path, overriding the one the name implies. */
  readonly path?: string;
  /** The pipeline-level fields, and the jobs unless `invokes` or `fanOut` supply them. */
  readonly pipeline?: CiPipeline;
  /** The targets to run as jobs, bare or with the runner's adjustments. */
  readonly invokes?: readonly ManifestCiInvocation[];
  /** One job per target in the graph; the options without a command, which stays the launcher. */
  readonly fanOut?: boolean | FanOutOptions;
  /** Pinned action references by action name: what a `pins` resolver answers. */
  readonly pins?: Readonly<Record<string, CiUses>>;
}

const PROVIDERS: readonly CiProvider[] = [
  "github",
  "gitlab",
  "azure",
  "bitbucket",
];
const EGRESS = ["audit", "block"] as const;

/** `{ key: value }`, or nothing when the value is unset, so parsed objects carry only the fields given. */
function opt<K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  const out: { [P in K]?: V } = {};
  if (value !== undefined) out[key] = value;
  return out;
}

function oneOf<T extends string>(
  f: Fields,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = f.raw(name);
  if (value === undefined) return undefined;
  return allowed.find((a) => a === value) ??
    f.reject(name, `be one of ${allowed.join(", ")}`);
}

function uses(f: Fields, name: string): CiUses | undefined {
  const value = f.raw(name);
  if (value === undefined || typeof value === "string") return value;
  const o = f.objectOr(name);
  return { ref: o.string("ref"), ...opt("version", o.stringIfSet("version")) };
}

function step(s: Fields): CiStep {
  return {
    ...opt("name", s.stringIfSet("name")),
    ...opt("id", s.stringIfSet("id")),
    ...opt("if", s.stringIfSet("if")),
    ...opt("shell", s.stringIfSet("shell")),
    ...opt("continueOnError", s.booleanIfSet("continueOnError")),
    ...opt("run", s.stringIfSet("run")),
    ...opt("uses", uses(s, "uses")),
    ...opt("with", s.stringMapIfSet("with")),
    ...opt("env", s.stringMapIfSet("env")),
  };
}

function steps(f: Fields, name: string): CiStep[] | undefined {
  return f.has(name) ? f.objects(name).map(step) : undefined;
}

/** A prelude part: an object, `false` to opt out, or unset. */
function orOff<T>(
  f: Fields,
  name: string,
  parse: (o: Fields) => T,
): T | false | undefined {
  if (f.raw(name) === false) return false;
  return f.has(name) ? parse(f.objectOr(name)) : undefined;
}

function harden(o: Fields): CiHardenRunner {
  return {
    ...opt("action", uses(o, "action")),
    ...opt("egress", oneOf(o, "egress", EGRESS)),
    ...opt("allowedEndpoints", o.stringsIfSet("allowedEndpoints")),
    ...opt("name", o.stringIfSet("name")),
  };
}

function checkout(o: Fields): CiCheckout {
  return {
    ...opt("action", uses(o, "action")),
    ...opt("persistCredentials", o.booleanIfSet("persistCredentials")),
    ...opt("ref", o.stringIfSet("ref")),
    ...opt("fetchDepth", o.numberIfSet("fetchDepth")),
    ...opt("name", o.stringIfSet("name")),
  };
}

function bootstrap(o: Fields): CiBootstrap {
  return {
    ...opt("action", uses(o, "action")),
    ...opt("denoVersion", o.stringIfSet("denoVersion")),
    ...opt("actionsCache", o.booleanIfSet("actionsCache")),
    ...opt("name", o.stringIfSet("name")),
  };
}

function scalar(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
}

function axes(f: Fields, name: string): CiMatrixAxes | undefined {
  const value = f.raw(name);
  if (value === undefined) return undefined;
  if (!isRecord(value)) return f.reject(name, "map each axis to its values");
  const out: CiMatrixAxes = {};
  for (const [axis, values] of Object.entries(value)) {
    if (!Array.isArray(values)) {
      return f.reject(`${name}.${axis}`, "be an array of strings and numbers");
    }
    out[axis] = values.map((v) =>
      scalar(v) ??
        f.reject(`${name}.${axis}`, "be an array of strings and numbers")
    );
  }
  return out;
}

function rows(f: Fields, name: string): CiMatrixRow[] | undefined {
  const value = f.raw(name);
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return f.reject(name, "be an array of rows");
  return value.map((row, i) => {
    if (!isRecord(row)) return f.reject(`${name}[${i}]`, "be an object");
    const out: CiMatrixRow = {};
    for (const [key, v] of Object.entries(row)) {
      out[key] = scalar(v) ??
        f.reject(`${name}[${i}].${key}`, "be a string or a number");
    }
    return out;
  });
}

function pathFilter(f: Fields, name: string): CiPathFilter | undefined {
  if (!f.has(name)) return undefined;
  const o = f.objectOr(name);
  if (o.has("paths") && o.has("pathsIgnore")) {
    o.reject("pathsIgnore", 'not be set together with "paths"');
  }
  return o.has("paths")
    ? { paths: o.strings("paths") }
    : { pathsIgnore: o.strings("pathsIgnore") };
}

function triggers(t: Fields): CiTriggers {
  return {
    ...opt("push", t.stringsIfSet("push")),
    ...opt("pullRequest", t.stringsIfSet("pullRequest")),
    ...opt("pushPaths", pathFilter(t, "pushPaths")),
    ...opt("pullRequestPaths", pathFilter(t, "pullRequestPaths")),
    ...opt("pullRequestTypes", t.stringsIfSet("pullRequestTypes")),
    ...opt("manual", t.booleanIfSet("manual")),
    ...opt("issueComment", t.stringsIfSet("issueComment")),
    ...opt("branchProtectionRule", t.booleanIfSet("branchProtectionRule")),
    ...opt(
      "schedule",
      t.has("schedule")
        ? t.objects("schedule").map((s): ScheduleEntry => ({
          cron: s.string("cron"),
          ...opt("tz", s.stringIfSet("tz")),
        }))
        : undefined,
    ),
  };
}

function concurrency(o: Fields): CiConcurrency {
  return {
    group: o.string("group"),
    ...opt("cancelInProgress", o.booleanIfSet("cancelInProgress")),
  };
}

function environment(f: Fields): string | CiEnvironment | undefined {
  const value = f.raw("environment");
  if (value === undefined || typeof value === "string") return value;
  const o = f.objectOr("environment");
  return { name: o.string("name"), ...opt("url", o.stringIfSet("url")) };
}

/** The fields a job and an invocation share. */
function jobBase(j: Fields): Omit<CiJob, "needs" | "concurrency" | "steps"> {
  return {
    ...opt("id", j.stringIfSet("id")),
    ...opt("name", j.stringIfSet("name")),
    ...opt("runsOn", j.stringIfSet("runsOn")),
    ...opt("matrix", axes(j, "matrix")),
    ...opt("matrixInclude", rows(j, "matrixInclude")),
    ...opt("matrixExclude", rows(j, "matrixExclude")),
    ...opt("failFast", j.booleanIfSet("failFast")),
    ...opt("permissions", j.stringMapIfSet("permissions")),
    ...opt("harden", orOff(j, "harden", harden)),
    ...opt("checkout", orOff(j, "checkout", checkout)),
    ...opt("bootstrap", orOff(j, "bootstrap", bootstrap)),
    ...opt("env", j.stringMapIfSet("env")),
    ...opt("environment", environment(j)),
    ...opt("outputs", j.stringMapIfSet("outputs")),
    ...opt("if", j.stringIfSet("if")),
    ...opt("timeoutMinutes", j.numberIfSet("timeoutMinutes")),
  };
}

function job(j: Fields): CiJob {
  return {
    ...jobBase(j),
    ...opt("needs", j.stringsIfSet("needs")),
    ...opt(
      "concurrency",
      j.has("concurrency") ? concurrency(j.objectOr("concurrency")) : undefined,
    ),
    ...opt("steps", steps(j, "steps")),
  };
}

function invocation(i: Fields): ManifestCiInvocation {
  return {
    ...jobBase(i),
    target: i.string("target"),
    ...opt("after", i.stringsIfSet("after")),
    ...opt("before", steps(i, "before")),
    ...opt("then", steps(i, "then")),
    ...opt("steps", steps(i, "steps")),
  };
}

/** Bare target names, or invocation objects, in one list. */
function invokes(c: Fields): ManifestCiInvocation[] | undefined {
  const value = c.raw("invokes");
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return c.reject("invokes", "be an array");
  return value.map((item, i) =>
    typeof item === "string"
      ? { target: item }
      : invocation(fieldsOf(item, `${c.where}.invokes[${i}]`))
  );
}

function pipeline(p: Fields): CiPipeline {
  return {
    ...opt("name", p.stringIfSet("name")),
    ...opt(
      "triggers",
      p.has("triggers") ? triggers(p.objectOr("triggers")) : undefined,
    ),
    ...opt("permissions", p.stringMapIfSet("permissions")),
    ...opt(
      "concurrency",
      p.has("concurrency") ? concurrency(p.objectOr("concurrency")) : undefined,
    ),
    ...opt(
      "harden",
      p.has("harden") ? harden(p.objectOr("harden")) : undefined,
    ),
    ...opt(
      "checkout",
      p.has("checkout") ? checkout(p.objectOr("checkout")) : undefined,
    ),
    ...opt("bootstrap", orOff(p, "bootstrap", bootstrap)),
    ...opt("jobs", p.has("jobs") ? p.objects("jobs").map(job) : undefined),
  };
}

function fanOut(c: Fields): boolean | FanOutOptions | undefined {
  const value = c.raw("fanOut");
  if (value === undefined || typeof value === "boolean") return value;
  const o = c.objectOr("fanOut");
  return {
    ...opt("setupSteps", steps(o, "setupSteps")),
    ...opt("runsOn", o.stringIfSet("runsOn")),
    ...opt("includeUnlisted", o.booleanIfSet("includeUnlisted")),
    ...opt("env", o.stringMapIfSet("env")),
  };
}

function pins(c: Fields): Record<string, CiUses> | undefined {
  const value = c.raw("pins");
  if (value === undefined) return undefined;
  if (!isRecord(value)) return c.reject("pins", "map action names to pins");
  const o = c.objectOr("pins");
  return Object.fromEntries(
    Object.keys(value).map((action) => [
      action,
      uses(o, action) ?? o.reject(action, "be a pinned reference"),
    ]),
  );
}

/** Parse one `ci` entry of the manifest. */
export function parseCi(c: Fields): ManifestCi {
  return {
    name: c.string("name"),
    ...opt("provider", oneOf(c, "provider", PROVIDERS)),
    ...opt("path", c.stringIfSet("path")),
    ...opt(
      "pipeline",
      c.has("pipeline") ? pipeline(c.objectOr("pipeline")) : undefined,
    ),
    ...opt("invokes", invokes(c)),
    ...opt("fanOut", fanOut(c)),
    ...opt("pins", pins(c)),
  };
}

/**
 * The `CiFile` for `entry`, its target names resolved through `targetOf`. A
 * pin the manifest does not carry is an error naming the action, as a
 * resolver that cannot answer is in a `zuke.ts` build.
 */
export function ciFileOf(
  entry: ManifestCi,
  targetOf: (name: string, where: string) => TargetBuilder,
): CiFile {
  const where = `ci "${entry.name}"`;
  const pinned = entry.pins;
  return new CiFile({
    provider: entry.provider,
    path: entry.path,
    pipeline: entry.pipeline,
    fanOut: entry.fanOut,
    invokes: entry.invokes?.map(({ target, after, ...rest }) => ({
      ...rest,
      target: targetOf(target, where),
      ...opt("after", after?.map((n) => targetOf(n, `${where}'s "after"`))),
    })),
    pins: pinned === undefined ? undefined : (action) => {
      const pin = pinned[action];
      if (pin === undefined) {
        throw new Error(`manifest: ${where} pins no "${action}"`);
      }
      return pin;
    },
  });
}
