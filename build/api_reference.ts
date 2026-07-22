// ---------------------------------------------------------------------------
// api.json — structured API reference for the website (`./zuke apiReference`).
//
// Consumes `deno doc --json` (v2) and reshapes it into the website's stable
// `api.json` contract. The `deno doc` JSON schema is large; the interfaces
// below cover only the subset we read, so the code stays `any`/`as`-free.
// ---------------------------------------------------------------------------

import { FileTasks } from "@zuke/core";
import { DenoTasks } from "@zuke/deno";
import { localVersion, packageEntrypoints, PACKAGES } from "./packages.ts";

/**
 * A `deno doc --json` type node — the subset we render. `value` holds the
 * kind-specific payload: for `typeRef` it is the `{ typeName, typeParams }`
 * object (its own `typeName`/`typeParams` fields), for `array` it is the
 * element type, and for `union`/`intersection` it is the member list.
 */
interface DocTsType {
  kind?: string;
  repr?: string;
  value?: DocTsType | DocTsType[];
  typeName?: string;
  typeParams?: DocTsType[];
}

/**
 * A function/method parameter. `identifier` carries `name`/`tsType` directly;
 * `rest` carries the name under `arg` (and the array type at top level);
 * `assign` (a defaulted param) carries name/type under `left` and is optional.
 */
interface DocParam {
  kind?: string;
  name?: string;
  optional?: boolean;
  tsType?: DocTsType;
  left?: { name?: string; optional?: boolean; tsType?: DocTsType };
  arg?: { name?: string; tsType?: DocTsType };
}

/** The callable shape shared by function defs and (class) method defs. */
interface DocFunctionDef {
  params?: DocParam[];
  returnType?: DocTsType;
  isAsync?: boolean;
}

/**
 * A class or interface method. Class methods nest their signature under
 * `functionDef`; interface methods carry `params`/`returnType` at the top
 * level — hence both are declared optional here and read with a fallback.
 */
interface DocMethod {
  name?: string;
  kind?: string;
  optional?: boolean;
  accessibility?: string;
  jsDoc?: DocJsDoc;
  functionDef?: DocFunctionDef;
  params?: DocParam[];
  returnType?: DocTsType;
}

/** A class or interface property. */
interface DocProperty {
  name?: string;
  optional?: boolean;
  accessibility?: string;
  jsDoc?: DocJsDoc;
  tsType?: DocTsType;
}

/**
 * The `def` object of a declaration — a union of the per-kind fields (each
 * field is present only for the relevant kind). `extends` is `unknown` because it may
 * be a string or a type node; it is narrowed with `typeof` at the use site.
 */
interface DocDef {
  params?: DocParam[];
  returnType?: DocTsType;
  isAsync?: boolean;
  tsType?: DocTsType;
  extends?: unknown;
  methods?: DocMethod[];
  properties?: DocProperty[];
}

/** A JSDoc block: its markdown body plus any structured tags. */
interface DocJsDoc {
  doc?: string;
  tags?: { kind?: string }[];
}

/** One declaration of a symbol (a function may have several — overloads). */
interface DocDeclaration {
  kind?: string;
  jsDoc?: DocJsDoc;
  def?: DocDef;
}

/** A documented symbol and its declaration(s). */
interface DocSymbol {
  name: string;
  declarations?: DocDeclaration[];
}

/** A documented module (one entrypoint file). */
interface DocNode {
  module_doc?: { doc?: string };
  symbols?: DocSymbol[];
}

/** The root of `deno doc --json` output (schema v2). */
interface DocRoot {
  version?: number;
  nodes?: Record<string, DocNode>;
}

/** A class/interface member as rendered into `api.json`. */
interface ApiMember {
  name: string;
  kind: "method" | "property";
  optional: boolean;
  signature: string;
  doc: string;
}

/** A single symbol entry in `api.json`. */
interface ApiSymbol {
  name: string;
  kind: string;
  doc: string;
  signature: string;
  deprecated: boolean;
  members?: ApiMember[];
}

/** One package's entry in `api.json`. */
interface ApiPackage {
  name: string;
  dir: string;
  summary: string;
  symbols: ApiSymbol[];
}

/** The full `api.json` document (schema version 1). */
interface ApiReference {
  version: number;
  generated: string;
  packages: ApiPackage[];
}

/**
 * Render a `deno doc` type node to a one-line TS type string. Recurses into
 * `typeRef` type arguments — the `repr` string drops them, so a bare
 * `Promise`/`Array` would otherwise lose its `<T>`. Everything exotic falls
 * back to the pre-rendered `repr` (safe), then to `"unknown"`.
 */
function renderType(t: DocTsType | undefined): string {
  if (t === undefined) return "unknown";
  const value = t.value;
  if (
    t.kind === "typeRef" && value !== undefined && !Array.isArray(value) &&
    value.typeName !== undefined
  ) {
    const params = value.typeParams;
    return params !== undefined && params.length > 0
      ? `${value.typeName}<${params.map(renderType).join(", ")}>`
      : value.typeName;
  }
  if (t.kind === "array" && value !== undefined && !Array.isArray(value)) {
    return `${renderType(value)}[]`;
  }
  if (
    (t.kind === "union" || t.kind === "intersection") && Array.isArray(value)
  ) {
    return value.map(renderType).join(t.kind === "union" ? " | " : " & ");
  }
  return t.repr !== undefined && t.repr.length > 0 ? t.repr : "unknown";
}

/** Render one parameter as `name: Type` (with `...`/`?` as appropriate). */
function renderParam(p: DocParam): string {
  if (p.kind === "rest") {
    return `...${p.arg?.name ?? "args"}: ${renderType(p.tsType)}`;
  }
  if (p.kind === "assign") {
    return `${p.left?.name ?? "arg"}?: ${renderType(p.left?.tsType)}`;
  }
  const name = p.name ?? p.left?.name ?? "arg";
  const optional = p.optional === true ? "?" : "";
  return `${name}${optional}: ${renderType(p.tsType ?? p.left?.tsType)}`;
}

/** `[async ]function name(params): Return` for one function declaration. */
function functionSignature(name: string, def: DocDef | undefined): string {
  const params = (def?.params ?? []).map(renderParam).join(", ");
  const prefix = def?.isAsync === true ? "async " : "";
  return `${prefix}function ${name}(${params}): ${renderType(def?.returnType)}`;
}

/** Build the one-line signature for a symbol from its declaration(s). */
function symbolSignature(
  name: string,
  kind: string,
  decls: DocDeclaration[],
): string {
  if (kind === "function") {
    // Overloads: one line per declaration, joined with newlines.
    const sigs = decls
      .filter((d) => d.kind === "function")
      .map((d) => functionSignature(name, d.def));
    return sigs.length > 0 ? sigs.join("\n") : `function ${name}()`;
  }
  const def = decls[0]?.def;
  switch (kind) {
    case "variable":
      return `const ${name}: ${renderType(def?.tsType)}`;
    case "typeAlias":
      return `type ${name} = ${renderType(def?.tsType)}`;
    case "class": {
      const base = def?.extends;
      const clause = typeof base === "string" ? ` extends ${base}` : "";
      return `class ${name}${clause}`;
    }
    case "interface":
      return `interface ${name}`;
    case "enum":
      return `enum ${name}`;
    case "namespace":
      return `namespace ${name}`;
    default:
      return name;
  }
}

/** A member is public unless explicitly `private`/`protected`. */
function isPublicMember(accessibility: string | undefined): boolean {
  return accessibility === undefined || accessibility === "public";
}

/** Render a method member as `name(params): Return`. */
function memberMethod(m: DocMethod): ApiMember {
  // Class methods nest under `functionDef`; interface methods are flat.
  const fn = m.functionDef ?? m;
  const params = (fn.params ?? []).map(renderParam).join(", ");
  const optional = m.optional === true;
  const name = m.name ?? "";
  return {
    name,
    kind: "method",
    optional,
    signature: `${name}${optional ? "?" : ""}(${params}): ${
      renderType(fn.returnType)
    }`,
    doc: m.jsDoc?.doc ?? "",
  };
}

/** Render a property member as `name: Type`. */
function memberProperty(p: DocProperty): ApiMember {
  const optional = p.optional === true;
  const name = p.name ?? "";
  return {
    name,
    kind: "property",
    optional,
    signature: `${name}${optional ? "?" : ""}: ${renderType(p.tsType)}`,
    doc: p.jsDoc?.doc ?? "",
  };
}

/** Public methods then properties of a class/interface def. */
function symbolMembers(def: DocDef | undefined): ApiMember[] {
  const members: ApiMember[] = [];
  for (const m of def?.methods ?? []) {
    if (isPublicMember(m.accessibility)) members.push(memberMethod(m));
  }
  for (const p of def?.properties ?? []) {
    if (isPublicMember(p.accessibility)) members.push(memberProperty(p));
  }
  return members;
}

/** Reshape one documented symbol into its `api.json` entry. */
function buildSymbol(sym: DocSymbol): ApiSymbol {
  const decls = sym.declarations ?? [];
  const first = decls[0];
  const kind = first?.kind ?? "variable";
  const symbol: ApiSymbol = {
    name: sym.name,
    kind,
    doc: first?.jsDoc?.doc ?? "",
    signature: symbolSignature(sym.name, kind, decls),
    deprecated: decls.some(
      (d) => d.jsDoc?.tags?.some((t) => t.kind === "deprecated") ?? false,
    ),
  };
  if (kind === "class" || kind === "interface") {
    symbol.members = symbolMembers(first?.def);
  }
  return symbol;
}

/** The package summary: the first non-empty line of any module doc. */
function moduleSummary(nodes: DocNode[]): string {
  for (const node of nodes) {
    const doc = node.module_doc?.doc;
    if (doc !== undefined && doc.trim() !== "") {
      return doc.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
    }
  }
  return "";
}

/** Reshape a package's whole `deno doc --json` output into `api.json` form. */
function transformPackage(dir: string, root: DocRoot): ApiPackage {
  const nodes = Object.values(root.nodes ?? {});
  // Aggregate symbols across every entrypoint, first-seen wins (a re-export
  // can surface the same symbol from more than one entrypoint file).
  const byName = new Map<string, DocSymbol>();
  for (const node of nodes) {
    for (const sym of node.symbols ?? []) {
      if ((sym.declarations?.length ?? 0) === 0) continue;
      if (!byName.has(sym.name)) byName.set(sym.name, sym);
    }
  }
  const symbols = [...byName.values()]
    .map(buildSymbol)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { name: `@zuke/${dir}`, dir, summary: moduleSummary(nodes), symbols };
}

/**
 * Run `deno doc --json` on every package's entrypoints and reshape the output
 * into the website's `api.json` package list. `JSON.parse` yields the doc
 * schema (typed via {@link DocRoot}), narrowed defensively downstream.
 */
async function collectApiJson(): Promise<ApiPackage[]> {
  const packages: ApiPackage[] = [];
  for (const dir of PACKAGES) {
    const entrypoints = await packageEntrypoints(dir);
    const { stdout } = await DenoTasks.doc((s) =>
      s.paths(...entrypoints).json().env({ NO_COLOR: "1" }).quiet()
    );
    const root: DocRoot = JSON.parse(stdout);
    packages.push(transformPackage(dir, root));
  }
  return packages;
}

/**
 * Assemble the full `api.json` document. `generated` is the headline
 * `core@<version>` (read from `packages/core/deno.json`) rather than a
 * timestamp, so re-runs produce byte-stable diffs.
 */
async function buildApiReference(): Promise<ApiReference> {
  return {
    version: 1,
    generated: `core@${await localVersion("core")}`,
    packages: await collectApiJson(),
  };
}

/** Write the generated `api.json` to `dist/api.json`, returning the document. */
export async function writeApiJson(): Promise<ApiReference> {
  const reference = await buildApiReference();
  await FileTasks.createDirectory("dist");
  await FileTasks.writeText(
    "dist/api.json",
    `${JSON.stringify(reference, null, 2)}\n`,
  );
  return reference;
}
