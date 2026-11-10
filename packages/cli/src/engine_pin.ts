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
import { PLAIN_DENO_LAUNCHER } from "./launcher.ts";
import {
  binaryMcpEntry,
  MCP_CONFIG_FILE,
  MCP_SERVER_NAME,
  mergeMcpConfig,
  parseMcpConfig,
} from "./mcp_config.ts";
import type { CliPaint } from "./paint.ts";
import { isRecord } from "./records.ts";
import { CLI_PACKAGE, registryMeta, resolveRelease } from "./upgrade.ts";
import { VERSION_PATTERN } from "./version_report.ts";

/** The command, as its messages name it. */
const COMMAND = "zuke upgrade --engine";

/** What moving the pin reaches outside the process, injectable for tests. */
export interface EnginePinHost {
  /**
   * What is at `path`, not following a link: a regular `file`, nothing
   * (`missing`), or `other` — a directory, or a link, which a write would
   * follow out of the project.
   */
  entry(path: string): Promise<"file" | "missing" | "other">;
  /** Read a regular text file. */
  readText(path: string): Promise<string>;
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
    text.includes(PLAIN_DENO_LAUNCHER);
}

/**
 * Whether `text` is a launcher `zuke setup` wrote, of either kind, by the
 * line each one opens its description with: a file of the user's own under
 * the same name is never replaced.
 */
function isLauncher(text: string): boolean {
  return /^# Zuke (bootstrap )?launcher\b/m.test(text);
}

/** One file the move rewrites: where, what it holds, and what it will hold. */
interface Change {
  /** The file's path. */
  readonly path: string;
  /** Whether it already holds what it would be rewritten with. */
  readonly same: boolean;
  /** The text to write. */
  readonly text: string;
}

/**
 * The rewrite of a hosted build's stale `.mcp.json` server: one that runs
 * an engine release on Deno (`deno run -A jsr:@zuke/engine@<v> mcp`), which
 * becomes `zuke mcp`, keeping `--allow-run`. `undefined` for anything else,
 * which is left as it is.
 */
function mcpChange(path: string, text: string): Change | undefined {
  const config = parseMcpConfig(text);
  if (config.state !== "present") return undefined;
  const servers = config.document.mcpServers;
  const entry = isRecord(servers) ? servers[MCP_SERVER_NAME] : undefined;
  const args = isRecord(entry) && Array.isArray(entry.args) ? entry.args : [];
  const onDeno = isRecord(entry) && entry.command === "deno" &&
    args.some((arg) =>
      typeof arg === "string" && arg.startsWith("jsr:@zuke/engine@")
    );
  if (!onDeno) return undefined;
  return {
    path,
    same: false,
    text: mergeMcpConfig(
      config.document,
      binaryMcpEntry(args.includes("--allow-run")),
    ),
  };
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
      `${COMMAND}: the project at ${location.root} has its own ${location.build}, ` +
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
      `${COMMAND}: ${error instanceof Error ? error.message : String(error)}` +
        (flags.version === undefined
          ? ". A release's binaries are published shortly after it; name " +
            "the one before to move now."
          : "."),
    );
  }

  // Every file this writes, with what it holds now and what it will hold.
  const configPath = `${location.root}/zuke.json`;
  if (await host.entry(configPath) !== "file") {
    throw new Error(
      `${COMMAND}: ${configPath} is not a regular file, so it is not ` +
        "rewritten: a write would follow it out of the project. Edit it by hand.",
    );
  }
  const config: unknown = JSON.parse(await host.readText(configPath));
  const document: Record<string, unknown> = isRecord(config) ? config : {};
  const moved = { ...document, [ENGINE_FIELD]: pin.engine };
  const changes: Change[] = [{
    path: configPath,
    same: JSON.stringify(document) === JSON.stringify(moved),
    text: `${JSON.stringify(moved, null, 2)}\n`,
  }];
  const notes: string[] = [];
  let launchers = 0;
  for (
    const [name, render] of [
      [LAUNCHER_FILE, binaryLauncherBash],
      [`${LAUNCHER_FILE}.ps1`, binaryLauncherPwsh],
    ] as const
  ) {
    const path = `${location.root}/${name}`;
    const entry = await host.entry(path);
    if (entry === "missing") continue;
    const before = entry === "file" ? await host.readText(path) : null;
    if (before === null || !isLauncher(before)) {
      notes.push(
        `${path} is ${
          before === null ? "a directory or a link" : "not a Zuke launcher"
        }, so it is left as it is.`,
      );
      continue;
    }
    launchers++;
    const text = render({ download: !isPlain(before) }, pin);
    changes.push({ path, same: before === text, text });
  }
  if (launchers === 0) {
    notes.push(
      `No ./${LAUNCHER_FILE} or ${LAUNCHER_FILE}.ps1 launcher here was ` +
        "rewritten: a launcher kept under another name still runs its old " +
        "zuke release.",
    );
  }
  const mcpPath = `${location.root}/${MCP_CONFIG_FILE}`;
  if (await host.entry(mcpPath) === "file") {
    const change = mcpChange(mcpPath, await host.readText(mcpPath));
    if (change !== undefined) changes.push(change);
  }
  const moving = changes.filter((change) => !change.same);
  for (const note of notes) log(`  note     ${note}`);
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
  for (const change of moving) await host.writeText(change.path, change.text);
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
