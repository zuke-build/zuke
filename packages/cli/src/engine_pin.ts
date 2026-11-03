// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `zuke upgrade --engine`: move the `engine` pin of a build another SDK
 * hosts to another `@zuke/engine` release.
 *
 * Such a project has no `zuke.ts` and no lock of its own: its `zuke.json`
 * names the exact engine release the launchers and the `zuke` command run,
 * so moving the engine is editing that one field. The project is found the
 * way forwarding finds it, through the same trust gate, and every other
 * field of the file is kept.
 *
 * @module
 */

import {
  BUILD_FILE,
  type BuildProbe,
  locateBuild,
  LOCK_FILE,
} from "./dispatch.ts";
import { ENGINE_FIELD } from "./launcher.ts";
import type { CliPaint } from "./paint.ts";
import { isRecord } from "./records.ts";
import { ENGINE_PACKAGE, registryMeta, resolveRelease } from "./upgrade.ts";
import { VERSION_PATTERN } from "./version_report.ts";

/** The command, as its messages name it. */
const COMMAND = "zuke upgrade --engine";

/** What moving the pin reaches outside the process, injectable for tests. */
export interface EnginePinHost {
  /** Read a text file, rejecting when it cannot be read. */
  readText(path: string): Promise<string>;
  /** Write a text file, replacing what is there. */
  writeText(path: string, text: string): Promise<void>;
  /** Fetch and parse `@zuke/engine`'s JSR `meta.json`. */
  engineMeta(): Promise<unknown>;
}

/** Flags accepted by `zuke upgrade --engine`. */
export interface EnginePinFlags {
  /** The exact release to pin. When unset, the registry's latest. */
  version?: string;
  /** Report what would be pinned, and change nothing. */
  dryRun: boolean;
}

/**
 * Parse the arguments following `zuke upgrade --engine`. Strict like
 * `upgrade`'s own parser: this rewrites a project file.
 *
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
        `${COMMAND}: "${arg}" is not a version — name a release such as ` +
          "1.2.0.",
      );
    } else {
      flags.version = arg;
    }
  }
  return flags;
}

/**
 * Run `zuke upgrade --engine <args>` for the project at or above `cwd`,
 * reporting through `log`, and return the exit code.
 *
 * @throws {Error} with a message for the user when there is no project, when
 * it has no engine pin, or when the release cannot be resolved.
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
  const meta = await registryMeta(
    () => host.engineMeta(),
    ENGINE_PACKAGE,
    COMMAND,
  );
  const target = resolveRelease(meta, flags.version, ENGINE_PACKAGE, COMMAND);
  if (target === location.engine) {
    log(paint.ok(
      `${ENGINE_PACKAGE} ${target} is already pinned` +
        (flags.version === undefined ? ", and is the latest release" : "") +
        ".",
    ));
    return 0;
  }
  const path = `${location.root}/zuke.json`;
  if (flags.dryRun) {
    log(
      `Would move ${ENGINE_FIELD} from ${location.engine} to ${target} in ` +
        path,
    );
    return 0;
  }
  // The file was parsed by the probe to find the pin; it is an object with
  // an `engine` string, and the rewrite keeps every other field as it is.
  const config: unknown = JSON.parse(await host.readText(path));
  const document: Record<string, unknown> = isRecord(config) ? config : {};
  await host.writeText(
    path,
    `${JSON.stringify({ ...document, [ENGINE_FIELD]: target }, null, 2)}\n`,
  );
  log(paint.ok(
    `Moved ${ENGINE_FIELD} from ${location.engine} to ${target} in ${path}.`,
  ));
  if (location.frozen) {
    // The launchers and the zuke command run a hosted build frozen against
    // its deno.lock, which pins the engine it was written for.
    log(
      `  note     ${location.root}/${LOCK_FILE} pins @zuke/engine ` +
        `${location.engine}, so the next run refuses it: regenerate it with ` +
        "your build's lock target, or remove it to run unlocked.",
    );
  }
  return 0;
}
