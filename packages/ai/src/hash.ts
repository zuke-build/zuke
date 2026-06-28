/**
 * A tiny, dependency-free string hash used to derive stable identifiers — cache
 * keys ({@link "./cache.ts".AiCache}) and finding fingerprints
 * ({@link "./suppress.ts".findingFingerprint}). It is **not** cryptographic; it
 * exists only to turn an arbitrary string into a short, deterministic token that
 * is stable across runs and platforms.
 *
 * @module
 */

/** The 32-bit FNV-1a offset basis. */
const OFFSET_BASIS = 0x811c9dc5;

/** The 32-bit FNV-1a prime. */
const PRIME = 0x01000193;

/**
 * Hash `input` to a short, stable token (lowercase base-36) via FNV-1a. The
 * same input always yields the same token, on any platform, with no external
 * dependencies — suitable for cache keys and fingerprints, not for security.
 */
export function stableHash(input: string): string {
  let hash = OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply mod 2^32 without overflowing the safe-integer range: combine the
    // 16-bit halves so the product stays exact, then mask back to 32 bits.
    hash = Math.imul(hash, PRIME);
  }
  // `>>> 0` reinterprets the 32-bit result as unsigned before the base-36 cast.
  return (hash >>> 0).toString(36);
}
