// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Python facade generator (`./zuke pythonFacades --out <dir>`): one Python
 * module per wrapper package, read from the wrapper's own `deno doc --json`
 * output, so no facade is written by hand and none can drift from the wrapper
 * it fronts.
 *
 * A facade mirrors the TypeScript surface a `zuke.ts` build calls: a class per
 * `*Tasks` object with a method per task, and a class per settings class with
 * a method per public setter, each recording its call. A task call sends the
 * engine a `tool.call`: the package, its exact release, the task object, the
 * task and the arguments, with a settings lambda sent as the recorded
 * `[setter, [arguments]]` pairs. The modules import that runtime, the settings
 * base and the call helpers, from `zuke._facade` in the Python SDK.
 *
 * Core's `./tooling` entrypoint, the base settings every wrapper's settings
 * extend, is generated into `_tooling.py` beside the packages' modules.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { DenoTasks } from "@zuke/deno";
import { RESERVED } from "../packages/engine/src/tools.ts";
import {
  type DocMethod,
  type DocParam,
  type DocRoot,
  type DocSymbol,
  type DocTsType,
  isPublicMember,
} from "./api_reference.ts";
import { localVersion, packageEntrypoints, PACKAGES } from "./packages.ts";

/** The template every generated module starts from. */
export const PYTHON_TEMPLATE = "internal/python_facade.py.tmpl";

/** Core's tooling entrypoint: the base settings every wrapper's settings extend. */
export const TOOLING_ENTRYPOINT = "packages/core/src/tooling.ts";

/** The module the base settings are generated into. */
export const TOOLING_MODULE = "_tooling";

/** Packages that wrap no tool: nothing in them is a facade's to call. */
const NOT_WRAPPERS: ReadonlySet<string> = new Set(["core", "engine", "cli"]);

/** The wrapper packages a facade is generated for, in publish order. */
export const WRAPPER_PACKAGES: readonly string[] = PACKAGES.filter(
  (dir) => !NOT_WRAPPERS.has(dir),
);

/** Names Python reserves, or binds in a method; a member so named is suffixed. */
const PYTHON_KEYWORDS: ReadonlySet<string> = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "case",
  "class",
  "cls",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "match",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "self",
  "try",
  "type",
  "while",
  "with",
  "yield",
]);

/** The Python spelling of each TypeScript keyword type. */
const KEYWORD_TYPES: ReadonlyMap<string, string> = new Map([
  ["string", "str"],
  ["number", "float"],
  ["bigint", "int"],
  ["boolean", "bool"],
  ["void", "None"],
  ["undefined", "None"],
  ["null", "None"],
]);

/** `camelCase` to `snake_case`, as Python names its functions and arguments. */
export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/** The Python name of a member: snake case, suffixed when Python reserves it. */
export function pythonName(name: string): string {
  const snake = snakeCase(name);
  return PYTHON_KEYWORDS.has(snake) ? `${snake}_` : snake;
}

/** Which imports a module needs, set as the types that need them are rendered. */
interface Uses {
  callable: boolean;
  literal: boolean;
  mapping: boolean;
  sequence: boolean;
  self: boolean;
  execResult: boolean;
  /** A class extends the runtime's `Settings` directly. */
  settingsBase: boolean;
  /** A task sends a settings lambda through `configured`. */
  configured: boolean;
}

/** What the type renderer resolves names against. */
interface Scope {
  /** The module's type aliases, inlined where they are referenced. */
  readonly aliases: ReadonlyMap<string, DocTsType>;
  /** The settings classes a type may name: the module's and the base module's. */
  readonly classes: ReadonlySet<string>;
  /** Interfaces of plain data, carried as a mapping. */
  readonly shapes: ReadonlySet<string>;
  /** Names JSON cannot carry: hosts, streams, providers, the package's other classes. */
  readonly opaque: ReadonlySet<string>;
  readonly uses: Uses;
}

/** Built-in types no JSON carries; a member taking one is left out. */
const NOT_JSON: ReadonlySet<string> = new Set([
  "AbortSignal",
  "ArrayBuffer",
  "Blob",
  "FormData",
  "Headers",
  "ReadableStream",
  "Request",
  "Response",
  "Uint8Array",
  "WritableStream",
]);

/** A `value` that is one type node rather than a list of them. */
function one(
  value: DocTsType | DocTsType[] | undefined,
): DocTsType | undefined {
  return Array.isArray(value) ? undefined : value;
}

/** Fold a union's rendered members: literals into one `Literal`, `None` last. */
function unionOf(members: string[]): string {
  const literals: string[] = [];
  const rest: string[] = [];
  let none = false;
  for (const member of members) {
    const literal = /^Literal\[(.*)\]$/.exec(member);
    if (literal !== null) literals.push(literal[1] ?? "");
    else if (member === "None") none = true;
    else if (!rest.includes(member)) rest.push(member);
  }
  const parts = literals.length > 0
    ? [`Literal[${literals.join(", ")}]`, ...rest]
    : rest;
  if (parts.length === 0) return none ? "None" : "object";
  const joined = parts.includes("object") ? "object" : parts.join(" | ");
  return none ? `${joined} | None` : joined;
}

/** Render a `typeRef` node: the wrappers' generic shapes, aliases and classes. */
function refType(t: DocTsType, scope: Scope, depth: number): string {
  const value = one(t.value);
  const name = value?.typeName ?? t.repr ?? "";
  const params = value?.typeParams ?? [];
  const inner = () => pythonType(params[0], scope, depth + 1);
  switch (name) {
    case "Promise":
    case "Readonly":
    case "Partial":
    case "Required":
    // Python has no subtraction of a union's members; the whole union is close.
    case "Exclude":
    case "Extract":
      return inner();
    case "Array":
    case "ReadonlyArray":
      scope.uses.sequence = true;
      return `Sequence[${inner()}]`;
    case "Record":
      scope.uses.mapping = true;
      return `Mapping[${inner()}, ${pythonType(params[1], scope, depth + 1)}]`;
    case "PathLike":
    case "AbsolutePath":
    case "URL":
    // A date travels as the ISO string JSON carries, which is what a setter
    // taking a date or a string accepts.
    case "Date":
      return "str";
    case "CommandOutput":
      scope.uses.execResult = true;
      return "ExecResult";
    case "Configure": {
      const settings = inner();
      scope.uses.callable = true;
      return `Callable[[${settings}], ${settings}]`;
    }
    default: {
      const alias = scope.aliases.get(name);
      if (alias !== undefined) return pythonType(alias, scope, depth + 1);
      if (scope.shapes.has(name)) {
        scope.uses.mapping = true;
        return "Mapping[str, object]";
      }
      return scope.classes.has(name) ? name : "object";
    }
  }
}

/**
 * Render a documented type as the Python annotation the facade declares: the
 * keyword types, literal unions, lists, records, the settings lambda, and
 * `object` for whatever Python cannot name the same way.
 */
export function pythonType(
  t: DocTsType | undefined,
  scope: Scope,
  depth = 0,
): string {
  if (t === undefined || depth > 8) return "object";
  const value = t.value;
  switch (t.kind) {
    case "keyword":
      return KEYWORD_TYPES.get(t.repr ?? "") ?? "object";
    case "literal": {
      const literal = one(value);
      scope.uses.literal = true;
      if (literal?.string !== undefined) {
        return `Literal[${JSON.stringify(literal.string)}]`;
      }
      if (literal?.number !== undefined) return `Literal[${literal.number}]`;
      if (literal?.boolean !== undefined) {
        return `Literal[${literal.boolean ? "True" : "False"}]`;
      }
      return "object";
    }
    case "union":
      return Array.isArray(value)
        ? unionOf(value.map((m) => pythonType(m, scope, depth + 1)))
        : "object";
    case "parenthesized":
      return pythonType(one(value), scope, depth + 1);
    case "array":
      scope.uses.sequence = true;
      return `Sequence[${pythonType(one(value), scope, depth + 1)}]`;
    case "this":
      scope.uses.self = true;
      return "Self";
    case "typeRef":
      return refType(t, scope, depth);
    default:
      return "object";
  }
}

/** One parameter of a facade method, as it is declared and as it is sent. */
interface PyParam {
  /** The Python parameter name. */
  readonly name: string;
  /** The annotation, without the `| None` an optional parameter adds. */
  readonly type: string;
  readonly rest: boolean;
  readonly optional: boolean;
  /** The settings class a `Configure` parameter configures, if it is one. */
  readonly configures?: string;
}

/**
 * Whether JSON carries a value of this type to the engine: not a function, a
 * host, a stream or an instance of the package's own classes, at any depth.
 */
function jsonCarries(
  t: DocTsType | undefined,
  scope: Scope,
  depth = 0,
): boolean {
  if (t === undefined || depth > 8) return true;
  const value = t.value;
  switch (t.kind) {
    // A function, or the type of one (`typeof fetch`).
    case "fnOrConstructor":
    case "typeQuery":
      return false;
    case "union":
    case "intersection":
      return !Array.isArray(value) ||
        value.every((m) => jsonCarries(m, scope, depth + 1));
    case "array":
    case "parenthesized":
      return jsonCarries(one(value), scope, depth + 1);
    case "typeRef": {
      const name = one(value)?.typeName ?? "";
      if (scope.opaque.has(name)) return false;
      const alias = scope.aliases.get(name);
      if (alias !== undefined) return jsonCarries(alias, scope, depth + 1);
      return (one(value)?.typeParams ?? []).every((p) =>
        jsonCarries(p, scope, depth + 1)
      );
    }
    default:
      return true;
  }
}

/** Read one documented parameter; `undefined` when a facade cannot carry it. */
function paramOf(p: DocParam, scope: Scope): PyParam | undefined {
  const tsType = p.tsType ?? p.left?.tsType ?? p.arg?.tsType;
  if (!jsonCarries(tsType, scope)) return undefined;
  const raw = p.arg?.name ?? p.left?.name ?? p.name ?? "arg";
  const name = pythonName(raw);
  const rest = p.kind === "rest";
  const optional = p.kind === "assign" || p.optional === true ||
    p.left?.optional === true;
  const value = one(tsType?.value);
  if (tsType?.kind === "typeRef" && value?.typeName === "Configure") {
    const settings = pythonType(value.typeParams?.[0], scope);
    scope.uses.callable = true;
    const named = scope.classes.has(settings) ? settings : "Settings";
    return {
      name,
      type: `Callable[[${named}], ${named}]`,
      rest,
      optional,
      configures: named,
    };
  }
  // A rest parameter's documented type is the array; each element is one.
  const element = rest ? one(tsType?.value) : tsType;
  return { name, type: pythonType(element, scope), rest, optional };
}

/** Render parameters, one per line, after the leading `self` or `ctx`. */
function signature(leading: string, params: readonly PyParam[]): string[] {
  if (params.length === 0) return [`${leading}`];
  const lines = [`${leading},`];
  for (const p of params) {
    const type = p.optional ? `${p.type} | None = None` : p.type;
    lines.push(p.rest ? `*${p.name}: ${p.type},` : `${p.name}: ${type},`);
  }
  return lines;
}

/** The arguments a call sends, in order, a rest parameter spread into them. */
function argumentsOf(params: readonly PyParam[], uses: Uses): string {
  return params.map((p) => {
    if (p.configures === undefined) return p.rest ? `*${p.name}` : p.name;
    uses.configured = true;
    return `configured(${p.configures}(), ${p.name})`;
  }).join(", ");
}

/** Render a JSDoc body as a Python docstring, indented. */
export function docstring(
  doc: string | undefined,
  indent: string,
  fallback: string,
): string[] {
  const text = (doc ?? "")
    .replace(
      /\{@link(?:code)?\s+([^}|]+?)(?:\s*\|\s*([^}]+))?\}/g,
      (_match, target: string, label: string | undefined) => label ?? target,
    )
    .replace(/\\/g, "\\\\")
    .replace(/"""/g, '\\"\\"\\"')
    .trim();
  const lines = (text === "" ? fallback : text).split("\n").map((l) =>
    l.trimEnd()
  );
  const [first = "", ...more] = lines;
  if (more.length === 0) return [`${indent}"""${first}"""`];
  return [
    `${indent}"""${first}`,
    ...more.map((l) => (l === "" ? "" : `${indent}${l}`)),
    `${indent}"""`,
  ];
}

/** A settings class as the generator reads it. */
interface ClassInfo {
  readonly name: string;
  readonly doc: string | undefined;
  readonly base: string | undefined;
  readonly methods: readonly DocMethod[];
}

/** A task as the generator reads it, whatever shape its object was declared in. */
interface TaskInfo {
  readonly name: string;
  readonly doc: string | undefined;
  readonly params: readonly DocParam[];
  readonly returnType: DocTsType | undefined;
}

/** A `*Tasks` object and its tasks. */
interface TasksInfo {
  readonly name: string;
  readonly doc: string | undefined;
  readonly tasks: readonly TaskInfo[];
}

/** Every symbol of a doc root, first seen wins, in entrypoint order. */
function symbolsOf(root: DocRoot): DocSymbol[] {
  const byName = new Map<string, DocSymbol>();
  for (const node of Object.values(root.nodes ?? {})) {
    for (const symbol of node.symbols ?? []) {
      if ((symbol.declarations?.length ?? 0) === 0) continue;
      if (!byName.has(symbol.name)) byName.set(symbol.name, symbol);
    }
  }
  return [...byName.values()];
}

/** The classes a doc root declares, by name. */
function classesOf(root: DocRoot): Map<string, ClassInfo> {
  const classes = new Map<string, ClassInfo>();
  for (const symbol of symbolsOf(root)) {
    const decl = symbol.declarations?.[0];
    if (decl?.kind !== "class") continue;
    const base = decl.def?.extends;
    classes.set(symbol.name, {
      name: symbol.name,
      doc: decl.jsDoc?.doc,
      base: typeof base === "string" ? base : undefined,
      methods: decl.def?.methods ?? [],
    });
  }
  return classes;
}

/**
 * The interfaces a doc root declares, split into plain data, which a mapping
 * carries, and those with methods or function-typed members, which nothing
 * does.
 */
function interfacesOf(
  root: DocRoot,
): { shapes: Set<string>; behaviours: Set<string> } {
  const shapes = new Set<string>();
  const behaviours = new Set<string>();
  for (const symbol of symbolsOf(root)) {
    const decl = symbol.declarations?.[0];
    if (decl?.kind !== "interface") continue;
    const def = decl.def;
    const functional = (def?.methods?.length ?? 0) > 0 ||
      (def?.properties ?? []).some((p) => p.tsType?.kind === "fnOrConstructor");
    (functional ? behaviours : shapes).add(symbol.name);
  }
  return { shapes, behaviours };
}

/** The type aliases a doc root declares, by name. */
function aliasesOf(root: DocRoot): Map<string, DocTsType> {
  const aliases = new Map<string, DocTsType>();
  for (const symbol of symbolsOf(root)) {
    const decl = symbol.declarations?.[0];
    const type = decl?.def?.tsType;
    if (decl?.kind === "typeAlias" && type !== undefined) {
      aliases.set(symbol.name, type);
    }
  }
  return aliases;
}

/** The tasks of a task object's type: an interface's methods, or a literal's. */
function tasksOfType(
  type: DocTsType | undefined,
  interfaces: ReadonlyMap<string, DocSymbol>,
): TaskInfo[] {
  const value = one(type?.value);
  if (type?.kind === "typeRef" && value?.typeName !== undefined) {
    const decl = interfaces.get(value.typeName)?.declarations?.[0];
    return (decl?.def?.methods ?? []).map((m) => ({
      name: m.name ?? "",
      doc: m.jsDoc?.doc,
      params: m.params ?? m.functionDef?.params ?? [],
      returnType: m.returnType ?? m.functionDef?.returnType,
    }));
  }
  if (type?.kind !== "typeLiteral" || value === undefined) return [];
  const tasks: TaskInfo[] = [];
  for (const property of value.properties ?? []) {
    const fn = one(property.tsType?.value);
    if (property.tsType?.kind !== "fnOrConstructor" || fn === undefined) {
      continue;
    }
    tasks.push({
      name: property.name ?? "",
      doc: property.jsDoc?.doc,
      params: fn.params ?? [],
      returnType: fn.tsType,
    });
  }
  for (const m of value.methods ?? []) {
    tasks.push({
      name: m.name ?? "",
      doc: m.jsDoc?.doc,
      params: m.params ?? [],
      returnType: m.returnType,
    });
  }
  return tasks;
}

/** The `*Tasks` objects a doc root exports, with their tasks. */
function tasksOf(root: DocRoot): TasksInfo[] {
  const symbols = symbolsOf(root);
  const interfaces = new Map(
    symbols.filter((s) => s.declarations?.[0]?.kind === "interface").map((
      s,
    ) => [s.name, s]),
  );
  const objects: TasksInfo[] = [];
  for (const symbol of symbols) {
    const decl = symbol.declarations?.[0];
    if (decl?.kind !== "variable" || !symbol.name.endsWith("Tasks")) continue;
    const type = decl.def?.tsType;
    const value = one(type?.value);
    const viaInterface =
      type?.kind === "typeRef" && value?.typeName !== undefined
        ? interfaces.get(value.typeName)?.declarations?.[0]?.jsDoc?.doc
        : undefined;
    objects.push({
      name: symbol.name,
      doc: decl.jsDoc?.doc ?? viaInterface,
      tasks: tasksOfType(type, interfaces),
    });
  }
  return objects;
}

/** What `renderFacade` renders: a package, its release and the two doc roots. */
export interface FacadeSource {
  /** The package's name after `@zuke/`. */
  readonly package: string;
  /** The exact release the facade calls. */
  readonly version: string;
  /** The package's `deno doc --json` output. */
  readonly root: DocRoot;
  /** Core's `./tooling` doc output, for the base settings. */
  readonly tooling: DocRoot;
}

/** The text of one setter, or nothing when the facade cannot carry it. */
function renderSetter(
  m: DocMethod,
  owner: ClassInfo,
  scope: Scope,
  seen: Set<string>,
): string[] | undefined {
  const name = m.name ?? "";
  if (
    m.kind !== "method" || m.isStatic === true ||
    !isPublicMember(m.accessibility) || RESERVED.has(name) ||
    name.startsWith("_") || seen.has(name)
  ) return undefined;
  const fn = m.functionDef ?? m;
  const params: PyParam[] = [];
  for (const p of fn.params ?? []) {
    const param = paramOf(p, scope);
    if (param === undefined || param.configures !== undefined) return undefined;
    params.push(param);
  }
  const returns = fn.returnType;
  const returnsClass = returns?.kind === "typeRef"
    ? one(returns.value)?.typeName
    : undefined;
  const recorded = [
    JSON.stringify(name),
    ...params.map((p) => p.rest ? `*${p.name}` : p.name),
  ].join(", ");
  let annotation: string;
  let body: string;
  if (returns?.kind === "this") {
    scope.uses.self = true;
    annotation = "Self";
    body = `return self._record(${recorded})`;
  } else if (
    returnsClass !== undefined && scope.classes.has(returnsClass) &&
    returnsClass !== owner.name
  ) {
    annotation = returnsClass;
    body = `return self._switch(${returnsClass}, ${recorded})`;
  } else if (returns?.kind === "keyword" && returns.repr === "void") {
    annotation = "None";
    body = `self._record(${recorded})`;
  } else {
    return undefined;
  }
  seen.add(name);
  const [head, ...rest] = signature("self", params);
  const lines = rest.length === 0
    ? [`    def ${pythonName(name)}(${head}) -> ${annotation}:`]
    : [
      `    def ${pythonName(name)}(`,
      `        ${head}`,
      ...rest.map((l) => `        ${l}`),
      `    ) -> ${annotation}:`,
    ];
  return [
    ...lines,
    ...docstring(m.jsDoc?.doc, "        ", `\`${name}\`.`),
    `        ${body}`,
  ];
}

/** The text of one settings class. */
function renderClass(
  info: ClassInfo,
  base: string,
  scope: Scope,
): string[] {
  const lines = [
    `class ${info.name}(${base}):`,
    ...docstring(info.doc, "    ", `Settings of \`${info.name}\`.`),
  ];
  const seen = new Set<string>();
  for (const m of info.methods) {
    const setter = renderSetter(m, info, scope, seen);
    if (setter !== undefined) lines.push("", ...setter);
  }
  return lines;
}

/** The text of one task object's class. */
function renderTasks(info: TasksInfo, scope: Scope): string[] | undefined {
  const lines = [
    `class ${info.name}:`,
    ...docstring(info.doc, "    ", `The tasks of \`${info.name}\`.`),
  ];
  let any = false;
  for (const task of info.tasks) {
    const params: PyParam[] = [];
    let carried = true;
    for (const p of task.params) {
      const param = paramOf(p, scope);
      if (param === undefined) {
        carried = false;
        break;
      }
      params.push(param);
    }
    if (!carried || task.name === "") continue;
    any = true;
    const answer = pythonType(task.returnType, scope);
    const call = [
      "await call(",
      "    ctx,",
      "    PACKAGE,",
      "    VERSION,",
      `    ${JSON.stringify(info.name)},`,
      `    ${JSON.stringify(task.name)},`,
      `    [${argumentsOf(params, scope.uses)}],`,
      ")",
    ];
    const [head, ...rest] = signature("ctx: Context", params);
    const annotation = answer === "ExecResult"
      ? "ExecResult"
      : answer === "None"
      ? "None"
      : "object";
    const body = annotation === "ExecResult"
      ? [`answer = ${call[0]}`, ...call.slice(1), "return exec_result(answer)"]
      : annotation === "None"
      ? call
      : [`return ${call[0]}`, ...call.slice(1)];
    lines.push(
      "",
      "    @staticmethod",
      ...(rest.length === 0
        ? [`    async def ${pythonName(task.name)}(${head}) -> ${annotation}:`]
        : [
          `    async def ${pythonName(task.name)}(`,
          `        ${head}`,
          ...rest.map((l) => `        ${l}`),
          `    ) -> ${annotation}:`,
        ]),
      ...docstring(task.doc, "        ", `\`${task.name}\`.`),
      ...body.map((l) => `        ${l}`),
    );
  }
  return any ? lines : undefined;
}

/** The settings classes a module's tasks reach: through `Configure`, bases and kind-changing setters. */
function reachableClasses(
  tasks: readonly TasksInfo[],
  classes: ReadonlyMap<string, ClassInfo>,
): Set<string> {
  const reached = new Set<string>();
  const visit = (name: string | undefined) => {
    if (name === undefined || reached.has(name)) return;
    const info = classes.get(name);
    if (info === undefined) return;
    reached.add(name);
    visit(info.base);
    for (const m of info.methods) {
      const returns = (m.functionDef ?? m).returnType;
      if (returns?.kind === "typeRef") visit(one(returns.value)?.typeName);
    }
  };
  for (const object of tasks) {
    for (const task of object.tasks) {
      for (const p of task.params) {
        const type = p.tsType ?? p.left?.tsType;
        const value = one(type?.value);
        if (type?.kind === "typeRef" && value?.typeName === "Configure") {
          visit(one(value.typeParams?.[0]?.value)?.typeName);
        }
      }
    }
  }
  return reached;
}

/** Fill the template with a module's docstring, imports and body. */
function fill(
  template: string,
  doc: string,
  imports: string[],
  body: string[],
): string {
  return template
    .replace("__DOC__", doc)
    .replace("__IMPORTS__", imports.join("\n"))
    .replace("__BODY__", body.join("\n"))
    .replace(/\n{3,}$/, "\n");
}

/** The import lines a module's rendered types need. */
function importsFor(
  uses: Uses,
  runtime: string[],
  bases: string[],
  context: boolean,
): string[] {
  const lines: string[] = [];
  const abc = [
    ...(uses.callable ? ["Callable"] : []),
    ...(uses.mapping ? ["Mapping"] : []),
    ...(uses.sequence ? ["Sequence"] : []),
  ];
  const typing = [
    ...(uses.literal ? ["Literal"] : []),
    ...(uses.self ? ["Self"] : []),
  ];
  if (abc.length > 0) {
    lines.push(`from collections.abc import ${abc.join(", ")}`);
  }
  if (typing.length > 0) lines.push(`from typing import ${typing.join(", ")}`);
  if (lines.length > 0) lines.push("");
  const sdk = [
    ...(context ? ["Context"] : []),
    ...(uses.execResult ? ["ExecResult"] : []),
  ];
  if (sdk.length > 0) lines.push(`from zuke import ${sdk.join(", ")}`);
  lines.push(`from zuke._facade import ${runtime.join(", ")}`);
  if (bases.length > 0) {
    lines.push(`from zuke.tools.${TOOLING_MODULE} import ${bases.join(", ")}`);
  }
  return lines;
}

/** The facade of core's base settings: every class `./tooling` exports. */
export function renderTooling(tooling: DocRoot, template: string): string {
  const classes = classesOf(tooling);
  const uses: Uses = {
    callable: false,
    literal: false,
    mapping: false,
    sequence: false,
    self: false,
    execResult: false,
    settingsBase: false,
    configured: false,
  };
  const interfaces = interfacesOf(tooling);
  const scope: Scope = {
    aliases: aliasesOf(tooling),
    classes: new Set(classes.keys()),
    shapes: interfaces.shapes,
    opaque: new Set([...NOT_JSON, ...interfaces.behaviours]),
    uses,
  };
  const body: string[] = [];
  const emitted = new Set<string>();
  // The base of every wrapper's settings and what extends it; the entrypoint's
  // other classes, an error say, are no settings.
  const isSettings = (info: ClassInfo): boolean =>
    info.name === "ToolSettings" ||
    (info.base !== undefined && (classes.get(info.base)?.name !== undefined) &&
      isSettings(classes.get(info.base) ?? info));
  const emit = (info: ClassInfo) => {
    if (emitted.has(info.name) || !isSettings(info)) return;
    emitted.add(info.name);
    const base = info.base !== undefined ? classes.get(info.base) : undefined;
    if (base !== undefined) emit(base);
    body.push("", "", ...renderClass(info, base?.name ?? "Settings", scope));
  };
  for (const info of classes.values()) emit(info);
  return fill(
    template,
    "The settings every wrapper's settings extend: `@zuke/core`'s tooling base.",
    importsFor(uses, ["Settings"], [], false),
    body,
  );
}

/** The facade of one wrapper package; `undefined` when it exports no tasks. */
export function renderFacade(
  source: FacadeSource,
  template: string,
): string | undefined {
  const classes = classesOf(source.root);
  const toolingClasses = classesOf(source.tooling);
  const tasks = tasksOf(source.root);
  const reached = reachableClasses(tasks, classes);
  const uses: Uses = {
    callable: false,
    literal: false,
    mapping: false,
    sequence: false,
    self: false,
    execResult: false,
    settingsBase: false,
    configured: false,
  };
  const interfaces = interfacesOf(source.root);
  const settings = new Set([...reached, ...toolingClasses.keys()]);
  const scope: Scope = {
    aliases: aliasesOf(source.root),
    classes: settings,
    shapes: interfaces.shapes,
    opaque: new Set([
      ...NOT_JSON,
      ...interfaces.behaviours,
      ...[...classes.keys()].filter((name) => !settings.has(name)),
    ]),
    uses,
  };
  const body: string[] = [];
  const bases = new Set<string>();
  const emitted = new Set<string>();
  const emit = (info: ClassInfo) => {
    if (emitted.has(info.name)) return;
    emitted.add(info.name);
    let base = "Settings";
    const local = info.base !== undefined ? classes.get(info.base) : undefined;
    if (local !== undefined && reached.has(local.name)) {
      emit(local);
      base = local.name;
    } else if (info.base !== undefined && toolingClasses.has(info.base)) {
      bases.add(info.base);
      base = info.base;
    }
    if (base === "Settings") uses.settingsBase = true;
    body.push("", "", ...renderClass(info, base, scope));
  };
  for (const info of classes.values()) {
    if (reached.has(info.name)) emit(info);
  }
  const rendered = tasks.map((t) => renderTasks(t, scope)).filter((t) =>
    t !== undefined
  );
  if (rendered.length === 0) return undefined;
  for (const lines of rendered) body.push("", "", ...lines);
  const runtime = [
    ...(uses.settingsBase ? ["Settings"] : []),
    "call",
    ...(uses.configured ? ["configured"] : []),
    ...(uses.execResult ? ["exec_result"] : []),
  ];
  const summary = firstSentence(source.root);
  return fill(
    template,
    `\`@zuke/${source.package}\` ${source.version}${
      summary === "" ? "" : `: ${summary}`
    }`,
    [
      ...importsFor(uses, runtime, [...bases].sort(), true),
      "",
      `PACKAGE = ${JSON.stringify(source.package)}`,
      `VERSION = ${JSON.stringify(source.version)}`,
    ],
    body,
  );
}

/** The package's `__init__.py`: a docstring, nothing else. */
export function renderInit(template: string): string {
  return fill(
    template,
    "The facades over the engine's wrappers, one module per `@zuke/<package>`.",
    [],
    [],
  ).replace(/\n\n+$/, "\n");
}

/** The first sentence of a package's module doc, its lines joined. */
export function firstSentence(root: DocRoot): string {
  for (const node of Object.values(root.nodes ?? {})) {
    const doc = node.module_doc?.doc?.trim() ?? "";
    if (doc === "") continue;
    const paragraph = doc.split(/\n\s*\n/)[0] ?? "";
    const joined = paragraph.split("\n").map((l) => l.trim()).join(" ");
    const end = joined.search(/[.!?](\s|$)/);
    return end === -1 ? joined : joined.slice(0, end + 1);
  }
  return "";
}

/** The `deno doc --json` output of the given entrypoints. */
export async function docOf(paths: readonly string[]): Promise<DocRoot> {
  const { stdout } = await DenoTasks.doc((s) =>
    s.paths(...paths).json().env({ NO_COLOR: "1" }).quiet()
  );
  const root: DocRoot = JSON.parse(stdout);
  return root;
}

/** The module file a package's facade is written to. */
export function moduleOf(pkg: string): string {
  return `${pkg.replaceAll("-", "_")}.py`;
}

/**
 * Generate the facades into `out`: the package init, the base settings module
 * and one module per wrapper package that exports tasks. Answers the paths
 * written, in order.
 */
export async function generatePythonFacades(
  out: string,
  packages: readonly string[] = WRAPPER_PACKAGES,
): Promise<string[]> {
  const template = await FileTasks.readText(PYTHON_TEMPLATE);
  const tooling = await docOf([TOOLING_ENTRYPOINT]);
  await FileTasks.createDirectory(out);
  const written: string[] = [];
  const write = async (name: string, text: string) => {
    const path = `${out}/${name}`;
    await FileTasks.writeText(path, text);
    written.push(path);
  };
  await write("__init__.py", renderInit(template));
  await write(`${TOOLING_MODULE}.py`, renderTooling(tooling, template));
  for (const pkg of packages) {
    const root = await docOf(await packageEntrypoints(pkg));
    const version = await localVersion(pkg);
    const text = renderFacade(
      { package: pkg, version, root, tooling },
      template,
    );
    if (text !== undefined) await write(moduleOf(pkg), text);
  }
  return written;
}
