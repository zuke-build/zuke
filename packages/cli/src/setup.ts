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
  MCP_CONFIG_FILE,
  mergeMcpConfig,
  parseMcpConfig,
} from "./mcp_config.ts";
import { isRecord } from "./records.ts";
import { launcherBash, launcherPwsh } from "./launcher.ts";
import { exists, lstatOrNull } from "./fs.ts";
import { output } from "./output.ts";
import { STARTER_IMPORTS, starterBuild, starterConfig } from "./starter.ts";

// Re-exported so the merge guard keeps its historical home for importers.
export { isRecord };

/**
 * The task names `setup` writes into `deno.json`, with their commands.
 *
 * The `zuke` task deliberately omits `--frozen`, unlike the launchers: a task
 * command runs in `deno task`'s own shell, which has no conditionals, so it
 * cannot skip the flag on the first run when no `deno.lock` exists yet — and
 * hard-coding it would make a fresh scaffold fail before it could ever write
 * one. The launcher (`./zuke`, the advertised entry point) does the lockfile
 * check and enforces `--frozen` from the second run onward.
 */
const DEFAULT_TASKS: ReadonlyArray<readonly [string, string]> = [
  ["zuke", "deno run -A zuke.ts"],
  ["fmt", "deno fmt"],
  ["lint", "deno lint"],
  ["test", "deno test -A"],
];

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
 * resolves through.
 *
 * Merging is additive per key: a task or import the document already declares
 * is left exactly as it is, so a project that has pinned `@zuke/core` to a
 * specific version keeps that pin. A document that delegates to an external
 * `importMap` keeps that delegation and grows no `imports` block — see
 * {@link delegatesImportMap}; the caller reports the entry as a manual step
 * instead.
 */
export function mergeDenoJson(
  existing: string | null,
  imports: ScaffoldImports,
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
  mergeMissing(root, "tasks", DEFAULT_TASKS);
  return `${JSON.stringify(root, null, 2)}\n`;
}

/**
 * Whether a `deno.json` text already carries everything the scaffold needs.
 *
 * `"present"` means both the `zuke` task and every scaffold import are already
 * declared, so there is nothing to merge.
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
): DenoJsonState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "unparseable";
  }
  if (!isRecord(parsed)) return "absent";
  const hasTask = isRecord(parsed.tasks) && "zuke" in parsed.tasks;
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
  exists,
  async isDirectory(path: string): Promise<boolean> {
    return (await lstatOrNull(path))?.isDirectory === true;
  },
  async isSymlink(path: string): Promise<boolean> {
    return (await lstatOrNull(path))?.isSymlink === true;
  },
  readText(path: string): Promise<string> {
    return Deno.readTextFile(path);
  },
  async writeText(path: string, content: string): Promise<void> {
    // Write beside the destination and rename into place, rather than writing
    // to the destination directly. Renaming replaces a symbolic link sitting at
    // the destination instead of following it, so the bytes cannot be
    // redirected outside this directory even by a link planted after the
    // pre-write check. The temporary name is created exclusively, so it cannot
    // itself be a link someone left waiting.
    const temp = `${path}.zuke-${crypto.randomUUID().slice(0, 8)}.tmp`;
    try {
      await Deno.writeTextFile(temp, content, { createNew: true });
      await Deno.rename(temp, path);
    } catch (error) {
      // Best effort: a failed write may not have created the file at all.
      await Deno.remove(temp).catch(() => {});
      throw error;
    }
  },
  chmod(path: string, mode: number): Promise<void> {
    return Deno.chmod(path, mode);
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
  /** Build class name for the starter `zuke.ts`. */
  name: string;
  /**
   * The base name for the launcher scripts (`<name>` and `<name>.ps1`).
   * Defaults to `"zuke"`; override it when a `zuke/` directory already occupies
   * that name in the target directory.
   */
  launcherName?: string;
  /**
   * The `zuke.ts` contents to write. Defaults to {@link starterBuild}; `zuke
   * import` passes a build generated from an existing project's tasks instead.
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
   * Scaffold launchers that bootstrap a pinned, checksum-verified Deno when
   * none is on `PATH` (the default), or plain ones that require Deno and fail
   * closed when it is missing (`false`). See {@link "./launcher.ts"}.
   */
  bootstrapDeno?: boolean;
  /**
   * Also write an `.mcp.json` registering the build's MCP server (`--mcp`), so
   * an agent client picks the build up from the first commit. `allowRun`
   * adds `--allow-run`, letting the agent execute targets rather than only
   * inspect them. Omitted: no file is written.
   */
  mcp?: McpSetupOptions;
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
}

/** The default launcher base name. */
export const DEFAULT_LAUNCHER = "zuke";

/** Scaffold file names a launcher must not shadow (the build file and config). */
const RESERVED_NON_LAUNCHER = new Set([
  "zuke.ts",
  "zuke.json",
  "deno.json",
  ".gitignore",
  MCP_CONFIG_FILE,
]);

/**
 * Validate a `--launcher-name`: a single path segment (so the launcher can't be
 * written outside the target directory) that doesn't shadow another file setup
 * writes. Throws a friendly error otherwise.
 */
function assertLauncherName(name: string): void {
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
  if (RESERVED_NON_LAUNCHER.has(name.toLowerCase())) {
    throw new Error(
      `zuke setup: --launcher-name "${name}" would overwrite a file setup ` +
        `writes (the build file or config) — choose a different name.`,
    );
  }
}

/**
 * Scaffold Zuke into `options.dir`: a starter `zuke.ts`, the launcher scripts,
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
  assertLauncherName(launcher);
  const variant = { bootstrapDeno: options.bootstrapDeno ?? true };

  const scaffold: readonly ScaffoldFile[] = [
    {
      name: "zuke.ts",
      content: options.buildContent ?? starterBuild(options.name),
    },
    {
      name: launcher,
      content: launcherBash(variant),
      mode: 0o755,
      launcher: true,
    },
    { name: `${launcher}.ps1`, content: launcherPwsh(variant), launcher: true },
    { name: "zuke.json", content: starterConfig(options.name) },
  ];

  // Fail before writing anything if a target name is occupied by a directory —
  // a scaffolded file can't be written over a directory, and silently skipping
  // it (the old behaviour) produced a launcher-less setup. Covers every name
  // setup writes, including the separately-written deno.json and .gitignore.
  const collisionTargets: ReadonlyArray<{ name: string; launcher: boolean }> = [
    ...scaffold.map((s) => ({ name: s.name, launcher: s.launcher === true })),
    { name: "deno.json", launcher: false },
    { name: ".gitignore", launcher: false },
    ...(options.mcp ? [{ name: MCP_CONFIG_FILE, launcher: false }] : []),
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
    if (existed && !options.force) {
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

  files.push(
    await setupDenoJson(
      options.dir,
      options.imports ?? STARTER_IMPORTS,
      host,
      manualSteps,
      notes,
    ),
  );
  files.push(await setupGitignore(options.dir, host));
  if (options.mcp) {
    files.push(
      await setupMcpConfig(options.dir, options.mcp, options.force, host),
    );
  }
  return { files, manualSteps, notes };
}

/**
 * Create or merge `.mcp.json` so the build's MCP server is registered. An
 * existing `zuke` entry is left alone unless `force` is set (it may carry a
 * deliberate `--allow-run` choice); every other server in the file survives
 * either way. An unparseable file is skipped with a notice, like `deno.json`.
 */
async function setupMcpConfig(
  dir: string,
  mcp: McpSetupOptions,
  force: boolean,
  host: SetupHost,
): Promise<FileResult> {
  const name = MCP_CONFIG_FILE;
  const path = joinPath(dir, name);
  if (!(await host.exists(path))) {
    await host.writeText(path, mergeMcpConfig({}, mcp.allowRun));
    host.log(`  create   ${name}`);
    return { path: name, status: "created" };
  }

  const config = parseMcpConfig(await host.readText(path));
  if (config.state === "unparseable") {
    host.log(`  skip     ${name}  (unparseable, edit by hand)`);
    return { path: name, status: "skipped" };
  }
  if (config.state === "present" && !force) {
    host.log(`  skip     ${name}  (zuke server already registered)`);
    return { path: name, status: "skipped" };
  }
  await host.writeText(path, mergeMcpConfig(config.document, mcp.allowRun));
  host.log(`  update   ${name}`);
  return { path: name, status: "overwritten" };
}

/** The line `setup` ensures is present in `.gitignore` for generated output. */
const GITIGNORE_ENTRY = ".zuke/";

/** Create or update `.gitignore` so the generated `.zuke/` folder is ignored. */
async function setupGitignore(
  dir: string,
  host: SetupHost,
): Promise<FileResult> {
  const name = ".gitignore";
  const path = joinPath(dir, name);
  if (!(await host.exists(path))) {
    await host.writeText(path, `${GITIGNORE_ENTRY}\n`);
    host.log(`  create   ${name}`);
    return { path: name, status: "created" };
  }

  const before = await host.readText(path);
  if (before.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_ENTRY)) {
    host.log(`  skip     ${name}  (${GITIGNORE_ENTRY} already ignored)`);
    return { path: name, status: "skipped" };
  }
  const separator = before === "" || before.endsWith("\n") ? "" : "\n";
  await host.writeText(path, `${before}${separator}${GITIGNORE_ENTRY}\n`);
  host.log(`  update   ${name}`);
  return { path: name, status: "overwritten" };
}

/** The `imports` entries `steps` tells the reader to add, as JSON lines. */
function importLines(imports: ScaffoldImports): string {
  return Object.entries(imports)
    .map(([specifier, dependency]) => `"${specifier}": "${dependency}"`)
    .join(", ");
}

/**
 * Create or merge `deno.json`, returning what happened to it. `imports` are the
 * bare specifiers the `zuke.ts` written alongside it resolves through, so the
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
  host: SetupHost,
  steps: string[],
  notes: string[],
): Promise<FileResult> {
  const name = "deno.json";
  const path = joinPath(dir, name);
  if (!(await host.exists(path))) {
    await host.writeText(path, mergeDenoJson(null, imports));
    host.log(`  create   ${name}`);
    return { path: name, status: "created" };
  }

  const before = await host.readText(path);
  const state = denoJsonState(before, imports);
  if (state === "unparseable") {
    host.log(`  skip     ${name}  (not plain JSON, edit by hand)`);
    steps.push(
      `${path} has comments or a trailing comma, so it could not be edited ` +
        `without discarding them. Add to its "imports": ` +
        `${importLines(imports)} — the scaffolded zuke.ts will not run until ` +
        `you do.`,
    );
    return { path: name, status: "skipped" };
  }

  const parsed: unknown = JSON.parse(before);
  const root: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  if (delegatesImportMap(root)) {
    // Writing `imports` here would make Deno ignore `importMap` and take the
    // project's whole module resolution down with it.
    steps.push(
      `${path} delegates its import map to ${String(root.importMap)}, which ` +
        `Deno ignores as soon as "imports" appears beside it. Add to that ` +
        `file's "imports" instead: ${importLines(imports)} — the scaffolded ` +
        `zuke.ts will not run until you do.`,
    );
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
  await host.writeText(path, mergeDenoJson(before, imports));
  host.log(`  update   ${name}`);
  return { path: name, status: "overwritten" };
}
