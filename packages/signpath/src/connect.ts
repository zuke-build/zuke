// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Turning {@link SignPathConnectionSettings} into a resolved {@link Connection}
 * — the organization id and token (falling back to the environment), the API's
 * base URL — and building every URL a call goes to from it.
 *
 * Validation lives here, once, so no endpoint can skip it:
 *
 * - the organization id and every signing request id must be GUIDs, so
 *   nothing a caller or a server supplies can add a path segment, a query or
 *   a fragment to a URL (each is percent-encoded as well, belt and braces);
 * - the token must be printable ASCII with no spaces, so it cannot inject a
 *   header line, and it is registered with the call's redactor before
 *   anything can fail;
 * - the API URL carries the token, so core's `assertSecureBackendUrl` refuses
 *   a plaintext one that is not loopback.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { assertSecureBackendUrl, Redactor } from "@zuke/core";
import {
  SIGNPATH_API_TOKEN_ENV,
  SIGNPATH_ORGANIZATION_ID_ENV,
  type SignPathConnectionSettings,
} from "./connection.ts";

/** A connection resolved from settings: who, with what, and where. */
export interface Connection {
  /** The organization id, a validated GUID. */
  readonly organizationId: string;
  /** The API token. */
  readonly token: string;
  /** The API base URL, without a trailing slash. */
  readonly apiBase: string;
  /** The origin the web app's links use. */
  readonly webOrigin: string;
  /** Masks the token (and any other secret the call adds) in messages. */
  readonly redactor: Redactor;
  /** The seams and limits the settings carry. */
  readonly settings: SignPathConnectionSettings;
}

/** A GUID, in any case, without braces. */
const GUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Printable ASCII with no space: what a bearer token can be. */
const TOKEN = /^[\x21-\x7e]+$/;

/** Whether `value` is a GUID. */
export function isGuid(value: string): boolean {
  return GUID.test(value);
}

/**
 * `value`, checked to be a GUID. The message names what was wrong but never
 * echoes the value: a token pasted into the wrong setter must not be printed.
 */
export function requireGuid(value: string, what: string): string {
  if (!isGuid(value)) {
    throw new Error(
      `the SignPath ${what} is not a GUID (like ` +
        `"0b5d3f2c-8c7e-4a1b-9d2e-3f4a5b6c7d8e") — copy it from the SignPath ` +
        `web app.`,
    );
  }
  return value;
}

/** A setting's value, else the environment variable's, treating `""` as unset. */
export function orEnv(
  value: string | undefined,
  settings: SignPathConnectionSettings,
  env: string,
): string | undefined {
  if (value !== undefined && value !== "") return value;
  const fromEnv = settings.readEnv_(env);
  return fromEnv === "" ? undefined : fromEnv;
}

/**
 * Check a bearer token is present and printable ASCII with no whitespace — so
 * it cannot inject a header line — naming the setter and the environment
 * variable that supply it, and never echoing the value.
 */
export function requireToken(
  token: string | undefined,
  what: string,
  setter: string,
  env: string,
): asserts token is string {
  if (token === undefined) {
    throw new Error(`the ${what} is missing — call ${setter} or set ${env}.`);
  }
  if (!TOKEN.test(token)) {
    throw new Error(
      `the ${what} contains whitespace or non-ASCII characters — check it ` +
        `was copied whole, with no trailing newline.`,
    );
  }
}

/** Resolve and validate `settings` into a {@link Connection}. */
export function connect(settings: SignPathConnectionSettings): Connection {
  const token = orEnv(settings.apiToken_, settings, SIGNPATH_API_TOKEN_ENV);
  const redactor = new Redactor();
  requireToken(
    token,
    "SignPath API token",
    "s.apiToken(...)",
    SIGNPATH_API_TOKEN_ENV,
  );
  redactor.add(token);
  const organizationId = orEnv(
    settings.organizationId_,
    settings,
    SIGNPATH_ORGANIZATION_ID_ENV,
  );
  if (organizationId === undefined) {
    throw new Error(
      `SignPath needs an organization id — call s.organizationId(...) or set ` +
        `${SIGNPATH_ORGANIZATION_ID_ENV}.`,
    );
  }
  requireGuid(organizationId, "organization id");
  const apiUrl = parseHttpUrl(settings.apiUrl_, "API URL");
  assertSecureBackendUrl(
    settings.apiUrl_,
    "the SignPath API URL",
    settings.readEnv_,
  );
  apiUrl.search = "";
  apiUrl.hash = "";
  return {
    organizationId,
    token,
    apiBase: apiUrl.href.replace(/\/+$/, ""),
    webOrigin: apiUrl.origin,
    redactor,
    settings,
  };
}

/**
 * `raw` parsed as an `http(s):` URL with no userinfo, or an error naming
 * `what`. Userinfo is refused rather than sent: the token is the credential.
 */
export function parseHttpUrl(raw: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`the SignPath ${what} is not a valid URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`the SignPath ${what} must be an https URL.`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(
      `the SignPath ${what} must not carry a user or password — the API ` +
        `token is the credential.`,
    );
  }
  return url;
}

/**
 * The API path `/v1/<org>/<segments…>`, every segment percent-encoded — the
 * form errors name a call by, since it holds no host and no secret.
 */
export function apiPath(connection: Connection, ...segments: string[]): string {
  return ["v1", connection.organizationId, ...segments]
    .map((segment) => `/${encodeURIComponent(segment)}`).join("");
}

/** The full URL of an {@link apiPath}. */
export function apiUrl(connection: Connection, path: string): URL {
  return new URL(`${connection.apiBase}${path}`);
}

/**
 * The signing request's page in the SignPath web app,
 * `<origin>/Web/<org>/SigningRequests/<id>`.
 *
 * Built here rather than taken from an answer: the GitHub connector does
 * return a `signingRequestUrl`, but a link printed into the build log should
 * not be one a server chose.
 *
 * Assumption: the `/Web/<org>/SigningRequests/<id>` path is the SignPath web
 * app's own URL scheme; SignPath's REST documentation does not spell it out.
 */
export function webUrl(
  connection: Connection,
  signingRequestId: string,
): string {
  return `${connection.webOrigin}/Web/${
    encodeURIComponent(connection.organizationId)
  }/SigningRequests/${encodeURIComponent(signingRequestId)}`;
}
