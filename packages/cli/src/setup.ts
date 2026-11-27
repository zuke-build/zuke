// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The scaffolding engine behind `zuke setup`. It writes a starter `zuke.ts`,
 * the `./zuke` launchers (see {@link "./launcher.ts"} for the two variants),
 * and a `deno.json` task into a target directory.
 *
 * All filesystem and console effects go through an injectable {@link SetupHost}
 * so the logic stays pure and unit-testable; {@link defaultHost} is the real
 * `Deno`-backed implementation used in production.
 */

import {
  binaryMcpEntry,
  isServerEntry,
  MCP_CONFIG_FILE,
  MCP_SERVER_NAME,
  type McpServerEntry,
  mcpServerEntry,
  mergeMcpConfig,
  nodeMcpEntry,
  parseMcpConfig,
} from "./mcp_config.ts";
import { FileTasks, RuntimeTasks } from "@zuke/core";
import { forgivingField, isRecord, parsedRecord } from "./records.ts";
import {
  assertBuildFileName,
  BUILD_FILE,
  buildFileNamed,
  NEW_BUILD_FILE,
} from "./build_file.ts";
import { launcherBash, launcherPwsh } from "./launcher.ts";
import { nodeLauncherBash, nodeLauncherPowerShell } from "./node_launcher.ts";
import { type ProjectRuntime, runtimeNamed } from "./runtime_field.ts";
import { binaryLauncherBash, binaryLauncherPwsh } from "./binary_launcher.ts";
import type { BinaryPin } from "./binary_pin.ts";
import { lstatOrNull } from "./fs.ts";
import { output } from "./output.ts";
import {
  PYTHON_BUILD_FILE,
  STARTER_IMPORTS,
  starterBuild,
  starterConfig,
  starterPythonBuild,
  starterSdkConfig,
  zukeNpmDependency,
} from "./starter.ts";

// Re-exported so the merge guard keeps its historical home for importers.
export { isRecord };

/**
 * The task names `setup` writes into `deno.json`, with their commands, for a
 * build whose file is `buildFile`.
 *
 * The `zuke` task deliberately omits `--frozen`, unlike the launchers: a task
 * command runs in `deno task`'s own shell, which has no conditionals, so it
 * cannot skip the flag on the first run when no `deno.lock` exists yet — and
 * hard-coding it would make a fresh scaffold fail before it could ever write
 * one. The launcher (`./zuke`, the advertised entry point) does the lockfile
 * check and enforces `--frozen` from the second run onward.
 */
function defaultTasks(
  buildFile: string,
): ReadonlyArray<readonly [string, string]> {
  return [
    ["zuke", `deno run -A ${buildFile}`],
    ["fmt", "deno fmt"],
    ["lint", "deno lint"],
    ["test", "deno test -A"],
  ];
}

/** The `zuke` task as setup itself writes it, for any build file. */
const SCAFFOLDED_ZUKE_TASK = /^deno run -A [A-Za-z0-9_.][A-Za-z0-9_.-]*\.ts$/;

/**
 * Whether `tasks.zuke` is a task setup wrote for another build file than
 * `buildFile`: the one thing in `tasks` a re-run replaces, so that a project
 * whose `zuke.json` was pointed at a new build file does not keep a task
 * running the old one. A task the project wrote itself is never touched.
 */
function staleZukeTask(tasks: unknown, buildFile: string): boolean {
  if (!isRecord(tasks) || typeof tasks.zuke !== "string") return false;
  return SCAFFOLDED_ZUKE_TASK.test(tasks.zuke) &&
    tasks.zuke !== `deno run -A ${buildFile}`;
}

/**
 * The import map entries a scaffolded build needs, keyed by bare specifier.
 *
 * The scaffolded `zuke.ts` imports `@zuke/core` (and `zuke import`'s output
 * `@zuke/cmd`) by bare specifier, so `deno.json` has to map each one to its
 * `jsr:` dependency — see {@link "./starter.ts".STARTER_IMPORTS} for why the
 * specifier does not go in the source file.
 */
export type ScaffoldImports = Readonly<Record<string, string>>;

/**
 * Add every entry of `defaults` that `root[key]` does not already declare,
 * leaving the ones it does exactly as they are.
 *
 * Shared by the `imports` and `tasks` merges, which differ only in the
 * collection they draw from: one implementation, so the "never overwrite what
 * the project already declared" rule cannot come to mean two things.
 */
function mergeMissing(
  root: Record<string, unknown>,
  key: string,
  defaults: Iterable<readonly [string, string]>,
): void {
  const existing = root[key];
  const merged: Record<string, unknown> = isRecord(existing)
    ? { ...existing }
    : {};
  for (const [name, value] of defaults) {
    if (!(name in merged)) merged[name] = value;
  }
  root[key] = merged;
}

/**
 * Whether a `deno.json` document delegates its import map to a separate file
 * and would be broken by growing an `imports` block.
 *
 * Deno ignores the `importMap` field the moment `imports` or `scopes` appears
 * in the config, so writing `imports` beside a lone `importMap` silently
 * disables the project's entire module resolution. A document that already has
 * `imports` or `scopes` is not delegating — Deno is ignoring `importMap` there
 * already — so merging into it changes nothing.
 */
export function delegatesImportMap(root: Record<string, unknown>): boolean {
  return typeof root.importMap === "string" &&
    !isRecord(root.imports) && !isRecord(root.scopes);
}

/**
 * Merge the default Zuke tasks and `imports` into a `deno.json` document,
 * preserving the existing content. `existing` is the file text, or `null` to
 * start fresh; `imports` are the bare-specifier mappings the scaffolded build
 * resolves through, and `buildFile` is the file the `zuke` task runs.
 *
 * Merging is additive per key: a task or import the document already declares
 * is left exactly as it is (but for a `zuke` task setup wrote for another
 * build file, which follows the build file), so a project that has pinned `@zuke/core` to a
 * specific version keeps that pin. A document that delegates to an external
 * `importMap` keeps that delegation and grows no `imports` block — see
 * {@link delegatesImportMap}; the caller reports the entry as a manual step
 * instead.
 */
export function mergeDenoJson(
  existing: string | null,
  imports: ScaffoldImports,
  buildFile: string,
): string {
  const root: Record<string, unknown> = {};
  if (existing !== null) {
    const parsed: unknown = JSON.parse(existing);
    if (isRecord(parsed)) Object.assign(root, parsed);
  }
  // Seed `imports` before `tasks` so a file created from scratch lists the
  // dependencies first, the order deno.json conventionally uses. On a file that
  // already has either key, assigning it keeps its original position.
  if (!delegatesImportMap(root)) {
    mergeMissing(root, "imports", Object.entries(imports));
  }
  if (staleZukeTask(root.tasks, buildFile) && isRecord(root.tasks)) {
    root.tasks = { ...root.tasks, zuke: `deno run -A ${buildFile}` };
  }
  mergeMissing(root, "tasks", defaultTasks(buildFile));
  return `${JSON.stringify(root, null, 2)}\n`;
}

/**
 * Whether a `deno.json` text already carries everything the scaffold needs.
 *
 * `"present"` means both the `zuke` task, for this build file, and every
 * scaffold import are already declared, so there is nothing to merge.
 */
export type DenoJsonState = "present" | "absent" | "unparseable";

/**
 * Classify a `deno.json` text by whether the scaffold has anything to add to
 * it: the `zuke` task, or any of `imports`.
 *
 * The imports are part of the question because the build file is written by the
 * same run and imports them by bare specifier. Treating the `zuke` task alone
 * as "already set up" — as this did before the imports existed — would skip the
 * file on a project being re-scaffolded and leave a `zuke.ts` whose specifiers
 * nothing resolves.
 */
export function denoJsonState(
  text: string,
  imports: ScaffoldImports,
  buildFile: string,
): DenoJsonState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "unparseable";
  }
  if (!isRecord(parsed)) return "absent";
  const hasTask = isRecord(parsed.tasks) && "zuke" in parsed.tasks &&
    !staleZukeTask(parsed.tasks, buildFile);
  // A document delegating to an external `importMap` will not grow an
  // `imports` block (it would disable the delegation), so the imports are not
  // something this file is still missing — they are reported as a manual step.
  const declared = isRecord(parsed.imports) ? parsed.imports : {};
  const hasImports = delegatesImportMap(parsed) ||
    Object.keys(imports).every((s) => s in declared);
  return hasTask && hasImports ? "present" : "absent";
}

/**
 * The scaffold specifiers `root` maps somewhere other than their `jsr:@zuke/…`
 * dependency, in declaration order.
 *
 * Keeping a mapping the project already declared is the right default — it is
 * how a deliberate version pin, or a link to a local checkout, survives. But
 * the run should not go on to report the dependency as simply "present", so the
 * caller names what it found and leaves the decision to the reader.
 */
export function remappedImports(
  root: Record<string, unknown>,
  imports: ScaffoldImports,
): string[] {
  const declared = isRecord(root.imports) ? root.imports : {};
  return Object.keys(imports).filter((specifier) => {
    const value = declared[specifier];
    return typeof value === "string" &&
      !value.startsWith(`jsr:${specifier}@`);
  });
}

/** Injected side effects, so {@link runSetup} is unit-testable. */
export interface SetupHost {
  /** Whether a path exists. */
  exists(path: string): Promise<boolean>;
  /** Whether a path exists and is a directory (a reserved-name collision). */
  isDirectory(path: string): Promise<boolean>;
  /**
   * Whether a path is a symbolic link, without following it. Scaffolding
   * refuses to write through one: the writes below follow links, so a link
   * planted at a scaffold name by the very repository being set up would
   * redirect them outside the target directory.
   *
   * The guard covers the names scaffolding chooses, which is where the hazard
   * is — the caller never asked for `.gitignore` to be written, so a repository
   * redirecting it is a decision nobody made. It reports what is there when it
   * runs, and a link planted after it would escape it; that is why
   * {@link SetupHost.writeText} does not write through a link either, so the
   * refusal is the friendly answer rather than the only defence.
   *
   * Two things stay out of scope. The directory the caller names with `--dir`
   * is the caller's to name, symlink or not. And a **hard** link is
   * indistinguishable from the file it shares, so no probe can see one; git
   * cannot check one out either, which is what keeps it out of the threat this
   * guards.
   */
  isSymlink(path: string): Promise<boolean>;
  /** Read a file as UTF-8 text. */
  readText(path: string): Promise<string>;
  /**
   * Whether stdout is an interactive terminal, which decides whether the
   * CLI's own output is rich. Optional: an implementation without it is
   * asked through Deno, the way every other process decides.
   */
  isTerminal?(): boolean;
  /**
   * Write UTF-8 text to a file, creating or replacing it.
   *
   * An implementation must not write *through* a symbolic link standing at
   * `path`: the scaffolder's confinement to its target directory rests on this,
   * and the pre-write {@link SetupHost.isSymlink} check alone cannot carry it,
   * since a link can appear after the check.
   */
  writeText(path: string, content: string): Promise<void>;
  /** Set a file's permission bits (may be unsupported on some platforms). */
  chmod(path: string, mode: number): Promise<void>;
  /** Emit a line of progress output. */
  log(message: string): void;
}

/**
 * The real, `Deno`-backed {@link SetupHost}. Every probe reads the link itself
 * rather than its target (see {@link lstatOrNull}), so a symlink is reported
 * as a symlink instead of as whatever it points at.
 */
export const defaultHost: SetupHost = {
  exists: (path) => FileTasks.exists(path),
  async isDirectory(path: string): Promise<boolean> {
    return (await lstatOrNull(path))?.isDirectory === true;
  },
  async isSymlink(path: string): Promise<boolean> {
    return (await lstatOrNull(path))?.isSymlink === true;
  },
  readText(path: string): Promise<string> {
    return FileTasks.readText(path);
  },
  async writeText(path: string, content: string): Promise<void> {
    // Write beside the destination and rename into place, rather than writing
    // to the destination directly. Renaming replaces a symbolic link sitting at
    // the destination instead of following it, so the bytes cannot be
    // redirected outside this directory even by a link planted after the
    // pre-write check. The temporary name is created exclusively, so it cannot
    // itself be a link someone left waiting.
    const temp = `${path}.zuke-${crypto.randomUUID().slice(0, 8)}.tmp`;
    // `--dir` may name a directory that is not there yet; every path written
    // is that directory joined with a file name.
    const parent = path.lastIndexOf("/");
    if (parent > 0) await FileTasks.createDirectory(path.slice(0, parent));
    try {
      await FileTasks.writeText(temp, content, (s) => s.createNew());
      await FileTasks.move(temp, path);
    } catch (error) {
      // Best effort: a failed write may not have created the file at all.
      await FileTasks.remove(temp).catch(() => {});
      throw error;
    }
  },
  chmod(path: string, mode: number): Promise<void> {
    return FileTasks.chmod(path, mode);
  },
  log(message: string): void {
    output.info(message);
  },
};

/** Options controlling {@link runSetup}. */
export interface SetupOptions {
  /** Directory to scaffold into (e.g. `"."`). */
  dir: string;
  /** Overwrite existing files instead of skipping them. */
  force: boolean;
  /** Build class name for the starter build file. */
  name: string;
  /**
   * The TypeScript build file's name (`--build-file`). Omitted: the name the
   * project already has (see {@link existingBuildFile}), or `build.ts` for a
   * new one. Not for {@link SetupOptions.sdk}, whose build is `build.py`.
   */
  buildFile?: string;
  /**
   * The base name for the launcher scripts (`<name>` and `<name>.ps1`).
   * Defaults to `"zuke"`; override it when a `zuke/` directory already occupies
   * that name in the target directory.
   */
  launcherName?: string;
  /**
   * The build file's contents: the `zuke.ts`, or with {@link SetupOptions.sdk}
   * the `build.py`. Defaults to {@link starterBuild} (or
   * {@link starterPythonBuild}); `zuke import` passes a build generated from
   * an existing project's tasks instead.
   */
  buildContent?: string;
  /**
   * The bare specifiers {@link SetupOptions.buildContent} imports, mapped to
   * their `jsr:` dependencies, merged into `deno.json` so they resolve.
   * Defaults to {@link STARTER_IMPORTS}; a caller that supplies its own
   * `buildContent` supplies the imports that build needs (`zuke import` adds
   * `@zuke/cmd` when it generates a command).
   */
  imports?: ScaffoldImports;
  /**
   * Scaffold launchers that bootstrap their runtime when it is missing (the
   * default), or plain ones that require it on `PATH` and fail closed
   * (`false`). The runtime is a pinned, checksum-verified Deno for a
   * TypeScript build (see {@link "./launcher.ts"}), and the pinned `zuke`
   * release for one another SDK hosts (see {@link "./binary_launcher.ts"}).
   */
  bootstrapDeno?: boolean;
  /**
   * Also write an `.mcp.json` registering the build's MCP server (`--mcp`), so
   * an agent client picks the build up from the first commit. `allowRun`
   * adds `--allow-run`, letting the agent execute targets rather than only
   * inspect them. Omitted: no file is written.
   */
  mcp?: McpSetupOptions;
  /**
   * Scaffold a build the Python SDK describes and `@zuke/engine` runs
   * (`--sdk python`): a starter `build.py` in place of `zuke.ts`, a
   * `zuke.json` naming `sdk.command` and the engine release, and no
   * `deno.json`, since the project has no Deno code of its own. Its
   * launchers run the pinned `zuke` binary, which carries that engine, so
   * nothing in the project needs Deno. Omitted: a TypeScript build.
   */
  sdk?: SdkSetupOptions;
  /**
   * The runtime the build file runs on (`--runtime`): `"node"` scaffolds a
   * `package.json` in place of `deno.json`, a `zuke.json` with
   * `"runtime": "node"` and launchers that bootstrap Node. Omitted or
   * `"deno"`: today's Deno project. Not with {@link SetupOptions.sdk}.
   */
  runtime?: ProjectRuntime;
}

/** What `--sdk python` scaffolds against. */
export interface SdkSetupOptions {
  /**
   * The `zuke` release the launchers run; `zuke.json` pins the engine it
   * carries.
   */
  pin: BinaryPin;
}

/** What `--mcp` writes into `.mcp.json`. */
export interface McpSetupOptions {
  /** Register the server with `--allow-run`, so the agent may run targets. */
  allowRun: boolean;
}

/** What happened to one scaffolded file. */
export type FileStatus = "created" | "overwritten" | "skipped";

/** The outcome for a single file. */
export interface FileResult {
  /** The file's name, relative to the setup directory. */
  path: string;
  /** What `setup` did with it. */
  status: FileStatus;
}

/** The result of a {@link runSetup} run. */
export interface SetupResult {
  /** One entry per file `setup` considered. */
  files: FileResult[];
  /**
   * What `setup` could not do, each line naming the problem and the fix.
   *
   * Non-empty means the scaffold is **incomplete**: the `zuke.ts` on disk
   * imports `@zuke/core` by bare specifier, and nothing resolves it until the
   * reader acts. The caller reports these and exits non-zero rather than
   * printing `Next: ./zuke` over a build that cannot start.
   */
  manualSteps: string[];
  /**
   * Advisory observations about the existing project that `setup` deliberately
   * left alone. Worth printing, but nothing is broken and the exit code stays
   * 0.
   */
  notes: string[];
}

/** Join a directory and file name without pulling in path utilities. */
export function joinPath(dir: string, name: string): string {
  return dir === "." ? name : `${dir}/${name}`;
}

/** One file the scaffolder can write. */
interface ScaffoldFile {
  name: string;
  content: string;
  mode?: number;
  /** Whether this file is a launcher (its name comes from `launcherName`). */
  launcher?: boolean;
  /**
   * Whether a conversion to Node rewrites this file even when it exists and
   * `--force` was not given.
   */
  converted?: boolean;
}

/** The line every launcher setup writes opens its description with. */
const ZUKE_LAUNCHER = /^# Zuke (?:bootstrap )?launcher\b/m;

/** The default launcher base name. */
export const DEFAULT_LAUNCHER = "zuke";

/**
 * Scaffold file names a launcher must not shadow (the config, and the Python
 * build file; the TypeScript one is named per project).
 */
const RESERVED_NON_LAUNCHER = new Set([
  PYTHON_BUILD_FILE,
  "zuke.json",
  "deno.json",
  "package.json",
  ".gitignore",
  MCP_CONFIG_FILE,
]);

/**
 * Validate a `--launcher-name`: a single path segment (so the launcher can't be
 * written outside the target directory) that doesn't shadow another file setup
 * writes, `buildFile` among them. Throws a friendly error otherwise.
 */
function assertLauncherName(name: string, buildFile: string): void {
  // Reject path separators and a colon (a Windows drive/ADS separator), so the
  // launcher can only be a plain file in the target directory.
  if (name === "" || /[\\/:]/.test(name) || name === "." || name === "..") {
    throw new Error(
      `zuke setup: invalid --launcher-name "${name}" — it must be a plain file ` +
        `name (no path separators or ":").`,
    );
  }
  // Compare case-insensitively: a case-insensitive filesystem (macOS, Windows)
  // would let `Zuke.ts` shadow the `zuke.ts` setup writes.
  const lower = name.toLowerCase();
  if (RESERVED_NON_LAUNCHER.has(lower) || lower === buildFile.toLowerCase()) {
    throw new Error(
      `zuke setup: --launcher-name "${name}" would overwrite a file setup ` +
        `writes (the build file or config) — choose a different name.`,
    );
  }
}

/**
 * The build file the TypeScript project in `dir` already has: the one its
 * `zuke.json` names, `zuke.ts` when it names none, and `zuke.ts` too for a
 * directory that holds one with no `zuke.json` yet. `undefined` for a
 * directory with neither, which is a new project. A `zuke.json` that is a
 * link is not read: scaffolding refuses it.
 *
 * @throws {Error} when `zuke.json` names a build file that is not a valid name.
 */
export async function existingBuildFile(
  dir: string,
  host: SetupHost,
): Promise<string | undefined> {
  const config = joinPath(dir, "zuke.json");
  if (await host.exists(config) && !(await host.isSymlink(config))) {
    return buildFileNamed(await host.readText(config));
  }
  return await host.exists(joinPath(dir, BUILD_FILE)) ? BUILD_FILE : undefined;
}

/**
 * Whether the project in `dir` is one another SDK hosts: its `zuke.json`
 * names an `sdk`. A `zuke.json` that is a link is not read.
 */
async function hostedBySdk(dir: string, host: SetupHost): Promise<boolean> {
  const config = joinPath(dir, "zuke.json");
  return await host.exists(config) && !(await host.isSymlink(config)) &&
    forgivingField(await host.readText(config), "sdk") !== undefined;
}

/**
 * The runtime the TypeScript project in `dir` already runs on: the one its
 * `zuke.json` names, Deno for one that names none or has a build file and no
 * `zuke.json` yet. `undefined` for a new project.
 *
 * @throws {Error} when `zuke.json` names a runtime Zuke does not run on.
 */
export async function existingRuntime(
  dir: string,
  host: SetupHost,
): Promise<ProjectRuntime | undefined> {
  if (await existingBuildFile(dir, host) === undefined) return undefined;
  const config = joinPath(dir, "zuke.json");
  return await host.exists(config) && !(await host.isSymlink(config))
    ? runtimeNamed(await host.readText(config))
    : "deno";
}

/**
 * Whether `name` in `dir` is a file of the project's own that is not a Zuke
 * build: it exists and does not import `@zuke/core`. A new project must not
 * take such a name, because its `zuke.json` would point at an unrelated
 * script, and `--force` would overwrite it.
 */
export async function unrelatedBuildFile(
  dir: string,
  name: string,
  host: SetupHost,
): Promise<boolean> {
  const path = joinPath(dir, name);
  // A link or a directory there is refused by the collision check instead.
  if (
    !(await host.exists(path)) || await host.isSymlink(path) ||
    await host.isDirectory(path)
  ) {
    return false;
  }
  return !(await host.readText(path)).includes("@zuke/core");
}

/**
 * The build file a TypeScript scaffold writes: the one asked for, else the
 * project's own, else `build.ts`.
 *
 * @throws {Error} when the name asked for is not valid, differs from the one
 * an existing project has, or would take over an unrelated file in a new
 * project.
 */
async function scaffoldBuildFile(
  options: SetupOptions,
  host: SetupHost,
): Promise<string> {
  const existing = await existingBuildFile(options.dir, host);
  const asked = options.buildFile === undefined
    ? undefined
    : assertBuildFileName(options.buildFile);
  if (existing !== undefined) {
    // Setup does not move a build: it would have to overwrite whatever has
    // the new name. The person renames the file, and setup follows zuke.json.
    if (asked !== undefined && asked !== existing) {
      throw new Error(
        `zuke setup: this project's build file is ${existing}, not ${asked}. ` +
          `To rename it, rename the file, set "build": "${asked}" in ` +
          "zuke.json, and re-run zuke setup --force to rewrite the launchers.",
      );
    }
    return existing;
  }
  const name = asked ?? NEW_BUILD_FILE;
  if (await unrelatedBuildFile(options.dir, name, host)) {
    throw new Error(
      `zuke setup: ${joinPath(options.dir, name)} already exists and is not ` +
        "a Zuke build, so it was left alone. Pass --build-file <name> to " +
        "give the build another name.",
    );
  }
  return name;
}

/**
 * Scaffold Zuke into `options.dir`: a starter build file, the launcher scripts,
 * and a `deno.json` task block. Existing files are skipped unless
 * `options.force` is set; `deno.json` is always merged (never clobbered). Fails
 * up front if a target name is occupied by a directory (see
 * {@link SetupOptions.launcherName}).
 */
export async function runSetup(
  options: SetupOptions,
  host: SetupHost = defaultHost,
): Promise<SetupResult> {
  const files: FileResult[] = [];
  const manualSteps: string[] = [];
  const notes: string[] = [];
  const launcher = options.launcherName ?? DEFAULT_LAUNCHER;
  const sdk = options.sdk;
  const node = options.runtime === "node";
  if (sdk !== undefined && node) {
    throw new Error(
      "zuke setup: --runtime picks the runtime of a TypeScript build; " +
        "--sdk python builds run on the zuke binary.",
    );
  }
  if (sdk === undefined && await hostedBySdk(options.dir, host)) {
    throw new Error(
      "zuke setup: this project's build is hosted by another SDK (zuke.json " +
        'names an "sdk"), so it has no TypeScript build to scaffold. Re-run ' +
        "with --sdk python.",
    );
  }
  const was = sdk === undefined
    ? await existingRuntime(options.dir, host)
    : undefined;
  if (was === "node" && !node) {
    throw new Error(
      "zuke setup: this project's build runs on Node (zuke.json's " +
        '"runtime": "node"); setup does not move it back to Deno.',
    );
  }
  // A Deno project asked for Node is converted in place: its launchers and
  // zuke.json are rewritten whether or not --force is given, since that is
  // what the conversion is, and its build file and deno.json are kept.
  const converting = node && was === "deno";
  if (sdk !== undefined && options.buildFile !== undefined) {
    throw new Error(
      "zuke setup: --build-file names a TypeScript build file; a Python " +
        `build is always ${PYTHON_BUILD_FILE}.`,
    );
  }
  // The build file, the launchers, the task, the MCP entry and zuke.json all
  // carry the one name. An SDK build has no TypeScript file to name.
  const buildFile = sdk === undefined
    ? await scaffoldBuildFile(options, host)
    : BUILD_FILE;
  assertLauncherName(launcher, buildFile);
  const variant = { bootstrapDeno: options.bootstrapDeno ?? true, buildFile };

  const scaffold: readonly ScaffoldFile[] = [
    sdk === undefined
      ? {
        name: buildFile,
        content: options.buildContent ?? starterBuild(options.name),
      }
      : {
        name: PYTHON_BUILD_FILE,
        content: options.buildContent ?? starterPythonBuild(options.name),
      },
    {
      name: launcher,
      content: node
        ? nodeLauncherBash({ buildFile })
        : sdk === undefined
        ? launcherBash(variant)
        : binaryLauncherBash({ download: variant.bootstrapDeno }, sdk.pin),
      mode: 0o755,
      launcher: true,
      converted: converting,
    },
    {
      name: `${launcher}.ps1`,
      content: node
        ? nodeLauncherPowerShell({ buildFile })
        : sdk === undefined
        ? launcherPwsh(variant)
        : binaryLauncherPwsh({ download: variant.bootstrapDeno }, sdk.pin),
      launcher: true,
      converted: converting,
    },
    {
      name: "zuke.json",
      content: converting
        ? await convertedConfig(options.dir, options.name, buildFile, host)
        : sdk === undefined
        ? starterConfig(options.name, buildFile, options.runtime)
        : starterSdkConfig(options.name, sdk.pin.engine),
      converted: converting,
    },
  ];

  // Fail before writing anything if a target name is occupied by a directory —
  // a scaffolded file can't be written over a directory, and silently skipping
  // it (the old behaviour) produced a launcher-less setup. Covers every name
  // setup writes, including the separately-written deno.json and .gitignore.
  const collisionTargets: ReadonlyArray<{ name: string; launcher: boolean }> = [
    ...scaffold.map((s) => ({ name: s.name, launcher: s.launcher === true })),
    ...(sdk === undefined
      ? [{ name: node ? "package.json" : "deno.json", launcher: false }]
      : []),
    // A conversion reads deno.json's imports, so it is held to the same rule.
    ...(converting ? [{ name: "deno.json", launcher: false }] : []),
    { name: ".gitignore", launcher: false },
    ...(options.mcp || converting
      ? [{ name: MCP_CONFIG_FILE, launcher: false }]
      : []),
  ];
  for (const item of collisionTargets) {
    const path = joinPath(options.dir, item.name);
    // A symlink at a scaffold name is refused for the same reason a directory
    // is — nothing can be written there safely — but the stakes differ. Writing
    // follows the link, so a repository that ships one (setup is precisely what
    // a developer runs inside a freshly cloned project) would redirect the
    // write to whatever it names, outside this directory entirely. Checked
    // before any write, so a refusal leaves the tree untouched.
    if (await host.isSymlink(path)) {
      throw new Error(
        `zuke setup: refusing to write "${item.name}" — ${path} is a symbolic ` +
          `link, and writing through it would modify the file it points at, ` +
          `outside this directory. Replace the link with a regular file (or ` +
          `remove it), then re-run setup.`,
      );
    }
    if (await host.isDirectory(path)) {
      throw new Error(
        `zuke setup: cannot write "${item.name}" — a directory exists at ` +
          `${path}. ` +
          (item.launcher
            ? `Pass --launcher-name <name> to write the launcher under a ` +
              `different name`
            : `Move or rename that directory (${item.name} is reserved by ` +
              `Zuke)`) +
          `, then re-run setup.`,
      );
    }
  }

  for (const item of scaffold) {
    const path = joinPath(options.dir, item.name);
    const existed = await host.exists(path);
    // A conversion rewrites zuke.json, and a launcher only when what is there
    // is one of Zuke's: a file of the project's own at that name is kept.
    const rewrite = existed && item.converted === true &&
      (item.launcher !== true || ZUKE_LAUNCHER.test(await host.readText(path)));
    if (existed && !options.force && !rewrite) {
      host.log(`  skip     ${item.name}  (already exists)`);
      files.push({ path: item.name, status: "skipped" });
      continue;
    }
    await host.writeText(path, item.content);
    if (item.mode !== undefined) {
      try {
        await host.chmod(path, item.mode);
      } catch {
        // chmod is a no-op / unsupported on some platforms (e.g. Windows).
      }
    }
    const status: FileStatus = existed ? "overwritten" : "created";
    host.log(`  ${existed ? "update" : "create"}   ${item.name}`);
    files.push({ path: item.name, status });
  }

  if (node) {
    // What the build file imports, plus, when converting, what the Deno
    // project already declared: an imported build brings its own imports.
    const declared = npmDependencies(
      Object.keys(options.imports ?? STARTER_IMPORTS),
    );
    const dependencies = converting
      ? [
        ...new Map([
          ...declared,
          ...await convertedDependencies(
            options.dir,
            buildFile,
            host,
            manualSteps,
            notes,
          ),
        ]),
      ]
      : declared;
    files.push(
      await setupPackageJson(
        options.dir,
        dependencies,
        host,
        manualSteps,
        notes,
      ),
    );
  } else if (sdk === undefined) {
    files.push(
      await setupDenoJson(
        options.dir,
        options.imports ?? STARTER_IMPORTS,
        buildFile,
        host,
        manualSteps,
        notes,
      ),
    );
  }
  if (converting) {
    const mcp = await convertMcpConfig(options.dir, buildFile, host, notes);
    if (mcp !== undefined) files.push(mcp);
  }
  files.push(
    await setupGitignore(
      options.dir,
      host,
      node ? [GITIGNORE_ENTRY, "node_modules/"] : [GITIGNORE_ENTRY],
    ),
  );
  if (options.mcp) {
    files.push(
      await setupMcpConfig(
        options.dir,
        options.force,
        host,
        notes,
        // A hosted build is served by the zuke binary, whichever CLI
        // registered it: its project needs nothing from Deno's stack. A
        // TypeScript build stays on Deno.
        node
          ? nodeMcpEntry(options.mcp.allowRun, buildFile)
          : sdk === undefined
          ? mcpServerEntry(options.mcp.allowRun, buildFile)
          : binaryMcpEntry(options.mcp.allowRun),
      ),
    );
  }
  return { files, manualSteps, notes };
}

/**
 * Create or merge `.mcp.json` so the build's MCP server is registered as
 * `entry`. An
 * existing `zuke` entry is left alone unless `force` is set (it may carry a
 * deliberate `--allow-run` choice); every other server in the file survives
 * either way. An unparseable file is skipped, recorded in `notes` so the
 * caller can report that `--mcp` did not take effect.
 */
async function setupMcpConfig(
  dir: string,
  force: boolean,
  host: SetupHost,
  notes: string[],
  entry: McpServerEntry,
): Promise<FileResult> {
  const name = MCP_CONFIG_FILE;
  const path = joinPath(dir, name);
  if (!(await host.exists(path))) {
    await host.writeText(
      path,
      mergeMcpConfig({}, entry),
    );
    host.log(`  create   ${name}`);
    return { path: name, status: "created" };
  }

  const config = parseMcpConfig(await host.readText(path));
  if (config.state === "unparseable") {
    host.log(`  skip     ${name}  (unparseable, edit by hand)`);
    // `--mcp` asked for the server to be registered and it was not, so say so
    // in the result rather than only in a line of progress output. A note, not
    // a manual step: the build itself runs regardless, only an agent client
    // will not find it.
    notes.push(
      `${path} could not be parsed, so the zuke MCP server was not ` +
        `registered. Fix the file and re-run with --mcp to add it.`,
    );
    return { path: name, status: "skipped" };
  }
  if (config.state === "present" && !force) {
    host.log(`  skip     ${name}  (zuke server already registered)`);
    return { path: name, status: "skipped" };
  }
  await host.writeText(
    path,
    mergeMcpConfig(config.document, entry),
  );
  host.log(`  update   ${name}`);
  return { path: name, status: "overwritten" };
}

/**
 * Point the `zuke` server of a converted project's `.mcp.json` at Node: an
 * entry that runs the build file with `deno run` becomes `node`, keeping the
 * arguments after the build file. Any other entry is the project's own and is
 * left alone with a note; a project with no `.mcp.json`, or no `zuke` server
 * in it, has nothing to convert.
 */
async function convertMcpConfig(
  dir: string,
  buildFile: string,
  host: SetupHost,
  notes: string[],
): Promise<FileResult | undefined> {
  const name = MCP_CONFIG_FILE;
  const path = joinPath(dir, name);
  if (!(await host.exists(path))) return undefined;
  const config = parseMcpConfig(await host.readText(path));
  if (config.state === "unparseable") {
    notes.push(
      `${path} could not be parsed, so its zuke server was not moved to ` +
        `Node. Point it at node ${buildFile} mcp by hand.`,
    );
    return undefined;
  }
  const servers = config.document.mcpServers;
  const entry = isRecord(servers) ? servers[MCP_SERVER_NAME] : undefined;
  // A bare deno, a path to one, or deno.exe.
  if (
    !isServerEntry(entry) || !/(?:^|[\\/])deno(?:\.exe)?$/i.test(entry.command)
  ) {
    return undefined;
  }
  // Only the form setup writes: any other Deno option, such as --env-file,
  // has meaning Node would lose, so that entry is the user's to move.
  const [run, all, file, ...rest] = entry.args;
  if (
    run !== "run" || !["-A", "--allow-all"].includes(all) || file !== buildFile
  ) {
    notes.push(
      `${path}'s zuke server runs deno in a way setup does not recognise, ` +
        `so it was kept. Point it at node ${buildFile} mcp by hand.`,
    );
    return undefined;
  }
  await host.writeText(
    path,
    // The entry's own keys (env, cwd, type) are the user's, and kept.
    mergeMcpConfig(config.document, {
      ...entry,
      command: "node",
      args: [buildFile, ...rest],
    }),
  );
  host.log(`  update   ${name}`);
  return { path: name, status: "overwritten" };
}

/** The line `setup` ensures is present in `.gitignore` for generated output. */
const GITIGNORE_ENTRY = ".zuke/";

/**
 * Create or update `.gitignore` so every one of `entries` is ignored, adding
 * only the lines it does not already have.
 */
async function setupGitignore(
  dir: string,
  host: SetupHost,
  entries: readonly string[],
): Promise<FileResult> {
  const name = ".gitignore";
  const path = joinPath(dir, name);
  const exists = await host.exists(path);
  const before = exists ? await host.readText(path) : "";
  const lines = before.split(/\r?\n/).map((line) => line.trim());
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) {
    host.log(`  skip     ${name}  (${entries.join(", ")} already ignored)`);
    return { path: name, status: "skipped" };
  }
  const separator = before === "" || before.endsWith("\n") ? "" : "\n";
  await host.writeText(path, `${before}${separator}${missing.join("\n")}\n`);
  host.log(`  ${exists ? "update" : "create"}   ${name}`);
  return { path: name, status: exists ? "overwritten" : "created" };
}

/** The name a new `package.json` takes: the project directory's, as npm spells one. */
function packageNameFor(dir: string): string {
  const last =
    (dir === "." ? RuntimeTasks.cwd() : dir).split(/[\\/]/).filter(Boolean)
      .at(-1) ?? "";
  const name = last.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+/, "");
  return name === "" ? "zuke-build" : name;
}

/** A dependency `package.json` declares: its name, and its npm specifier. */
type NpmDependency = readonly [string, string];

/** The dependency every Node build has: `@zuke/core`, through its npm alias. */
const STARTER_NPM_DEPENDENCY: NpmDependency = [
  "@zuke/core",
  zukeNpmDependency("core"),
];

/** A Zuke package's bare specifier, `@zuke/<name>`, without a subpath. */
const ZUKE_PACKAGE = /^@zuke\/([a-z0-9][a-z0-9-]*)$/;

/** An inline `jsr:@zuke/<name>` specifier, with or without a version and subpath. */
const INLINE_ZUKE_JSR =
  /["']jsr:@zuke\/([a-z0-9][a-z0-9-]*)(?:@[^"'/]*)?(?:\/[^"']*)?["']/g;

/** The npm alias of each `@zuke/<name>` among `specifiers`; others are dropped. */
function npmDependencies(specifiers: readonly string[]): NpmDependency[] {
  return specifiers.flatMap((specifier): NpmDependency[] => {
    const zuke = ZUKE_PACKAGE.exec(specifier);
    return zuke === null ? [] : [[specifier, zukeNpmDependency(zuke[1])]];
  });
}

/**
 * The `zuke.json` of the Deno project in `dir`, converted to Node: its own
 * fields, with `"runtime": "node"`. A project with no `zuke.json` yet gets
 * none of its own, so it gets the starter one.
 *
 * @throws {Error} when `zuke.json` is a link, which setup never reads or
 * writes through, or not a JSON object, which nothing can merge into without
 * losing it.
 */
async function convertedConfig(
  dir: string,
  name: string,
  buildFile: string,
  host: SetupHost,
): Promise<string> {
  const path = joinPath(dir, "zuke.json");
  if (!(await host.exists(path))) return starterConfig(name, buildFile, "node");
  if (await host.isSymlink(path)) {
    throw new Error(
      `zuke setup: refusing to convert ${path} — it is a symbolic link. ` +
        "Replace it with a regular file, then re-run setup.",
    );
  }
  const parsed = parsedRecord(await host.readText(path));
  if (parsed === undefined) {
    throw new Error(
      `zuke setup: ${path} is not a JSON object, so it cannot be converted ` +
        'to Node. Fix it, or add "runtime": "node" to it by hand.',
    );
  }
  return `${JSON.stringify({ ...parsed, runtime: "node" }, null, 2)}\n`;
}

/**
 * The dependencies a Deno project converted to Node declares in
 * `package.json`: `@zuke/core`, and the npm alias of every other `@zuke/*`
 * package its `deno.json` imports. What else `deno.json` imports is named in
 * a note, since npm cannot install it under that name; a build file that
 * still imports a `jsr:` specifier is a manual step, since Node cannot load
 * one.
 */
async function convertedDependencies(
  dir: string,
  buildFile: string,
  host: SetupHost,
  steps: string[],
  notes: string[],
): Promise<NpmDependency[]> {
  const build = joinPath(dir, buildFile);
  const source = await host.readText(build);
  // A build that inlines its jsr: specifiers declares them nowhere else.
  const inlined = [...source.matchAll(INLINE_ZUKE_JSR)].map((m) =>
    `@zuke/${m[1]}`
  );
  const dependencies = new Map([
    STARTER_NPM_DEPENDENCY,
    ...npmDependencies(inlined),
  ]);
  const denoJson = joinPath(dir, "deno.json");
  if (await host.exists(denoJson)) {
    const imports = parsedRecord(await host.readText(denoJson))?.imports;
    const others: string[] = [];
    for (const specifier of isRecord(imports) ? Object.keys(imports) : []) {
      const [dependency] = npmDependencies([specifier]);
      if (dependency === undefined) others.push(specifier);
      else dependencies.set(...dependency);
    }
    notes.push(
      `${denoJson} is kept, but the build no longer reads it on Node. ` +
        (others.length === 0
          ? "Remove it once nothing else uses it."
          : `If ${buildFile} imports ${
            others.join(", ")
          }, add an npm equivalent to package.json.`),
    );
  }
  if (/["']jsr:/.test(source)) {
    steps.push(
      `${build} imports a jsr: specifier, which Node cannot load. Import ` +
        "@zuke/* by bare specifier instead, as package.json declares it.",
    );
  }
  return [...dependencies];
}

/**
 * Create or merge `package.json` for a Node project: `type: module` and
 * `dependencies`, each only when absent. A different `type` is kept and
 * noted, since a CommonJS package cannot load the starter build; a file that
 * is not JSON is left alone and reported as a manual step.
 */
async function setupPackageJson(
  dir: string,
  dependency: readonly NpmDependency[],
  host: SetupHost,
  steps: string[],
  notes: string[],
): Promise<FileResult> {
  const name = "package.json";
  const path = joinPath(dir, name);
  const exists = await host.exists(path);
  const root: Record<string, unknown> = {};
  let original = "";
  if (exists) {
    const parsed = parsedRecord(await host.readText(path));
    // Not JSON, or JSON that is not an object: either way not a manifest setup
    // can merge into, so it is left exactly as it is.
    if (parsed === undefined) {
      host.log(`  skip     ${name}  (not a JSON object, edit by hand)`);
      steps.push(
        `${path} is not a JSON object. Add "type": "module" and the ` +
          `dependencies ${npmDependencyLines(dependency)} — the build will ` +
          "not run until you do.",
      );
      return { path: name, status: "skipped" };
    }
    Object.assign(root, parsed);
    original = JSON.stringify(root);
  } else {
    root.name = packageNameFor(dir);
    root.private = true;
  }
  if (root.type === undefined) root.type = "module";
  else if (root.type !== "module") {
    notes.push(
      `${path} has "type": ${JSON.stringify(root.type)}; setup kept it, but ` +
        'the scaffolded build uses import syntax and needs "type": "module".',
    );
  }
  const declared = root.dependencies;
  const added = dependency.filter(([dep]) =>
    !(isRecord(declared) && dep in declared)
  );
  mergeMissing(root, "dependencies", dependency);
  // The launcher runs npm ci, which refuses a lockfile that no longer matches
  // package.json, so a dependency added beside an existing lock needs one
  // npm install to record it.
  const lock = joinPath(dir, "package-lock.json");
  if (added.length > 0 && await host.exists(lock)) {
    steps.push(
      `Run \`npm install --ignore-scripts\` in ${dir} once to add ` +
        `${added.map(([dep]) => dep).join(", ")} to package-lock.json: ` +
        "./zuke installs with " +
        "npm ci, which refuses a lockfile that does not match package.json.",
    );
  }
  if (exists && JSON.stringify(root) === original) {
    host.log(`  skip     ${name}  (type and dependencies already declared)`);
    return { path: name, status: "skipped" };
  }
  await host.writeText(path, `${JSON.stringify(root, null, 2)}\n`);
  host.log(`  ${exists ? "update" : "create"}   ${name}`);
  return { path: name, status: exists ? "overwritten" : "created" };
}

/** The `dependencies` entries `steps` tells the reader to add, as JSON. */
function npmDependencyLines(dependencies: readonly NpmDependency[]): string {
  return dependencies.map(([dep, spec]) => `"${dep}": "${spec}"`).join(", ");
}

/** The `imports` entries `steps` tells the reader to add, as JSON lines. */
function importLines(imports: ScaffoldImports): string {
  return Object.entries(imports)
    .map(([specifier, dependency]) => `"${specifier}": "${dependency}"`)
    .join(", ");
}

/**
 * Where an `importMap` field points, as a path inside the setup directory, or
 * `null` when it points anywhere else.
 *
 * Only a plain relative path is resolved. An absolute path, a URL, or one
 * climbing out with `..` names a file this directory does not own, and setup
 * has no business reading it just to decide what to print — those report as
 * unverified instead.
 */
function delegatedMapPath(dir: string, importMap: string): string | null {
  const rel = importMap.replace(/^\.[\\/]/, "");
  const escapes = rel === "" || rel.startsWith("/") || rel.startsWith("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.split(/[\\/]/).includes("..");
  return escapes ? null : joinPath(dir, rel);
}

/**
 * Whether the import map at `path` already declares every scaffold specifier.
 *
 * Setup cannot write into a delegated import map — it is the project's file,
 * in a shape setup did not choose — but it can read it, and must: without this
 * a project that has already added the entry would be told to add it again on
 * every run, and `setup` would never exit 0 on a correctly configured project.
 * Anything unreadable or unparseable answers `false`, so an unverifiable map
 * still gets the manual step rather than a silent pass.
 */
async function delegatedMapDeclares(
  path: string,
  imports: ScaffoldImports,
  host: SetupHost,
): Promise<boolean> {
  try {
    if (!(await host.exists(path))) return false;
    const parsed: unknown = JSON.parse(await host.readText(path));
    if (!isRecord(parsed) || !isRecord(parsed.imports)) return false;
    const declared = parsed.imports;
    return Object.keys(imports).every((specifier) => specifier in declared);
  } catch {
    return false;
  }
}

/**
 * Create or merge `deno.json`, returning what happened to it. `imports` are the
 * bare specifiers the `buildFile` written alongside it resolves through, so the
 * file is completed whenever any of them is missing — not only when the `zuke`
 * task is.
 *
 * Two shapes cannot be completed automatically, and both are fatal to the
 * scaffold now that the build resolves through this file rather than carrying
 * its own `jsr:` specifier. They go into `steps` so the run reports an
 * incomplete scaffold instead of pointing at a `./zuke` that cannot start:
 *
 * - **Unparseable.** `deno.json` is JSONC — Deno accepts `//` comments and
 *   trailing commas that `JSON.parse` rejects. Such a file is perfectly valid
 *   and must not be rewritten: doing so would strip the reader's comments.
 * - **Delegated.** The document points `importMap` at a separate file, and
 *   `imports` belongs in *that* file (see {@link delegatesImportMap}).
 */
async function setupDenoJson(
  dir: string,
  imports: ScaffoldImports,
  buildFile: string,
  host: SetupHost,
  steps: string[],
  notes: string[],
): Promise<FileResult> {
  const name = "deno.json";
  const path = joinPath(dir, name);
  if (!(await host.exists(path))) {
    await host.writeText(path, mergeDenoJson(null, imports, buildFile));
    host.log(`  create   ${name}`);
    return { path: name, status: "created" };
  }

  const before = await host.readText(path);
  const state = denoJsonState(before, imports, buildFile);
  if (state === "unparseable") {
    host.log(`  skip     ${name}  (not plain JSON, edit by hand)`);
    steps.push(
      `${path} has comments or a trailing comma, so it could not be edited ` +
        `without discarding them. Add to its "imports": ` +
        `${
          importLines(imports)
        } — the scaffolded ${buildFile} will not run until ` +
        `you do.`,
    );
    return { path: name, status: "skipped" };
  }

  const parsed: unknown = JSON.parse(before);
  const root: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  if (delegatesImportMap(root)) {
    // Writing `imports` here would make Deno ignore `importMap` and take the
    // project's whole module resolution down with it. Ask for the entry only
    // when the delegated map does not already carry it — otherwise a project
    // that has done exactly this would be nagged on every run.
    const delegated = String(root.importMap);
    const target = delegatedMapPath(dir, delegated);
    const already = target !== null &&
      await delegatedMapDeclares(target, imports, host);
    if (!already) {
      steps.push(
        `${path} delegates its import map to ${delegated}, which Deno ignores ` +
          `as soon as "imports" appears beside it. Add to that file's ` +
          `"imports" instead: ${importLines(imports)} — the scaffolded ` +
          `${buildFile} will not run until you do.`,
      );
    }
  }
  for (const specifier of remappedImports(root, imports)) {
    notes.push(
      `${path} already maps "${specifier}" to something other than its JSR ` +
        `package; setup kept that mapping. Check it is what you intend.`,
    );
  }

  if (state === "present") {
    host.log(`  skip     ${name}  (zuke task and imports already declared)`);
    return { path: name, status: "skipped" };
  }
  await host.writeText(path, mergeDenoJson(before, imports, buildFile));
  host.log(`  update   ${name}`);
  return { path: name, status: "overwritten" };
}
