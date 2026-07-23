/**
 * `CodexTasks` — a typed wrapper for the
 * [OpenAI Codex](https://developers.openai.com/codex/cli) CLI (`codex`), in the
 * same settings-lambda style as the other Zuke tool wrappers.
 *
 * The flagship task is {@link CodexTasksApi.exec}: a non-interactive
 * (`codex exec`) invocation suitable for builds and CI — drive a prompt, pick a
 * model, choose a sandbox and approval policy, and capture the response (use
 * `.json()` with `.outputLastMessage(...)` for machine-readable output). The
 * `mcp` task is a flexible command builder for the `codex mcp` subcommand group.
 *
 * ```ts
 * import { CodexTasks } from "jsr:@zuke/codex";
 *
 * const out = await CodexTasks.exec((s) =>
 *   s.prompt("Summarise the staged diff in one line")
 *     .model("gpt-5-codex")
 *     .sandbox("read-only")
 *     .json()
 * );
 * console.log(out.stdout);
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free. Authenticate through the
 * shared `.env(...)` chainer (e.g. `OPENAI_API_KEY`), backed by a
 * `parameter().secret()` build input so Zuke masks it in CI output.
 *
 * @module
 */

import {
  type Configure,
  runSettings,
  SubcommandSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Sandbox policy for model-generated commands (`--sandbox`). */
export type CodexSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

/** Approval policy for a run (`--ask-for-approval`). */
export type CodexApprovalPolicy =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never";

/** When to colourise output (`--color`). */
export type CodexColor = "always" | "never" | "auto";

/**
 * Settings for a non-interactive `codex exec` run — the build-friendly way to
 * send a single prompt and capture the response.
 */
export class CodexExecSettings extends ToolSettings {
  #prompt?: string;
  #model?: string;
  #images: string[] = [];
  #configs: string[] = [];
  #sandbox?: CodexSandboxMode;
  #cd?: string;
  #askForApproval?: CodexApprovalPolicy;
  #fullAuto = false;
  #bypass = false;
  #skipGitRepoCheck = false;
  #json = false;
  #outputLastMessage?: string;
  #outputSchema?: string;
  #color?: CodexColor;
  #profile?: string;
  #oss = false;

  /** The executable this settings class drives (`codex`). */
  protected override defaultTool(): string {
    return "codex";
  }

  /** The prompt to run non-interactively. Omit to read from stdin. */
  prompt(text: string): this {
    this.#prompt = text;
    return this;
  }

  /** Pin the model, e.g. `model("gpt-5-codex")` (`--model`). */
  model(id: string): this {
    this.#model = id;
    return this;
  }

  /** Attach an image to the prompt (`--image`). Repeatable. */
  image(...paths: string[]): this {
    this.#images.push(...paths);
    return this;
  }

  /** Override a config value as `key=value` (`--config`). Repeatable. */
  config(key: string, value: string): this {
    this.#configs.push(`${key}=${value}`);
    return this;
  }

  /** Sandbox policy for model-generated commands (`--sandbox`). */
  sandbox(mode: CodexSandboxMode): this {
    this.#sandbox = mode;
    return this;
  }

  /** Run as if `codex` was started in this directory (`--cd`). */
  cd(dir: string): this {
    this.#cd = dir;
    return this;
  }

  /** Approval policy for the run (`--ask-for-approval`). */
  askForApproval(policy: CodexApprovalPolicy): this {
    this.#askForApproval = policy;
    return this;
  }

  /** Low-friction sandboxed automatic execution (`--full-auto`). */
  fullAuto(): this {
    this.#fullAuto = true;
    return this;
  }

  /** Skip all confirmation prompts and sandboxing (`--dangerously-bypass-approvals-and-sandbox`). */
  dangerouslyBypassApprovalsAndSandbox(): this {
    this.#bypass = true;
    return this;
  }

  /** Allow running outside a Git repository (`--skip-git-repo-check`). */
  skipGitRepoCheck(): this {
    this.#skipGitRepoCheck = true;
    return this;
  }

  /** Emit events as newline-delimited JSON (`--json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  /** Write the agent's final message to a file (`--output-last-message`). */
  outputLastMessage(file: string): this {
    this.#outputLastMessage = file;
    return this;
  }

  /** Constrain the final message to a JSON schema file (`--output-schema`). */
  outputSchema(file: string): this {
    this.#outputSchema = file;
    return this;
  }

  /** When to colourise output (`--color`). */
  color(mode: CodexColor): this {
    this.#color = mode;
    return this;
  }

  /** Use a named configuration profile (`--profile`). */
  profile(name: string): this {
    this.#profile = name;
    return this;
  }

  /** Use a local open-source model provider (`--oss`). */
  oss(): this {
    this.#oss = true;
    return this;
  }

  /** Assemble the `codex exec` argv. */
  protected override buildArgs(): string[] {
    const argv = ["exec"];
    if (this.#model !== undefined) argv.push("--model", this.#model);
    for (const image of this.#images) argv.push("--image", image);
    for (const config of this.#configs) argv.push("--config", config);
    if (this.#sandbox !== undefined) argv.push("--sandbox", this.#sandbox);
    if (this.#cd !== undefined) argv.push("--cd", this.#cd);
    if (this.#askForApproval !== undefined) {
      argv.push("--ask-for-approval", this.#askForApproval);
    }
    if (this.#fullAuto) argv.push("--full-auto");
    if (this.#bypass) argv.push("--dangerously-bypass-approvals-and-sandbox");
    if (this.#skipGitRepoCheck) argv.push("--skip-git-repo-check");
    if (this.#json) argv.push("--json");
    if (this.#outputLastMessage !== undefined) {
      argv.push("--output-last-message", this.#outputLastMessage);
    }
    if (this.#outputSchema !== undefined) {
      argv.push("--output-schema", this.#outputSchema);
    }
    if (this.#color !== undefined) argv.push("--color", this.#color);
    if (this.#profile !== undefined) argv.push("--profile", this.#profile);
    if (this.#oss) argv.push("--oss");
    if (this.#prompt !== undefined) argv.push(this.#prompt);
    return argv;
  }
}

/**
 * Settings for a `codex mcp …` invocation (manage MCP servers): name the verb
 * and operands with `.command(...)` and pass anything else with `.flag(...)`.
 */
export class CodexMcpSettings extends SubcommandSettings {
  /** The executable this settings class drives (`codex`). */
  protected override defaultTool(): string {
    return "codex";
  }

  /** The fixed `mcp` group token that leads the argv. */
  protected override leadingTokens(): string[] {
    return ["mcp"];
  }
}

/** The shape of {@link CodexTasks}. */
export interface CodexTasksApi {
  /** Run a prompt non-interactively (`codex exec`). */
  exec(configure?: Configure<CodexExecSettings>): Promise<CommandOutput>;
  /** Manage MCP servers (`codex mcp …`). */
  mcp(configure?: Configure<CodexMcpSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the OpenAI Codex CLI. */
export const CodexTasks: CodexTasksApi = {
  exec(configure?: Configure<CodexExecSettings>): Promise<CommandOutput> {
    return runSettings(new CodexExecSettings(), configure);
  },
  mcp(configure?: Configure<CodexMcpSettings>): Promise<CommandOutput> {
    return runSettings(new CodexMcpSettings(), configure);
  },
};
