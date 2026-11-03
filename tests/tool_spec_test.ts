// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the tool spec (`build/tool_spec.ts`): the type reader is checked
 * directly; the two fixture wrappers, of different shapes, read to their
 * committed golden parts; the tooling base carries core's public setters and
 * not its reserved members; and the workspace spec reads the real packages.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import type { DocTsType } from "../build/api_reference.ts";
import {
  docOf,
  docRootOf,
  firstSentence,
  packageOf,
  renderToolSpec,
  type SpecType,
  specType,
  TOOL_SPEC_VERSION,
  TOOLING_ENTRYPOINT,
  toolingOf,
  toolSpec,
} from "../build/tool_spec.ts";

const FIXTURES = "tests/fixtures/tool_spec";

/** Fail with `message` unless `condition` holds. */
function assert(condition: boolean, message = "assertion failed"): void {
  if (!condition) throw new Error(message);
}

/** A committed golden part, parsed, so line endings cannot matter. */
async function golden(name: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(`${FIXTURES}/${name}.json`));
}

/** A scope naming one settings class, one data shape and one alias. */
function scope() {
  return {
    aliases: new Map<string, DocTsType>([["Kind", literal("fast")]]),
    classes: new Set(["BuildSettings"]),
    shapes: new Set(["Options"]),
    opaque: new Set(["Host"]),
  };
}

/** A keyword type node, as `deno doc` emits it. */
function keyword(repr: string): DocTsType {
  return { kind: "keyword", repr };
}

/** A string literal type node. */
function literal(string: string): DocTsType {
  return { kind: "literal", repr: string, value: { kind: "string", string } };
}

/** A type reference node with its type arguments. */
function ref(typeName: string, ...typeParams: DocTsType[]): DocTsType {
  return { kind: "typeRef", repr: typeName, value: { typeName, typeParams } };
}

Deno.test("specType: keywords, literals, unions, arrays, records and references", () => {
  const s = scope();
  const cases: [DocTsType, SpecType][] = [
    [keyword("string"), { kind: "string" }],
    [keyword("bigint"), { kind: "number" }],
    [keyword("void"), { kind: "null" }],
    [keyword("object"), { kind: "unknown" }],
    [literal("x"), { kind: "literal", value: "x" }],
    [{ kind: "literal", value: { kind: "number", number: 2 } }, {
      kind: "literal",
      value: 2,
    }],
    [{ kind: "literal", value: { kind: "boolean", boolean: true } }, {
      kind: "literal",
      value: true,
    }],
    [{ kind: "literal", value: { kind: "bigint" } }, { kind: "unknown" }],
    [{ kind: "union", value: [keyword("string"), keyword("string")] }, {
      kind: "string",
    }],
    [{ kind: "union", value: [literal("a"), keyword("undefined")] }, {
      kind: "union",
      members: [{ kind: "literal", value: "a" }, { kind: "null" }],
    }],
    [{ kind: "union", value: [keyword("string"), keyword("object")] }, {
      kind: "unknown",
    }],
    [{ kind: "union", value: undefined }, { kind: "unknown" }],
    [{ kind: "parenthesized", value: keyword("boolean") }, {
      kind: "boolean",
    }],
    [{ kind: "array", value: keyword("number") }, {
      kind: "array",
      element: { kind: "number" },
    }],
    [{ kind: "this" }, { kind: "self" }],
    [ref("Promise", keyword("void")), { kind: "null" }],
    [ref("Readonly", ref("Array", keyword("string"))), {
      kind: "array",
      element: { kind: "string" },
    }],
    [ref("Exclude", ref("Kind"), literal("slow")), {
      kind: "literal",
      value: "fast",
    }],
    [ref("Record", keyword("string"), keyword("number")), {
      kind: "record",
      key: { kind: "string" },
      value: { kind: "number" },
    }],
    [ref("Date"), { kind: "string" }],
    [ref("URL"), { kind: "string" }],
    [ref("CommandOutput"), { kind: "output" }],
    [ref("Configure", ref("BuildSettings")), {
      kind: "configure",
      settings: "BuildSettings",
    }],
    [ref("Configure", ref("Host")), { kind: "unknown" }],
    [ref("Options"), { kind: "object", name: "Options" }],
    [ref("BuildSettings"), { kind: "settings", name: "BuildSettings" }],
    [ref("Host"), { kind: "unknown" }],
    [{ kind: "fnOrConstructor" }, { kind: "unknown" }],
  ];
  for (const [input, expected] of cases) {
    assertEquals(specType(input, s), expected, JSON.stringify(input));
  }
  assertEquals(specType(undefined, s), { kind: "unknown" });
});

Deno.test("docOf: links unwrapped, trailing space and blank ends trimmed", () => {
  assertEquals(
    docOf("See {@link Foo | the foo} and {@linkcode Bar}.  \n\n"),
    "See the foo and Bar.",
  );
  assertEquals(docOf(undefined), "");
});

Deno.test("packageOf: the fixture wrappers read to their golden parts", async () => {
  const tooling = await docRootOf([TOOLING_ENTRYPOINT]);
  for (const name of ["widget", "tally"]) {
    const root = await docRootOf([`${FIXTURES}/${name}.ts`]);
    assertEquals(packageOf(name, root, tooling), await golden(name), name);
  }
});

Deno.test("packageOf: a root without tasks is no part of the spec", async () => {
  const tooling = await docRootOf([TOOLING_ENTRYPOINT]);
  assertEquals(
    packageOf("empty", { version: 1, nodes: {} }, tooling),
    undefined,
  );
  assertEquals(firstSentence({ version: 1, nodes: {} }), "");
});

Deno.test("toolingOf: the base settings, their public setters, no reserved member", async () => {
  const tooling = toolingOf(await docRootOf([TOOLING_ENTRYPOINT]));
  const names = tooling.map((s) => s.name);
  assert(names.includes("ToolSettings"), names.join(","));
  assert(names.includes("DynamicToolSettings"), names.join(","));
  assert(!names.includes("ToolNotFoundError"), names.join(","));
  const base = tooling.find((s) => s.name === "ToolSettings");
  if (base === undefined) throw new Error("ToolSettings is not in the spec");
  assertEquals(base.extends, null);
  const setters = base.setters.map((s) => s.name);
  for (const name of ["env", "cwd", "noThrow", "toolPath"]) {
    assert(setters.includes(name), setters.join(","));
  }
  for (const name of ["run", "buildArgs", "onOutput", "markSecret"]) {
    assert(!setters.includes(name), setters.join(","));
  }
  const env = base.setters.find((s) => s.name === "env");
  assertEquals(env?.params[0]?.type, {
    kind: "record",
    key: { kind: "string" },
    value: { kind: "string" },
  });
  assertEquals(env?.returns, { kind: "self" });
});

Deno.test("toolSpec: the workspace's wrappers, rendered as the committed file is", async () => {
  const spec = await toolSpec(["deno", "docker"]);
  assertEquals(spec.spec, TOOL_SPEC_VERSION);
  assertEquals(spec.packages.map((p) => p.name), ["deno", "docker"]);
  const deno = spec.packages[0];
  if (deno === undefined) throw new Error("deno is not in the spec");
  assert(deno.summary !== "");
  const tasks = deno.tasks.find((t) => t.name === "DenoTasks");
  if (tasks === undefined) throw new Error("DenoTasks is not in the spec");
  assert(tasks.tasks.some((t) => t.name === "eval"));
  const text = renderToolSpec(spec);
  assert(text.endsWith("}\n"));
  assertEquals(JSON.parse(text), spec);
});
