// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The engine behind `zuke import`: read an existing project's task definitions —
 * `package.json` scripts, a `Makefile`, or a Python project's `pyproject.toml`
 * task table — and scaffold an equivalent build, so migrating to Zuke starts
 * from a working translation instead of a blank page.
 *
 * Each discovered task becomes a `target()`. A command maps to
 * {@link https://jsr.io/@zuke/cmd CmdTasks.exec} (typed, injection-safe); an
 * `&&` chain becomes sequential steps; a reference to another task becomes a
 * `dependsOn`; and a command too shell-specific to translate faithfully (pipes,
 * redirects, substitutions, env assignments) is preserved verbatim behind a
 * `// TODO` so the file still compiles and the few tricky scripts are flagged.
 *
 * A `pyproject.toml` (the first of `[tool.poe.tasks]`, `[tool.pdm.scripts]`,
 * `[tool.hatch.envs.default.scripts]`, `[tool.taskipy.tasks]` and
 * `[tool.rye.scripts]` it carries) scaffolds a **Python** build instead — the
 * project `zuke setup --sdk python` makes, with a generated `build.py` whose
 * targets run each command through `ctx.sh(...)` (see `./python_build.ts`).
 *
 * The parsing and generation are pure functions; {@link runImport} adds the
 * file I/O (reusing `zuke setup`'s scaffolder via its `buildContent` hook).
 *
 * @module
 */

import type { BinaryPin } from "./binary_pin.ts";
import { parsePyproject } from "./pyproject.ts";
import { generatePythonBuild } from "./python_build.ts";
import {
  isRecord,
  joinPath,
  type McpSetupOptions,
  runSetup,
  type ScaffoldImports,
  type SetupHost,
  type SetupResult,
} from "./setup.ts";
import { STARTER_IMPORTS, zukeDependency } from "./starter.ts";
import {
  literal,
  normalize,
  oneLine,
  order,
  segments,
  splitChain,
  tokenize,
} from "./translate.ts";

/** A task discovered in an existing project, before identifier normalisation. */
export interface RawTask {
  /** The task's original name (a `package.json` script key, a Makefile target). */
  readonly name: string;
  /** The shell command to run (may be empty for an aggregate/phony target). */
  readonly command: string;
  /** Names of other tasks this one depends on / delegates to. */
  readonly deps: readonly string[];
}

// --- package.json ---------------------------------------------------------

/** The package managers whose `run` delegations become dependencies. */
const RUNNERS = ["npm", "pnpm", "yarn", "bun", "deno"];

/**
 * Parse the `scripts` block of a `package.json` document into tasks, in
 * declaration order. A script segment that merely delegates to another script
 * (`npm run lint`, `pnpm test`, …) is recorded as a dependency rather than an
 * inlined command.
 */
export function parsePackageJson(text: string): RawTask[] {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) return [];
  const names = new Set(Object.keys(parsed.scripts));
  const tasks: RawTask[] = [];
  for (const [name, value] of Object.entries(parsed.scripts)) {
    if (typeof value !== "string") continue;
    const deps: string[] = [];
    const kept: string[] = [];
    for (const segment of splitChain(value)) {
      const target = delegatedScript(segment, names);
      if (target !== undefined && target !== name) deps.push(target);
      else kept.push(segment.trim());
    }
    tasks.push({ name, command: kept.join(" && "), deps });
  }
  return tasks;
}

/** If `segment` is a `<runner> [run] <script>` delegation, the script name. */
function delegatedScript(
  segment: string,
  scripts: Set<string>,
): string | undefined {
  const tokens = tokenize(segment.trim());
  if (tokens === undefined) return undefined;
  if (tokens.length === 0 || !RUNNERS.includes(tokens[0])) return undefined;
  const rest = tokens[1] === "run" ? tokens.slice(2) : tokens.slice(1);
  // A pure delegation is exactly the runner and one known script name.
  if (rest.length === 1 && scripts.has(rest[0])) return rest[0];
  return undefined;
}

// --- Makefile -------------------------------------------------------------

/**
 * Parse a `Makefile` into tasks: each rule (`target: prerequisites`) becomes a
 * task whose recipe lines are its command and whose prerequisites become
 * dependencies. Pattern rules, variable assignments, and directives are
 * skipped.
 */
export function parseMakefile(text: string): RawTask[] {
  const lines = text.split(/\r?\n/);
  const tasks: RawTask[] = [];
  let current: { name: string; deps: string[]; recipe: string[] } | undefined;
  const flush = () => {
    if (current !== undefined) {
      tasks.push({
        name: current.name,
        command: current.recipe.join(" && "),
        deps: current.deps,
      });
    }
    current = undefined;
  };
  for (const line of lines) {
    // Recipe lines are tab-indented and belong to the open rule.
    if (current !== undefined && line.startsWith("\t")) {
      const recipe = stripRecipePrefix(line.slice(1).trim());
      if (recipe !== "") current.recipe.push(recipe);
      continue;
    }
    const rule = line.match(/^([A-Za-z0-9_.-]+)\s*:(?!=)\s*(.*)$/);
    // Skip non-rules and special targets (`.PHONY`, `.DEFAULT`, …).
    if (rule === null || rule[1].startsWith(".")) {
      flush();
      continue;
    }
    flush();
    const deps = rule[2].trim().split(/\s+/).filter((d) => d !== "");
    current = { name: rule[1], deps, recipe: [] };
  }
  flush();
  // Prerequisites that are not themselves targets (files) are not dependencies.
  const targetNames = new Set(tasks.map((t) => t.name));
  return tasks.map((t) => ({
    ...t,
    deps: t.deps.filter((d) => targetNames.has(d)),
  }));
}

/** Drop a leading recipe modifier (`@` silent, `-` ignore-errors) from a line. */
function stripRecipePrefix(recipe: string): string {
  return recipe.replace(/^[@-]+/, "");
}

// --- command translation --------------------------------------------------

/** One statement in a generated target body. */
interface BodyItem {
  /** The code — a `CmdTasks.exec(...)` call or a `// TODO` comment. */
  readonly code: string;
  /** Whether this is a runnable command (vs. a comment placeholder). */
  readonly runnable: boolean;
}

/**
 * Translate a shell command into target-body statements: each `&&`-separated
 * segment becomes a `CmdTasks.exec(...)` call, or a `// TODO` comment
 * preserving the raw text when it is too shell-specific to translate.
 */
export function translateCommand(command: string): BodyItem[] {
  return segments(command).map((segment) => {
    if ("raw" in segment) {
      return {
        code: `// TODO: translate this shell command: ${oneLine(segment.raw)}`,
        runnable: false,
      };
    }
    const [bin, ...args] = segment.argv;
    const call = args.length === 0
      ? `CmdTasks.exec(${literal(bin)})`
      : `CmdTasks.exec(${literal(bin)}, (s) => s.args(${
        args.map(literal).join(", ")
      }))`;
    return { code: call, runnable: true };
  });
}

// --- identifiers ----------------------------------------------------------

/**
 * Turn a task name into a valid, camelCase JavaScript identifier for a target
 * field — `build:prod` → `buildProd`, `test-watch` → `testWatch`. Falls back to
 * `task` for an empty result and prefixes a leading digit.
 */
export function toIdentifier(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter((p) => p !== "");
  if (parts.length === 0) return "task";
  const head = parts[0];
  const camel = head.charAt(0).toLowerCase() + head.slice(1) +
    parts.slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("");
  return /^[0-9]/.test(camel) ? `task_${camel}` : camel;
}

// --- generation -----------------------------------------------------------

/** Render a target body from its statements (single-expression when it can). */
function renderBody(items: readonly BodyItem[]): string {
  if (items.length === 0) return "() => {}";
  if (items.length === 1 && items[0].runnable) return `() => ${items[0].code}`;
  const runnable = items.some((i) => i.runnable);
  const lines = items
    .map((i) => `      ${i.runnable ? `await ${i.code};` : i.code}`)
    .join("\n");
  return `${runnable ? "async " : ""}() => {\n${lines}\n    }`;
}

/** A generated `zuke.ts`, with the import map its bare specifiers need. */
export interface GeneratedBuild {
  /** The `zuke.ts` source text. */
  readonly source: string;
  /**
   * The `deno.json` `imports` entries {@link GeneratedBuild.source} resolves
   * through — always `@zuke/core`, plus `@zuke/cmd` when a task translated to a
   * command. {@link runImport} hands these to the scaffolder, which merges them
   * into `deno.json`.
   */
  readonly imports: ScaffoldImports;
}

/**
 * Generate a `zuke.ts` build class named `className` from imported tasks.
 * Exposed for tools and tests; {@link runImport} writes the result to disk.
 */
export function generateBuild(
  className: string,
  raw: readonly RawTask[],
): GeneratedBuild {
  const { ordered, dropped } = order(normalize(raw, toIdentifier, new Set()));
  const bodies = new Map(
    ordered.map((t) => [t.id, translateCommand(t.task.command)]),
  );
  const usesCmd = [...bodies.values()].some((b) => b.some((i) => i.runnable));

  const fields = ordered.map((task) => {
    const body = bodies.get(task.id) ?? [];
    const chain = [`  ${task.id} = target()`];
    chain.push(`    .description(${literal(`imported: ${task.task.name}`)})`);
    if (task.deps.length > 0) {
      const refs = task.deps.map((d) => `this.${d}`).join(", ");
      chain.push(`    .dependsOn(${refs})`);
    }
    const skipped = dropped.get(task.id);
    if (skipped !== undefined && skipped.length > 0) {
      chain.push(
        `    // TODO: dependency cycle — dropped .dependsOn(${
          skipped.map((d) => `this.${d}`).join(", ")
        })`,
      );
    }
    chain.push(`    .executes(${renderBody(body)});`);
    return chain.join("\n");
  });

  // Import by bare specifier and declare the `jsr:` dependency in `deno.json`,
  // exactly as `zuke setup` scaffolds it — an inline `jsr:` specifier trips
  // Deno's default `no-import-prefix` lint rule on the generated file. The
  // caret-major pin lives in the map, via the one definition of it.
  const imports: Record<string, string> = { ...STARTER_IMPORTS };
  const lines = [`import { Build, run, target } from "@zuke/core";`];
  if (usesCmd) {
    imports["@zuke/cmd"] = zukeDependency("cmd");
    lines.push(`import { CmdTasks } from "@zuke/cmd";`);
  }

  const body = fields.length > 0
    ? fields.join("\n\n")
    : "  // No tasks were found to import — add targets here.";

  const source = `${lines.join("\n")}

/** Imported build — refine these targets into typed Zuke tasks. */
class ${className} extends Build {
${body}
}

await run(${className});
`;
  return { source, imports };
}

// --- orchestration --------------------------------------------------------

/** The kinds of project `zuke import` can read. */
export type ImportSource = "package.json" | "Makefile" | "pyproject.toml";

/** Options controlling {@link runImport}. */
export interface ImportOptions {
  /** Directory to import from and scaffold into. */
  dir: string;
  /** Overwrite existing scaffolded files instead of skipping them. */
  force: boolean;
  /** Build class name for the generated `zuke.ts` or `build.py`. */
  name: string;
  /**
   * Force a specific source; auto-detected (package.json, then Makefile, then
   * pyproject.toml) when unset.
   */
  from?: ImportSource;
  /** Also register the build's MCP server in `.mcp.json` (see {@link "./setup.ts".SetupOptions.mcp}). */
  mcp?: McpSetupOptions;
  /** Which launchers to scaffold (see {@link "./setup.ts".SetupOptions.bootstrapDeno}). */
  bootstrapDeno?: boolean;
  /**
   * Resolve the pin of the `zuke` release a Python build's launchers run,
   * whose engine its `zuke.json` pins. Called only when a `pyproject.toml` is
   * imported, so importing a `package.json` or a `Makefile` never needs the
   * network.
   */
  pin: () => Promise<BinaryPin>;
}

/** The outcome of {@link runImport}. */
export interface ImportResult extends SetupResult {
  /** The source that was imported, or `null` when none was found. */
  source: ImportSource | null;
  /** The number of tasks discovered. */
  taskCount: number;
}

/** What one source file translates to: the build file and how to scaffold it. */
interface Translation {
  /** The number of tasks discovered. */
  readonly taskCount: number;
  /** The generated build file's text. */
  readonly buildContent: string;
  /** The `deno.json` imports a `zuke.ts` needs; `undefined` for a `build.py`. */
  readonly imports?: ScaffoldImports;
  /** Whether the build is a Python one, scaffolded as `setup --sdk python` would. */
  readonly python: boolean;
}

/** Translate tasks into a `zuke.ts`. */
function typescript(tasks: readonly RawTask[], name: string): Translation {
  const generated = generateBuild(name, tasks);
  return {
    taskCount: tasks.length,
    buildContent: generated.source,
    imports: generated.imports,
    python: false,
  };
}

/** The source files probed during auto-detection, in priority order. */
const SOURCE_FILES: ReadonlyArray<{
  source: ImportSource;
  file: string;
  translate: (text: string, name: string) => Translation;
}> = [
  {
    source: "package.json",
    file: "package.json",
    translate: (text, name) => typescript(parsePackageJson(text), name),
  },
  {
    source: "Makefile",
    file: "Makefile",
    translate: (text, name) => typescript(parseMakefile(text), name),
  },
  {
    source: "pyproject.toml",
    file: "pyproject.toml",
    translate: (text, name) => {
      const tasks = parsePyproject(text);
      return {
        taskCount: tasks.length,
        buildContent: generatePythonBuild(name, tasks),
        python: true,
      };
    },
  },
];

/**
 * Import an existing project's tasks into a generated build, then scaffold
 * the launchers and the rest around it (via `zuke setup`): a `zuke.ts` and
 * `deno.json` for `package.json` scripts or a `Makefile`, a `build.py` and a
 * `zuke.json` and launchers pinning a `zuke` release ({@link ImportOptions.pin}) for a
 * `pyproject.toml`. Detects the source automatically — `package.json`, then a
 * `Makefile`, then `pyproject.toml` — unless {@link ImportOptions.from} pins
 * one. Returns `source: null` when nothing was found (and writes nothing).
 */
export async function runImport(
  options: ImportOptions,
  host: SetupHost,
): Promise<ImportResult> {
  const candidates = options.from === undefined
    ? SOURCE_FILES
    : SOURCE_FILES.filter((c) => c.source === options.from);

  for (const candidate of candidates) {
    const path = joinPath(options.dir, candidate.file);
    if (!(await host.exists(path))) continue;
    // The source file's name is chosen here, not by the caller, so a repository
    // that ships a link at it decides what gets read — and whatever is read is
    // parsed into the generated build file, which import then writes back into
    // the repository. Refuse rather than follow, exactly as scaffolding does.
    if (await host.isSymlink(path)) {
      throw new Error(
        `zuke import: refusing to read "${candidate.file}" — ${path} is a ` +
          `symbolic link, so its contents would come from the file it points ` +
          `at and end up in the generated build. Replace the link with a ` +
          `regular file (or remove it), then re-run import.`,
      );
    }
    const translation = candidate.translate(
      await host.readText(path),
      options.name,
    );
    host.log(
      `Importing ${translation.taskCount} task(s) from ${candidate.file} ` +
        `into ${options.dir === "." ? "the current directory" : options.dir}:`,
    );
    const setup = await runSetup({
      dir: options.dir,
      force: options.force,
      name: options.name,
      buildContent: translation.buildContent,
      imports: translation.imports,
      mcp: options.mcp,
      bootstrapDeno: options.bootstrapDeno,
      sdk: translation.python ? { pin: await options.pin() } : undefined,
    }, host);
    return {
      ...setup,
      source: candidate.source,
      taskCount: translation.taskCount,
    };
  }

  return {
    files: [],
    manualSteps: [],
    notes: [],
    source: null,
    taskCount: 0,
  };
}
