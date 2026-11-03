// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Remote-cache artifact signing: an HMAC-SHA256 over a store key and its
 * archive, so a consumer holding the same secret
 * (`ZUKE_REMOTE_CACHE_SIGNING_KEY`) restores only what a producer holding it
 * uploaded. Anyone who can write the store but not read the secret can no
 * longer choose the files a restore writes.
 *
 * The MAC is a trailer on the stored blob — the archive, then its 32-byte MAC —
 * so the two are written by one put and can never disagree: a first-write-wins
 * store (the GitHub Actions cache) that keeps an earlier upload keeps that
 * upload's own MAC with it. A signed blob lives under {@link signedKey}, apart
 * from the unsigned one, so an unsigned artifact already stored under the plain
 * key cannot block a signed upload.
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

/** The length of the HMAC-SHA256 trailer. */
const MAC_BYTES = 32;

/** Versions the MAC input, so a future layout can never verify as this one. */
const CONTEXT = "zuke-remote-cache-mac-v1";

/** The store key the signed artifact for `key` is kept at. */
export function signedKey(key: string): string {
  return `${key}.signed`;
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
 * What the MAC is computed over, built as the archive streams past: the
 * context and the store key, then the SHA-256 of each {@link CHUNK}-byte slice
 * of the archive in order (the last one shorter).
 */
class MacInput {
  // A store key is `[A-Za-z0-9._-]`, so the newline cannot be forged inside it.
  readonly #parts: Uint8Array[];
  readonly #chunk = new Uint8Array(CHUNK);
  #fill = 0;

  constructor(key: string) {
    this.#parts = [new TextEncoder().encode(`${CONTEXT}\n${key}\n`)];
  }

  /** Feed the next bytes of the archive. */
  async update(piece: Uint8Array): Promise<void> {
    let at = 0;
    while (at < piece.length) {
      const take = Math.min(CHUNK - this.#fill, piece.length - at);
      this.#chunk.set(piece.subarray(at, at + take), this.#fill);
      this.#fill += take;
      at += take;
      if (this.#fill === CHUNK) {
        this.#parts.push(await digest(this.#chunk));
        this.#fill = 0;
      }
    }
  }

  /** The complete MAC input, once the whole archive has been fed. */
  async finish(): Promise<Uint8Array<ArrayBuffer>> {
    if (this.#fill > 0) {
      this.#parts.push(await digest(this.#chunk.slice(0, this.#fill)));
    }
    const input = new Uint8Array(
      this.#parts.reduce((n, p) => n + p.length, 0),
    );
    let offset = 0;
    for (const part of this.#parts) {
      input.set(part, offset);
      offset += part.length;
    }
    return input;
  }
}

/**
 * A transform that passes an archive through unchanged and appends its MAC
 * under `key` at the end. It hashes each chunk as the reader takes it, so a
 * slow upload slows the archive rather than buffering it.
 */
export function signingStream(
  secret: string,
  key: string,
): TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>> {
  const input = new MacInput(key);
  return new TransformStream({
    async transform(chunk, controller) {
      await input.update(chunk);
      controller.enqueue(chunk);
    },
    async flush(controller) {
      controller.enqueue(
        new Uint8Array(
          await crypto.subtle.sign(
            "HMAC",
            await hmacKey(secret),
            await input.finish(),
          ),
        ),
      );
    },
  });
}

/**
 * The bytes of `stored` before its last {@link MAC_BYTES}, yielded as they
 * arrive; the held-back tail is left in `trailer.mac` once the stream ends.
 */
async function* splitTrailer(
  stored: ReadableStream<Uint8Array<ArrayBuffer>>,
  trailer: { mac: Uint8Array<ArrayBuffer> },
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  let tail = new Uint8Array(0);
  for await (const piece of stored) {
    const all = new Uint8Array(tail.length + piece.length);
    all.set(tail);
    all.set(piece, tail.length);
    const cut = Math.max(0, all.length - MAC_BYTES);
    if (cut > 0) yield all.subarray(0, cut);
    tail = all.slice(cut);
  }
  trailer.mac = tail;
}

/**
 * Whether `stored` — an archive followed by its MAC, as {@link signingStream}
 * wrote it under `key` — carries a MAC that verifies against `secret`. A blob
 * shorter than a MAC does not. Compared by Web Crypto's own HMAC verify, which
 * is constant-time.
 */
export async function verifySigned(
  secret: string,
  key: string,
  stored: ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<boolean> {
  const input = new MacInput(key);
  const trailer = { mac: new Uint8Array(0) };
  for await (const piece of splitTrailer(stored, trailer)) {
    await input.update(piece);
  }
  if (trailer.mac.length < MAC_BYTES) return false;
  return await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    trailer.mac,
    await input.finish(),
  );
}

/** The archive inside `stored`, with its MAC trailer dropped. */
export function withoutTrailer(
  stored: ReadableStream<Uint8Array<ArrayBuffer>>,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  return ReadableStream.from(splitTrailer(stored, { mac: new Uint8Array(0) }));
}
