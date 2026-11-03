// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Remote-cache artifact signing: an HMAC-SHA256 over a store key and its
 * archive, kept in the store under {@link signatureKey}, so a consumer holding
 * the same secret (`ZUKE_REMOTE_CACHE_SIGNING_KEY`) restores only what a
 * producer holding it uploaded. Anyone who can write the store but not read
 * the secret can no longer choose the files a restore writes.
 *
 * An artifact runs to hundreds of megabytes and is streamed, while Web Crypto
 * HMAC takes its message whole. So the MAC covers the key and the SHA-256 of
 * each fixed-size chunk of the archive, which binds every byte as tightly as a
 * MAC over the bytes themselves while holding only one chunk in memory.
 *
 * @module
 */

/** The fixed chunk size the archive is hashed in. Changing it changes every MAC. */
const CHUNK = 1024 * 1024;

/** Versions the MAC input, so a future layout can never verify as this one. */
const CONTEXT = "zuke-remote-cache-mac-v1";

/** The store key the signature of the artifact under `key` is kept at. */
export function signatureKey(key: string): string {
  return `${key}.sig`;
}

/** The HMAC key for `secret`. */
function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** The SHA-256 of `bytes`, as bytes. */
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/**
 * What the MAC is computed over: the context and `key`, then the SHA-256 of
 * each {@link CHUNK}-byte slice of `artifact` in order (the last one shorter).
 */
async function macInput(
  key: string,
  artifact: ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array<ArrayBuffer>> {
  // A store key is `[A-Za-z0-9._-]`, so the newline cannot be forged inside it.
  const parts: Uint8Array[] = [
    new TextEncoder().encode(`${CONTEXT}\n${key}\n`),
  ];
  const chunk = new Uint8Array(CHUNK);
  let fill = 0;
  for await (const piece of artifact) {
    let at = 0;
    while (at < piece.length) {
      const take = Math.min(CHUNK - fill, piece.length - at);
      chunk.set(piece.subarray(at, at + take), fill);
      fill += take;
      at += take;
      if (fill === CHUNK) {
        parts.push(await digest(chunk));
        fill = 0;
      }
    }
  }
  if (fill > 0) parts.push(await digest(chunk.slice(0, fill)));
  const input = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    input.set(part, offset);
    offset += part.length;
  }
  return input;
}

/** The signature of the artifact stored under `key`, read from `artifact`. */
export async function signArtifact(
  secret: string,
  key: string,
  artifact: ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await hmacKey(secret),
      await macInput(key, artifact),
    ),
  );
}

/**
 * Whether `signature` is the signature of `artifact` under `key`. Compared by
 * Web Crypto's own HMAC verify, which is constant-time.
 */
export async function verifyArtifact(
  secret: string,
  key: string,
  artifact: ReadableStream<Uint8Array<ArrayBuffer>>,
  signature: Uint8Array,
): Promise<boolean> {
  return await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    new Uint8Array(signature),
    await macInput(key, artifact),
  );
}
