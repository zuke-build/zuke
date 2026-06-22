/**
 * `GeminiTasks` — a typed wrapper for the
 * [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`), in the
 * same settings-lambda style as the other Zuke tool wrappers.
 *
 * The flagship task is {@link GeminiTasksApi.run}: a non-interactive
 * (`--prompt`) invocation suitable for builds and CI — drive a prompt, pick a
 * model, scope the context, and capture the response. The `mcp` and
 * `extensions` tasks are flexible command builders for the matching subcommand
 * groups.
 *
 * ```ts
 * import { GeminiTasks } from "jsr:@zuke/gemini";
 *
 * const out = await GeminiTasks.run((s) =>
 *   s.prompt("Summarise the staged diff in one line")
 *     .model("gemini-2.5-pro")
 *     .outputFormat("json")
 * );
 * console.log(out.stdout);
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free. Authenticate through the
 * shared `.env(...)` chainer (e.g. `GEMINI_API_KEY`), backed by a
 * `parameter().secret()` build input so Zuke masks it in CI output.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Approval mode for tool calls (`--approval-mode`). */
export type GeminiApprovalMode = "default" | "auto_edit" | "yolo" | "plan";

/** Output format for a non-interactive run (`--output-format`). */
export type GeminiOutputFormat = "text" | "json" | "stream-json";

/**
 * Settings for a non-interactive `gemini --prompt` run — the build-friendly
 * way to send a single prompt and capture the response.
 */
export class GeminiRunSettings extends ToolSettings {
  #prompt?: string;
  #model?: string;
  #sandbox = false;
  #sandboxImage?: string;
  #allFiles = false;
  #yolo = false;
  #approvalMode?: GeminiApprovalMode;
  #includeDirectories: string[] = [];
  #extensions: string[] = [];
  #allowedTools: string[] = [];
  #allowedMcpServerNames: string[] = [];
  #outputFormat?: GeminiOutputFormat;
  #debug = false;
  #checkpointing = false;
  #showMemoryUsage = false;

  protected override defaultTool(): string {
    return "gemini";
  }

  /** The prompt to run non-interactively (`--prompt`). Required. */
  prompt(text: string): this {
    this.#prompt = text;
    return this;
  }

  /** Pin the model, e.g. `model("gemini-2.5-pro")` (`--model`). */
  model(id: string): this {
    this.#model = id;
    return this;
  }

  /** Run tools inside a sandbox (`--sandbox`). */
  sandbox(): this {
    this.#sandbox = true;
    return this;
  }

  /** Container image to use for the sandbox (`--sandbox-image`). */
  sandboxImage(image: string): this {
    this.#sandboxImage = image;
    return this;
  }

  /** Include all files in the context (`--all-files`). */
  allFiles(): this {
    this.#allFiles = true;
    return this;
  }

  /** Automatically approve all tool calls (`--yolo`). */
  yolo(): this {
    this.#yolo = true;
    return this;
  }

  /** How tool calls are approved (`--approval-mode`). */
  approvalMode(mode: GeminiApprovalMode): this {
    this.#approvalMode = mode;
    return this;
  }

  /** Add directories to the workspace context (`--include-directories`). Repeatable. */
  includeDirectories(...dirs: string[]): this {
    this.#includeDirectories.push(...dirs);
    return this;
  }

  /** Restrict to these extensions (`--extensions`). Repeatable. */
  extensions(...names: string[]): this {
    this.#extensions.push(...names);
    return this;
  }

  /** Allow only these tools (`--allowed-tools`). Repeatable. */
  allowedTools(...names: string[]): this {
    this.#allowedTools.push(...names);
    return this;
  }

  /** Allow only these MCP servers (`--allowed-mcp-server-names`). Repeatable. */
  allowedMcpServerNames(...names: string[]): this {
    this.#allowedMcpServerNames.push(...names);
    return this;
  }

  /** Shape of the printed response (`--output-format`). */
  outputFormat(format: GeminiOutputFormat): this {
    this.#outputFormat = format;
    return this;
  }

  /** Emit debug output (`--debug`). */
  debug(): this {
    this.#debug = true;
    return this;
  }

  /** Enable checkpointing of file edits (`--checkpointing`). */
  checkpointing(): this {
    this.#checkpointing = true;
    return this;
  }

  /** Report memory usage in the status bar (`--show-memory-usage`). */
  showMemoryUsage(): this {
    this.#showMemoryUsage = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#prompt === undefined) {
      throw new Error("GeminiTasks.run: .prompt() is required.");
    }
    const argv = ["--prompt", this.#prompt];
    if (this.#model !== undefined) argv.push("--model", this.#model);
    if (this.#sandbox) argv.push("--sandbox");
    if (this.#sandboxImage !== undefined) {
      argv.push("--sandbox-image", this.#sandboxImage);
    }
    if (this.#allFiles) argv.push("--all-files");
    if (this.#yolo) argv.push("--yolo");
    if (this.#approvalMode !== undefined) {
      argv.push("--approval-mode", this.#approvalMode);
    }
    for (const dir of this.#includeDirectories) {
      argv.push("--include-directories", dir);
    }
    for (const name of this.#extensions) argv.push("--extensions", name);
    for (const name of this.#allowedTools) argv.push("--allowed-tools", name);
    for (const name of this.#allowedMcpServerNames) {
      argv.push("--allowed-mcp-server-names", name);
    }
    if (this.#outputFormat !== undefined) {
      argv.push("--output-format", this.#outputFormat);
    }
    if (this.#debug) argv.push("--debug");
    if (this.#checkpointing) argv.push("--checkpointing");
    if (this.#showMemoryUsage) argv.push("--show-memory-usage");
    return argv;
  }
}

/**
 * Shared builder for `gemini <group> …` subcommand groups (`mcp`,
 * `extensions`): name the verb and operands with `.command(...)` and pass
 * anything else with `.flag(...)`.
 */
abstract class GeminiCommandSettings extends ToolSettings {
  #command: string[] = [];
  #flags: string[] = [];

  protected override defaultTool(): string {
    return "gemini";
  }

  /** The leading subcommand group token, e.g. `"mcp"`. */
  protected abstract group(): string;

  /** The verb and operands, e.g. `command("add", "my-server")`. */
  command(...parts: Array<string | number>): this {
    this.#command.push(...parts.map(String));
    return this;
  }

  /**
   * Add an arbitrary flag. With a value it renders `--name value`; without one
   * it renders the bare `--name`. Repeatable.
   */
  flag(name: string, value?: string | number): this {
    this.#flags.push(`--${name}`);
    if (value !== undefined) this.#flags.push(String(value));
    return this;
  }

  protected override buildArgs(): string[] {
    return [this.group(), ...this.#command, ...this.#flags];
  }
}

/** Settings for a `gemini mcp …` invocation (manage MCP servers). */
export class GeminiMcpSettings extends GeminiCommandSettings {
  protected override group(): string {
    return "mcp";
  }
}

/** Settings for a `gemini extensions …` invocation (manage extensions). */
export class GeminiExtensionsSettings extends GeminiCommandSettings {
  protected override group(): string {
    return "extensions";
  }
}

/** The shape of {@link GeminiTasks}. */
export interface GeminiTasksApi {
  /** Run a prompt non-interactively (`gemini --prompt`). */
  run(configure?: Configure<GeminiRunSettings>): Promise<CommandOutput>;
  /** Manage MCP servers (`gemini mcp …`). */
  mcp(configure?: Configure<GeminiMcpSettings>): Promise<CommandOutput>;
  /** Manage extensions (`gemini extensions …`). */
  extensions(
    configure?: Configure<GeminiExtensionsSettings>,
  ): Promise<CommandOutput>;
}

/** Typed task functions for the Gemini CLI. */
export const GeminiTasks: GeminiTasksApi = {
  run(configure?: Configure<GeminiRunSettings>): Promise<CommandOutput> {
    return runSettings(new GeminiRunSettings(), configure);
  },
  mcp(configure?: Configure<GeminiMcpSettings>): Promise<CommandOutput> {
    return runSettings(new GeminiMcpSettings(), configure);
  },
  extensions(
    configure?: Configure<GeminiExtensionsSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new GeminiExtensionsSettings(), configure);
  },
};
