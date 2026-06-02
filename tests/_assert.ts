/**
 * Minimal assertion helpers, kept local so the test suite has zero network
 * dependencies (the sandbox blocks the JSR registry).
 */

/** Structural equality via JSON-ish deep comparison. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
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

/** Assert that `fn` throws; optionally check the error type and message. */
export function assertThrows(
  fn: () => unknown,
  // deno-lint-ignore no-explicit-any
  ErrorClass?: new (...args: any[]) => Error,
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
  // deno-lint-ignore no-explicit-any
  ErrorClass?: new (...args: any[]) => Error,
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
  // deno-lint-ignore no-explicit-any
  ErrorClass?: new (...args: any[]) => Error,
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
