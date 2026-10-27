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
import { type ManifestCi, parseCi } from "./ci.ts";
import { type Fields, fieldsOf, isRecord } from "./fields.ts";

export { isRecord } from "./fields.ts";

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
  /** A plain target with a body, or a service the engine starts and stops. */
  readonly kind: "target" | "service";
  /** Whether the worker answers `service.ready` for this service. */
  readonly ready: boolean;
  /** How long the readiness probe may take before the service fails. */
  readonly readyTimeoutMs?: number;
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
  /** Whether `target.settings` answers a `lock` section for this target. */
  readonly lock: boolean;
  /** Whether `target.settings` answers a `waitsFor` section for this target. */
  readonly waitsFor: boolean;
  /** Whether `target.settings` answers a `validateDuring` section for this target. */
  readonly validateDuring: boolean;
}

/** A duration as the wrappers take it: `"5m"` or milliseconds. */
export type Duration = string | number;

/** A cross-run lock, as `LockSettings` configures it. */
export interface LockSpec {
  /** The lock's key. */
  readonly key: string;
  /** How long the lock may be held. */
  readonly ttl?: Duration;
  /** How long to wait for a held lock before giving up. */
  readonly waitUpTo?: Duration;
  /** How often to poll a held lock. */
  readonly pollEvery?: Duration;
  /** Keep the lock until the run ends rather than until the target does. */
  readonly holdForRun: boolean;
}

/** What a wait gate waits on. */
export type WaitTriggerSpec =
  | { readonly kind: "externalSignal"; readonly name: string }
  | { readonly kind: "resumeWhen"; readonly interval?: Duration };

/** A wait gate, as `WaitSettings` configures it. */
export interface WaitSpec {
  /** The trigger. */
  readonly on: WaitTriggerSpec;
  /** How long to wait before the timeout disposition applies. */
  readonly timeout?: Duration;
  /** `fail`, `cancel-run`, or a compensation target. */
  readonly onTimeout?: string;
}

/** Checks run on an interval while the body runs, as `ValidateDuringSettings` configures them. */
export interface ValidateDuringSpec {
  /** The interval. */
  readonly every?: Duration;
  /** The checks' names, each answered by `target.validate`. */
  readonly checks: readonly string[];
}

/** What `target.settings` answers for one target: the sections it declared. */
export interface LateSettings {
  /** The lock, when the target declared one. */
  readonly lock?: LockSpec;
  /** The wait gate, when the target declared one. */
  readonly waitsFor?: WaitSpec;
  /** The interval checks, when the target declared them. */
  readonly validateDuring?: ValidateDuringSpec;
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
  /** The CI files the build declares, for `generate-ci`. */
  readonly ci: readonly ManifestCi[];
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
  const kind = t.stringOr("kind", "target");
  if (kind !== "target" && kind !== "service") {
    t.reject("kind", 'be "target" or "service"');
  }
  return {
    name: t.string("name"),
    kind,
    ready: t.booleanOr("ready", false),
    readyTimeoutMs: t.numberIfSet("readyTimeoutMs"),
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
    lock: t.booleanOr("lock", false),
    waitsFor: t.booleanOr("waitsFor", false),
    validateDuring: t.booleanOr("validateDuring", false),
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
    ci: o.objectsOr("ci").map(parseCi),
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

/** Validate a boolean answer to `method` about `target`. */
export function parseBooleanAnswer(
  method: string,
  value: unknown,
  target: string,
): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${method}: "${target}" must answer a boolean`);
  }
  return value;
}

function parseWaitTrigger(w: Fields): WaitTriggerSpec {
  const on = w.objectOr("on");
  if (!w.has("on")) w.reject("on", "name the trigger");
  const kind = on.string("kind");
  if (kind === "externalSignal") return { kind, name: on.string("name") };
  if (kind === "resumeWhen") {
    return { kind, interval: on.durationIfSet("interval") };
  }
  return on.reject("kind", 'be "externalSignal" or "resumeWhen"');
}

/**
 * Validate a `target.settings` answer against what the target declared: a
 * declared section must be present and well-formed; an undeclared one is
 * ignored.
 */
export function parseSettings(
  value: unknown,
  target: ManifestTarget,
): LateSettings {
  const where = `target.settings: "${target.name}"`;
  const o = fieldsOf(value, where);
  const settings: {
    lock?: LockSpec;
    waitsFor?: WaitSpec;
    validateDuring?: ValidateDuringSpec;
  } = {};
  if (target.lock) {
    if (!o.has("lock")) {
      o.reject("lock", "be answered, as the target declared it");
    }
    const l = o.objectOr("lock");
    settings.lock = {
      key: l.string("key"),
      ttl: l.durationIfSet("ttl"),
      waitUpTo: l.durationIfSet("waitUpTo"),
      pollEvery: l.durationIfSet("pollEvery"),
      holdForRun: l.booleanOr("holdForRun", false),
    };
  }
  if (target.waitsFor) {
    if (!o.has("waitsFor")) {
      o.reject("waitsFor", "be answered, as the target declared it");
    }
    const w = o.objectOr("waitsFor");
    settings.waitsFor = {
      on: parseWaitTrigger(w),
      timeout: w.durationIfSet("timeout"),
      onTimeout: w.stringIfSet("onTimeout"),
    };
  }
  if (target.validateDuring) {
    if (!o.has("validateDuring")) {
      o.reject("validateDuring", "be answered, as the target declared it");
    }
    const v = o.objectOr("validateDuring");
    settings.validateDuring = {
      every: v.durationIfSet("every"),
      checks: v.strings("checks"),
    };
  }
  return settings;
}

/** Validate a `service.start` answer: the handle the worker chose. */
export function parseHandle(value: unknown, target: string): string {
  const handle = isRecord(value) ? value.handle : undefined;
  if (typeof handle !== "string" || handle === "") {
    throw new Error(`service.start: "${target}" must answer a handle`);
  }
  return handle;
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
