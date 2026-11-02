// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The tool bridge: a worker's `tool.call` run against a wrapper's task.
 *
 * The worker names a wrapper release, the task object it exports, the task on
 * it, and the arguments as JSON, where a settings lambda travels as the list
 * of setter calls it would make. The engine imports the release, applies the
 * setters to the task's settings and runs the task, inside the caller's scope,
 * so the ambient dry-run echo, redaction and cancel signal apply as they do to
 * a TypeScript build's own call.
 *
 * @module
 */

import type { JsonValue } from "@zuke/core";
import { MAX_LINE, RpcFailure } from "./peer.ts";
import { INVALID_PARAMS, isRecord, type ToolCall } from "./protocol.ts";

/** Resolves a wrapper release to its module: what `tool.call` imports. */
export type ToolResolver = (
  pkg: string,
  version: string,
) => Promise<Record<string, unknown>>;

/**
 * The default {@link ToolResolver}: a dynamic import of the release from JSR,
 * or from the workspace when it holds that version of the package.
 */
export async function importTool(
  pkg: string,
  version: string,
): Promise<Record<string, unknown>> {
  const module: Record<string, unknown> = await import(
    `jsr:@zuke/${pkg}@${version}`
  );
  return module;
}

/** The worker's environment and working directory: the base of every spawn. */
export interface SpawnBase {
  /** The environment the wrapper's command inherits, under the caller's overrides. */
  readonly env: Readonly<Record<string, string>>;
  /** The working directory the command runs in, unless a setter moves it. */
  readonly cwd: string;
}

/** JSON-RPC error code of a task that failed, as distinct from a malformed call. */
const FAILED = -32000;

/**
 * Members of the settings base class a configure list may not name: the hooks
 * and the run itself, which are the wrapper's to call, not the worker's.
 */
const RESERVED = new Set([
  "constructor",
  "run",
  "argv",
  "resolvedArgv",
  "buildArgs",
  "defaultTool",
  "defaultResolution",
  "onOutput",
  "stdinInput",
  "markSecret",
  "markSecretsInOutput",
]);

/** A settings lambda as data: the object with one `configure` key. */
function configureOf(arg: JsonValue): readonly JsonValue[] | undefined {
  if (!isRecord(arg) || Object.keys(arg).length !== 1) return undefined;
  const calls = arg.configure;
  return Array.isArray(calls) ? calls : undefined;
}

/** One setter call of a configure list: its name and its arguments. */
function setterOf(
  call: JsonValue,
  where: string,
): [string, readonly JsonValue[]] {
  if (
    !Array.isArray(call) || call.length !== 2 || typeof call[0] !== "string" ||
    !Array.isArray(call[1])
  ) {
    throw new RpcFailure(
      INVALID_PARAMS,
      `${where}: each configure entry must be a [setter, [arguments]] pair`,
    );
  }
  return [call[0], call[1]];
}

/**
 * Apply `calls` to `settings` in order, each a public setter of it. A name that
 * is not one, or that is a hook of the settings base class, is refused by name.
 */
export function applySettings(
  settings: unknown,
  calls: readonly JsonValue[],
  where: string,
): unknown {
  let current = settings;
  for (const call of calls) {
    const [name, args] = setterOf(call, where);
    const member: unknown = typeof current === "object" && current !== null
      ? Reflect.get(current, name)
      : undefined;
    if (
      RESERVED.has(name) || name.startsWith("_") || name in Object.prototype ||
      typeof member !== "function"
    ) {
      throw new RpcFailure(
        INVALID_PARAMS,
        `${where}: "${name}" is not a setter of the task's settings`,
      );
    }
    const out: unknown = Reflect.apply(member, current, [...args]);
    // A setter answers its settings, which a kind-changing one replaces.
    if (typeof out === "object" && out !== null) current = out;
  }
  return current;
}

/**
 * Seed `settings` with the worker's environment and directory, through the
 * `env` and `cwd` setters when it has them, before the caller's own setters.
 */
function seeded(settings: unknown, base: SpawnBase, where: string): unknown {
  const seeds: JsonValue[] = [];
  const has = (name: string) =>
    typeof settings === "object" && settings !== null &&
    typeof Reflect.get(settings, name) === "function";
  if (has("env")) seeds.push(["env", [{ ...base.env }]]);
  if (has("cwd")) seeds.push(["cwd", [base.cwd]]);
  return applySettings(settings, seeds, where);
}

/** The JSON answer to a task's result. */
function answerOf(result: unknown, where: string): unknown {
  if (result === undefined) return {};
  if (
    isRecord(result) && typeof result.code === "number" &&
    typeof result.stdout === "string" && typeof result.stderr === "string"
  ) {
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }
  let text: string;
  try {
    text = JSON.stringify(result);
  } catch {
    throw new RpcFailure(FAILED, `${where}: the task's result is not JSON`);
  }
  // One answer is one line of the protocol: a result past the line bound is
  // refused here, by name, rather than ending the worker's connection there.
  if (text.length > MAX_LINE) {
    throw new RpcFailure(
      FAILED,
      `${where}: the task's result is ${text.length} characters, over the ` +
        `${MAX_LINE} one answer carries`,
    );
  }
  return JSON.parse(text);
}

/**
 * Run the task `call` names on `module`, with the worker's environment and
 * directory under its settings. A missing export, task or setter is refused
 * by name; a task that throws fails the call with its message.
 */
export async function callTool(
  module: Record<string, unknown>,
  call: ToolCall,
  base: SpawnBase,
): Promise<unknown> {
  const where = `tool.call: @zuke/${call.package}@${call.version}`;
  const tasks = module[call.tasks];
  if (!isRecord(tasks)) {
    throw new RpcFailure(INVALID_PARAMS, `${where} exports no "${call.tasks}"`);
  }
  const task = tasks[call.task];
  if (typeof task !== "function") {
    throw new RpcFailure(
      INVALID_PARAMS,
      `${where}: "${call.tasks}" has no task "${call.task}"`,
    );
  }
  const at = `${where}: ${call.tasks}.${call.task}`;
  const args = call.args.map((arg) => {
    const calls = configureOf(arg);
    return calls === undefined
      ? arg
      : (settings: unknown) =>
        applySettings(seeded(settings, base, at), calls, at);
  });
  let result: unknown;
  try {
    result = await Reflect.apply(task, tasks, args);
  } catch (error) {
    if (error instanceof RpcFailure) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new RpcFailure(FAILED, `${at}: ${reason}`);
  }
  return answerOf(result, at);
}
