// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The small authenticated-JSON transport the Google REST task groups share
 * ({@link "./gcs.ts".GcsTasks}, {@link "./secret_manager.ts".SecretManagerTasks}):
 * a bearer-token request over an injectable `fetch`, plus a few guards for
 * narrowing an untrusted response body without a type assertion.
 *
 * @module
 */

import { HttpError } from "@zuke/core";
import { GcloudOutputError } from "./errors.ts";

/** Common options for a Google REST call: the bearer token and an injectable `fetch`. */
export interface GcpRestOptions {
  /** The OAuth access token (see {@link "./auth.ts".gcloudAccessToken}). */
  token: string;
  /** The `fetch` implementation; defaults to the global. Overridable for tests. */
  fetch?: typeof fetch;
}

/**
 * Perform an authenticated Google REST request and return its parsed JSON body
 * (`null` for an empty body; a body that is not JSON is a
 * {@link "./errors.ts".GcloudOutputError} that does not quote it). Throws {@link "@zuke/core".HttpError} on a non-2xx
 * status **unless** the status is listed in `tolerate` — the seam an idempotent
 * create uses to treat an already-exists `409` as success.
 */
export async function gcpJson(
  url: string,
  init: RequestInit,
  options: GcpRestOptions,
  tolerate: readonly number[] = [],
): Promise<unknown> {
  const doFetch = options.fetch ?? fetch;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${options.token}`);
  const response = await doFetch(url, { ...init, headers });
  if (!response.ok && !tolerate.includes(response.status)) {
    await response.body?.cancel();
    throw new HttpError(response.status, url);
  }
  const text = await response.text();
  if (text === "") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    // The parser's own message quotes the text around the fault, and the
    // text may be a secret's payload or whatever a proxy put in its place.
    throw new GcloudOutputError(
      url.split("?")[0],
      "the response body is not JSON, so it cannot be read. It is not " +
        "quoted here.",
    );
  }
}

/** Narrow an unknown JSON value to a plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a string field of a JSON object, or `undefined`. */
export function readString(
  object: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

/** The array elements of a JSON object's field, or `[]` when absent/not an array. */
export function readArray(
  object: Record<string, unknown>,
  key: string,
): unknown[] {
  const value = object[key];
  return Array.isArray(value) ? value : [];
}
