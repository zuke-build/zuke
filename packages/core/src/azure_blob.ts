// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Azure Blob block upload: `Put Block` for each part, then one `Put Block
 * List` that commits them in order. Shared by the stores that upload to a
 * blob URL signed with a SAS: the GitHub Actions cache and an HTTP store
 * pointed at Azure. Blocks never committed are discarded by the service, so a
 * failed upload leaves nothing to clean up.
 *
 * @module
 */

import { HttpError } from "./http.ts";

/** Whether `url` is an Azure Blob URL carrying a SAS signature. */
export function isAzureSasUrl(url: string): boolean {
  const parsed = URL.parse(url);
  return parsed !== null &&
    parsed.hostname.endsWith(".blob.core.windows.net") &&
    parsed.searchParams.has("sig");
}

/** `url` with `params` set on its query, keeping the SAS parameters. */
function withQuery(url: string, params: Record<string, string>): string {
  const out = new URL(url);
  for (const [name, value] of Object.entries(params)) {
    out.searchParams.set(name, value);
  }
  return out.toString();
}

/**
 * Upload `parts` to the blob at `url` and commit them; resolves to the total
 * size in bytes. Block ids are the part's index, zero-padded so every id has
 * the same length, which the service requires, then base64-encoded.
 */
export async function putBlocks(
  doFetch: typeof fetch,
  url: string,
  headers: Record<string, string>,
  parts: AsyncIterable<Uint8Array<ArrayBuffer>>,
): Promise<number> {
  const send = async (
    target: string,
    body: Blob,
    type: string,
  ): Promise<void> => {
    const response = await doFetch(target, {
      method: "PUT",
      headers: { ...headers, "content-type": type },
      body,
    });
    await response.body?.cancel();
    if (!response.ok) throw new HttpError(response.status, target);
  };
  const ids: string[] = [];
  let size = 0;
  // Per upload, so a concurrent upload to the same blob cannot overwrite this
  // one's uncommitted blocks; Azure needs ids of one length within a blob.
  const prefix = crypto.randomUUID();
  for await (const part of parts) {
    const id = btoa(`${prefix}${String(ids.length).padStart(8, "0")}`);
    await send(
      withQuery(url, { comp: "block", blockid: id }),
      new Blob([part]),
      "application/octet-stream",
    );
    ids.push(id);
    size += part.length;
  }
  const list = `<?xml version="1.0" encoding="utf-8"?><BlockList>${
    ids.map((id) => `<Latest>${id}</Latest>`).join("")
  }</BlockList>`;
  await send(
    withQuery(url, { comp: "blocklist" }),
    new Blob([list]),
    "application/xml",
  );
  return size;
}
