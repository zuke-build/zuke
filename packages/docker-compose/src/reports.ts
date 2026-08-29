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
 * parses the same way as an IPv4 one.
 */
export function parsePublishedPort(stdout: string): number {
  const line = stdout.trim();
  if (line === "") {
    throw new Error(
      "DockerComposeTasks.servicePort: compose printed no binding — the " +
        "service is not running, or that container port is not published.",
    );
  }
  const separator = line.lastIndexOf(":");
  const port = separator === -1 ? "" : line.slice(separator + 1);
  if (!/^\d+$/.test(port)) {
    throw new Error(
      `DockerComposeTasks.servicePort: compose printed "${line}", which does ` +
        "not end in a port number.",
    );
  }
  return Number(port);
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
