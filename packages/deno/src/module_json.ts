// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The shapes `deno info --json` emits, and the guarded parsers that turn its
 * stdout into them.
 *
 * `deno info` reports two different things depending on whether it was given a
 * module: the module graph rooted at that file, or the toolchain's cache
 * directories. They are separate types here because they are separate reports,
 * not two views of one.
 */

/** One module in the graph {@link parseModuleGraph} returns. */
export interface DenoModule {
  /** The module's fully qualified specifier, e.g. `file:///…/mod.ts`. */
  specifier: string;
  /** How deno classified the module, e.g. `esm` or `npm`; absent on an error entry. */
  kind?: string;
  /** The module's path in the local cache, when it has been fetched. */
  local?: string;
  /** The module's size in bytes, when known. */
  size?: number;
  /** The media type deno resolved, e.g. `TypeScript`. */
  mediaType?: string;
  /** Why the module could not be loaded, when it could not be. */
  error?: string;
  /** The specifiers this module imports, in source order. */
  dependencies: DenoModuleDependency[];
}

/** One import edge out of a {@link DenoModule}. */
export interface DenoModuleDependency {
  /** The specifier exactly as written in the source. */
  specifier: string;
  /** Why the dependency could not be resolved, when it could not be. */
  error?: string;
}

/** The module graph `deno info --json <file>` reports. */
export interface DenoModuleGraph {
  /** The entry points the graph was built from. */
  roots: string[];
  /** Every module reachable from {@link roots}, deno's order preserved. */
  modules: DenoModule[];
  /** Specifier redirects deno followed, from requested to resolved. */
  redirects: Record<string, string>;
}

/** The cache locations `deno info --json` reports when given no module. */
export interface DenoCacheInfo {
  /** The version of deno that produced the report. */
  denoVersion?: string;
  /** The root cache directory, i.e. `DENO_DIR`. */
  denoDir?: string;
  /** Where fetched remote modules are stored. */
  modulesCache?: string;
  /** Where npm packages are stored. */
  npmCache?: string;
  /** Where emitted TypeScript is stored. */
  typescriptCache?: string;
  /** Where registry metadata is stored. */
  registryCache?: string;
  /** Where origin-bound storage (`localStorage`) is kept. */
  originStorage?: string;
}

/** Whether `value` is a JSON object rather than an array or a primitive. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The property at `key`, if it is a string. */
function stringAt(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** The property at `key`, if it is a number. */
function numberAt(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

/** Parse `deno info --json` stdout, failing with the task's own name attached. */
function parseJson(task: string, stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `DenoTasks.${task}: deno info did not emit JSON — ${detail}`,
    );
  }
}

/** The object at the root of the report, or a failure naming the task. */
function rootObject(task: string, stdout: string): Record<string, unknown> {
  const parsed = parseJson(task, stdout);
  if (!isRecord(parsed)) {
    throw new Error(
      `DenoTasks.${task}: deno info emitted ${
        Array.isArray(parsed) ? "an array" : typeof parsed
      } where an object was expected.`,
    );
  }
  return parsed;
}

/** The dependency edges of one module entry. */
function parseDependencies(value: unknown): DenoModuleDependency[] {
  if (!Array.isArray(value)) return [];
  const edges: DenoModuleDependency[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const specifier = stringAt(entry, "specifier");
    if (specifier === undefined) continue;
    edges.push({ specifier, error: stringAt(entry, "error") });
  }
  return edges;
}

/**
 * Parse the module graph from `deno info --json <file>` stdout.
 *
 * Entries without a specifier are skipped rather than guessed at: a module
 * deno could not name is not a module a build can act on.
 */
export function parseModuleGraph(stdout: string): DenoModuleGraph {
  const root = rootObject("moduleGraph", stdout);
  const roots = Array.isArray(root.roots)
    ? root.roots.filter((entry): entry is string => typeof entry === "string")
    : [];
  const modules: DenoModule[] = [];
  if (Array.isArray(root.modules)) {
    for (const entry of root.modules) {
      if (!isRecord(entry)) continue;
      const specifier = stringAt(entry, "specifier");
      if (specifier === undefined) continue;
      modules.push({
        specifier,
        kind: stringAt(entry, "kind"),
        local: stringAt(entry, "local"),
        size: numberAt(entry, "size"),
        mediaType: stringAt(entry, "mediaType"),
        error: stringAt(entry, "error"),
        dependencies: parseDependencies(entry.dependencies),
      });
    }
  }
  const redirects: Record<string, string> = {};
  if (isRecord(root.redirects)) {
    for (const [from, to] of Object.entries(root.redirects)) {
      if (typeof to === "string") redirects[from] = to;
    }
  }
  return { roots, modules, redirects };
}

/** Parse the cache report from `deno info --json` stdout. */
export function parseCacheInfo(stdout: string): DenoCacheInfo {
  const root = rootObject("cacheInfo", stdout);
  return {
    denoVersion: stringAt(root, "denoVersion"),
    denoDir: stringAt(root, "denoDir"),
    modulesCache: stringAt(root, "modulesCache"),
    npmCache: stringAt(root, "npmCache"),
    typescriptCache: stringAt(root, "typescriptCache"),
    registryCache: stringAt(root, "registryCache"),
    originStorage: stringAt(root, "originStorage"),
  };
}
