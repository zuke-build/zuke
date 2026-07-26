/**
 * The one way Zuke ends a child process: signal politely, wait out a grace
 * window, then `SIGKILL`.
 *
 * Both places that terminate a process — stopping a service
 * ({@link "./shell.ts".SpawnedProcess.stop}) and reaping a command that blew its
 * {@link "./shell.ts".Command.killAfter} budget — share this sequence, so a child
 * that ignores `SIGTERM` can never hang a teardown or a timeout. Internal (not a
 * published entrypoint).
 *
 * @module
 */

/** How long a process is given to exit on its own before `SIGKILL`, in ms. */
export const TERMINATION_GRACE_MS = 5000;

/** The part of `Deno.ChildProcess` the termination sequence needs. */
export interface Terminable {
  /** Deliver a signal to the process. Throws if it has already exited. */
  kill(signal?: Deno.Signal): void;
  /** Resolves when the process exits. */
  readonly status: Promise<Deno.CommandStatus>;
}

/**
 * Terminate `child` and resolve once it has actually exited.
 *
 * Sends `signal`, then races the process's exit against `graceMs`; if the grace
 * window wins, escalates to `SIGKILL`. A process that has already exited (a
 * throwing `kill`) is treated as stopped, and a process that exits in the
 * instant between the grace timer and the escalation is fine too — neither is an
 * error. The grace timer is always cleared, so nothing is left pending.
 *
 * Windows has no `SIGTERM` semantics: `kill` terminates the process outright
 * there, so the escalation simply never fires — no platform branch needed.
 *
 * @param child The process to end.
 * @param signal The signal to send first — `SIGTERM` unless a caller needs another.
 * @param graceMs How long to wait for a clean exit before `SIGKILL`.
 */
export async function terminateProcess(
  child: Terminable,
  signal: Deno.Signal = "SIGTERM",
  graceMs: number = TERMINATION_GRACE_MS,
): Promise<void> {
  try {
    child.kill(signal);
  } catch {
    return; // Already exited: nothing to signal.
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const graceExpired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), graceMs);
  });
  const exited = child.status.then(() => false);
  const shouldKill = await Promise.race([exited, graceExpired]);
  if (timer !== undefined) clearTimeout(timer);
  if (shouldKill) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Raced to exit between the timeout and the kill.
    }
  }
  await child.status;
}
