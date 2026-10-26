// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Wire shapes of the engine/worker protocol (version 1) and the guards that
 * turn untrusted JSON from the socket into them. Every guard names the field
 * it rejects, since a worker author sees these messages while writing an SDK.
 *
 * @module
 */

/** The protocol version this engine speaks. */
export const PROTOCOL_VERSION = 1;

/** One target as the worker describes it. */
export interface ManifestTarget {
  /** The target's name, also its CLI name. */
  readonly name: string;
  /** The `--list` description. */
  readonly description: string;
  /** Names of targets this one depends on; each must be declared earlier. */
  readonly dependsOn: readonly string[];
}

/** The build as the worker describes it in reply to `build.describe`. */
export interface Manifest {
  /** The build's name. */
  readonly name: string;
  /** The targets, in declaration order. */
  readonly targets: readonly ManifestTarget[];
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

/** JSON-RPC error code the engine answers a cancelled `exec` with. */
export const CANCELLED = -32001;

/** JSON-RPC error code the engine answers a malformed request with. */
export const INVALID_PARAMS = -32602;

/** Whether `value` is a plain JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(
  object: Record<string, unknown>,
  name: string,
  where: string,
): unknown {
  const value = object[name];
  if (value === undefined) {
    throw new Error(`${where}: missing field "${name}"`);
  }
  return value;
}

function stringAt(
  object: Record<string, unknown>,
  name: string,
  where: string,
): string {
  const value = field(object, name, where);
  if (typeof value !== "string") {
    throw new Error(`${where}: field "${name}" must be a string`);
  }
  return value;
}

function stringsAt(
  object: Record<string, unknown>,
  name: string,
  where: string,
): string[] {
  const value = field(object, name, where);
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`${where}: field "${name}" must be an array of strings`);
  }
  return value;
}

function stringMapAt(
  object: Record<string, unknown>,
  name: string,
  where: string,
): Record<string, string> {
  const value = field(object, name, where);
  if (
    !isRecord(value) ||
    !Object.values(value).every((v) => typeof v === "string")
  ) {
    throw new Error(`${where}: field "${name}" must map strings to strings`);
  }
  return Object.fromEntries(
    Object.entries(value).filter((e): e is [string, string] =>
      typeof e[1] === "string"
    ),
  );
}

function recordOf(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where}: expected an object`);
  return value;
}

/** Validate a `hello` payload, checking its token against `expected`. */
export function parseHello(value: unknown, expected: string): Hello {
  const o = recordOf(value, "hello");
  const token = stringAt(o, "token", "hello");
  if (token !== expected) throw new Error("hello: token mismatch");
  if (field(o, "protocol", "hello") !== PROTOCOL_VERSION) {
    throw new Error(
      `hello: this engine speaks protocol ${PROTOCOL_VERSION} only`,
    );
  }
  return {
    sdk: stringAt(o, "sdk", "hello"),
    token,
    env: stringMapAt(o, "env", "hello"),
    cwd: stringAt(o, "cwd", "hello"),
  };
}

/** Validate a `build.describe` result. */
export function parseManifest(value: unknown): Manifest {
  const o = recordOf(value, "manifest");
  const raw = field(o, "targets", "manifest");
  if (!Array.isArray(raw)) {
    throw new Error('manifest: field "targets" must be an array');
  }
  const targets = raw.map((t, i) => {
    const where = `manifest.targets[${i}]`;
    const target = recordOf(t, where);
    return {
      name: stringAt(target, "name", where),
      description: typeof target.description === "string"
        ? target.description
        : "",
      dependsOn: target.dependsOn === undefined
        ? []
        : stringsAt(target, "dependsOn", where),
    };
  });
  return { name: stringAt(o, "name", "manifest"), targets };
}

/** Validate an `exec` request's params. */
export function parseExec(value: unknown): ExecRequest {
  const o = recordOf(value, "exec");
  const argv = stringsAt(o, "argv", "exec");
  if (argv.length === 0) throw new Error("exec: argv must not be empty");
  return {
    target: stringAt(o, "target", "exec"),
    argv,
    cwd: o.cwd === undefined ? undefined : stringAt(o, "cwd", "exec"),
    env: o.env === undefined ? undefined : stringMapAt(o, "env", "exec"),
    stdin: o.stdin === undefined ? undefined : stringAt(o, "stdin", "exec"),
  };
}
