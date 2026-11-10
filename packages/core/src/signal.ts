// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The process signals and exit status Zuke's own signatures name, spelled out
 * here so they depend on no runtime's types. They are structurally the same
 * as the runtime's, so a value of either kind is a value of the other.
 *
 * @module
 */

/** A POSIX signal name, as a process is sent one or reports dying of one. */
export type Signal =
  | "SIGABRT"
  | "SIGALRM"
  | "SIGBREAK"
  | "SIGBUS"
  | "SIGCHLD"
  | "SIGCONT"
  | "SIGEMT"
  | "SIGFPE"
  | "SIGHUP"
  | "SIGILL"
  | "SIGINFO"
  | "SIGINT"
  | "SIGIO"
  | "SIGPOLL"
  | "SIGUNUSED"
  | "SIGKILL"
  | "SIGPIPE"
  | "SIGPROF"
  | "SIGPWR"
  | "SIGQUIT"
  | "SIGSEGV"
  | "SIGSTKFLT"
  | "SIGSTOP"
  | "SIGSYS"
  | "SIGTERM"
  | "SIGTRAP"
  | "SIGTSTP"
  | "SIGTTIN"
  | "SIGTTOU"
  | "SIGURG"
  | "SIGUSR1"
  | "SIGUSR2"
  | "SIGVTALRM"
  | "SIGWINCH"
  | "SIGXCPU"
  | "SIGXFSZ";

/** How a process ended. */
export interface CommandStatus {
  /** Whether it exited with code 0. */
  success: boolean;
  /** Its exit code. */
  code: number;
  /** The signal that ended it, or `null` when it exited on its own. */
  signal: Signal | null;
}
