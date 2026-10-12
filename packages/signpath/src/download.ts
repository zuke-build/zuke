// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Downloading a signed artifact: {@link SignPathDownloadSettings} for
 * `SignPathTasks.download`, and {@link downloadSignedArtifact}, which `submit`
 * uses too.
 *
 * Endpoint (SignPath REST API): `GET /v1/<org>/SigningRequests/<id>/SignedArtifact`,
 * answering the signed file's bytes.
 *
 * The file is written to exactly the configured path. The name SignPath sends
 * in `Content-Disposition` is ignored on purpose: a server-chosen name is how a
 * download lands outside the directory it was meant for. The bytes are
 * streamed to a uniquely named sibling file and renamed over the destination
 * only once complete, so a failed, oversized or timed-out download never
 * leaves a truncated artifact where the build expects a signed one.
 *
 * A redirect — should SignPath hand the download to blob storage, which its
 * documentation neither promises nor rules out (an assumption) — is followed
 * by hand, at most five hops: each hop must be `https:` (or stay on the
 * origin it left), and the API token is dropped as soon as a hop leaves
 * SignPath's origin, so a storage host never receives it.
 *
 * @module
 */

import type { PathLike } from "@zuke/core";
import { apiPath, apiUrl, type Connection } from "./connect.ts";
import { SignPathRequestError } from "./errors.ts";
import { SignPathStatusSettings } from "./status.ts";
import {
  failure,
  isRedirect,
  type Outgoing,
  read,
  refusal,
  send,
} from "./transport.ts";
import type { SignPathSignedArtifact } from "./types.ts";

/** The most redirects a download follows. */
const MAX_REDIRECTS = 5;

/**
 * Settings for `SignPathTasks.download`: the connection, the signing
 * request's id, and where to write the signed artifact.
 */
export class SignPathDownloadSettings extends SignPathStatusSettings {
  /** Where to write the signed artifact (set by {@link output}). */
  output_?: string;

  /**
   * The file to write the signed artifact to; its directory is created when
   * missing, and an existing file is replaced. Required.
   */
  output(path: PathLike): this {
    this.output_ = String(path);
    return this;
  }
}

/** The configured output path, or an error naming the setter. */
export function requireOutput(output: string | undefined): string {
  if (output === undefined || output === "") {
    throw new Error(
      "SignPath needs a path to write the signed artifact to — call " +
        "s.output(...).",
    );
  }
  return output;
}

/**
 * The directory part of a `/`- or `\`-separated path, or `undefined` for a bare
 * name or a root-level entry — the same rule core's own write-with-mkdir
 * helpers apply, which are internal to core.
 */
function parentOf(path: string): string | undefined {
  const slash = path.replace(/\\/g, "/").lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : undefined;
}

/**
 * Fetch signing request `id`'s signed artifact, following at most
 * {@link MAX_REDIRECTS} redirects, and return the final response.
 */
async function fetchArtifact(
  connection: Connection,
  id: string,
): Promise<{ response: Response; signal: AbortSignal; outgoing: Outgoing }> {
  const path = apiPath(connection, "SigningRequests", id, "SignedArtifact");
  let outgoing: Outgoing = {
    method: "GET",
    url: apiUrl(connection, path),
    path,
    authorize: true,
    timeoutMs: connection.settings.downloadTimeout_,
  };
  for (let hop = 0;; hop++) {
    const { response, signal } = await send(connection, outgoing);
    if (!isRedirect(response)) return { response, signal, outgoing };
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (hop >= MAX_REDIRECTS || location === null) {
      throw new SignPathRequestError(
        "GET",
        path,
        location === null
          ? `SignPath answered with a redirect (HTTP ${response.status}) ` +
            `that names no location`
          : `more than ${MAX_REDIRECTS} redirects`,
      );
    }
    let next: URL;
    try {
      next = new URL(location, outgoing.url);
    } catch {
      throw new SignPathRequestError(
        "GET",
        path,
        "SignPath redirected the download to a location that is not a URL",
      );
    }
    const sameOrigin = next.origin === outgoing.url.origin;
    if (next.protocol !== "https:" && !sameOrigin) {
      throw new SignPathRequestError(
        "GET",
        path,
        "the download was redirected to a URL that is not https, which is " +
          "not followed",
      );
    }
    outgoing = {
      ...outgoing,
      url: next,
      authorize: outgoing.authorize && sameOrigin,
    };
  }
}

/**
 * Download signing request `id`'s signed artifact to `output`, replacing it
 * only once the whole file has arrived within the size cap.
 */
export async function downloadSignedArtifact(
  connection: Connection,
  id: string,
  output: string,
): Promise<SignPathSignedArtifact> {
  const { response, signal, outgoing } = await fetchArtifact(connection, id);
  if (!response.ok) {
    throw refusal(
      connection,
      outgoing,
      await read(connection, outgoing, { response, signal }),
    );
  }
  const partial = `${output}.${crypto.randomUUID()}.partial`;
  const max = connection.settings.maxDownloadBytes_;
  let bytes = 0;
  let oversized = false;
  let file: Deno.FsFile;
  try {
    const parent = parentOf(output);
    if (parent !== undefined) await Deno.mkdir(parent, { recursive: true });
    file = await Deno.open(partial, { write: true, createNew: true });
  } catch (error) {
    // Release the connection: the body will never be read.
    await response.body?.cancel();
    throw error;
  }
  try {
    const limit = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > max) {
          oversized = true;
          controller.error(new Error("oversized"));
          return;
        }
        controller.enqueue(chunk);
      },
    });
    if (response.body === null) file.close();
    else await response.body.pipeThrough(limit).pipeTo(file.writable);
    await Deno.rename(partial, output);
  } catch (error) {
    // The file is closed by now — a failed pipe aborts, and so closes, its
    // writable — so Windows lets the partial file be removed.
    await Deno.remove(partial).catch(() => {});
    if (oversized) {
      throw new SignPathRequestError(
        "GET",
        outgoing.path,
        `the signed artifact is larger than ${max} bytes (raise ` +
          `maxDownloadBytes)`,
      );
    }
    throw failure(connection, outgoing, error, signal);
  }
  return { path: output, bytes };
}
