/**
 * An MCP (Model Context Protocol) server over a Zuke build.
 *
 * {@link McpServer} turns a build into a set of MCP tools an AI client can
 * discover and call: read tools that describe the targets, parameters, and
 * dependency graph, plus — when execution is enabled — one `run:<target>` tool
 * per target whose JSON-Schema input is derived from the build's parameters.
 * The protocol handling is a pure {@link McpServer.handleMessage} (message in,
 * response out) so it is exercised without touching real stdio; the transport
 * loop lives in {@link serveStdio}.
 *
 * A run tool executes the target through {@link execute} with a buffering
 * reporter, so the captured output is returned to the client — and because that
 * output passes through the same reporter pipeline, `secret` parameter values
 * are redacted from it exactly as on the console.
 *
 * @module
 */

import type { Build } from "../build.ts";
import { discoverTargets } from "../build.ts";
import { type AnyParameter, discoverParameters } from "../params.ts";
import { describeBuildSurface } from "../describe.ts";
import { execute, type Reporter } from "../executor.ts";
import type { TargetBuilder } from "../target.ts";
import {
  err,
  INVALID_PARAMS,
  type JsonRpcResponse,
  METHOD_NOT_FOUND,
  ok,
} from "./jsonrpc.ts";

/** The newest MCP protocol version this server implements. */
export const PROTOCOL_VERSION = "2025-06-18";

/** The `run:` prefix that names a per-target execution tool. */
const RUN_PREFIX = "run:";

/** A JSON Schema fragment (kept loose — MCP only needs plain JSON Schema). */
type JsonSchema = Record<string, unknown>;

/** An MCP tool definition, as returned by `tools/list`. */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly annotations?: {
    readonly title?: string;
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
  };
}

/** Options for {@link McpServer}. */
export interface McpServerOptions {
  /**
   * Expose `run:<target>` tools that execute build code. Off by default, so a
   * freshly-connected agent can only inspect the build; enable it with
   * `zuke mcp --allow-run`.
   */
  allowRun?: boolean;
  /** The server version reported in `initialize`. Defaults to `"0.0.0"`. */
  version?: string;
}

/** A reporter that records every line, for returning a run's output. */
function bufferingReporter(): { reporter: Reporter; text(): string } {
  const lines: string[] = [];
  return {
    reporter: {
      info: (line) => void lines.push(line),
      error: (line) => void lines.push(line),
    },
    text: () => lines.join("\n"),
  };
}

/** The JSON-Schema type keyword for a parameter's value kind. */
function schemaForParam(param: AnyParameter): JsonSchema {
  if (param.array_) {
    return { type: "array", items: { type: "string" } };
  }
  const base: JsonSchema = { type: param.kind_ };
  if (param.description_) base.description = param.description_;
  if (param.options_ && param.options_.length > 0) {
    base.enum = [...param.options_];
  }
  return base;
}

/** The MCP result content for a single block of text. */
function textResult(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: "text", text }], isError };
}

/**
 * An MCP server bound to a build. Construct it once, then feed each incoming
 * JSON-RPC message to {@link McpServer.handleMessage}.
 */
export class McpServer {
  readonly #targets: Map<string, TargetBuilder>;
  readonly #params: Map<string, AnyParameter>;
  readonly #allowRun: boolean;
  readonly #version: string;

  constructor(
    private readonly build: Build,
    options: McpServerOptions = {},
  ) {
    this.#targets = discoverTargets(build);
    this.#params = discoverParameters(build);
    this.#allowRun = options.allowRun ?? false;
    this.#version = options.version ?? "0.0.0";
  }

  /** The tools advertised to the client, honouring {@link McpServerOptions.allowRun}. */
  tools(): McpTool[] {
    const tools: McpTool[] = [
      {
        name: "list_targets",
        description:
          "List the build's targets with their descriptions and dependencies.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
      },
      {
        name: "describe_build",
        description:
          "Describe the whole build surface: commands, flags, targets, and parameters.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
      },
      {
        name: "graph",
        description: "Show each target and the targets it depends on.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
      },
    ];
    if (this.#allowRun) {
      for (const [name, target] of this.#targets) {
        tools.push(this.#runTool(name, target));
      }
    }
    return tools;
  }

  /** Build the `run:<name>` tool for one target from the build's parameters. */
  #runTool(name: string, target: TargetBuilder): McpTool {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [paramName, param] of this.#params) {
      properties[paramName] = schemaForParam(param);
      if (param.required_ && !param.hasFallback_) required.push(paramName);
    }
    // Execution controls, alongside the declared parameters.
    properties.dryRun = {
      type: "boolean",
      description: "Plan without executing any target body.",
    };
    const description = target.description_
      ? `Run the "${name}" target: ${target.description_}`
      : `Run the "${name}" target.`;
    const schema: JsonSchema = { type: "object", properties };
    if (required.length > 0) schema.required = required;
    return {
      name: `${RUN_PREFIX}${name}`,
      description,
      inputSchema: schema,
      annotations: { title: `Run ${name}`, destructiveHint: true },
    };
  }

  /**
   * Handle one parsed JSON-RPC message. Returns the response to send, or `null`
   * for a notification (which takes no reply).
   */
  async handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
    if (
      typeof message !== "object" || message === null ||
      !("method" in message) || typeof message.method !== "string"
    ) {
      return err(idOf(message), INVALID_PARAMS, "Invalid Request");
    }
    const method = message.method;
    const id = idOf(message);
    const params = "params" in message ? message.params : undefined;

    // Notifications (no id) never receive a response.
    if (id === null && method.startsWith("notifications/")) return null;

    switch (method) {
      case "initialize":
        return ok(id, this.#initialize(params));
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: this.tools() });
      case "tools/call":
        return await this.#callTool(id, params);
      default:
        // An unknown notification is silently ignored; an unknown request errors.
        if (id === null) return null;
        return err(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  }

  /** The `initialize` result: echo the client's protocol version when given. */
  #initialize(params: unknown): Record<string, unknown> {
    const requested = typeof params === "object" && params !== null &&
        "protocolVersion" in params &&
        typeof params.protocolVersion === "string"
      ? params.protocolVersion
      : PROTOCOL_VERSION;
    return {
      protocolVersion: requested,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "zuke", version: this.#version },
    };
  }

  /** Dispatch a `tools/call`. */
  async #callTool(
    id: string | number | null,
    params: unknown,
  ): Promise<JsonRpcResponse> {
    if (typeof params !== "object" || params === null || !("name" in params)) {
      return err(id, INVALID_PARAMS, "tools/call requires a tool name");
    }
    const name = params.name;
    if (typeof name !== "string") {
      return err(id, INVALID_PARAMS, "tool name must be a string");
    }
    const args =
      "arguments" in params && typeof params.arguments === "object" &&
        params.arguments !== null
        ? params.arguments as Record<string, unknown>
        : {};

    if (name === "list_targets") {
      return ok(id, textResult(this.#describe().targets));
    }
    if (name === "describe_build") {
      return ok(id, textResult(this.#describe().full));
    }
    if (name === "graph") {
      return ok(id, textResult(this.#describe().graph));
    }
    if (name.startsWith(RUN_PREFIX)) {
      return await this.#run(id, name.slice(RUN_PREFIX.length), args);
    }
    // An unknown tool is reported through the result (isError), per MCP, so the
    // model sees it rather than a transport-level failure.
    return ok(id, textResult(`Unknown tool: ${name}`, true));
  }

  /** The three read tools' payloads, as pretty JSON / text. */
  #describe(): { targets: string; full: string; graph: string } {
    const surface = describeBuildSurface(this.#targets, this.#params);
    const graph = surface.targets
      .map((t) =>
        t.dependsOn.length > 0
          ? `${t.name} -> ${t.dependsOn.join(", ")}`
          : `${t.name} (no dependencies)`
      )
      .join("\n");
    return {
      targets: JSON.stringify(surface.targets, null, 2),
      full: JSON.stringify(surface, null, 2),
      graph,
    };
  }

  /** Execute a target and return its captured output. */
  async #run(
    id: string | number | null,
    targetName: string,
    args: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    if (!this.#allowRun) {
      return ok(
        id,
        textResult(
          "Running targets is disabled. Start the server with " +
            "`zuke mcp --allow-run` to enable execution.",
          true,
        ),
      );
    }
    const root = this.#targets.get(targetName);
    if (!root) {
      return ok(id, textResult(`Unknown target: ${targetName}`, true));
    }
    const dryRun = args.dryRun === true;
    const values: Record<string, string> = {};
    for (const paramName of this.#params.keys()) {
      const value = args[paramName];
      if (value !== undefined) values[paramName] = String(value);
    }
    const buffer = bufferingReporter();
    // Parameters resolve like the CLI: MCP arguments beat the environment beats
    // the declared default, so a value set in the server's environment still
    // applies unless the agent overrides it.
    const result = await execute(this.build, root, {
      params: values,
      reporter: buffer.reporter,
      dryRun,
      github: false,
    });
    const status = result.ok
      ? `\n\n✔ ${targetName} succeeded.`
      : `\n\n✘ ${targetName} failed.`;
    return ok(id, textResult(buffer.text() + status, !result.ok));
  }
}

/** Extract a JSON-RPC id from a message, defaulting to `null`. */
function idOf(message: unknown): string | number | null {
  if (
    typeof message === "object" && message !== null && "id" in message &&
    (typeof message.id === "string" || typeof message.id === "number")
  ) {
    return message.id;
  }
  return null;
}
