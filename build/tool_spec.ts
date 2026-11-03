// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The tool spec (`./zuke toolSpec`): one JSON document describing every
 * wrapper's `*Tasks` object, its tasks, and the settings classes they
 * configure, read from the wrappers' own `deno doc --json` output. It is what
 * an SDK in another language generates its facades from, so no facade is
 * written by hand and none can drift from the wrapper it fronts. The schema
 * is documented in `packages/engine/spec/README.md`.
 *
 * The spec carries only what `tool.call` carries: a task or setter taking a
 * function, a host, a stream, a bigint or an instance of the package's own
 * classes is left out, and a type JSON flattens (a date, a path, a URL) is
 * spelled as what travels. Versions are not in it; a wrapper's release is whatever the
 * checkout's `deno.json` says, which release-please moves without touching
 * this file.
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
import { packageEntrypoints, PACKAGES } from "./packages.ts";

/** Where the spec is committed: published with `@zuke/engine`. */
export const TOOL_SPEC_PATH = "packages/engine/spec/tools.json";

/** The spec's schema version, bumped when a reader must change. */
export const TOOL_SPEC_VERSION = 1;

/** Core's tooling entrypoint: the base settings every wrapper's settings extend. */
export const TOOLING_ENTRYPOINT = "packages/core/src/tooling.ts";

/** Packages that wrap no tool: nothing in them is a facade's to call. */
const NOT_WRAPPERS: ReadonlySet<string> = new Set(["core", "engine", "cli"]);

/** The wrapper packages the spec describes, in publish order. */
export const WRAPPER_PACKAGES: readonly string[] = PACKAGES.filter(
  (dir) => !NOT_WRAPPERS.has(dir),
);

/** A type in the spec: what JSON carries, in the shapes a facade can declare. */
export type SpecType =
  | { readonly kind: "string" | "number" | "boolean" | "null" | "unknown" }
  | { readonly kind: "self" }
  | { readonly kind: "output" }
  | { readonly kind: "literal"; readonly value: string | number | boolean }
  | { readonly kind: "union"; readonly members: readonly SpecType[] }
  | { readonly kind: "array"; readonly element: SpecType }
  | {
    readonly kind: "record";
    readonly key: SpecType;
    readonly value: SpecType;
  }
  | { readonly kind: "object"; readonly name?: string }
  | { readonly kind: "settings"; readonly name: string }
  | { readonly kind: "configure"; readonly settings: string };

/** One parameter of a task or a setter. */
export interface SpecParam {
  readonly name: string;
  readonly type: SpecType;
  readonly optional: boolean;
  readonly rest: boolean;
}

/** One member a facade calls: a task of a task object, or a setter. */
export interface SpecMember {
  readonly name: string;
  readonly doc: string;
  readonly params: readonly SpecParam[];
  readonly returns: SpecType;
}

/** A settings class: its base, where it has one the spec also carries. */
export interface SpecSettings {
  readonly name: string;
  readonly doc: string;
  readonly extends: string | null;
  readonly setters: readonly SpecMember[];
}

/** A `*Tasks` object and its tasks. */
export interface SpecTasks {
  readonly name: string;
  readonly doc: string;
  readonly tasks: readonly SpecMember[];
}

/** One wrapper package's part of the spec. */
export interface SpecPackage {
  /** The package's name after `@zuke/`. */
  readonly name: string;
  /** The first sentence of the package's module doc. */
  readonly summary: string;
  readonly tasks: readonly SpecTasks[];
  readonly settings: readonly SpecSettings[];
}

/** The whole spec. */
export interface ToolSpec {
  readonly spec: number;
  /** Core's tooling base: the settings classes every wrapper's extend. */
  readonly tooling: readonly SpecSettings[];
  readonly packages: readonly SpecPackage[];
}

/** What the type reader resolves names against. */
interface Scope {
  /** The module's type aliases, inlined where they are referenced. */
  readonly aliases: ReadonlyMap<string, DocTsType>;
  /** The settings classes a type may name: the module's and the base module's. */
  readonly classes: ReadonlySet<string>;
  /** Interfaces of plain data, carried as an object. */
  readonly shapes: ReadonlySet<string>;
  /** Names JSON cannot carry: hosts, streams, providers, the package's other classes. */
  readonly opaque: ReadonlySet<string>;
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

/** The spec kind of each TypeScript keyword type. */
const KEYWORDS: ReadonlyMap<string, SpecType> = new Map([
  ["string", { kind: "string" }],
  ["number", { kind: "number" }],
  ["boolean", { kind: "boolean" }],
  ["void", { kind: "null" }],
  ["undefined", { kind: "null" }],
  ["null", { kind: "null" }],
]);

const UNKNOWN: SpecType = { kind: "unknown" };

/** A `value` that is one type node rather than a list of them. */
function one(
  value: DocTsType | DocTsType[] | undefined,
): DocTsType | undefined {
  return Array.isArray(value) ? undefined : value;
}

/**
 * Fold a union's members: duplicates dropped, a lone member unwrapped, and a
 * member the spec cannot name dropped beside ones it can, so a setter taking a
 * parameter object or a string is declared with the string.
 */
function unionOf(members: readonly SpecType[]): SpecType {
  const unique: SpecType[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    const key = JSON.stringify(member);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(member);
    }
  }
  const named = unique.filter((m) => m.kind !== "unknown");
  const [only] = named;
  if (only === undefined) return UNKNOWN;
  return named.length === 1 ? only : { kind: "union", members: named };
}

/** Read a `typeRef` node: the wrappers' generic shapes, aliases and classes. */
function refType(t: DocTsType, scope: Scope, depth: number): SpecType {
  const value = one(t.value);
  const name = value?.typeName ?? t.repr ?? "";
  const params = value?.typeParams ?? [];
  const inner = () => specType(params[0], scope, depth + 1);
  switch (name) {
    case "Promise":
    case "Readonly":
    case "Partial":
    case "Required":
    // No subtraction of a union's members in the spec; the whole union is close.
    case "Exclude":
    case "Extract":
      return inner();
    case "Array":
    case "ReadonlyArray":
      return { kind: "array", element: inner() };
    case "Record":
      return {
        kind: "record",
        key: inner(),
        value: specType(params[1], scope, depth + 1),
      };
    case "PathLike":
    case "AbsolutePath":
    case "URL":
    // A date travels as the ISO string JSON carries, which is what a setter
    // taking a date or a string accepts.
    case "Date":
      return { kind: "string" };
    case "CommandOutput":
      return { kind: "output" };
    case "Configure": {
      const settings = inner();
      return settings.kind === "settings"
        ? { kind: "configure", settings: settings.name }
        : UNKNOWN;
    }
    default: {
      const alias = scope.aliases.get(name);
      if (alias !== undefined) return specType(alias, scope, depth + 1);
      if (scope.shapes.has(name)) return { kind: "object", name };
      return scope.classes.has(name) ? { kind: "settings", name } : UNKNOWN;
    }
  }
}

/**
 * Read a documented type as the spec declares it: the keyword types, literal
 * unions, arrays, records, the settings lambda, and `unknown` for whatever
 * the spec cannot name.
 */
export function specType(
  t: DocTsType | undefined,
  scope: Scope,
  depth = 0,
): SpecType {
  if (t === undefined || depth > 8) return UNKNOWN;
  const value = t.value;
  switch (t.kind) {
    case "keyword":
      return KEYWORDS.get(t.repr ?? "") ?? UNKNOWN;
    case "literal": {
      const literal = one(value);
      if (literal?.string !== undefined) {
        return { kind: "literal", value: literal.string };
      }
      if (literal?.number !== undefined) {
        return { kind: "literal", value: literal.number };
      }
      if (literal?.boolean !== undefined) {
        return { kind: "literal", value: literal.boolean };
      }
      return UNKNOWN;
    }
    case "union":
      // The members JSON carries: a setter taking a parameter or a string is
      // reached with the string.
      return Array.isArray(value)
        ? unionOf(
          value.filter((m) => jsonCarries(m, scope, depth + 1)).map((m) =>
            specType(m, scope, depth + 1)
          ),
        )
        : UNKNOWN;
    case "parenthesized":
      return specType(one(value), scope, depth + 1);
    case "array":
      return { kind: "array", element: specType(one(value), scope, depth + 1) };
    case "this":
      return { kind: "self" };
    case "typeRef":
      return refType(t, scope, depth);
    default:
      return UNKNOWN;
  }
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
    // JSON has no bigint: a number would reach a setter expecting one.
    case "keyword":
      return t.repr !== "bigint";
    // A union is reached through any member JSON carries.
    case "union":
      return !Array.isArray(value) ||
        value.some((m) => jsonCarries(m, scope, depth + 1));
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

/** Read one documented parameter; `undefined` when the spec cannot carry it. */
function paramOf(p: DocParam, scope: Scope): SpecParam | undefined {
  const tsType = p.tsType ?? p.left?.tsType ?? p.arg?.tsType;
  if (!jsonCarries(tsType, scope)) return undefined;
  const name = p.arg?.name ?? p.left?.name ?? p.name ?? "arg";
  const rest = p.kind === "rest";
  const optional = p.kind === "assign" || p.optional === true ||
    p.left?.optional === true;
  // A rest parameter's documented type is the array; each element is one.
  const element = rest ? elementOf(tsType) : tsType;
  return { name, type: specType(element, scope), rest, optional };
}

/** The element type of an array, written `T[]` or `Array<T>`. */
function elementOf(t: DocTsType | undefined): DocTsType | undefined {
  return t?.kind === "array" ? one(t.value) : one(t?.value)?.typeParams?.[0];
}

/** Read every parameter, or nothing when one of them cannot be carried. */
function paramsOf(
  params: readonly DocParam[],
  scope: Scope,
): SpecParam[] | undefined {
  const out: SpecParam[] = [];
  for (const p of params) {
    const param = paramOf(p, scope);
    if (param === undefined) return undefined;
    out.push(param);
  }
  return out;
}

/** A JSDoc body as the spec carries it: links unwrapped, trimmed. */
export function docOf(doc: string | undefined): string {
  return (doc ?? "")
    .replace(
      /\{@link(?:code)?\s+([^}|]+?)(?:\s*\|\s*([^}]+))?\}/g,
      (_match, target: string, label: string | undefined) => label ?? target,
    )
    .split("\n").map((l) => l.trimEnd()).join("\n")
    .trim();
}

/** A settings class as the reader sees it. */
interface ClassInfo {
  readonly name: string;
  readonly doc: string | undefined;
  readonly base: string | undefined;
  readonly methods: readonly DocMethod[];
}

/** A task as the reader sees it, whatever shape its object was declared in. */
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
 * The interfaces a doc root declares, split into plain data, which an object
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

/**
 * An interface's methods, the ones it inherits through `extends` included:
 * `GhTasksApi` declares two of its own and takes the rest from twenty
 * interfaces it extends. The bases come first, in the order they are listed,
 * and a method the interface redeclares replaces the inherited one in place.
 */
function interfaceMethods(
  name: string,
  interfaces: ReadonlyMap<string, DocSymbol>,
  seen: Set<string>,
): DocMethod[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const def = interfaces.get(name)?.declarations?.[0]?.def;
  const bases = Array.isArray(def?.extends) ? def.extends : [];
  const methods = new Map<string, DocMethod>();
  for (const base of bases) {
    const typeName = isDocTsType(base) ? one(base.value)?.typeName : undefined;
    if (typeName === undefined) continue;
    for (const m of interfaceMethods(typeName, interfaces, seen)) {
      methods.set(m.name ?? "", m);
    }
  }
  for (const m of def?.methods ?? []) methods.set(m.name ?? "", m);
  return [...methods.values()];
}

/** Whether a `deno doc` value is a type node, as an `extends` entry is. */
function isDocTsType(value: unknown): value is DocTsType {
  return typeof value === "object" && value !== null && "kind" in value;
}

/** The tasks of a task object's type: an interface's methods, or a literal's. */
function tasksOfType(
  type: DocTsType | undefined,
  interfaces: ReadonlyMap<string, DocSymbol>,
): TaskInfo[] {
  const value = one(type?.value);
  if (type?.kind === "typeRef" && value?.typeName !== undefined) {
    return interfaceMethods(value.typeName, interfaces, new Set()).map((m) => ({
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

/** One setter as the spec carries it, or nothing when it cannot. */
function setterOf(
  m: DocMethod,
  scope: Scope,
  seen: Set<string>,
): SpecMember | undefined {
  const name = m.name ?? "";
  if (
    m.kind !== "method" || m.isStatic === true ||
    !isPublicMember(m.accessibility) || RESERVED.has(name) ||
    name.startsWith("_") || seen.has(name)
  ) return undefined;
  const fn = m.functionDef ?? m;
  // A setter is synchronous: an async method is a hook or a run, never one.
  if (one(fn.returnType?.value)?.typeName === "Promise") return undefined;
  const params = paramsOf(fn.params ?? [], scope);
  if (params === undefined) return undefined;
  const returns = specType(fn.returnType, scope);
  // A setter answers its settings, another settings class, or nothing.
  if (!["self", "settings", "null"].includes(returns.kind)) return undefined;
  seen.add(name);
  return { name, doc: docOf(m.jsDoc?.doc), params, returns };
}

/** One settings class as the spec carries it. */
function settingsOf(
  info: ClassInfo,
  base: string | null,
  scope: Scope,
): SpecSettings {
  const seen = new Set<string>();
  const setters: SpecMember[] = [];
  for (const m of info.methods) {
    const setter = setterOf(m, scope, seen);
    if (setter !== undefined) setters.push(setter);
  }
  return { name: info.name, doc: docOf(info.doc), extends: base, setters };
}

/** One task object as the spec carries it; nothing when no task is carried. */
function tasksObjectOf(info: TasksInfo, scope: Scope): SpecTasks | undefined {
  const tasks: SpecMember[] = [];
  for (const task of info.tasks) {
    const params = paramsOf(task.params, scope);
    if (params === undefined || task.name === "") continue;
    tasks.push({
      name: task.name,
      doc: docOf(task.doc),
      params,
      returns: specType(task.returnType, scope),
    });
  }
  return tasks.length === 0
    ? undefined
    : { name: info.name, doc: docOf(info.doc), tasks };
}

/** The settings classes a package's tasks reach: through a `Configure`, a task's or a setter's, bases and kind-changing setters. */
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
      const fn = m.functionDef ?? m;
      const returns = fn.returnType;
      if (returns?.kind === "typeRef") visit(one(returns.value)?.typeName);
      visitConfigured(fn.params ?? []);
    }
  };
  // The settings class each `Configure` parameter names.
  const visitConfigured = (params: readonly DocParam[]) => {
    for (const p of params) {
      const type = p.tsType ?? p.left?.tsType;
      const value = one(type?.value);
      if (type?.kind === "typeRef" && value?.typeName === "Configure") {
        visit(one(value.typeParams?.[0]?.value)?.typeName);
      }
    }
  };
  for (const object of tasks) {
    for (const task of object.tasks) visitConfigured(task.params);
  }
  return reached;
}

/** The settings classes of core's tooling base: `ToolSettings` and what extends it. */
export function toolingOf(tooling: DocRoot): SpecSettings[] {
  const classes = classesOf(tooling);
  const interfaces = interfacesOf(tooling);
  const scope: Scope = {
    aliases: aliasesOf(tooling),
    classes: new Set(classes.keys()),
    shapes: interfaces.shapes,
    opaque: new Set([...NOT_JSON, ...interfaces.behaviours]),
  };
  // The entrypoint's other classes, an error say, are no settings.
  const isSettings = (info: ClassInfo): boolean =>
    info.name === "ToolSettings" ||
    (info.base !== undefined && classes.has(info.base) &&
      isSettings(classes.get(info.base) ?? info));
  const out: SpecSettings[] = [];
  const emitted = new Set<string>();
  const emit = (info: ClassInfo) => {
    if (emitted.has(info.name) || !isSettings(info)) return;
    emitted.add(info.name);
    const base = info.base !== undefined ? classes.get(info.base) : undefined;
    if (base !== undefined) emit(base);
    out.push(settingsOf(info, base?.name ?? null, scope));
  };
  for (const info of classes.values()) emit(info);
  return out;
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

/**
 * One wrapper package's part of the spec, from its doc root and core's
 * tooling root; `undefined` when it exports no task the spec carries.
 */
export function packageOf(
  name: string,
  root: DocRoot,
  tooling: DocRoot,
): SpecPackage | undefined {
  const classes = classesOf(root);
  const toolingClasses = classesOf(tooling);
  const tasks = tasksOf(root);
  const reached = reachableClasses(tasks, classes);
  const interfaces = interfacesOf(root);
  const settings = new Set([...reached, ...toolingClasses.keys()]);
  const scope: Scope = {
    aliases: aliasesOf(root),
    classes: settings,
    shapes: interfaces.shapes,
    opaque: new Set([
      ...NOT_JSON,
      ...interfaces.behaviours,
      ...[...classes.keys()].filter((n) => !settings.has(n)),
    ]),
  };
  const carried = tasks.map((t) => tasksObjectOf(t, scope)).filter((t) =>
    t !== undefined
  );
  if (carried.length === 0) return undefined;
  const out: SpecSettings[] = [];
  const emitted = new Set<string>();
  const emit = (info: ClassInfo) => {
    if (emitted.has(info.name)) return;
    emitted.add(info.name);
    const local = info.base !== undefined ? classes.get(info.base) : undefined;
    if (local !== undefined && reached.has(local.name)) emit(local);
    const base = info.base !== undefined && settings.has(info.base)
      ? info.base
      : null;
    out.push(settingsOf(info, base, scope));
  };
  for (const info of classes.values()) {
    if (reached.has(info.name)) emit(info);
  }
  return { name, summary: firstSentence(root), tasks: carried, settings: out };
}

/** The `deno doc --json` output of the given entrypoints. */
export async function docRootOf(paths: readonly string[]): Promise<DocRoot> {
  const { stdout } = await DenoTasks.doc((s) =>
    s.paths(...paths).json().env({ NO_COLOR: "1" }).quiet()
  );
  const root: DocRoot = JSON.parse(stdout);
  return root;
}

/** The spec of every wrapper package, read from the workspace. */
export async function toolSpec(
  packages: readonly string[] = WRAPPER_PACKAGES,
): Promise<ToolSpec> {
  const tooling = await docRootOf([TOOLING_ENTRYPOINT]);
  const out: SpecPackage[] = [];
  for (const pkg of packages) {
    const root = await docRootOf(await packageEntrypoints(pkg));
    const described = packageOf(pkg, root, tooling);
    if (described !== undefined) out.push(described);
  }
  return {
    spec: TOOL_SPEC_VERSION,
    tooling: toolingOf(tooling),
    packages: out,
  };
}

/** The spec as the file carries it: indented, newline-terminated. */
export function renderToolSpec(spec: ToolSpec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

/** Write the spec to its path; answers whether the file changed. */
export async function writeToolSpec(): Promise<boolean> {
  const text = renderToolSpec(await toolSpec());
  const before = await FileTasks.exists(TOOL_SPEC_PATH)
    ? await FileTasks.readText(TOOL_SPEC_PATH)
    : undefined;
  if (before === text) return false;
  await FileTasks.writeText(TOOL_SPEC_PATH, text);
  return true;
}

/** Whether the committed spec matches the workspace; answers the stale reason. */
export async function checkToolSpec(): Promise<string | undefined> {
  const text = renderToolSpec(await toolSpec());
  if (!await FileTasks.exists(TOOL_SPEC_PATH)) {
    return `${TOOL_SPEC_PATH} is missing`;
  }
  const committed = (await FileTasks.readText(TOOL_SPEC_PATH)).replaceAll(
    "\r\n",
    "\n",
  );
  return committed === text ? undefined : `${TOOL_SPEC_PATH} is out of date`;
}
