// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Wire shapes of the engine/worker protocol (version 1) and the guards that
 * turn untrusted JSON from the socket into them. Every guard names the field
 * it rejects, since a worker author sees these messages while writing an SDK.
 *
 * @module
 */

import type { JsonValue } from "@zuke/core";

/** The protocol version this engine speaks. */
export const PROTOCOL_VERSION = 1;

/** Extra attempts after a failed body, and the pause between them. */
export interface ManifestRetry {
  /** How many more times to run the body after it fails. */
  readonly times: number;
  /** Milliseconds to wait between attempts. */
  readonly delayMs: number;
}

/** One target as the worker describes it. */
export interface ManifestTarget {
  /** The target's name, also its CLI name. */
  readonly name: string;
  /** The `--list` description. */
  readonly description: string;
  /** Names of targets this one depends on; each must be declared earlier. */
  readonly dependsOn: readonly string[];
  /** Hide from `--list` and `--help`. */
  readonly unlisted: boolean;
  /** Input paths whose contents key the cache. */
  readonly inputs: readonly string[];
  /** Output paths that must exist for a cache hit. */
  readonly outputs: readonly string[];
  /** Artifact paths this target produces. */
  readonly produces: readonly string[];
  /** The retry policy. */
  readonly retry: ManifestRetry;
  /** Per-attempt timeout in milliseconds, if any. */
  readonly timeoutMs?: number;
  /** Soft ordering: run before these targets when both are planned. */
  readonly before: readonly string[];
  /** Soft ordering: run after these targets when both are planned. */
  readonly after: readonly string[];
  /** Targets pulled in and run after this one. */
  readonly triggers: readonly string[];
  /** Keep the build running after this target fails. */
  readonly proceedAfterFailure: boolean;
  /** Run even after the build has failed. */
  readonly always: boolean;
  /** Run the body under `--dry-run` too. */
  readonly dryRunnable: boolean;
  /** Parameters that must resolve before this target runs. */
  readonly requires: readonly string[];
  /** The compensation target to run when the run is cancelled after this one succeeded. */
  readonly onCancel?: string;
  /** What this target's failure does: `fail`, `cancel-run`, or a compensation target. */
  readonly onFailure?: string;
  /** Whether the engine must ask `target.condition` before running this target. */
  readonly condition: boolean;
  /** Whether the engine must ask `target.cacheKey` when fingerprinting this target. */
  readonly cacheKey: boolean;
}

/** Which build hooks the worker implements; the engine calls only those. */
export interface ManifestHooks {
  /** `build.onStart`, before the first target. */
  readonly onStart: boolean;
  /** `build.onTargetStart { target }`, before each target. */
  readonly onTargetStart: boolean;
  /** `build.onTargetEnd { target, status }`, after each target settles. */
  readonly onTargetEnd: boolean;
  /** `build.onFinish { ok }`, before `run.exit`. */
  readonly onFinish: boolean;
}

/** What is common to every parameter kind. */
export interface ManifestParameterBase {
  /** The field name the build declares it under. */
  readonly name: string;
  /** The `--help` description. */
  readonly description: string;
  /** Whether a value must be supplied. */
  readonly required: boolean;
  /** Whether the value is a comma-separated list. */
  readonly array: boolean;
  /** Whether the value is masked and redacted. */
  readonly secret: boolean;
  /** The CLI flag, when it is not derived from the name. */
  readonly flag?: string;
  /** The environment variable, when it is not derived from the name. */
  readonly env?: string;
}

/** One build parameter as the worker describes it, by kind. */
export type ManifestParameter =
  & ManifestParameterBase
  & (
    | {
      readonly kind: "string";
      readonly default?: string;
      /** The allowed values, if restricted. */
      readonly options: readonly string[];
    }
    | { readonly kind: "number"; readonly default?: number }
    | { readonly kind: "boolean"; readonly default?: boolean }
  );

/** A parallel batch of targets. */
export interface ManifestGroup {
  /** The group's field name. */
  readonly name: string;
  /** The targets in it. */
  readonly members: readonly string[];
}

/** Build-wide settings. */
export interface ManifestConfig {
  /** The run's deadline, as a duration or milliseconds. */
  readonly deadline?: string | number;
  /** Targets `--force` may never re-run. */
  readonly unforceable: readonly string[];
}

/** The build as the worker describes it in reply to `build.describe`. */
export interface Manifest {
  /** The build's name. */
  readonly name: string;
  /** The targets, in declaration order. */
  readonly targets: readonly ManifestTarget[];
  /** The parameters, in declaration order. */
  readonly parameters: readonly ManifestParameter[];
  /** The groups. */
  readonly groups: readonly ManifestGroup[];
  /** The hooks the worker implements. */
  readonly hooks: ManifestHooks;
  /** Build-wide settings. */
  readonly config: ManifestConfig;
}

/** The worker's first message, authenticating and describing its process. */
export interface Hello {
  /** The SDK's name, e.g. `zuke-python`. */
  readonly sdk: string;
  /** The per-run token the engine handed the worker in `ZUKE_ENGINE_TOKEN`. */
  readonly token: string;
  /** The worker's environment: the base of every `exec` it requests. */
  readonly env: Readonly<Record<string, string>>;
  /** The worker's working directory: the default `cwd` of every `exec`. */
  readonly cwd: string;
}

/**
 * What `build.configure` tells the worker once the parameters have resolved,
 * before `build.onStart` and before any body: each parameter's value in its
 * CLI form, or null when unset. The run's id and dry-run flag travel with
 * every `target.run` instead, since the build's own `onStart` has neither.
 */
export interface ConfigureParams {
  /** Each parameter's resolved value in its CLI form, or null when unset. */
  readonly parameters: Readonly<Record<string, string | null>>;
}

/** The hooks a worker may implement, named as the `build.*` methods are. */
export type HookName = keyof ManifestHooks;

/** An `exec` request: a subprocess the engine runs on the worker's behalf. */
export interface ExecRequest {
  /** The target whose body is asking, for attribution and cancellation. */
  readonly target: string;
  /** The command line as discrete argv entries. */
  readonly argv: readonly string[];
  /** Working directory; defaults to the worker's. */
  readonly cwd?: string;
  /** Environment overrides on top of the worker's. */
  readonly env?: Readonly<Record<string, string>>;
  /** Text to feed on stdin. */
  readonly stdin?: string;
}

/** A durable-state read, for the body's own target or, with `of`, another's. */
export interface StateRead {
  /** The target whose body is asking. */
  readonly target: string;
  /** The target whose state to read; the body's own when absent. */
  readonly of?: string;
}

/** A durable-state write: the patch merged into the state. */
export interface StateWrite extends StateRead {
  /** The JSON patch to merge. */
  readonly patch: Readonly<Record<string, JsonValue>>;
}

/** Another target's outcome, asked for by a body. */
export interface OutcomeRequest {
  /** The target whose body is asking. */
  readonly target: string;
  /** The target whose outcome to report. */
  readonly of: string;
}

/** Notes for the asking target's summary row. */
export interface SummaryRequest {
  /** The target whose body is asking. */
  readonly target: string;
  /** The notes, keyed by label. */
  readonly pairs: Readonly<Record<string, string | number>>;
}

/** A value the engine must redact from now on. */
export interface SecretRequest {
  /** The target whose body is asking. */
  readonly target: string;
  /** The secret. */
  readonly value: string;
}

/** A log line attributed to the asking target. */
export interface LogRequest {
  /** The target whose body is asking. */
  readonly target: string;
  /** The line. */
  readonly line: string;
}

/** JSON-RPC error code the engine answers a cancelled `exec` with. */
export const CANCELLED = -32001;

/** JSON-RPC error code the engine answers a malformed request with. */
export const INVALID_PARAMS = -32602;

/** Whether `value` is a plain JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is JSON: what a parsed wire message can hold, nothing else. */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "object":
      return Array.isArray(value)
        ? value.every(isJsonValue)
        : Object.values(value).every(isJsonValue);
    default:
      return false;
  }
}

/** A typed view of one JSON object, naming its location in every error. */
class Fields {
  constructor(
    private readonly object: Record<string, unknown>,
    private readonly where: string,
  ) {}

  /** Whether the field is present. */
  has(name: string): boolean {
    return this.object[name] !== undefined;
  }

  required(name: string): unknown {
    const value = this.object[name];
    if (value === undefined) {
      throw new Error(`${this.where}: missing field "${name}"`);
    }
    return value;
  }

  string(name: string): string {
    const value = this.required(name);
    if (typeof value !== "string") {
      throw new Error(`${this.where}: field "${name}" must be a string`);
    }
    return value;
  }

  stringOr(name: string, fallback: string): string {
    return this.has(name) ? this.string(name) : fallback;
  }

  stringIfSet(name: string): string | undefined {
    return this.has(name) ? this.string(name) : undefined;
  }

  strings(name: string): string[] {
    const value = this.required(name);
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      throw new Error(
        `${this.where}: field "${name}" must be an array of strings`,
      );
    }
    return value;
  }

  stringsOr(name: string, fallback: string[]): string[] {
    return this.has(name) ? this.strings(name) : fallback;
  }

  number(name: string): number {
    const value = this.required(name);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(
        `${this.where}: field "${name}" must be a non-negative number`,
      );
    }
    return value;
  }

  numberIfSet(name: string): number | undefined {
    return this.has(name) ? this.number(name) : undefined;
  }

  booleanOr(name: string, fallback: boolean): boolean {
    if (!this.has(name)) return fallback;
    const value = this.object[name];
    if (typeof value !== "boolean") {
      throw new Error(`${this.where}: field "${name}" must be a boolean`);
    }
    return value;
  }

  stringMap(name: string): Record<string, string> {
    const value = this.required(name);
    if (
      !isRecord(value) ||
      !Object.values(value).every((v) => typeof v === "string")
    ) {
      throw new Error(
        `${this.where}: field "${name}" must map strings to strings`,
      );
    }
    return Object.fromEntries(
      Object.entries(value).filter((e): e is [string, string] =>
        typeof e[1] === "string"
      ),
    );
  }

  stringMapIfSet(name: string): Record<string, string> | undefined {
    return this.has(name) ? this.stringMap(name) : undefined;
  }

  /** The objects in an array field, each viewed at `where.name[i]`. */
  objects(name: string): Fields[] {
    const value = this.required(name);
    if (!Array.isArray(value)) {
      throw new Error(`${this.where}: field "${name}" must be an array`);
    }
    return value.map((item, i) =>
      fieldsOf(item, `${this.where}.${name}[${i}]`)
    );
  }

  objectsOr(name: string): Fields[] {
    return this.has(name) ? this.objects(name) : [];
  }

  /** The nested object field, viewed at `where.name`, or an empty one. */
  objectOr(name: string): Fields {
    return this.has(name)
      ? fieldsOf(this.required(name), `${this.where}.${name}`)
      : new Fields({}, `${this.where}.${name}`);
  }

  /** The raw value, for a field whose type depends on another. */
  raw(name: string): unknown {
    return this.object[name];
  }

  jsonRecord(name: string): Record<string, JsonValue> {
    const value = this.required(name);
    if (!isRecord(value)) {
      throw new Error(`${this.where}: field "${name}" must be an object`);
    }
    const entries: Array<[string, JsonValue]> = [];
    for (const [key, item] of Object.entries(value)) {
      if (!isJsonValue(item)) {
        throw new Error(`${this.where}: field "${name}.${key}" must be JSON`);
      }
      entries.push([key, item]);
    }
    return Object.fromEntries(entries);
  }

  summaryPairs(name: string): Record<string, string | number> {
    const value = this.required(name);
    if (!isRecord(value)) {
      throw new Error(`${this.where}: field "${name}" must be an object`);
    }
    const entries: Array<[string, string | number]> = [];
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== "string" && typeof item !== "number") {
        throw new Error(
          `${this.where}: field "${name}.${key}" must be a string or a number`,
        );
      }
      entries.push([key, item]);
    }
    return Object.fromEntries(entries);
  }

  reject(name: string, must: string): never {
    throw new Error(`${this.where}: field "${name}" must ${must}`);
  }
}

function fieldsOf(value: unknown, where: string): Fields {
  if (!isRecord(value)) throw new Error(`${where}: expected an object`);
  return new Fields(value, where);
}

/** Validate a `hello` payload, checking its token against `expected`. */
export function parseHello(value: unknown, expected: string): Hello {
  const o = fieldsOf(value, "hello");
  const token = o.string("token");
  if (token !== expected) throw new Error("hello: token mismatch");
  if (o.required("protocol") !== PROTOCOL_VERSION) {
    throw new Error(
      `hello: this engine speaks protocol ${PROTOCOL_VERSION} only`,
    );
  }
  return {
    sdk: o.string("sdk"),
    token,
    env: o.stringMap("env"),
    cwd: o.string("cwd"),
  };
}

function parseTarget(t: Fields): ManifestTarget {
  const retry = t.objectOr("retry");
  return {
    name: t.string("name"),
    description: t.stringOr("description", ""),
    dependsOn: t.stringsOr("dependsOn", []),
    unlisted: t.booleanOr("unlisted", false),
    inputs: t.stringsOr("inputs", []),
    outputs: t.stringsOr("outputs", []),
    produces: t.stringsOr("produces", []),
    retry: {
      times: retry.has("times") ? retry.number("times") : 0,
      delayMs: retry.has("delayMs") ? retry.number("delayMs") : 0,
    },
    timeoutMs: t.numberIfSet("timeoutMs"),
    before: t.stringsOr("before", []),
    after: t.stringsOr("after", []),
    triggers: t.stringsOr("triggers", []),
    proceedAfterFailure: t.booleanOr("proceedAfterFailure", false),
    always: t.booleanOr("always", false),
    dryRunnable: t.booleanOr("dryRunnable", false),
    requires: t.stringsOr("requires", []),
    onCancel: t.stringIfSet("onCancel"),
    onFailure: t.stringIfSet("onFailure"),
    condition: t.booleanOr("condition", false),
    cacheKey: t.booleanOr("cacheKey", false),
  };
}

function parseParameter(p: Fields): ManifestParameter {
  const base: ManifestParameterBase = {
    name: p.string("name"),
    description: p.stringOr("description", ""),
    required: p.booleanOr("required", false),
    array: p.booleanOr("array", false),
    secret: p.booleanOr("secret", false),
    flag: p.stringIfSet("flag"),
    env: p.stringIfSet("env"),
  };
  const kind = p.stringOr("kind", "string");
  const fallback = p.raw("default");
  if (base.array && fallback !== undefined) {
    p.reject("default", "be absent on an array parameter");
  }
  if (kind === "number") {
    if (fallback !== undefined && typeof fallback !== "number") {
      p.reject("default", "be a number");
    }
    return { ...base, kind, default: fallback };
  }
  if (kind === "boolean") {
    if (fallback !== undefined && typeof fallback !== "boolean") {
      p.reject("default", "be a boolean");
    }
    if (base.array) p.reject("array", "be false on a boolean parameter");
    return { ...base, kind, default: fallback };
  }
  if (kind !== "string") {
    p.reject("kind", 'be "string", "number" or "boolean"');
  }
  if (fallback !== undefined && typeof fallback !== "string") {
    p.reject("default", "be a string");
  }
  return {
    ...base,
    kind,
    default: fallback,
    options: p.stringsOr("options", []),
  };
}

function parseConfig(c: Fields): ManifestConfig {
  const deadline = c.raw("deadline");
  if (
    deadline !== undefined && typeof deadline !== "string" &&
    typeof deadline !== "number"
  ) {
    c.reject("deadline", "be a duration string or milliseconds");
  }
  return { deadline, unforceable: c.stringsOr("unforceable", []) };
}

/** Validate a `build.describe` result. */
export function parseManifest(value: unknown): Manifest {
  const o = fieldsOf(value, "manifest");
  return {
    name: o.string("name"),
    targets: o.objects("targets").map(parseTarget),
    parameters: o.objectsOr("parameters").map(parseParameter),
    groups: o.objectsOr("groups").map((g) => ({
      name: g.string("name"),
      members: g.strings("members"),
    })),
    hooks: parseHooks(o.objectOr("hooks")),
    config: parseConfig(o.objectOr("config")),
  };
}

function parseHooks(h: Fields): ManifestHooks {
  return {
    onStart: h.booleanOr("onStart", false),
    onTargetStart: h.booleanOr("onTargetStart", false),
    onTargetEnd: h.booleanOr("onTargetEnd", false),
    onFinish: h.booleanOr("onFinish", false),
  };
}

/** Validate a `target.condition` answer. */
export function parseCondition(value: unknown, target: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`target.condition: "${target}" must answer a boolean`);
  }
  return value;
}

/** Validate a `target.cacheKey` answer. */
export function parseCacheKey(value: unknown, target: string): string {
  if (typeof value !== "string") {
    throw new Error(`target.cacheKey: "${target}" must answer a string`);
  }
  return value;
}

/** Validate a `state.get` request's params. */
export function parseStateRead(value: unknown, method: string): StateRead {
  const o = fieldsOf(value, method);
  return { target: o.string("target"), of: o.stringIfSet("of") };
}

/** Validate a `state.set` or `state.trySet` request's params. */
export function parseStateWrite(value: unknown, method: string): StateWrite {
  const o = fieldsOf(value, method);
  return { ...parseStateRead(value, method), patch: o.jsonRecord("patch") };
}

/** Validate an `outcome.of` request's params. */
export function parseOutcome(value: unknown): OutcomeRequest {
  const o = fieldsOf(value, "outcome.of");
  return { target: o.string("target"), of: o.string("of") };
}

/** Validate a `summary.report` request's params. */
export function parseSummary(value: unknown): SummaryRequest {
  const o = fieldsOf(value, "summary.report");
  return { target: o.string("target"), pairs: o.summaryPairs("pairs") };
}

/** Validate a `secret.register` request's params. */
export function parseSecret(value: unknown): SecretRequest {
  const o = fieldsOf(value, "secret.register");
  const secret = o.string("value");
  if (secret === "") {
    throw new Error("secret.register: value must not be empty");
  }
  return { target: o.string("target"), value: secret };
}

/** Validate a `log` request's params. */
export function parseLog(value: unknown): LogRequest {
  const o = fieldsOf(value, "log");
  return { target: o.string("target"), line: o.string("line") };
}

/** Validate the params of a request that carries only its target. */
export function parseTargeted(value: unknown, method: string): string {
  return fieldsOf(value, method).string("target");
}

/** Validate an `exec` request's params. */
export function parseExec(value: unknown): ExecRequest {
  const o = fieldsOf(value, "exec");
  const argv = o.strings("argv");
  if (argv.length === 0) throw new Error("exec: argv must not be empty");
  return {
    target: o.string("target"),
    argv,
    cwd: o.stringIfSet("cwd"),
    env: o.stringMapIfSet("env"),
    stdin: o.stringIfSet("stdin"),
  };
}
