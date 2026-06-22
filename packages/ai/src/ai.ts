/**
 * `@zuke/ai` — AI-powered code review as a target {@link Validation}.
 *
 * Define a reviewer fluently (provider + API key is all that's required; every
 * other option has a sane default), then plug it into a target with
 * {@link "jsr:@zuke/core".TargetBuilder.validateBefore | .validateBefore} or
 * `.validateAfter`. The reviewer fetches the diff, asks the model for a
 * structured {@link Assessment}, prints the findings, and **throws to break the
 * build** when the assessed risk crosses the threshold you choose.
 *
 * ```ts
 * import { Build, parameter, target } from "jsr:@zuke/core";
 * import { securityReviewer } from "jsr:@zuke/ai";
 *
 * class Pipeline extends Build {
 *   key = parameter("Anthropic API key").secret().required();
 *
 *   security = securityReviewer((r) => r.provider("claude").apiKey(this.key));
 *
 *   deploy = target()
 *     .validateBefore(this.security)        // gate before deploying
 *     .executes(async () => {});
 * }
 * ```
 *
 * Built on the platform `fetch` with an injectable `.fetch()` seam (and an
 * `.exec()` seam for the `git diff`), so reviewers unit-test without network or
 * a working tree. Dependency-free; works with Claude, OpenAI, or Gemini.
 *
 * @module
 */

import type { AnyParameter, Validation, ValidationContext } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { Command } from "@zuke/core/shell";

/** A supported model provider. */
export type Provider = "claude" | "openai" | "gemini";

/** The kind of review an assessment performs. */
export type AssessmentType =
  | "generic"
  | "security"
  | "secrets"
  | "correctness"
  | "license";

/** A severity level, ordered `none` < `low` < `medium` < `high` < `critical`. */
export type Severity = "none" | "low" | "medium" | "high" | "critical";

/** The thinking-depth hint passed to providers that support it (Claude). */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** A single issue reported by the model. */
export interface AssessmentFinding {
  /** A short title for the issue. */
  title: string;
  /** The issue's severity. */
  severity: Severity;
  /** The file the issue is in, if the model attributed one. */
  file?: string;
  /** The line the issue is at, if the model attributed one. */
  line?: number;
  /** A longer explanation, if provided. */
  detail?: string;
}

/** The structured result of a review. */
export interface Assessment {
  /** Overall risk score, `0` (none) to `10` (severe). */
  score: number;
  /** The overall severity. */
  severity: Severity;
  /** A one-line summary of the assessment. */
  summary: string;
  /** The individual findings. */
  findings: AssessmentFinding[];
}

/** Raised when a reviewer is misconfigured, the API fails, or the gate trips. */
export class AiReviewError extends Error {
  override name = "AiReviewError";
  constructor(message: string) {
    super(message);
  }
}

/** Default model per provider, used when `.model(...)` is not set. */
const DEFAULT_MODELS: Record<Provider, string> = {
  claude: "claude-opus-4-8",
  openai: "gpt-4o",
  gemini: "gemini-1.5-pro",
};

/** Diff sections matching these globs are dropped from review by default. */
const DEFAULT_EXCLUDES = ["**/*.lock"];

const SEVERITY_ORDER: Severity[] = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
];

/** The numeric rank of a severity, for comparisons. */
function rank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

/** What each built-in assessment asks the model to look for. */
const SUBJECTS: Record<AssessmentType, string> = {
  generic: "",
  security:
    "security vulnerabilities — injection, broken authentication or authorization, secret leakage, unsafe deserialization, SSRF, and path traversal",
  secrets: "leaked secrets — credentials, API keys, tokens, or private keys",
  correctness: "correctness bugs, logic errors, and likely regressions",
  license:
    "license and dependency-compliance risk — incompatible licenses or newly added risky dependencies",
};

/** Read a nested field from an unknown value without casting. */
function dig(value: unknown, ...path: Array<string | number>): unknown {
  let current = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      if (typeof current !== "object" || current === null) return undefined;
      current = Reflect.get(current, key);
    }
  }
  return current;
}

/** Read a string at `path`, or throw if the response shape is wrong. */
function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new AiReviewError(`could not read ${label} from the response`);
  }
  return value;
}

/** Translate a glob (`*`, `**`, `?`) into an anchored regular expression. */
function globToRe(pattern: string): RegExp {
  const body = pattern
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((token) => {
      if (token === "**/") return "(?:.*/)?";
      if (token === "**") return ".*";
      if (token === "*") return "[^/]*";
      if (token === "?") return "[^/]";
      return token.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${body}$`);
}

/** Whether `path` matches any of the glob `patterns`. */
function matchesAny(patterns: string[], path: string): boolean {
  return patterns.some((p) => globToRe(p).test(path));
}

/** The file path of a `diff --git` section header, if it has one. */
function sectionPath(section: string): string | undefined {
  const match = section.match(/^diff --git a\/(\S+) b\//m);
  return match?.[1];
}

/** Drop diff sections whose file is excluded (or not included). */
function filterDiff(
  diff: string,
  include: string[],
  exclude: string[],
): string {
  const sections = diff.split(/(?=^diff --git )/m);
  return sections
    .filter((section) => {
      const path = sectionPath(section);
      if (path === undefined) return true; // preamble / non-file text
      if (include.length > 0 && !matchesAny(include, path)) return false;
      return !matchesAny(exclude, path);
    })
    .join("");
}

/** Truncate a diff to roughly `maxTokens` (≈4 chars/token), noting the cut. */
function truncate(diff: string, maxTokens: number): string {
  const limit = maxTokens * 4;
  if (diff.length <= limit) return diff;
  return `${
    diff.slice(0, limit)
  }\n… (diff truncated to fit the token budget) …`;
}

/** A configured rule for {@link Reviewer.failWhen}. */
type GateRule =
  | { kind: "score"; value: number }
  | { kind: "severity"; value: Severity };

/** Fluent gate configuration passed to {@link Reviewer.failWhen}. */
export class GateSettings {
  readonly rules_: GateRule[] = [];

  /** Fail when the assessed risk score is strictly above `value` (0–10). */
  scoreAbove(value: number): this {
    this.rules_.push({ kind: "score", value });
    return this;
  }

  /** Fail when the overall severity is at least `value`. */
  severityAtLeast(value: Severity): this {
    this.rules_.push({ kind: "severity", value });
    return this;
  }
}

/** Whether an assessment trips the gate, and the human-readable reason. */
function gateTrips(
  assessment: Assessment,
  rules: GateRule[],
): { tripped: boolean; reason: string } {
  for (const rule of rules) {
    if (rule.kind === "score" && assessment.score > rule.value) {
      return {
        tripped: true,
        reason: `risk score ${assessment.score} exceeds ${rule.value}`,
      };
    }
    if (
      rule.kind === "severity" &&
      rank(assessment.severity) >= rank(rule.value)
    ) {
      return {
        tripped: true,
        reason: `severity "${assessment.severity}" is at least "${rule.value}"`,
      };
    }
  }
  return { tripped: false, reason: "" };
}

/** Fluent diff source configuration passed to {@link Reviewer.diff}. */
export class DiffSettings {
  base_?: string;
  staged_ = false;
  text_?: string;

  /** Review the diff against `ref` (e.g. `"origin/main"`). */
  base(ref: string): this {
    this.base_ = ref;
    return this;
  }

  /** Review the staged changes (`git diff --cached`). */
  staged(): this {
    this.staged_ = true;
    return this;
  }

  /** Review a diff supplied directly, bypassing `git` (useful in tests). */
  text(diff: string): this {
    this.text_ = diff;
    return this;
  }

  /** The `git` argv this diff source resolves to. */
  argv_(): string[] {
    const argv = ["git", "diff"];
    if (this.staged_) argv.push("--cached");
    if (this.base_ !== undefined) argv.push(this.base_);
    return argv;
  }
}

/** Normalise an unknown into a {@link Severity}, or `undefined`. */
function toSeverity(value: unknown): Severity | undefined {
  if (typeof value !== "string") return undefined;
  for (const severity of SEVERITY_ORDER) {
    if (severity === value) return severity;
  }
  return undefined;
}

/** Clamp an unknown score into the `0`–`10` range, defaulting to `0`. */
function clampScore(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value)));
}

/** The highest severity among the findings (or `none`). */
function maxSeverity(findings: AssessmentFinding[]): Severity {
  let highest: Severity = "none";
  for (const f of findings) {
    if (rank(f.severity) > rank(highest)) highest = f.severity;
  }
  return highest;
}

/** Build the finding list from an unknown `findings` value. */
function toFindings(value: unknown): AssessmentFinding[] {
  if (!Array.isArray(value)) return [];
  const findings: AssessmentFinding[] = [];
  for (const item of value) {
    const title = dig(item, "title");
    if (typeof title !== "string") continue;
    const file = dig(item, "file");
    const line = dig(item, "line");
    const detail = dig(item, "detail");
    findings.push({
      title,
      severity: toSeverity(dig(item, "severity")) ?? "low",
      ...(typeof file === "string" ? { file } : {}),
      ...(typeof line === "number" ? { line } : {}),
      ...(typeof detail === "string" ? { detail } : {}),
    });
  }
  return findings;
}

/** Strip Markdown code fences and isolate the JSON object in a response. */
function isolateJson(text: string): string {
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, "").replace(
    /\s*```\s*$/,
    "",
  ).trim();
  const open = unfenced.indexOf("{");
  const close = unfenced.lastIndexOf("}");
  return open >= 0 && close > open ? unfenced.slice(open, close + 1) : unfenced;
}

/** Parse a model response into a validated {@link Assessment}. */
function parseAssessment(text: string): Assessment {
  let raw: unknown;
  try {
    raw = JSON.parse(isolateJson(text));
  } catch {
    throw new AiReviewError("the model did not return valid JSON");
  }
  const findings = toFindings(dig(raw, "findings"));
  const summary = dig(raw, "summary");
  return {
    score: clampScore(dig(raw, "score")),
    severity: toSeverity(dig(raw, "severity")) ?? maxSeverity(findings),
    summary: typeof summary === "string" ? summary : "",
    findings,
  };
}

/** Resolve the API key from a parameter or literal string. */
function resolveKey(apiKey: AnyParameter | string | undefined): string {
  if (apiKey === undefined) return "";
  if (typeof apiKey === "string") return apiKey;
  return apiKey.stringValue_() ?? "";
}

/** Throw an {@link AiReviewError} for a non-2xx response (key redacted). */
async function ensureOk(response: Response, provider: Provider): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new AiReviewError(`${provider} API error: HTTP ${response.status}`);
  }
}

/** Options threaded through {@link callProvider}. */
interface CallOptions {
  effort?: Effort;
  fetch?: typeof fetch;
}

/** POST the prompt to the provider and return the raw text content. */
async function callProvider(
  provider: Provider,
  key: string,
  model: string,
  system: string,
  user: string,
  options: CallOptions,
): Promise<string> {
  const doFetch = options.fetch ?? fetch;
  if (provider === "claude") {
    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    };
    if (options.effort !== undefined) {
      body.output_config = { effort: options.effort };
    }
    const url = "https://api.anthropic.com/v1/messages";
    const response = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    await ensureOk(response, provider);
    const data: unknown = await response.json();
    if (dig(data, "stop_reason") === "refusal") {
      throw new AiReviewError("the model refused the request");
    }
    return expectString(dig(data, "content", 0, "text"), "the Claude response");
  }
  if (provider === "openai") {
    const url = "https://api.openai.com/v1/chat/completions";
    const response = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    await ensureOk(response, provider);
    const data: unknown = await response.json();
    return expectString(
      dig(data, "choices", 0, "message", "content"),
      "the OpenAI response",
    );
  }
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${
      encodeURIComponent(key)
    }`;
  const response = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  await ensureOk(response, provider);
  const data: unknown = await response.json();
  return expectString(
    dig(data, "candidates", 0, "content", "parts", 0, "text"),
    "the Gemini response",
  );
}

/** Assemble the system + user prompt for an assessment. */
function buildPrompt(
  assessment: AssessmentType,
  criteria: string,
  diff: string,
): { system: string; user: string } {
  const subject = assessment === "generic"
    ? "the criteria below"
    : SUBJECTS[assessment];
  const system =
    `You are a meticulous senior reviewer. Assess the unified diff for ${subject}. ` +
    `Respond with ONLY a JSON object — no prose, no Markdown, no code fences — matching: ` +
    `{"score": <integer 0-10, higher means more risk>, "severity": <"none"|"low"|"medium"|"high"|"critical">, ` +
    `"summary": <one sentence>, "findings": [{"title": <string>, "severity": <severity>, "file": <string?>, "line": <number?>, "detail": <string?>}]}. ` +
    `If there is nothing of concern, return score 0, severity "none", and an empty findings array.`;
  const user =
    (assessment === "generic" ? `Review criteria:\n${criteria}\n\n` : "") +
    `Unified diff to review:\n\n${diff}`;
  return { system, user };
}

/** A reviewer with nothing to review: a clean pass. */
function emptyAssessment(): Assessment {
  return {
    score: 0,
    severity: "none",
    summary: "No changes to review.",
    findings: [],
  };
}

/**
 * A fluent AI reviewer. Construct one via {@link securityReviewer} (and the
 * sibling factories), configure it, and attach it to a target with
 * `.validateBefore(...)` / `.validateAfter(...)`. `.provider(...)` and
 * `.apiKey(...)` are required; everything else has a default.
 */
export class Reviewer implements Validation {
  readonly #assessment: AssessmentType;
  #provider?: Provider;
  #apiKey?: AnyParameter | string;
  #model?: string;
  #effort?: Effort;
  #criteria = "";
  readonly #diff = new DiffSettings();
  readonly #include: string[] = [];
  readonly #exclude: string[] = [];
  #maxDiffTokens?: number;
  #gate: GateRule[] = [{ kind: "score", value: 7 }];
  #onError: "fail" | "warn" = "fail";
  #quiet = false;
  #fetch?: typeof fetch;
  #exec?: (argv: string[]) => Promise<string>;

  /** A name for diagnostics — `"<assessment> review"`. */
  name: string;

  constructor(assessment: AssessmentType) {
    this.#assessment = assessment;
    this.name = `${assessment} review`;
  }

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

  /** The rubric for a {@link genericReviewer} (required for generic reviews). */
  criteria(criteria: string): this {
    this.#criteria = criteria;
    return this;
  }

  /** Configure the diff source (default: the working-tree diff, `git diff`). */
  diff(configure: Configure<DiffSettings>): this {
    configure(this.#diff);
    return this;
  }

  /** Only review files matching these globs (default: all files). */
  include(...globs: string[]): this {
    this.#include.push(...globs);
    return this;
  }

  /** Exclude files matching these globs (in addition to lockfiles). */
  exclude(...globs: string[]): this {
    this.#exclude.push(...globs);
    return this;
  }

  /** Cap the diff at roughly this many tokens, truncating the rest. */
  maxDiffTokens(tokens: number): this {
    this.#maxDiffTokens = tokens;
    return this;
  }

  /** Choose the gate that breaks the build (default: score above 7). */
  failWhen(configure: Configure<GateSettings>): this {
    const settings = new GateSettings();
    configure(settings);
    this.#gate = settings.rules_;
    return this;
  }

  /**
   * What to do when the review itself fails (API error, refusal, bad JSON):
   * `"fail"` breaks the build (default), `"warn"` logs and passes.
   */
  onError(mode: "fail" | "warn"): this {
    this.#onError = mode;
    return this;
  }

  /** Suppress the findings printout. */
  quiet(): this {
    this.#quiet = true;
    return this;
  }

  /** The `fetch` implementation for the API call (test seam). */
  fetch(impl: typeof fetch): this {
    this.#fetch = impl;
    return this;
  }

  /** The `git` runner used to produce the diff (test seam). */
  exec(run: (argv: string[]) => Promise<string>): this {
    this.#exec = run;
    return this;
  }

  /** Resolve the diff text from the configured source. */
  async #resolveDiff(): Promise<string> {
    if (this.#diff.text_ !== undefined) return this.#diff.text_;
    const run = this.#exec ??
      ((argv: string[]) => new Command(argv).text());
    return await run(this.#diff.argv_());
  }

  /** Print the assessment unless quiet. */
  #print(assessment: Assessment): void {
    if (this.#quiet) return;
    console.log(
      `[${this.name}] score ${assessment.score}/10 (${assessment.severity}) — ${assessment.findings.length} finding(s)`,
    );
    for (const f of assessment.findings) {
      const where = f.file !== undefined
        ? ` (${f.file}${f.line !== undefined ? `:${f.line}` : ""})`
        : "";
      console.log(`  - [${f.severity}] ${f.title}${where}`);
    }
    if (assessment.summary !== "") console.log(`  ${assessment.summary}`);
  }

  /**
   * Run the review and gate the build. Throws an {@link AiReviewError} when the
   * gate trips (or on a configuration/API error with `onError: "fail"`).
   */
  async validate(context: ValidationContext): Promise<void> {
    const provider = this.#provider;
    if (provider === undefined) {
      throw new AiReviewError("a provider is required; call .provider(...)");
    }
    const key = resolveKey(this.#apiKey);
    if (key === "") {
      throw new AiReviewError("an API key is required; call .apiKey(...)");
    }
    if (this.#assessment === "generic" && this.#criteria === "") {
      throw new AiReviewError(
        "genericReviewer needs review criteria; call .criteria(...)",
      );
    }

    let diff = filterDiff(
      await this.#resolveDiff(),
      this.#include,
      [...DEFAULT_EXCLUDES, ...this.#exclude],
    ).trim();
    if (diff === "") {
      this.#print(emptyAssessment());
      return;
    }
    if (this.#maxDiffTokens !== undefined) {
      diff = truncate(diff, this.#maxDiffTokens);
    }

    const { system, user } = buildPrompt(
      this.#assessment,
      this.#criteria,
      diff,
    );
    let assessment: Assessment;
    try {
      const text = await callProvider(
        provider,
        key,
        this.#model ?? DEFAULT_MODELS[provider],
        system,
        user,
        { effort: this.#effort, fetch: this.#fetch },
      );
      assessment = parseAssessment(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.#onError === "warn") {
        console.warn(`[${this.name}] skipped: ${message}`);
        return;
      }
      throw error instanceof AiReviewError ? error : new AiReviewError(message);
    }

    this.#print(assessment);
    const gate = gateTrips(assessment, this.#gate);
    if (gate.tripped) {
      throw new AiReviewError(
        `${this.name} of "${context.target}" failed: ${gate.reason}. ${assessment.summary}`,
      );
    }
  }
}

/** Construct a {@link Reviewer} for `assessment` and apply the lambda. */
function makeReviewer(
  assessment: AssessmentType,
  configure?: Configure<Reviewer>,
): Reviewer {
  const reviewer = new Reviewer(assessment);
  return configure ? configure(reviewer) : reviewer;
}

/**
 * A general-purpose reviewer. Requires `.criteria(...)` describing what to
 * assess and how to score it, in addition to `.provider(...)`/`.apiKey(...)`.
 */
export function genericReviewer(configure?: Configure<Reviewer>): Reviewer {
  return makeReviewer("generic", configure);
}

/** A reviewer that scores the diff for security vulnerabilities. */
export function securityReviewer(configure?: Configure<Reviewer>): Reviewer {
  return makeReviewer("security", configure);
}

/** A reviewer that scans the diff for leaked secrets and credentials. */
export function secretsReviewer(configure?: Configure<Reviewer>): Reviewer {
  return makeReviewer("secrets", configure);
}

/** A reviewer that scores the diff for correctness bugs and regressions. */
export function correctnessReviewer(configure?: Configure<Reviewer>): Reviewer {
  return makeReviewer("correctness", configure);
}

/** A reviewer that scores the diff for license and compliance risk. */
export function licenseReviewer(configure?: Configure<Reviewer>): Reviewer {
  return makeReviewer("license", configure);
}
