/**
 * The engine behind `zuke import`: read an existing project's task definitions —
 * `package.json` scripts or a `Makefile` — and scaffold an equivalent typed
 * `zuke.ts` build, so migrating to Zuke starts from a working translation
 * instead of a blank page.
 *
 * Each discovered task becomes a `target()`. A command maps to
 * {@link https://jsr.io/@zuke/cmd CmdTasks.exec} (typed, injection-safe); an
 * `&&` chain becomes sequential steps; a reference to another task becomes a
 * `dependsOn`; and a command too shell-specific to translate faithfully (pipes,
 * redirects, substitutions, env assignments) is preserved verbatim behind a
 * `// TODO` so the file still compiles and the few tricky scripts are flagged.
 *
 * The parsing and generation are pure functions; {@link runImport} adds the
 * file I/O (reusing `zuke setup`'s scaffolder via its `buildContent` hook).
 *
 * @module
 */

import {
  isRecord,
  joinPath,
  runSetup,
  type SetupHost,
  type SetupResult,
} from "./setup.ts";

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

/** Shell features a single `CmdTasks.exec` argv cannot faithfully express. */
function needsShell(segment: string): boolean {
  if (/[|<>;`$]/.test(segment)) return true; // pipe, redirect, subst, env expand
  if (/(^|\s)&(\s|$)/.test(segment)) return true; // background job
  const first = segment.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(first); // leading VAR=value assignment
}

/**
 * Translate a shell command into target-body statements: each `&&`-separated
 * segment becomes a `CmdTasks.exec(...)` call, or a `// TODO` comment
 * preserving the raw text when it is too shell-specific to translate.
 */
export function translateCommand(command: string): BodyItem[] {
  const items: BodyItem[] = [];
  for (const raw of splitChain(command)) {
    const segment = raw.trim();
    if (segment === "") continue;
    if (needsShell(segment)) {
      items.push({
        code: `// TODO: translate this shell command: ${segment}`,
        runnable: false,
      });
      continue;
    }
    const tokens = tokenize(segment);
    const bin = tokens[0];
    if (bin === undefined) continue;
    const args = tokens.slice(1);
    const call = args.length === 0
      ? `CmdTasks.exec(${str(bin)})`
      : `CmdTasks.exec(${str(bin)}, (s) => s.args(${
        args.map(str).join(", ")
      }))`;
    items.push({ code: call, runnable: true });
  }
  return items;
}

/** Split a command on top-level `&&`, ignoring `&&` inside quotes. */
function splitChain(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote !== undefined) {
      current += ch;
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "&" && command[i + 1] === "&") {
      parts.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Split a command segment into argv, honouring single/double quotes. */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;
  let has = false;
  for (const ch of segment) {
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      else {
        current += ch;
        has = true;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === " " || ch === "\t") {
      if (has) {
        tokens.push(current);
        current = "";
        has = false;
      }
    } else {
      current += ch;
      has = true;
    }
  }
  if (has) tokens.push(current);
  return tokens;
}

/** A double-quoted TypeScript string literal for `value`. */
function str(value: string): string {
  return JSON.stringify(value);
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

/** A task with a unique identifier and dependencies remapped to identifiers. */
interface NamedTask {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly deps: readonly string[];
}

/** Assign each raw task a unique identifier and remap its deps to identifiers. */
function normalize(tasks: readonly RawTask[]): NamedTask[] {
  const idByName = new Map<string, string>();
  const used = new Set<string>();
  for (const task of tasks) {
    let id = toIdentifier(task.name);
    while (used.has(id)) id = `${id}_`;
    used.add(id);
    idByName.set(task.name, id);
  }
  return tasks.map((task) => ({
    id: idByName.get(task.name) ?? toIdentifier(task.name),
    label: task.name,
    command: task.command,
    deps: task.deps
      .map((d) => idByName.get(d))
      .filter((d): d is string => d !== undefined),
  }));
}

/**
 * Order tasks so every dependency is declared before its dependents (Zuke
 * forbids forward references), dropping the edges that would close a cycle.
 * Returns the order plus, per task id, any dependency ids that were dropped.
 */
function order(
  tasks: readonly NamedTask[],
): { ordered: NamedTask[]; dropped: Map<string, string[]> } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, "open" | "done">();
  const ordered: NamedTask[] = [];
  const dropped = new Map<string, string[]>();
  const visit = (task: NamedTask) => {
    state.set(task.id, "open");
    for (const dep of task.deps) {
      const target = byId.get(dep);
      if (target === undefined) continue;
      const st = state.get(dep);
      if (st === "open") {
        dropped.set(task.id, [...(dropped.get(task.id) ?? []), dep]);
      } else if (st === undefined) {
        visit(target);
      }
    }
    state.set(task.id, "done");
    ordered.push(task);
  };
  for (const task of tasks) {
    if (state.get(task.id) === undefined) visit(task);
  }
  return { ordered, dropped };
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

/**
 * Generate a `zuke.ts` build class named `className` from imported tasks.
 * Exposed for tools and tests; {@link runImport} writes the result to disk.
 */
export function generateBuild(
  className: string,
  raw: readonly RawTask[],
): string {
  const { ordered, dropped } = order(normalize(raw));
  const bodies = new Map(
    ordered.map((t) => [t.id, translateCommand(t.command)]),
  );
  const usesCmd = [...bodies.values()].some((b) => b.some((i) => i.runnable));

  const fields = ordered.map((task) => {
    const body = bodies.get(task.id) ?? [];
    const chain = [`  ${task.id} = target()`];
    chain.push(`    .description(${str(`imported: ${task.label}`)})`);
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

  const imports = [`import { Build, run, target } from "jsr:@zuke/core";`];
  if (usesCmd) imports.push(`import { CmdTasks } from "jsr:@zuke/cmd";`);

  const body = fields.length > 0
    ? fields.join("\n\n")
    : "  // No tasks were found to import — add targets here.";

  return `${imports.join("\n")}

/** Imported build — refine these targets into typed Zuke tasks. */
class ${className} extends Build {
${body}
}

await run(${className});
`;
}

// --- orchestration --------------------------------------------------------

/** The kinds of project `zuke import` can read. */
export type ImportSource = "package.json" | "Makefile";

/** Options controlling {@link runImport}. */
export interface ImportOptions {
  /** Directory to import from and scaffold into. */
  dir: string;
  /** Overwrite existing scaffolded files instead of skipping them. */
  force: boolean;
  /** Build class name for the generated `zuke.ts`. */
  name: string;
  /** Force a specific source; auto-detected (package.json, then Makefile) when unset. */
  from?: ImportSource;
}

/** The outcome of {@link runImport}. */
export interface ImportResult extends SetupResult {
  /** The source that was imported, or `null` when none was found. */
  source: ImportSource | null;
  /** The number of tasks discovered. */
  taskCount: number;
}

/** The source files probed during auto-detection, in priority order. */
const SOURCE_FILES: ReadonlyArray<
  { source: ImportSource; file: string; parse: (text: string) => RawTask[] }
> = [
  { source: "package.json", file: "package.json", parse: parsePackageJson },
  { source: "Makefile", file: "Makefile", parse: parseMakefile },
];

/**
 * Import an existing project's tasks into a generated `zuke.ts`, then scaffold
 * the launchers and `deno.json` around it (via `zuke setup`). Detects the
 * source automatically — `package.json` scripts, then a `Makefile` — unless
 * {@link ImportOptions.from} pins one. Returns `source: null` when nothing was
 * found (and writes nothing).
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
    const tasks = candidate.parse(await host.readText(path));
    host.log(
      `Importing ${tasks.length} task(s) from ${candidate.file} into ${
        options.dir === "." ? "the current directory" : options.dir
      }:`,
    );
    const setup = await runSetup({
      dir: options.dir,
      force: options.force,
      name: options.name,
      buildContent: generateBuild(options.name, tasks),
    }, host);
    return { ...setup, source: candidate.source, taskCount: tasks.length };
  }

  return { files: [], source: null, taskCount: 0 };
}
