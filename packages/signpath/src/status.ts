// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading a signing request's status: {@link SignPathStatusSettings} for
 * `SignPathTasks.status`, and {@link fetchStatus}, the one status call the
 * wait loop polls with too.
 *
 * Endpoint (SignPath REST API, documented under "Build system integration"):
 * `GET /v1/<org>/SigningRequests/<id>/Status`, answering
 * `{ signingRequestId, status, workflowStatus, isFinalStatus }`.
 *
 * @module
 */

import {
  apiPath,
  apiUrl,
  type Connection,
  requireGuid,
  webUrl,
} from "./connect.ts";
import { SignPathConnectionSettings } from "./connection.ts";
import { SignPathRequestError } from "./errors.ts";
import { scrub } from "./scrub.ts";
import { isRecord, optionalString, own, parseJson } from "./shape.ts";
import { call, type Outgoing, refusal } from "./transport.ts";
import type { SignPathSigningRequestStatus } from "./types.ts";

/** The statuses SignPath documents as final. */
const FINAL = ["Completed", "Failed", "Denied", "Canceled"];

/** Settings for `SignPathTasks.status`: the connection and the request's id. */
export class SignPathStatusSettings extends SignPathConnectionSettings {
  /** The signing request's id (set by {@link signingRequestId}). */
  signingRequestId_?: string;

  /** The signing request to read — the GUID `submit` returned. Required. */
  signingRequestId(id: string): this {
    this.signingRequestId_ = id;
    return this;
  }
}

/** The signing request id a settings object names, validated. */
export function requestIdOf(settings: SignPathStatusSettings): string {
  const id = settings.signingRequestId_;
  if (id === undefined) {
    throw new Error(
      "SignPath needs the signing request's id — call s.signingRequestId(...).",
    );
  }
  return requireGuid(id, "signing request id");
}

/** Read signing request `id`'s status. */
export async function fetchStatus(
  connection: Connection,
  id: string,
): Promise<SignPathSigningRequestStatus> {
  const path = apiPath(connection, "SigningRequests", id, "Status");
  const outgoing: Outgoing = {
    method: "GET",
    url: apiUrl(connection, path),
    path,
    authorize: true,
    timeoutMs: connection.settings.requestTimeout_,
  };
  const answer = await call(connection, outgoing);
  if (!answer.ok) {
    throw refusal(connection, outgoing, answer);
  }
  const json = parseJson(answer.text);
  const status = isRecord(json) ? optionalString(json, "status") : undefined;
  if (!isRecord(json) || status === undefined) {
    throw new SignPathRequestError(
      "GET",
      path,
      `the answer has no "status": ${
        scrub(connection.redactor, answer.text) || "(empty)"
      }`,
    );
  }
  const final = own(json, "isFinalStatus");
  return {
    signingRequestId: id,
    status: scrub(connection.redactor, status),
    workflowStatus: workflowOf(connection, json),
    isFinalStatus: final === true || FINAL.includes(status),
    webUrl: webUrl(connection, id),
  };
}

/** The answer's `workflowStatus`, scrubbed, when it has one. */
function workflowOf(
  connection: Connection,
  json: Record<string, unknown>,
): string | undefined {
  const value = optionalString(json, "workflowStatus");
  return value === undefined ? undefined : scrub(connection.redactor, value);
}
