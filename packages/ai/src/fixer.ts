/**
 * The fluent {@link AiFixer} and the {@link aiFixer} factory — a
 * {@link "jsr:@zuke/core".Remediation} that diagnoses a failed target with an
 * LLM and, when allowed, applies the fix, optionally commits it, and asks the
 * executor to re-run the target.
 *
 * The default is intentionally safe and useful with only a provider and key:
 * it diagnoses the failure and writes the explanation to the job summary and a
 * PR comment, without touching any files. Opt into changes with `.autoApply()`
 * and `.commitFixes()`.
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
import { Command, CommandError } from "@zuke/core/shell";
import type { Effort, Provider, Usage } from "./types.ts";
import { type Fix, type FixLocation, parseFix } from "./fix.ts";
import { FIX_GEMINI_SCHEMA, FIX_JSON_SCHEMA } from "./fix_schema.ts";
import { resolveGithubContext } from "./hosts/github.ts";
import { postSuggestions } from "./hosts/github_review.ts";
import {
  DEFAULT_EXCLUDES,
  DiffSettings,
  filterDiff,
  truncate,
} from "./diff.ts";
import { callProvider, DEFAULT_MODELS, resolveKey } from "./provider.ts";
import { fixSystemPrompt, fixUserPrompt } from "./prompts/fix.ts";
import { applyEdits } from "./apply.ts";
import { commitAndPush, type GitRunner } from "./commit.ts";
import {
  fixConsoleLines,
  fixMarkdown,
  type FixReport,
  fixSkipConsoleLine,
  fixSkipMarkdown,
} from "./fix_report.ts";
import { retryLine, writeStepSummary } from "./report.ts";
import { detectReviewHost, type EnvReader, readEnv } from "./hosts.ts";
import type { RetryInfo, RetryOptions } from "./retry.ts";

/** The files a fixer reads, in order, for project conventions. */
const CONVENTION_FILES = ["CLAUDE.md", "AGENTS.md"];

/** Read a text file, returning `undefined` when it cannot be read. */
export async function readTextOrUndefined(
  path: string,
): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}

/**
 * The body of an inline review comment for one location: the diagnosis plus a
 * committable `suggestion` block. An empty suggestion produces an empty
 * block, which GitHub renders as a deletion of the targeted lines.
 */
function suggestionBody(diagnosis: string, loc: FixLocation): string {
  const suggestion = loc.suggestion ?? "";
  const block = suggestion === ""
    ? ["```suggestion", "```"]
    : ["```suggestion", suggestion, "```"];
  return [diagnosis, "", ...block].join("\n");
}

/** Extract the failed command and its output from a target's error. */
function describeError(error: unknown): { command?: string; output: string } {
  if (error instanceof CommandError) {
    const output = error.stderr.trim();
    return {
      command: error.command,
      output: output === "" ? error.message : output,
    };
  }
  if (error instanceof Error) return { output: error.message };
  return { output: String(error) };
}

/**
 * A fluent AI fixer. Construct one via {@link aiFixer}, configure it, and attach
 * it to a target with `.recoverWith(...)`. Only `.provider(...)` and
 * `.apiKey(...)` are required; everything else defaults.
 */
export class AiFixer implements Remediation {
  #provider?: Provider;
  #apiKey?: AnyParameter | string;
  #model?: string;
  #effort?: Effort;
  #criteria = "";
  #conventions?: string;
  readonly #diff = new DiffSettings();
  readonly #include: string[] = [];
  readonly #exclude: string[] = [];
  #maxDiffTokens?: number = 16000;
  #autoApply = false;
  readonly #allow: string[] = [];
  readonly #excludePaths: string[] = [];
  #maxEdits = 10;
  #onlyLocal = true;
  #commitFixes = false;
  #commitMessage?: string;
  #push = true;
  #comment = true;
  #suggest = true;
  #commentToken?: AnyParameter | string;
  #retry?: RetryOptions;
  #quiet = false;
  #fetch?: typeof fetch;
  #exec?: (argv: string[]) => Promise<string>;
  #write?: (path: string, content: string) => Promise<void>;
  #readFile?: (path: string) => Promise<string | undefined>;
  #env: EnvReader = readEnv;

  /** A name for diagnostics — `"AI fix"`. */
  name = "AI fix";

  /** Set the model provider (required). */
  provider(provider: Provider): this {
    this.#provider = provider;
    return this;
  }

  /** Set the API key, from a secret parameter or a literal string (required). */
  apiKey(apiKey: AnyParameter | string): this {
    this.#apiKey = apiKey;
    return this;
  }

  /** Override the model (default: the provider's recommended model). */
  model(model: string): this {
    this.#model = model;
    return this;
  }

  /** Set the thinking-effort hint (honoured by Claude; ignored elsewhere). */
  effort(effort: Effort): this {
    this.#effort = effort;
    return this;
  }

  /** Project-specific notes appended to the prompt (idioms, constraints). */
  criteria(criteria: string): this {
    this.#criteria = criteria;
    return this;
  }

  /**
   * Supply the project conventions text directly, instead of letting the fixer
   * read `CLAUDE.md`/`AGENTS.md`. Pass an empty string to send none.
   */
  conventions(text: string): this {
    this.#conventions = text;
    return this;
  }

  /** Configure the diff source used for context (default: the working tree). */
  diff(configure: Configure<DiffSettings>): this {
    configure(this.#diff);
    return this;
  }

  /** Only include diff sections matching these globs in the prompt context. */
  include(...globs: string[]): this {
    this.#include.push(...globs);
    return this;
  }

  /** Exclude diff sections matching these globs from the prompt context. */
  exclude(...globs: string[]): this {
    this.#exclude.push(...globs);
    return this;
  }

  /** Cap the context diff at roughly this many tokens (default 16000). */
  maxDiffTokens(tokens: number): this {
    this.#maxDiffTokens = tokens;
    return this;
  }

  /**
   * Apply the proposed fix to the working tree and ask the executor to re-run
   * the target. Off by default (the fixer only diagnoses). Writes are confined
   * by {@link allowPaths}, the built-in exclusions, and {@link maxEdits}, and
   * are refused on CI unless {@link allowCI} is set.
   */
  autoApply(): this {
    this.#autoApply = true;
    return this;
  }

  /** Restrict applied edits to paths matching these globs (default: all). */
  allowPaths(...globs: string[]): this {
    this.#allow.push(...globs);
    return this;
  }

  /** Exclude paths matching these globs from edits, on top of the built-ins. */
  excludePaths(...globs: string[]): this {
    this.#excludePaths.push(...globs);
    return this;
  }

  /** Cap how many files a single applied fix may touch (default 10). */
  maxEdits(count: number): this {
    this.#maxEdits = Math.max(1, Math.floor(count));
    return this;
  }

  /** Permit auto-apply (and committing) on CI; off by default. */
  allowCI(): this {
    this.#onlyLocal = false;
    return this;
  }

  /**
   * After applying a fix, stage it, commit it, and push to the current branch —
   * so a healed pull request carries the fix as a commit. Implies
   * {@link autoApply}. Requires a checkout that can push (a non-detached branch
   * with credentials); a failed push is reported, not fatal.
   */
  commitFixes(): this {
    this.#commitFixes = true;
    this.#autoApply = true;
    return this;
  }

  /** Override the commit subject used by {@link commitFixes}. */
  commitMessage(message: string): this {
    this.#commitMessage = message;
    return this;
  }

  /** Commit the fix but do not push it (leave it staged in a local commit). */
  noPush(): this {
    this.#push = false;
    return this;
  }

  /** Also post the diagnosis/fix as a PR comment (on by default). */
  comment(): this {
    this.#comment = true;
    return this;
  }

  /** Do not post a PR comment (the job summary is still written). */
  noComment(): this {
    this.#comment = false;
    return this;
  }

  /**
   * On GitHub, post each code location as an inline review comment with a
   * committable `suggestion` block (the Copilot-style suggestion) instead
   * of a single overview comment. On by default; a no-op off GitHub or when the
   * model reports no specific locations, where the overview comment is used.
   */
  suggest(): this {
    this.#suggest = true;
    return this;
  }

  /** Post a single overview comment instead of inline GitHub suggestions. */
  noSuggest(): this {
    this.#suggest = false;
    return this;
  }

  /** The token used to post the PR comment (defaults to the host's env var). */
  commentToken(token: AnyParameter | string): this {
    this.#commentToken = token;
    return this;
  }

  /** Retry the provider call on transient failures (see {@link RetryOptions}). */
  retry(options: RetryOptions = {}): this {
    this.#retry = options;
    return this;
  }

  /** Suppress the console printout (the summary/comment are still written). */
  quiet(): this {
    this.#quiet = true;
    return this;
  }

  /** The `fetch` implementation for the API call (test seam). */
  fetch(impl: typeof fetch): this {
    this.#fetch = impl;
    return this;
  }

  /** The `git` runner used for the diff and commit (test seam). */
  exec(run: (argv: string[]) => Promise<string>): this {
    this.#exec = run;
    return this;
  }

  /** The file writer used when applying edits (test seam). */
  write(impl: (path: string, content: string) => Promise<void>): this {
    this.#write = impl;
    return this;
  }

  /** The convention-file reader (test seam). */
  readFile(impl: (path: string) => Promise<string | undefined>): this {
    this.#readFile = impl;
    return this;
  }

  /** The environment reader used to detect CI and the comment host (test seam). */
  env(reader: EnvReader): this {
    this.#env = reader;
    return this;
  }

  /** The git runner: the configured seam, or the real shell `Command`. */
  #git(): GitRunner {
    return this.#exec ?? ((argv) => new Command(argv).text());
  }

  /** Resolve the context diff, tolerating a missing repo (returns ""). */
  async #resolveDiff(): Promise<string> {
    if (this.#diff.text_ !== undefined) return this.#diff.text_;
    try {
      return await this.#git()(this.#diff.argv_());
    } catch {
      return "";
    }
  }

  /** Read project conventions: the explicit text, or the first file found. */
  async #resolveConventions(): Promise<string | undefined> {
    if (this.#conventions !== undefined) {
      return this.#conventions === "" ? undefined : this.#conventions;
    }
    const read = this.#readFile ?? readTextOrUndefined;
    for (const file of CONVENTION_FILES) {
      const text = await read(file);
      if (text !== undefined && text !== "") return text;
    }
    return undefined;
  }

  /**
   * Report the fix to the console and the job summary, then post to the PR: as
   * Copilot-style committable inline suggestions on GitHub when there are code
   * locations, otherwise as a single overview comment.
   */
  async #report(target: string, report: FixReport): Promise<void> {
    if (!this.#quiet) {
      for (const line of fixConsoleLines(this.name, target, report)) {
        console.log(line);
      }
    }
    const markdown = fixMarkdown(this.name, target, report);
    writeStepSummary(markdown);
    if (!this.#comment) return;
    if (this.#suggest && await this.#postSuggestions(report)) return;
    await this.#postIssueComment(markdown);
  }

  /** Announce a skipped fix on the console, summary, and (if on) the PR. */
  async #reportSkip(target: string, reason: string): Promise<void> {
    if (!this.#quiet) console.log(fixSkipConsoleLine(this.name, reason));
    const markdown = fixSkipMarkdown(this.name, target, reason);
    writeStepSummary(markdown);
    if (this.#comment) await this.#postIssueComment(markdown);
  }

  /**
   * Post each code location as a GitHub inline review comment with a committable
   * `suggestion` block. Returns whether at least one was posted (so the
   * overview comment can be skipped). A no-op off GitHub or without locations.
   */
  async #postSuggestions(report: FixReport): Promise<boolean> {
    if (detectCiHost(this.#env) !== "github") return false;
    if (report.locations.length === 0) return false;
    const token = this.#commentToken !== undefined
      ? resolveKey(this.#commentToken)
      : this.#env("GITHUB_TOKEN") ?? "";
    const context = resolveGithubContext(token, this.#env);
    if (context === undefined) return false;
    const suggestions = report.locations.map((loc) => ({
      path: loc.file,
      line: loc.endLine ?? loc.line,
      startLine: loc.line,
      body: suggestionBody(report.diagnosis, loc),
      key: `${loc.file}:${loc.line}`,
    }));
    try {
      return (await postSuggestions(
        context,
        suggestions,
        this.#fetch ?? fetch,
      )) > 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${this.name}] could not post suggestions: ${message}`);
      return false;
    }
  }

  /** Upsert the single overview comment via the active CI host. */
  async #postIssueComment(markdown: string): Promise<void> {
    const host = detectReviewHost(this.#env);
    if (host === undefined) return;
    const token = this.#commentToken !== undefined
      ? resolveKey(this.#commentToken)
      : this.#env(host.defaultTokenEnv) ?? "";
    const upsert = host.prepare(token, this.#env);
    if (upsert === undefined) return;
    try {
      await upsert(this.name, markdown, this.#fetch ?? fetch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${this.name}] could not post PR comment: ${message}`);
    }
  }

  /** The commit subject for an applied fix. */
  #message(target: string): string {
    return this.#commitMessage ?? `Apply Zuke AI fix for "${target}"`;
  }

  /**
   * Diagnose the failure and, when permitted, apply (and commit) the fix. Always
   * reports; returns `{ retry: true }` only when it changed the working tree so
   * the executor re-runs the target as the verifier.
   */
  async remediate(context: RemediationContext): Promise<RemediationResult> {
    const provider = this.#provider;
    if (provider === undefined) {
      console.warn(`[${this.name}] no provider configured — skipping`);
      return { retry: false };
    }
    const key = resolveKey(this.#apiKey);
    if (key === "") {
      await this.#reportSkip(context.target, "no API key");
      return { retry: false };
    }
    const model = this.#model ?? DEFAULT_MODELS[provider];

    const { command, output } = describeError(context.error);
    let diff = filterDiff(
      await this.#resolveDiff(),
      this.#include,
      [...DEFAULT_EXCLUDES, ...this.#exclude],
    ).trim();
    if (this.#maxDiffTokens !== undefined) {
      diff = truncate(diff, this.#maxDiffTokens);
    }
    const conventions = await this.#resolveConventions();

    const system = fixSystemPrompt();
    const user = fixUserPrompt({
      target: context.target,
      command,
      output,
      diff: diff === "" ? undefined : diff,
      conventions,
      criteria: this.#criteria === "" ? undefined : this.#criteria,
    });
    const retry = {
      ...this.#retry,
      onRetry: this.#quiet ? undefined : (info: RetryInfo) => {
        console.warn(retryLine(this.name, info));
      },
    };

    let fix: Fix;
    let usage: Usage | undefined;
    try {
      const result = await callProvider(provider, key, model, system, user, {
        effort: this.#effort,
        fetch: this.#fetch,
        retry,
        schema: { json: FIX_JSON_SCHEMA, gemini: FIX_GEMINI_SCHEMA },
        schemaName: "fix",
        maxTokens: 8192,
      });
      fix = parseFix(result.text);
      usage = result.usage;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${this.name}] could not produce a fix: ${message}`);
      return { retry: false };
    }

    const ci = detectCiHost(this.#env) !== "local";
    const wantApply = this.#autoApply && fix.edits.length > 0;
    const ciBlocked = wantApply && this.#onlyLocal && ci;

    if (!wantApply || ciBlocked) {
      const action = fix.edits.length === 0
        ? "diagnosed (no fix proposed)"
        : ciBlocked
        ? `diagnosed (auto-apply disabled on CI; ${fix.edits.length} file(s) proposed)`
        : `diagnosed (${fix.edits.length} file(s) proposed)`;
      await this.#report(context.target, {
        ...fix,
        files: fix.edits.map((e) => e.path),
        action,
        usage,
      });
      return { retry: false, summary: fix.diagnosis };
    }

    let applied: string[];
    try {
      applied = await applyEdits(
        fix.edits,
        {
          allow: this.#allow,
          exclude: this.#excludePaths,
          maxEdits: this.#maxEdits,
        },
        this.#write,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.#report(context.target, {
        ...fix,
        files: fix.edits.map((e) => e.path),
        action: `could not apply fix: ${message}`,
        usage,
      });
      return { retry: false, summary: fix.diagnosis };
    }

    let action =
      `applied a fix to ${applied.length} file(s) and re-ran the target`;
    if (this.#commitFixes) {
      try {
        await commitAndPush({
          paths: applied,
          message: this.#message(context.target),
          push: this.#push,
          run: this.#git(),
        });
        action = this.#push
          ? `applied, committed, and pushed a fix to ${applied.length} file(s)`
          : `applied and committed a fix to ${applied.length} file(s)`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        action =
          `applied a fix to ${applied.length} file(s) (commit failed: ${message})`;
      }
    }
    await this.#report(context.target, {
      ...fix,
      files: applied,
      action,
      usage,
    });
    return { retry: true, summary: fix.diagnosis };
  }
}

/**
 * Construct an {@link AiFixer} and apply the configuration lambda. Plug the
 * result into a target with `.recoverWith(...)`:
 *
 * ```ts
 * test = target()
 *   .executes(() => DenoTasks.test((s) => s.allowAll()))
 *   .recoverWith(aiFixer((f) => f.provider("claude").apiKey(this.key)));
 * ```
 */
export function aiFixer(configure?: Configure<AiFixer>): AiFixer {
  const fixer = new AiFixer();
  return configure ? configure(fixer) : fixer;
}
