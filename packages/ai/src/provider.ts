/**
 * The transport layer: POST a prompt to a provider and return its raw text.
 * Each provider has its own endpoint, auth scheme, and response shape; the rest
 * of the package is provider-agnostic.
 *
 * @module
 */

import type { AnyParameter } from "@zuke/core";
import type { Effort, Provider } from "./types.ts";
import { AiReviewError } from "./errors.ts";
import { dig, expectString } from "./json.ts";
import { ASSESSMENT_GEMINI_SCHEMA, ASSESSMENT_JSON_SCHEMA } from "./schema.ts";

/** Default model per provider, used when `.model(...)` is not set. */
export const DEFAULT_MODELS: Record<Provider, string> = {
  claude: "claude-opus-4-8",
  openai: "gpt-4o",
  gemini: "gemini-1.5-pro",
};

/** Options threaded through {@link callProvider}. */
export interface CallOptions {
  effort?: Effort;
  fetch?: typeof fetch;
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

/** POST the prompt to the provider and return the raw text content. */
export async function callProvider(
  provider: Provider,
  key: string,
  model: string,
  system: string,
  user: string,
  options: CallOptions,
): Promise<string> {
  const doFetch = options.fetch ?? fetch;
  if (provider === "claude") {
    // `output_config.format` enforces the JSON shape server-side.
    const outputConfig: Record<string, unknown> = {
      format: { type: "json_schema", schema: ASSESSMENT_JSON_SCHEMA },
    };
    if (options.effort !== undefined) outputConfig.effort = options.effort;
    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
      output_config: outputConfig,
    };
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
        // Strict structured outputs enforce the JSON shape server-side.
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "assessment",
            strict: true,
            schema: ASSESSMENT_JSON_SCHEMA,
          },
        },
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
      // `responseSchema` enforces the JSON shape server-side.
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: ASSESSMENT_GEMINI_SCHEMA,
      },
    }),
  });
  await ensureOk(response, provider);
  const data: unknown = await response.json();
  return expectString(
    dig(data, "candidates", 0, "content", "parts", 0, "text"),
    "the Gemini response",
  );
}
