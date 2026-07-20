/**
 * The transport layer: POST a prompt to a provider and return its raw text.
 * Each provider has its own endpoint, auth scheme, and response shape; the rest
 * of the package is provider-agnostic.
 *
 * @module
 */

import type { AnyParameter } from "@zuke/core";
import type { Effort, Provider, Usage } from "./types.ts";
import { AiReviewError } from "./errors.ts";
import { dig, expectString } from "./json.ts";
import { retryingFetch, type RetryOptions } from "./retry.ts";
import { ASSESSMENT_GEMINI_SCHEMA, ASSESSMENT_JSON_SCHEMA } from "./schema.ts";

/** Default model per provider, used when `.model(...)` is not set. */
export const DEFAULT_MODELS: Record<Provider, string> = {
  claude: "claude-opus-4-8",
  openai: "gpt-5.4-mini",
  gemini: "gemini-3.5-flash",
};

/** Options threaded through {@link callProvider}. */
export interface CallOptions {
  effort?: Effort;
  fetch?: typeof fetch;
  /** Retry-on-transient-failure knobs (see {@link RetryOptions}). */
  retry?: RetryOptions;
  /**
   * The structured-output schema to enforce. Defaults to the review
   * {@link ASSESSMENT_JSON_SCHEMA}; the fixer passes its own `Fix` schema. The
   * `gemini` variant is the OpenAPI-subset dialect Gemini's `responseSchema`
   * expects (no `additionalProperties`, `nullable` for optionals).
   */
  schema?: { json: Record<string, unknown>; gemini: Record<string, unknown> };
  /** Name for OpenAI's `json_schema` (cosmetic). Defaults to `"assessment"`. */
  schemaName?: string;
  /** Max output tokens to request. Defaults to 4096. */
  maxTokens?: number;
}

/** A provider's raw text plus the token usage it reported, if any. */
export interface ProviderResult {
  /** The model's raw text content. */
  text: string;
  /** Token counts from the response, when the provider reported them. */
  usage?: Usage;
}

/** A finite number, or `undefined` for anything else. */
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Assemble a {@link Usage} from input/output/total counts, deriving the total
 * from input + output when the provider omits it. Returns `undefined` when no
 * count is present so callers can tell "not reported" from "zero".
 */
function buildUsage(
  input: number | undefined,
  output: number | undefined,
  total: number | undefined,
): Usage | undefined {
  const resolvedTotal = total ??
    (input !== undefined && output !== undefined ? input + output : undefined);
  if (
    input === undefined && output === undefined && resolvedTotal === undefined
  ) {
    return undefined;
  }
  return {
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    ...(resolvedTotal !== undefined ? { totalTokens: resolvedTotal } : {}),
  };
}

/** Read the token usage from a provider response, normalising field names. */
function readUsage(data: unknown, provider: Provider): Usage | undefined {
  if (provider === "claude") {
    return buildUsage(
      num(dig(data, "usage", "input_tokens")),
      num(dig(data, "usage", "output_tokens")),
      undefined,
    );
  }
  if (provider === "openai") {
    return buildUsage(
      num(dig(data, "usage", "prompt_tokens")),
      num(dig(data, "usage", "completion_tokens")),
      num(dig(data, "usage", "total_tokens")),
    );
  }
  return buildUsage(
    num(dig(data, "usageMetadata", "promptTokenCount")),
    num(dig(data, "usageMetadata", "candidatesTokenCount")),
    num(dig(data, "usageMetadata", "totalTokenCount")),
  );
}

/** Resolve the API key from a parameter or literal string. */
export function resolveKey(
  apiKey: AnyParameter | string | undefined,
): string {
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

/** POST the prompt to the provider and return its text and token usage. */
export async function callProvider(
  provider: Provider,
  key: string,
  model: string,
  system: string,
  user: string,
  options: CallOptions,
): Promise<ProviderResult> {
  const doFetch = options.fetch ?? fetch;
  const jsonSchema = options.schema?.json ?? ASSESSMENT_JSON_SCHEMA;
  const geminiSchema = options.schema?.gemini ?? ASSESSMENT_GEMINI_SCHEMA;
  const schemaName = options.schemaName ?? "assessment";
  const maxTokens = options.maxTokens ?? 4096;
  if (provider === "claude") {
    // `output_config.format` enforces the JSON shape server-side.
    const outputConfig: Record<string, unknown> = {
      format: { type: "json_schema", schema: jsonSchema },
    };
    if (options.effort !== undefined) outputConfig.effort = options.effort;
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: outputConfig,
    };
    const url = "https://api.anthropic.com/v1/messages";
    const response = await retryingFetch(doFetch, url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    }, options.retry);
    await ensureOk(response, provider);
    const data: unknown = await response.json();
    if (dig(data, "stop_reason") === "refusal") {
      throw new AiReviewError("the model refused the request");
    }
    return {
      text: expectString(
        dig(data, "content", 0, "text"),
        "the Claude response",
      ),
      usage: readUsage(data, provider),
    };
  }
  if (provider === "openai") {
    const url = "https://api.openai.com/v1/chat/completions";
    const response = await retryingFetch(doFetch, url, {
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
        // Strict structured outputs enforce the JSON shape server-side.
        response_format: {
          type: "json_schema",
          json_schema: {
            name: schemaName,
            strict: true,
            schema: jsonSchema,
          },
        },
      }),
    }, options.retry);
    await ensureOk(response, provider);
    const data: unknown = await response.json();
    return {
      text: expectString(
        dig(data, "choices", 0, "message", "content"),
        "the OpenAI response",
      ),
      usage: readUsage(data, provider),
    };
  }
  // Send the key in a header, never the query string: a URL can leak into
  // access logs, proxies, and error messages, whereas the header does not.
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await retryingFetch(doFetch, url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      // `responseSchema` enforces the JSON shape server-side.
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: geminiSchema,
      },
    }),
  }, options.retry);
  await ensureOk(response, provider);
  const data: unknown = await response.json();
  return {
    text: expectString(
      dig(data, "candidates", 0, "content", "parts", 0, "text"),
      "the Gemini response",
    ),
    usage: readUsage(data, provider),
  };
}
