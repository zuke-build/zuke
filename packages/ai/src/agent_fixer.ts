/**
 * The fluent {@link AgentFixer} and the {@link agentFixer} factory — a
 * {@link "jsr:@zuke/core".Remediation} that delegates the actual fixing to a
 * coding agent (Claude Code, Codex, Gemini CLI, …) you inject, then asks the
 * executor to re-run the target so the real command verifies the fix.
 *
 * Unlike {@link "./fixer.ts".AiFixer} (one structured API call, edits applied by
 * Zuke), the agent reads and edits files autonomously. It is therefore gated to
 * local runs by default — opt into CI with `.allowCI()`. Bring your own runner:
 *
 * ```ts
 * import { agentFixer } from "jsr:@zuke/ai";
 * import { ClaudeTasks } from "jsr:@zuke/claude";
 *
 * test = target()
 *   .executes(() => DenoTasks.test((s) => s.allowAll()))
 *   .recoverWith(
 *     agentFixer((ctx) =>
 *       ClaudeTasks.run((s) => s.prompt(ctx.prompt).permissionMode("acceptEdits"))
 *     ),
 *   );
 * ```
 *
 * @module
 */

import {
  type AnyParameter,
  detectCiHost,
  type Remediation,
  type RemediationContext,
  type RemediationResult,
} from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { Command, CommandOutput } from "@zuke/core/shell";
import {
  describeError,
  readTextOrUndefined,
  resolveConventions,
} from "./context.ts";
import { agentPrompt } from "./prompts/agent.ts";
import { commitAll, type GitRunner } from "./commit.ts";
import { writeStepSummary } from "./report.ts";
import { postComment } from "./comment.ts";
import { type EnvReader, readEnv } from "./hosts.ts";

/** The failure context handed to an {@link AgentRunner}, plus a ready prompt. */
export interface AgentContext {
  /** The name of the failed target. */
  target: string;
  /** The 1-based recovery attempt. */
  attempt: number;
  /** The command line that failed, if known. */
  command?: string;
  /** The captured error output (stderr, or the error message). */
  output: string;
  /** Project conventions (CLAUDE.md / AGENTS.md), if found. */
  conventions?: string;
  /** A ready-to-use prompt assembled from the fields above. */
  prompt: string;
}

/**
 * What an {@link AgentRunner} may resolve to: a {@link CommandOutput} (its
 * stdout is captured for the report), a string, or nothing.
 */
export type AgentResult = CommandOutput | string | void;

/**
 * Runs the coding agent against the assembled {@link AgentContext}. The agent is
 * expected to edit files in place; the executor then re-runs the target. Throw
 * (or let the underlying command throw) to signal the agent could not run.
 */
export type AgentRunner = (
  context: AgentContext,
) => Promise<AgentResult> | AgentResult;

/** The agent's captured text output, for the report. */
function textOf(result: AgentResult): string {
  if (typeof result === "string") return result.trim();
  if (result instanceof CommandOutput) return result.text();
  return "";
}

/** A Markdown section reporting what the agent did, for the summary/PR comment. */
function agentMarkdown(
  name: string,
  target: string,
  action: string,
  output: string,
): string {
  const parts = [
    `## 🤖 ${name} — \`${target}\``,
    "",
    `**Action:** ${action.replaceAll("|", "\\|")}`,
    "",
  ];
  const trimmed = output.trim();
  if (trimmed !== "") {
    const capped = trimmed.length > 4000
      ? `${trimmed.slice(0, 4000)}\n… (truncated) …`
      : trimmed;
    parts.push(
      "<details><summary>Agent output</summary>",
      "",
      "```",
      capped,
      "```",
      "</details>",
      "",
    );
  }
  return parts.join("\n");
}

/**
 * A fluent agent fixer. Construct one via {@link agentFixer} with a runner, and
 * attach it to a target with `.recoverWith(...)`. Diagnose/report defaults are
 * on; file changes happen through the agent, gated to local runs unless
 * `.allowCI()`.
 */
export class AgentFixer implements Remediation {
  readonly #run: AgentRunner;
  #onlyLocal = true;
  #commitFixes = false;
  #commitMessage?: string;
  #push = true;
  #comment = true;
  #commentToken?: AnyParameter | string;
  #criteria = "";
  #conventions?: string;
  #quiet = false;
  #env: EnvReader = readEnv;
  #exec?: (argv: string[]) => Promise<string>;
  #readFile?: (path: string) => Promise<string | undefined>;
  #fetch?: typeof fetch;

  /** A name for diagnostics — `"agent fix"`. */
  name = "agent fix";

  constructor(run: AgentRunner) {
    this.#run = run;
  }

  /** Permit the agent to run (and edit files) on CI; off by default. */
  allowCI(): this {
    this.#onlyLocal = false;
    return this;
  }

  /**
   * After the agent runs, stage all its changes, commit, and push to the current
   * branch so a healed PR carries the fix. Requires a checkout that can push; a
   * failed push is reported, not fatal.
   */
  commitFixes(): this {
    this.#commitFixes = true;
    return this;
  }

  /** Override the commit subject used by {@link commitFixes}. */
  commitMessage(message: string): this {
    this.#commitMessage = message;
    return this;
  }

  /** Commit the fix but do not push it. */
  noPush(): this {
    this.#push = false;
    return this;
  }

  /** Also post what the agent did as a PR comment (on by default). */
  comment(): this {
    this.#comment = true;
    return this;
  }

  /** Do not post a PR comment (the job summary is still written). */
  noComment(): this {
    this.#comment = false;
    return this;
  }

  /** The token used to post the PR comment (defaults to the host's env var). */
  commentToken(token: AnyParameter | string): this {
    this.#commentToken = token;
    return this;
  }

  /** Project-specific notes appended to the agent's prompt. */
  criteria(criteria: string): this {
    this.#criteria = criteria;
    return this;
  }

  /**
   * Supply the project conventions text directly instead of reading
   * `CLAUDE.md`/`AGENTS.md`. Pass an empty string to send none.
   */
  conventions(text: string): this {
    this.#conventions = text;
    return this;
  }

  /** Suppress the console printout (the summary/comment are still written). */
  quiet(): this {
    this.#quiet = true;
    return this;
  }

  /** The environment reader used to detect CI and the comment host (test seam). */
  env(reader: EnvReader): this {
    this.#env = reader;
    return this;
  }

  /** The `git` runner used for committing (test seam). */
  exec(run: (argv: string[]) => Promise<string>): this {
    this.#exec = run;
    return this;
  }

  /** The convention-file reader (test seam). */
  readFile(impl: (path: string) => Promise<string | undefined>): this {
    this.#readFile = impl;
    return this;
  }

  /** The `fetch` implementation used to post the PR comment (test seam). */
  fetch(impl: typeof fetch): this {
    this.#fetch = impl;
    return this;
  }

  /** The git runner: the configured seam, or the real shell `Command`. */
  #git(): GitRunner {
    return this.#exec ?? ((argv) => new Command(argv).text());
  }

  /** Report what the agent did to the console, the job summary, and the PR. */
  async #report(target: string, action: string, output: string): Promise<void> {
    if (!this.#quiet) console.log(`[${this.name}] "${target}" — ${action}`);
    const markdown = agentMarkdown(this.name, target, action, output);
    writeStepSummary(markdown);
    if (this.#comment) {
      await postComment(this.name, markdown, {
        commentToken: this.#commentToken,
        env: this.#env,
        fetch: this.#fetch,
      });
    }
  }

  /**
   * Run the agent against the failure, optionally commit its changes, and ask
   * the executor to re-run the target as the verifier. Skips (no retry) on CI
   * unless {@link allowCI} is set, or if the agent run itself fails.
   */
  async remediate(context: RemediationContext): Promise<RemediationResult> {
    if (this.#onlyLocal && detectCiHost(this.#env) !== "local") {
      await this.#report(
        context.target,
        "skipped — agent fixer is disabled on CI (.allowCI() to enable)",
        "",
      );
      return { retry: false };
    }

    const { command, output } = describeError(context.error);
    const conventions = await resolveConventions(
      this.#conventions,
      this.#readFile ?? readTextOrUndefined,
    );
    const prompt = agentPrompt({
      target: context.target,
      command,
      output,
      conventions,
      criteria: this.#criteria === "" ? undefined : this.#criteria,
    });

    let agentOutput: string;
    try {
      agentOutput = textOf(
        await this.#run({
          target: context.target,
          attempt: context.attempt,
          command,
          output,
          conventions,
          prompt,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${this.name}] agent run failed: ${message}`);
      return { retry: false };
    }

    let action = "ran the agent; re-running the target to verify";
    if (this.#commitFixes) {
      try {
        await commitAll({
          message: this.#commitMessage ??
            `Apply Zuke agent fix for "${context.target}"`,
          push: this.#push,
          run: this.#git(),
        });
        action = this.#push
          ? "ran the agent, committed, and pushed; re-running to verify"
          : "ran the agent and committed; re-running to verify";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        action =
          `ran the agent (commit failed: ${message}); re-running to verify`;
      }
    }
    await this.#report(context.target, action, agentOutput);
    return { retry: true };
  }
}

/**
 * Construct an {@link AgentFixer} from an {@link AgentRunner} and apply the
 * configuration lambda. Plug the result into a target with `.recoverWith(...)`.
 */
export function agentFixer(
  run: AgentRunner,
  configure?: Configure<AgentFixer>,
): AgentFixer {
  const fixer = new AgentFixer(run);
  return configure ? configure(fixer) : fixer;
}
