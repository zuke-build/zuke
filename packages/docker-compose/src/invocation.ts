// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Detecting which Compose is installed.
 *
 * Compose ships in two shapes: the v2 CLI plugin invoked as `docker compose`
 * and the legacy v1 standalone binary `docker-compose`. These resolve which
 * one the host has, preferring the plugin, and cache the answer.
 */

import { ToolNotFoundError } from "@zuke/core/tooling";
import { Command } from "@zuke/core/shell";

/**
 * Probes whether a candidate Compose invocation is runnable on this host.
 * Receives the binary-and-prefix argv (`["docker", "compose"]` or
 * `["docker-compose"]`) and resolves to `true` when it works. Injectable so
 * detection can be unit-tested without a real Docker install.
 */
export type ComposeProbe = (argv: readonly string[]) => Promise<boolean>;

/**
 * The default {@link ComposeProbe}: run the candidate's `version` subcommand
 * quietly and treat a zero exit as success. A missing binary resolves to
 * `false` rather than throwing, so detection can fall through to the next
 * candidate.
 */
export async function defaultComposeProbe(
  argv: readonly string[],
): Promise<boolean> {
  try {
    const out = await new Command([...argv, "version"]).noThrow().quiet();
    return out.code === 0;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

let cached: Promise<string[]> | undefined;

/** Detect the installed Compose invocation, preferring the v2 plugin. */
async function detect(probe: ComposeProbe): Promise<string[]> {
  if (await probe(["docker", "compose"])) return ["docker", "compose"];
  if (await probe(["docker-compose"])) return ["docker-compose"];
  throw new ToolNotFoundError("docker compose");
}

/**
 * Resolve how Docker Compose is invoked on this host: `["docker", "compose"]`
 * for the v2 plugin or `["docker-compose"]` for the v1 standalone binary. The
 * v2 plugin is preferred; if neither is runnable a {@link ToolNotFoundError} is
 * raised. The result is cached after the first successful detection (a failed
 * detection is not cached, so a later call retries). Pass a custom
 * {@link ComposeProbe} to override how candidates are tested.
 */
export function resolveComposeInvocation(
  probe: ComposeProbe = defaultComposeProbe,
): Promise<string[]> {
  if (cached === undefined) {
    cached = detect(probe).catch((error) => {
      cached = undefined;
      throw error;
    });
  }
  return cached;
}

/**
 * Clear the cached Compose invocation so the next
 * {@link resolveComposeInvocation} re-detects. Internal test seam — the
 * trailing underscore signals it is not part of the stable public API.
 */
export function resetComposeInvocationCache_(): void {
  cached = undefined;
}
