// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Turning Compose's output into values a build can branch on.
 *
 * Two shapes are covered here, and they are different kinds of answer. `wait`
 * reports through its exit status, which needs no parsing but does need
 * telling apart from a command that genuinely failed. `port` and `version`
 * report through stdout.
 */

/**
 * The part of a finished command this module reads.
 *
 * Narrower than `CommandOutput` on purpose: these readers need the status and
 * the two streams and nothing else, so they take exactly that. A real
 * `CommandOutput` satisfies it structurally.
 */
export interface ComposeRunOutcome {
  /** The process exit status. */
  code: number;
  /** Everything the command wrote to standard output. */
  stdout: string;
  /** Everything the command wrote to standard error. */
  stderr: string;
}

/** The version report `compose version --format json` emits. */
export interface DockerComposeVersion {
  /** The Compose version string, e.g. `v5.1.1`. */
  version: string;
}

/**
 * The exit status `compose wait` reported.
 *
 * `wait` exits with the stopped container's own status, so every code is a
 * legitimate answer and none is reserved to mean "Compose itself failed".
 * There is therefore nothing here to distinguish the two on, and this returns
 * the code as it stands rather than guessing from the output.
 *
 * What that does and does not cover: a missing Compose binary still fails,
 * because tool resolution raises before any process runs. A Compose that ran
 * but could not reach the daemon returns its own exit status, which is
 * indistinguishable from a container that exited with the same number — so a
 * build that needs to tell those apart should confirm the services are up
 * first, or use {@link DockerComposeTasks.wait}, which fails the target on any
 * non-zero status.
 */
export function waitStatus(output: ComposeRunOutcome): number {
  return output.code;
}

/**
 * The host port `compose port` printed, from output like `0.0.0.0:32768`.
 *
 * Read as the segment after the final colon so an IPv6 binding (`[::]:32768`)
 * parses the same way as an IPv4 one, then checked rather than trusted.
 *
 * Compose prints one binding, so anything else is refused instead of guessed
 * at: several lines mean several bindings and there is no way to know which
 * one was wanted, and a line that merely happens to end in digits — a
 * diagnostic, say — is not a binding at all. The number is range-checked too,
 * since a value outside 1-65535 cannot be a published port whatever produced
 * it.
 */
export function parsePublishedPort(stdout: string): number {
  const line = stdout.trim();
  if (line === "") {
    throw new Error(
      "DockerComposeTasks.servicePort: compose printed no binding — the " +
        "service is not running, or that container port is not published.",
    );
  }
  if (/[\r\n]/.test(line)) {
    throw new Error(
      "DockerComposeTasks.servicePort: compose printed more than one " +
        `binding, and which one was wanted is not knowable:\n${line}`,
    );
  }
  // A binding is an optional host — bare, bracketed IPv6, or a name — then a
  // colon and the port. Matching the whole line is what keeps a diagnostic
  // that merely ends in digits from parsing as one.
  const binding = /^(?:\[[0-9A-Fa-f:.]+\]|[0-9A-Za-z.\-*]+)?:(\d{1,5})$/.exec(
    line,
  );
  if (binding === null) {
    throw new Error(
      `DockerComposeTasks.servicePort: compose printed "${line}", which is ` +
        "not a host and port.",
    );
  }
  const port = Number(binding[1]);
  if (port < 1 || port > 65535) {
    throw new Error(
      `DockerComposeTasks.servicePort: compose printed port ${port}, which ` +
        "is outside the 1-65535 a published port can be.",
    );
  }
  return port;
}

/** Parse `compose version --format json` stdout. */
export function parseComposeVersion(stdout: string): DockerComposeVersion {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `DockerComposeTasks.composeVersion: compose did not emit JSON — ${detail}`,
    );
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    !("version" in parsed) || typeof parsed.version !== "string"
  ) {
    throw new Error(
      "DockerComposeTasks.composeVersion: compose emitted JSON without a " +
        "string version field.",
    );
  }
  return { version: parsed.version };
}
