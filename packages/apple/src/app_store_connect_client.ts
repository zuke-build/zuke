// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one transport every App Store Connect API call goes through: it signs
 * the token, sends JSON:API requests, retries a read on a transient failure,
 * and turns an error response into an `AppStoreConnectError`. Also the small
 * readers that take a JSON:API document apart without casting it.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { assertSecureBackendUrl } from "@zuke/core";
import type { AppStoreConnectSettings } from "./app_store_connect.ts";
import { signToken } from "./app_store_connect_token.ts";
import {
  AppStoreConnectError,
  type AppStoreConnectErrorDetail,
} from "./errors.ts";

/** A JSON object. */
export type JsonObject = { [key: string]: unknown };

/** Whether `value` is a JSON object. */
export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value[key]` when it is a string, else `undefined`. */
export function stringAt(value: unknown, key: string): string | undefined {
  if (!isObject(value)) return undefined;
  const found = value[key];
  return typeof found === "string" ? found : undefined;
}

/** A JSON:API resource: its id and attributes. */
export interface Resource {
  /** The resource id. */
  id: string;
  /** Its attributes, `{}` when it has none. */
  attributes: JsonObject;
}

/** The resources in a JSON:API document's `data` (one or a list). */
export function resources(document: unknown): Resource[] {
  const data = isObject(document) ? document.data : undefined;
  const list = Array.isArray(data) ? data : data === undefined ? [] : [data];
  return list.flatMap((item) => {
    const id = stringAt(item, "id");
    if (id === undefined || !isObject(item)) return [];
    const attributes = isObject(item.attributes) ? item.attributes : {};
    return [{ id, attributes }];
  });
}

/** The statuses a read is retried after. */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

/** How many times a read is retried, with a doubling delay from one second. */
const RETRIES = 3;

/** The errors an error response lists. */
async function errorDetails(
  response: Response,
): Promise<AppStoreConnectErrorDetail[]> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return [];
  }
  const errors = isObject(body) && Array.isArray(body.errors)
    ? body.errors
    : [];
  return errors.flatMap((error) => {
    const code = stringAt(error, "code");
    const title = stringAt(error, "title");
    if (code === undefined || title === undefined) return [];
    const detail = stringAt(error, "detail");
    return [detail === undefined ? { code, title } : { code, title, detail }];
  });
}

/** Sends App Store Connect API requests for one settings object. */
export class AppStoreConnectClient {
  readonly #settings: AppStoreConnectSettings;
  #privateKey?: string;

  /** A client for `settings`. */
  constructor(settings: AppStoreConnectSettings) {
    assertSecureBackendUrl(
      settings.apiUrl_,
      "App Store Connect apiUrl",
      settings.readEnv_,
    );
    this.#settings = settings;
  }

  /** The private key's PEM, read from its file once. */
  async #key(): Promise<string> {
    const { privateKey_, privateKeyFile_ } = this.#settings;
    if (privateKey_ !== undefined && privateKeyFile_ === undefined) {
      return privateKey_;
    }
    if (privateKeyFile_ !== undefined && privateKey_ === undefined) {
      this.#privateKey ??= await Deno.readTextFile(privateKeyFile_);
      return this.#privateKey;
    }
    throw new Error(
      "App Store Connect: set exactly one of .privateKey() and " +
        ".privateKeyFile().",
    );
  }

  async #token(): Promise<string> {
    const { issuerId_, keyId_ } = this.#settings;
    if (issuerId_ === undefined || keyId_ === undefined) {
      throw new Error(
        "App Store Connect: .issuerId() and .keyId() are required.",
      );
    }
    return await signToken({
      issuerId: issuerId_,
      keyId: keyId_,
      privateKey: await this.#key(),
      now: this.#settings.now_(),
    });
  }

  /**
   * Send a request and return the parsed JSON body (`undefined` for an empty
   * one). A `GET` is retried after a network error or a transient status;
   * a write is sent once, so it cannot be applied twice.
   *
   * @throws {AppStoreConnectError} on an error status.
   */
  async request(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: JsonObject,
  ): Promise<unknown> {
    const settings = this.#settings;
    const url = `${settings.apiUrl_.replace(/\/+$/, "")}${path}`;
    const label = `${method} ${path.split("?")[0]}`;
    for (let attempt = 0;; attempt++) {
      const retry = method === "GET" && attempt < RETRIES;
      const token = await this.#token();
      let response: Response;
      try {
        response = await settings.fetch_(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "error",
        });
      } catch (error) {
        if (!retry || !(error instanceof TypeError)) throw error;
        await settings.sleep_(1000 * 2 ** attempt);
        continue;
      }
      if (response.ok) {
        const text = await response.text();
        return text === "" ? undefined : JSON.parse(text);
      }
      if (retry && TRANSIENT.has(response.status)) {
        await response.body?.cancel();
        await settings.sleep_(1000 * 2 ** attempt);
        continue;
      }
      throw new AppStoreConnectError(
        label,
        response.status,
        await errorDetails(response),
      );
    }
  }
}
