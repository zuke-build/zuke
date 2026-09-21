// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A tiny, dependency-free string hash used to derive stable identifiers — cache
 * keys ({@link "./cache.ts".AiCache}) and finding fingerprints
 * ({@link "./suppress.ts".findingFingerprint}). It is **not** cryptographic; it
 * exists only to turn an arbitrary string into a short, deterministic token that
 * is stable across runs and platforms.
 *
 * @module
 */

/** The 64-bit FNV-1a offset basis. */
const OFFSET_BASIS = 0xcbf29ce484222325n;

/** The 64-bit FNV-1a prime. */
const PRIME = 0x00000100000001b3n;

/** Mask that keeps the running hash within 64 bits (BigInt has no fixed width). */
const MASK_64 = 0xffffffffffffffffn;

/**
 * Hash `input` to a short, stable token (lowercase base-36) via 64-bit FNV-1a.
 * The same input always yields the same token, on any platform, with no external
 * dependencies — suitable for cache keys and fingerprints, not for security.
 *
 * 64 bits (via BigInt) rather than 32: these tokens key a response cache and a
 * false-positive suppression set, where a collision would serve a wrong cached
 * review or silently mute an unrelated finding. A 32-bit space reaches a 50%
 * birthday-collision chance at only ~77k distinct inputs; 64 bits pushes that
 * far past any realistic corpus.
 */
export function stableHash(input: string): string {
  let hash = OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * PRIME) & MASK_64;
  }
  return hash.toString(36);
}

/** Shared encoder for {@link sha256Hex} (a `TextEncoder` is stateless and reusable). */
const encoder = new TextEncoder();

/**
 * The SHA-256 digest of `text` as lowercase hex — the collision-resistant
 * fingerprint the review state keeps of what a verifier saw, where
 * {@link stableHash} would let a crafted diff collide with a stored digest and
 * keep a refutation standing over changed code.
 *
 * Core keeps an equivalent helper unexported, and this package must type-check
 * against the core floor it declares — a symbol new in an unreleased core is
 * exactly what that floor check exists to refuse — so the digest lives here.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
