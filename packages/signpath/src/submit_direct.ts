// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Submitting by uploading the artifact — SignPath's `SubmitWithArtifact`:
 * `POST /v1/<org>/SigningRequests/SubmitWithArtifact` as `multipart/form-data`
 * with `projectSlug`, `signingPolicySlug`, the optional
 * `artifactConfigurationSlug` and `description`, one `parameters.<name>` field
 * per user-defined parameter, and the file as `artifact`. SignPath answers
 * `201 Created` with the new request's URL in `Location`, whose last segment
 * is its id.
 *
 * Internal: not re-exported from `mod.ts`.
 *
 * @module
 */

import { apiPath, apiUrl, type Connection, isGuid } from "./connect.ts";
import { SignPathRequestError } from "./errors.ts";
import { scrub } from "./scrub.ts";
import type { SubmitRequest } from "./submit_request.ts";
import { call, type Outgoing, refusal } from "./transport.ts";

/** The file name part of a `/`- or `\`-separated path. */
function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

/** Read the artifact, reporting a missing file by its path. */
async function readArtifact(
  connection: Connection,
  path: string,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    throw new Error(
      `could not read the artifact to sign, ${path}: ${
        scrub(
          connection.redactor,
          error instanceof Error ? error.message : String(error),
        )
      }`,
    );
  }
}

/** The multipart form `SubmitWithArtifact` takes. */
function formOf(
  request: SubmitRequest,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): FormData {
  const form = new FormData();
  form.append("projectSlug", request.projectSlug);
  form.append("signingPolicySlug", request.signingPolicySlug);
  if (request.artifactConfigurationSlug !== undefined) {
    form.append("artifactConfigurationSlug", request.artifactConfigurationSlug);
  }
  if (request.description !== undefined) {
    form.append("description", request.description);
  }
  for (const [name, value] of request.parameters) {
    form.append(`parameters.${name}`, value);
  }
  form.append("artifact", new Blob([bytes]), baseName(path));
  return form;
}

/**
 * The signing request id a `Location` header ends in, or `undefined` when
 * there is no header, it is not a URL, or its last segment is not a GUID.
 */
function idFromLocation(
  location: string | null,
  base: URL,
): string | undefined {
  if (location === null) return undefined;
  let url: URL;
  try {
    url = new URL(location, base);
  } catch {
    return undefined;
  }
  const last = url.pathname.split("/").pop() ?? "";
  return isGuid(last) ? last : undefined;
}

/** Upload the file at `path` for signing and return the new request's id. */
export async function submitWithArtifact(
  connection: Connection,
  request: SubmitRequest,
  path: string,
): Promise<string> {
  const bytes = await readArtifact(connection, path);
  const endpoint = apiPath(connection, "SigningRequests", "SubmitWithArtifact");
  const outgoing: Outgoing = {
    method: "POST",
    url: apiUrl(connection, endpoint),
    path: endpoint,
    body: formOf(request, path, bytes),
    authorize: true,
    timeoutMs: connection.settings.requestTimeout_,
  };
  const answer = await call(connection, outgoing);
  if (!answer.ok) throw refusal(connection, outgoing, answer);
  const id = idFromLocation(answer.headers.get("location"), outgoing.url);
  if (id === undefined) {
    throw new SignPathRequestError(
      "POST",
      endpoint,
      `SignPath answered HTTP ${answer.status} without the new request's ` +
        `id in a Location header`,
    );
  }
  return id;
}
