// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `zuke upgrade --engine`: move a build another SDK hosts to another `zuke`
 * release, and so to the `@zuke/engine` inside it.
 *
 * Such a project has no `zuke.ts` and nothing from Deno's stack: its
 * launchers run a pinned `zuke` binary, which carries the engine and every
 * tool wrapper, and its `zuke.json` names that engine. Moving it rewrites
 * both, from the release's own `SHA256SUMS` and engine version. The project
 * is found the way forwarding finds it, through the same trust gate, and
 * every other field of `zuke.json` is kept.
 *
 * @module
 */

import {
  BUILD_FILE,
  type BuildProbe,
  ENGINE_FIELD,
  LAUNCHER_FILE,
  locateBuild,
  LOCK_FILE,
} from "./dispatch.ts";
import {
  binaryLauncherBash,
  binaryLauncherPwsh,
  PLAIN_BINARY_LAUNCHER,
} from "./binary_launcher.ts";
import type { BinaryPin } from "./binary_pin.ts";
import type { CliPaint } from "./paint.ts";
import { isRecord } from "./records.ts";
import { CLI_PACKAGE, registryMeta, resolveRelease } from "./upgrade.ts";
import { VERSION_PATTERN } from "./version_report.ts";

/** The command, as its messages name it. */
const COMMAND = "zuke upgrade --engine";

/** What moving the pin reaches outside the process, injectable for tests. */
export interface EnginePinHost {
  /** Read a text file, or `null` when there is none. */
  readText(path: string): Promise<string | null>;
  /** Write a text file, replacing what is there. */
  writeText(path: string, text: string): Promise<void>;
  /** Fetch and parse `@zuke/cli`'s JSR `meta.json`, whose latest is the newest zuke. */
  cliMeta(): Promise<unknown>;
  /** Resolve the pin of a `zuke` release. */
  binaryPin(version: string): Promise<BinaryPin>;
}

/** Flags accepted by `zuke upgrade --engine`. */
export interface EnginePinFlags {
  /** The exact `zuke` release to move to. When unset, the registry's latest. */
  version?: string;
  /** Report what would change, and change nothing. */
  dryRun: boolean;
}

/**
 * Parse the arguments following `zuke upgrade --engine`. Strict like
 * `upgrade`'s own parser: this rewrites project files.
 * @throws {Error} on an unknown flag, a second version, or a malformed one.
 */
export function parseEnginePinFlags(args: readonly string[]): EnginePinFlags {
  const flags: EnginePinFlags = { dryRun: false };
  for (const arg of args) {
    if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg.startsWith("-")) {
      throw new Error(
        `${COMMAND}: unknown option ${arg}. Usage: ${COMMAND} [<version>] ` +
          "[--dry-run]",
      );
    } else if (flags.version !== undefined) {
      throw new Error(
        `${COMMAND}: name one version, not ${flags.version} and ${arg}.`,
      );
    } else if (!VERSION_PATTERN.test(arg)) {
      throw new Error(
        `${COMMAND}: "${arg}" is not a version — name a zuke release such ` +
          "as 2.4.0.",
      );
    } else {
      flags.version = arg;
    }
  }
  return flags;
}

/**
 * Whether the launcher `text` is a plain one, requiring its runtime on
 * `PATH`, by the line each plain variant carries. A project keeps the
 * variant it chose.
 */
function isPlain(text: string): boolean {
  return text.includes(PLAIN_BINARY_LAUNCHER) ||
    text.includes("Requires Deno:");
}

/**
 * Run `zuke upgrade --engine <args>` for the project at or above `cwd`: move
 * a build another SDK hosts to the latest (or given) `zuke` release, by
 * rewriting its launchers to run that release and its `zuke.json` to pin the
 * engine it carries. A project still on the Deno launchers moves to the
 * binary ones. Reports through `log` and returns the exit code.
 * @throws {Error} with a message for the user when there is no project, when
 * it has its own `zuke.ts`, or when the release cannot be resolved.
 */
export async function runEnginePin(
  args: readonly string[],
  log: (line: string) => void,
  host: EnginePinHost,
  paint: CliPaint,
  cwd: string,
  probe: BuildProbe,
): Promise<number> {
  const flags = parseEnginePinFlags(args);
  const location = await locateBuild(cwd, probe);
  if (location === null) {
    throw new Error(
      `${COMMAND}: no zuke.json in this directory or any parent, so there ` +
        "is no project to work on.",
    );
  }
  if (location.engine === null) {
    throw new Error(
      `${COMMAND}: the project at ${location.root} has its own ${BUILD_FILE}, ` +
        "so no engine pin to move: its Zuke version is the @zuke/core in its " +
        "lock, which zuke relock moves.",
    );
  }
  const version = resolveRelease(
    await registryMeta(() => host.cliMeta(), CLI_PACKAGE, COMMAND),
    flags.version,
    CLI_PACKAGE,
    COMMAND,
  );
  let pin: BinaryPin;
  try {
    pin = await host.binaryPin(version);
  } catch (error) {
    throw new Error(
      `${COMMAND}: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }

  // Every file this writes, with what it holds now and what it will hold.
  const configPath = `${location.root}/zuke.json`;
  const config: unknown = JSON.parse(await host.readText(configPath) ?? "{}");
  const document: Record<string, unknown> = isRecord(config) ? config : {};
  const changes: Array<{ path: string; before: string | null; after: string }> =
    [{
      path: configPath,
      before: JSON.stringify(document),
      after: JSON.stringify({ ...document, [ENGINE_FIELD]: pin.engine }),
    }];
  for (
    const [name, render] of [
      [LAUNCHER_FILE, binaryLauncherBash],
      [`${LAUNCHER_FILE}.ps1`, binaryLauncherPwsh],
    ] as const
  ) {
    const path = `${location.root}/${name}`;
    const before = await host.readText(path);
    // A project without its launchers keeps going without them.
    if (before === null) continue;
    changes.push({
      path,
      before,
      after: render({ download: !isPlain(before) }, pin),
    });
  }
  const moving = changes.filter((change) => change.before !== change.after);
  if (moving.length === 0) {
    log(paint.ok(
      `zuke ${pin.version} (@zuke/engine ${pin.engine}) is already pinned` +
        (flags.version === undefined ? ", and is the latest release" : "") +
        ".",
    ));
    return 0;
  }
  const summary = `zuke ${pin.version}, with @zuke/engine ${pin.engine}`;
  if (flags.dryRun) {
    log(`Would move ${location.root} to ${summary}, rewriting:`);
    for (const change of moving) log(`  ${change.path}`);
    return 0;
  }
  for (const change of moving) {
    await host.writeText(
      change.path,
      change.path === configPath
        ? `${JSON.stringify(JSON.parse(change.after), null, 2)}\n`
        : change.after,
    );
  }
  log(paint.ok(`Moved ${location.root} to ${summary}.`));
  if (location.frozen) {
    // The binary carries exact releases, so a lock written for Deno to run
    // the engine is no longer read by anything.
    log(
      `  note     zuke reads no ${location.root}/${LOCK_FILE}: it carries ` +
        "the exact releases it runs, so the file can be removed.",
    );
  }
  return 0;
}
