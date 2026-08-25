// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `NodeTasks.evaluate` — call into a Node module from a target and get a value
 * back, instead of shelling out to a script that has to serialise its own
 * result somewhere.
 *
 * Node runs a generated ESM driver (`node --input-type=module --eval …`) that
 * imports the module, picks one export, calls it when it is a function, and
 * prints the JSON result between two markers. The task reads the markers back
 * out of stdout, so the module's own output — a framework's boot log, say —
 * still streams to the terminal untouched.
 *
 * ```ts
 * import { NodeTasks } from "jsr:@zuke/node";
 * const spec = await NodeTasks.evaluate("tools/openapi.mjs");
 * ```
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import type { JsonValue } from "@zuke/core";
import { NodeSettings } from "./settings.ts";

/** Marker printed before the JSON payload. */
const BEGIN = "<<<zuke:evaluate>>>";

/** Marker printed after the JSON payload. */
const END = "<<</zuke:evaluate>>>";

/**
 * Settings for {@link "./node.ts".NodeTasks.evaluate} — which export of the
 * module to take, and what to call it with.
 */
export class NodeEvaluateSettings extends NodeSettings {
  #module: string;
  #export = "default";
  #callArgs: JsonValue[] = [];
  #exitAfterResult = false;

  /** Evaluate `module`, a path resolved against the working directory. */
  constructor(module: PathLike) {
    super();
    this.#module = String(module);
  }

  /**
   * The named export to take, instead of the default one.
   *
   * The export is awaited; when it is a function it is called first, with
   * {@link callWith}'s arguments.
   */
  export(name: string): this {
    this.#export = name;
    return this;
  }

  /**
   * Arguments for the exported function, in order. Each must be
   * JSON-serialisable — they cross a process boundary as JSON.
   *
   * Named `callWith` rather than `args` because `ToolSettings.args` already
   * means "append raw arguments to the `node` command line", which is a
   * different thing.
   */
  callWith(...values: JsonValue[]): this {
    this.#callArgs.push(...values);
    return this;
  }

  /**
   * End the Node process as soon as the result has been written, instead of
   * waiting for the module to let Node exit on its own.
   *
   * A module that leaves a live handle on the event loop — an HTTP server, a
   * database pool, a timer — never exits, and the evaluation then blocks
   * forever on a value it has *already* produced and written. This makes the
   * driver exit once that write has flushed, so such a module can be evaluated
   * as it is, without a `process.exit` of its own.
   *
   * Two consequences, both by design: whatever the module writes *after* its
   * result is cut off, and the module's own exit code is no longer observed
   * (the driver exits `0`). A module that throws before producing a result is
   * unaffected — the driver never reaches its final write, so the evaluation
   * still rejects — and so is one that exits on its own, for which this is a
   * no-op.
   */
  exitAfterResult(): this {
    this.#exitAfterResult = true;
    return this;
  }

  /** The module being evaluated, for error messages. */
  get module(): string {
    return this.#module;
  }

  /** Assemble the `node --input-type=module --eval <driver>` argv. */
  protected override buildArgs(): string[] {
    return ["--input-type=module", "--eval", this.#driver()];
  }

  /**
   * The ESM driver source. Every value it closes over is embedded as a JSON
   * literal, so a module path or an argument cannot inject code into it.
   */
  #driver(): string {
    const module = JSON.stringify(this.#module);
    const name = JSON.stringify(this.#export);
    const callArgs = JSON.stringify(this.#callArgs);
    // The write callback runs once the payload has reached the pipe, so exiting
    // from it cannot truncate the result. Without the option the call is the
    // plain one-argument write it has always been.
    const thenExit = this.#exitAfterResult ? ", () => process.exit(0)" : "";
    return [
      `import { pathToFileURL } from "node:url";`,
      `const namespace = await import(pathToFileURL(${module}).href);`,
      `const picked = namespace[${name}];`,
      `if (picked === undefined) {`,
      `  throw new Error("zuke: " + ${module} + " has no export named " + ${name} + ".");`,
      `}`,
      `const value = typeof picked === "function"`,
      `  ? await picked(...${callArgs})`,
      `  : await picked;`,
      `const json = JSON.stringify(value);`,
      `process.stdout.write("\\n${BEGIN}" + (json === undefined ? "null" : json) + "${END}\\n"${thenExit});`,
    ].join("\n");
  }
}

/**
 * The JSON payload the driver printed, parsed.
 *
 * The last pair of markers wins, so anything the module printed before the
 * result cannot be mistaken for the payload. `truncated` is the capture flag
 * from the run: capture keeps the *newest* bytes, so an ordinary chatty module
 * never costs the payload — but a payload larger than the cap itself loses its
 * opening marker, which is a different failure and says so.
 *
 * @throws {Error} If the markers are absent, i.e. the driver never reached its
 * final write.
 */
export function parsePayload(
  stdout: string,
  module: string,
  truncated = false,
): JsonValue {
  const begin = stdout.lastIndexOf(BEGIN);
  const end = begin === -1 ? -1 : stdout.indexOf(END, begin);
  if (begin === -1 || end === -1) {
    throw new Error(
      truncated
        ? `NodeTasks.evaluate: ${module} produced a result larger than the ` +
          `capture cap, so its beginning was dropped. Raise it with ` +
          `.maxCapturedBytes().`
        : `NodeTasks.evaluate: ${module} produced no result. The module ran ` +
          `but never reached the driver's final write — check its output ` +
          `above for a process exit or an unhandled rejection.`,
    );
  }
  const json: JsonValue = JSON.parse(stdout.slice(begin + BEGIN.length, end));
  return json;
}

/**
 * Import `module` in Node, take one export, and resolve to its
 * JSON-serialisable value. Backs {@link "./node.ts".NodeTasks.evaluate}.
 */
export async function evaluateModule(
  module: PathLike,
  configure?: Configure<NodeEvaluateSettings>,
): Promise<JsonValue> {
  const settings = new NodeEvaluateSettings(module);
  const s = configure ? configure(settings) : settings;
  const output = await s.run();
  return parsePayload(output.stdout, s.module, output.truncated);
}
