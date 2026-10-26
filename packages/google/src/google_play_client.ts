// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one transport every Google Play Developer API call goes through: it adds
 * the access token, sends a JSON or a raw body, and turns an error response
 * into a `GooglePlayError` carrying Google's message.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { GooglePlayError } from "./errors.ts";
import type { GooglePlaySettings } from "./google_play_settings.ts";
import { isObject, type JsonObject, stringAt } from "./json.ts";

/** The longest Google message an error keeps, with control characters flattened. */
function printable(text: string): string {
  // deno-lint-ignore no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").slice(0, 500);
}

/** Sends Google Play Developer API requests for one settings object. */
export class GooglePlayClient {
  readonly #settings: GooglePlaySettings;
  readonly #token: string;
  readonly #signal?: AbortSignal;

  /** A client for `settings`, sending `token`, giving up when `signal` aborts. */
  constructor(
    settings: GooglePlaySettings,
    token: string,
    signal?: AbortSignal,
  ) {
    this.#settings = settings;
    this.#token = token;
    this.#signal = signal;
  }

  /**
   * Send a request and return the parsed JSON body (`undefined` for an empty
   * one). A JSON object body is sent as JSON, bytes as `application/octet-stream`.
   *
   * @throws {GooglePlayError} on an error status.
   */
  async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: JsonObject | Uint8Array<ArrayBuffer>,
  ): Promise<unknown> {
    const raw = body instanceof Uint8Array;
    const response = await this.#settings.fetch_(
      `${this.#settings.apiUrl_.replace(/\/+$/, "")}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          ...(body === undefined ? {} : {
            "Content-Type": raw
              ? "application/octet-stream"
              : "application/json",
          }),
        },
        body: body === undefined
          ? undefined
          : raw
          ? body
          : JSON.stringify(body),
        redirect: "error",
        signal: this.#signal,
      },
    );
    const text = await response.text();
    if (response.ok) return text === "" ? undefined : JSON.parse(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const detail = isObject(parsed)
      ? stringAt(parsed.error, "message")
      : undefined;
    throw new GooglePlayError(
      `Google Play: ${method} ${
        path.split("?")[0]
      } failed (HTTP ${response.status})` +
        (detail === undefined ? "." : `: ${printable(detail)}`),
      response.status,
    );
  }
}
