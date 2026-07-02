/**
 * Log levels for {@link ConsoleTasks} — an NUKE-style severity ladder that
 * gates which messages print. `trace` is the most verbose and `silent`
 * suppresses everything; `success` shares `info`'s severity.
 *
 * @module
 */

/** A severity threshold. Messages below the active level are suppressed. */
export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "silent";

/** Numeric severity for each level, so gating is a simple comparison. */
export const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 60,
};

/** Whether `name` is one of the {@link LogLevel} values. */
export function isLogLevel(name: string): name is LogLevel {
  return Object.hasOwn(LEVEL_ORDER, name);
}

/**
 * Resolve the starting level from the `ZUKE_LOG_LEVEL` environment variable,
 * falling back to `info` when it is unset or not a recognised level. `readEnv`
 * is injected so resolution stays testable without touching the real
 * environment.
 */
export function resolveLevel(
  readEnv: (name: string) => string | undefined,
): LogLevel {
  const raw = readEnv("ZUKE_LOG_LEVEL")?.toLowerCase();
  return raw !== undefined && isLogLevel(raw) ? raw : "info";
}
