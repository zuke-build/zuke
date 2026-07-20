/**
 * `ClaudeTasks` — a typed wrapper for the
 * [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI (`claude`),
 * in the same settings-lambda style as the other Zuke tool wrappers.
 *
 * The flagship task is {@link ClaudeTasksApi.run}: a non-interactive
 * (`--print`) invocation suitable for builds and CI — drive a prompt, pick a
 * model, constrain the tool set, and capture the response. The `mcp` and
 * `config` tasks are flexible command builders for the matching subcommand
 * groups, and `update` self-updates the CLI.
 *
 * ```ts
 * import { ClaudeTasks } from "jsr:@zuke/claude";
 *
 * const out = await ClaudeTasks.run((s) =>
 *   s.prompt("Summarise the staged diff in one line")
 *     .model("sonnet")
 *     .outputFormat("json")
 *     .allowedTools("Read", "Grep")
 * );
 * console.log(out.stdout);
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free. Provide the API key (or
 * any other secret) through the shared `.env(...)` chainer, backed by a
 * `parameter().secret()` build input so Zuke masks it in CI output.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Output format for a headless `claude --print` run (`--output-format`). */
export type ClaudeOutputFormat = "text" | "json" | "stream-json";

/** Input format for a headless `claude --print` run (`--input-format`). */
export type ClaudeInputFormat = "text" | "stream-json";

/** Permission mode for a run (`--permission-mode`). */
export type ClaudePermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan";

/**
 * Settings for a non-interactive `claude --print` run — the build-friendly
 * way to send a single prompt and capture the response.
 */
export class ClaudeRunSettings extends ToolSettings {
  #prompt?: string;
  #model?: string;
  #fallbackModel?: string;
  #outputFormat?: ClaudeOutputFormat;
  #inputFormat?: ClaudeInputFormat;
  #allowedTools: string[] = [];
  #disallowedTools: string[] = [];
  #addDirs: string[] = [];
  #permissionMode?: ClaudePermissionMode;
  #dangerouslySkipPermissions = false;
  #appendSystemPrompt?: string;
  #maxTurns?: number;
  #mcpConfig?: string;
  #settings?: string;
  #sessionId?: string;
  #continue = false;
  #resume = false;
  #resumeId?: string;
  #verbose = false;

  /** The underlying executable: `claude`. */
  protected override defaultTool(): string {
    return "claude";
  }

  /** The prompt to run non-interactively. Required. */
  prompt(text: string): this {
    this.#prompt = text;
    return this;
  }

  /** Pin the model by name or alias, e.g. `model("sonnet")` (`--model`). */
  model(id: string): this {
    this.#model = id;
    return this;
  }

  /** Model to fall back to when the primary is overloaded (`--fallback-model`). */
  fallbackModel(id: string): this {
    this.#fallbackModel = id;
    return this;
  }

  /** Shape of the printed response (`--output-format`). */
  outputFormat(format: ClaudeOutputFormat): this {
    this.#outputFormat = format;
    return this;
  }

  /** Shape of the supplied input (`--input-format`). */
  inputFormat(format: ClaudeInputFormat): this {
    this.#inputFormat = format;
    return this;
  }

  /** Allow only these tools, comma-joined into `--allowedTools`. Repeatable. */
  allowedTools(...tools: string[]): this {
    this.#allowedTools.push(...tools);
    return this;
  }

  /** Deny these tools, comma-joined into `--disallowedTools`. Repeatable. */
  disallowedTools(...tools: string[]): this {
    this.#disallowedTools.push(...tools);
    return this;
  }

  /** Grant the session access to extra directories (`--add-dir`). Repeatable. */
  addDir(...dirs: string[]): this {
    this.#addDirs.push(...dirs);
    return this;
  }

  /** How tool permissions are handled for the run (`--permission-mode`). */
  permissionMode(mode: ClaudePermissionMode): this {
    this.#permissionMode = mode;
    return this;
  }

  /** Bypass all permission prompts (`--dangerously-skip-permissions`). */
  dangerouslySkipPermissions(): this {
    this.#dangerouslySkipPermissions = true;
    return this;
  }

  /** Append text to the system prompt (`--append-system-prompt`). */
  appendSystemPrompt(text: string): this {
    this.#appendSystemPrompt = text;
    return this;
  }

  /** Cap the number of agentic turns (`--max-turns`). */
  maxTurns(turns: number): this {
    this.#maxTurns = turns;
    return this;
  }

  /** MCP server configuration, as a file path or inline JSON (`--mcp-config`). */
  mcpConfig(pathOrJson: string): this {
    this.#mcpConfig = pathOrJson;
    return this;
  }

  /** Settings, as a file path or inline JSON (`--settings`). */
  settings(pathOrJson: string): this {
    this.#settings = pathOrJson;
    return this;
  }

  /** Run under a specific session id (`--session-id`). */
  sessionId(id: string): this {
    this.#sessionId = id;
    return this;
  }

  /** Continue the most recent conversation (`--continue`). */
  continueSession(): this {
    this.#continue = true;
    return this;
  }

  /** Resume a conversation, optionally by session id (`--resume`). */
  resume(sessionId?: string): this {
    this.#resume = true;
    this.#resumeId = sessionId;
    return this;
  }

  /** Emit verbose logging (`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** Assemble the `claude --print` argv. */
  protected override buildArgs(): string[] {
    if (this.#prompt === undefined) {
      throw new Error("ClaudeTasks.run: .prompt() is required.");
    }
    const argv = ["--print", this.#prompt];
    if (this.#model !== undefined) argv.push("--model", this.#model);
    if (this.#fallbackModel !== undefined) {
      argv.push("--fallback-model", this.#fallbackModel);
    }
    if (this.#outputFormat !== undefined) {
      argv.push("--output-format", this.#outputFormat);
    }
    if (this.#inputFormat !== undefined) {
      argv.push("--input-format", this.#inputFormat);
    }
    if (this.#allowedTools.length > 0) {
      argv.push("--allowedTools", this.#allowedTools.join(","));
    }
    if (this.#disallowedTools.length > 0) {
      argv.push("--disallowedTools", this.#disallowedTools.join(","));
    }
    if (this.#addDirs.length > 0) argv.push("--add-dir", ...this.#addDirs);
    if (this.#permissionMode !== undefined) {
      argv.push("--permission-mode", this.#permissionMode);
    }
    if (this.#dangerouslySkipPermissions) {
      argv.push("--dangerously-skip-permissions");
    }
    if (this.#appendSystemPrompt !== undefined) {
      argv.push("--append-system-prompt", this.#appendSystemPrompt);
    }
    if (this.#maxTurns !== undefined) {
      argv.push("--max-turns", String(this.#maxTurns));
    }
    if (this.#mcpConfig !== undefined) {
      argv.push("--mcp-config", this.#mcpConfig);
    }
    if (this.#settings !== undefined) argv.push("--settings", this.#settings);
    if (this.#sessionId !== undefined) {
      argv.push("--session-id", this.#sessionId);
    }
    if (this.#continue) argv.push("--continue");
    if (this.#resume) {
      argv.push("--resume");
      if (this.#resumeId !== undefined) argv.push(this.#resumeId);
    }
    if (this.#verbose) argv.push("--verbose");
    return argv;
  }
}

/**
 * Shared builder for `claude <group> …` subcommand groups (`mcp`, `config`):
 * name the verb and operands with `.command(...)` and pass anything else with
 * `.flag(...)`.
 */
export abstract class ClaudeCommandSettings extends ToolSettings {
  #command: string[] = [];
  #flags: string[] = [];

  /** The underlying executable: `claude`. */
  protected override defaultTool(): string {
    return "claude";
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

  /** Assemble the `claude <group> …` argv. */
  protected override buildArgs(): string[] {
    return [this.group(), ...this.#command, ...this.#flags];
  }
}

/** Settings for a `claude mcp …` invocation (manage MCP servers). */
export class ClaudeMcpSettings extends ClaudeCommandSettings {
  /** The leading subcommand group token: `"mcp"`. */
  protected override group(): string {
    return "mcp";
  }
}

/** Settings for a `claude config …` invocation (manage configuration). */
export class ClaudeConfigSettings extends ClaudeCommandSettings {
  /** The leading subcommand group token: `"config"`. */
  protected override group(): string {
    return "config";
  }
}

/** Settings for `claude update` (self-update the CLI). */
export class ClaudeUpdateSettings extends ToolSettings {
  /** The underlying executable: `claude`. */
  protected override defaultTool(): string {
    return "claude";
  }

  /** Assemble the `claude update` argv. */
  protected override buildArgs(): string[] {
    return ["update"];
  }
}

/** The shape of {@link ClaudeTasks}. */
export interface ClaudeTasksApi {
  /** Run a prompt non-interactively (`claude --print`). */
  run(configure?: Configure<ClaudeRunSettings>): Promise<CommandOutput>;
  /** Manage MCP servers (`claude mcp …`). */
  mcp(configure?: Configure<ClaudeMcpSettings>): Promise<CommandOutput>;
  /** Manage configuration (`claude config …`). */
  config(configure?: Configure<ClaudeConfigSettings>): Promise<CommandOutput>;
  /** Self-update the CLI (`claude update`). */
  update(configure?: Configure<ClaudeUpdateSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the Claude Code CLI. */
export const ClaudeTasks: ClaudeTasksApi = {
  run(configure?: Configure<ClaudeRunSettings>): Promise<CommandOutput> {
    return runSettings(new ClaudeRunSettings(), configure);
  },
  mcp(configure?: Configure<ClaudeMcpSettings>): Promise<CommandOutput> {
    return runSettings(new ClaudeMcpSettings(), configure);
  },
  config(configure?: Configure<ClaudeConfigSettings>): Promise<CommandOutput> {
    return runSettings(new ClaudeConfigSettings(), configure);
  },
  update(configure?: Configure<ClaudeUpdateSettings>): Promise<CommandOutput> {
    return runSettings(new ClaudeUpdateSettings(), configure);
  },
};
