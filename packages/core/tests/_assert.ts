/**
 * Minimal assertion helpers, kept local so the test suite has zero network
 * dependencies (the sandbox blocks the JSR registry).
 */

/** A constructor usable on the right of `instanceof` (e.g. `TypeError`). */
type ErrorCtor = new (...args: never[]) => Error;

/** Extract a message from an unknown thrown value without casting. */
export function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** A plain data object (`{...}`) — not a class instance with an opaque shape. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A readable type name for an unknown value, for a clear failure message. */
function typeName(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  return Object.getPrototypeOf(value)?.constructor?.name ?? "object";
}

/**
 * Deep-equal two `Set`s: same size and a one-to-one matching of members (a
 * bijection, not a subset). Each `b` member is consumed once, so
 * `Set([{n:1},{n:1}])` does not match `Set([{n:1},{n:2}])` — the object-member
 * form of the very false positive (unequal Sets comparing equal) this helper
 * exists to catch.
 */
function setsEqual(a: Set<unknown>, b: Set<unknown>): boolean {
  if (a.size !== b.size) return false;
  const bs = [...b];
  const used = bs.map(() => false);
  return [...a].every((av) => {
    const i = bs.findIndex((bv, j) => !used[j] && deepEqual(av, bv));
    if (i === -1) return false;
    used[i] = true;
    return true;
  });
}

/**
 * Deep-equal two `Map`s: same size, every key present with a deep-equal value.
 * Keys are matched by `Map.has` (SameValueZero / reference identity), so two
 * maps keyed by equal-but-distinct objects read as unequal — an over-strict
 * (safe) limit; the suite only ever uses primitive keys.
 */
function mapsEqual(
  a: Map<unknown, unknown>,
  b: Map<unknown, unknown>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (!b.has(key) || !deepEqual(value, b.get(key))) return false;
  }
  return true;
}

/**
 * Structural equality. Handles primitives, arrays, plain objects, and the
 * built-ins whose data is invisible to `Object.keys` — `Date`, `Set`, `Map` —
 * which a naive key-only compare treats as always-equal (any two Sets have zero
 * keys). Any other object type (a class instance with an opaque shape, a RegExp,
 * …) throws rather than silently returning a vacuous `true`: add an explicit
 * handler here if the suite needs to compare one.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date &&
      a.getTime() === b.getTime();
  }
  if (a instanceof Set || b instanceof Set) {
    return a instanceof Set && b instanceof Set && setsEqual(a, b);
  }
  if (a instanceof Map || b instanceof Map) {
    return a instanceof Map && b instanceof Map && mapsEqual(a, b);
  }
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return a instanceof Uint8Array && b instanceof Uint8Array &&
      a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (
    typeof a !== "object" || typeof b !== "object" || a === null || b === null
  ) {
    return false; // a primitive (not `===`) or a null/object mismatch
  }
  if (!isRecord(a) || !isRecord(b)) {
    throw new Error(
      `deepEqual: cannot structurally compare ${typeName(a)} with ` +
        `${typeName(b)} — add an explicit handler in tests/_assert.ts.`,
    );
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => k in b && deepEqual(a[k], b[k]));
}

/** Assert deep equality. */
export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      msg ??
        `Values not equal:\n  actual:   ${JSON.stringify(actual)}\n` +
          `  expected: ${JSON.stringify(expected)}`,
    );
  }
}

/** Assert that `haystack` contains the substring `needle`. */
export function assertStringIncludes(
  haystack: string,
  needle: string,
  msg?: string,
): void {
  if (!haystack.includes(needle)) {
    throw new Error(
      msg ??
        `Expected string to contain substring.\n  substring: ${
          JSON.stringify(needle)
        }\n  actual:    ${JSON.stringify(haystack)}`,
    );
  }
}

/** Assert that `fn` throws; optionally check the error type and message. */
export function assertThrows(
  fn: () => unknown,
  ErrorClass?: ErrorCtor,
  msgIncludes?: string,
): Error {
  let thrown: Error | undefined;
  try {
    fn();
  } catch (e) {
    thrown = e instanceof Error ? e : new Error(String(e));
  }
  if (!thrown) throw new Error("Expected function to throw, but it did not.");
  check(thrown, ErrorClass, msgIncludes);
  return thrown;
}

/** Assert that the promise returned by `fn` rejects. */
export async function assertRejects(
  fn: () => PromiseLike<unknown>,
  ErrorClass?: ErrorCtor,
  msgIncludes?: string,
): Promise<Error> {
  let thrown: Error | undefined;
  try {
    await fn();
  } catch (e) {
    thrown = e instanceof Error ? e : new Error(String(e));
  }
  if (!thrown) throw new Error("Expected promise to reject, but it resolved.");
  check(thrown, ErrorClass, msgIncludes);
  return thrown;
}

function check(
  error: Error,
  ErrorClass?: ErrorCtor,
  msgIncludes?: string,
): void {
  const gotName = error.constructor?.name ?? "Error";
  const message = error.message;
  if (ErrorClass && !(error instanceof ErrorClass)) {
    throw new Error(
      `Expected error of type ${ErrorClass.name}, got ${gotName}: ${message}`,
    );
  }
  if (msgIncludes && !message.includes(msgIncludes)) {
    throw new Error(
      `Expected error message to include "${msgIncludes}", got: ${message}`,
    );
  }
}
