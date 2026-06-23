/**
 * Detecting the program's entry point.
 *
 * {@link run} uses this so a build file can call `run(MyBuild)` at the top
 * level without an `if (import.meta.main)` guard: when the module is the one
 * Deno was started with it runs; when it is merely imported (for example under
 * test) `run` returns without doing anything.
 *
 * The decision recovers the module that called `run` from a stack trace and
 * compares it against {@link Deno.mainModule}. Both are passed in as arguments
 * so the logic stays pure and unit-testable.
 *
 * @module
 */

/** The `file://` module URL within a single V8 stack frame, sans `:line:col`. */
const FRAME = /(file:\/\/.+?):\d+:\d+/;

/**
 * The URL of the first stack frame whose module differs from `selfUrl` — the
 * caller of the code that captured `stack`. Frames from `selfUrl` itself (where
 * the stack was taken) are skipped. Returns `undefined` when no other module
 * frame is present.
 */
export function callerModule(
  stack: string,
  selfUrl: string,
): string | undefined {
  for (const line of stack.split("\n")) {
    const match = FRAME.exec(line);
    if (match !== null && match[1] !== selfUrl) return match[1];
  }
  return undefined;
}

/**
 * Whether the module that invoked `run` is the program's entry point. When the
 * caller can't be identified, defaults to `true` so `run` keeps its
 * always-execute behaviour rather than silently skipping.
 */
export function isEntryModule(
  stack: string,
  selfUrl: string,
  mainModule: string = Deno.mainModule,
): boolean {
  const caller = callerModule(stack, selfUrl);
  return caller === undefined || caller === mainModule;
}
