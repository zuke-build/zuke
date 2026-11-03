// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the Python facade generator (`build/python_facades.ts`): the name
 * and type mappings are checked directly; the two fixture wrappers, of
 * different shapes, render to their committed golden facades; the base module
 * carries core's public setters and not its reserved members; and the
 * generator writes a package's modules where it is told to.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { withTemp } from "../packages/core/tests/_temp.ts";
import type { DocTsType } from "../build/api_reference.ts";
import { localVersion } from "../build/packages.ts";
import {
  docOf,
  firstSentence,
  generatePythonFacades,
  moduleOf,
  PYTHON_TEMPLATE,
  pythonName,
  pythonType,
  renderFacade,
  renderTooling,
  snakeCase,
  TOOLING_ENTRYPOINT,
} from "../build/python_facades.ts";

const FIXTURES = "tests/fixtures/python_facades";

/** A committed golden file, with the line endings a Windows checkout may add removed. */
async function golden(name: string): Promise<string> {
  const text = await Deno.readTextFile(`${FIXTURES}/${name}`);
  return text.replaceAll("\r\n", "\n");
}

/** A fresh use tracker, every flag off. */
function uses() {
  return {
    callable: false,
    literal: false,
    mapping: false,
    sequence: false,
    self: false,
    execResult: false,
    settingsBase: false,
    configured: false,
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

Deno.test("snakeCase and pythonName: camel case to snake case, a keyword suffixed", () => {
  assertEquals(snakeCase("noThrow"), "no_throw");
  assertEquals(snakeCase("allowFFI"), "allow_ffi");
  assertEquals(snakeCase("maxCapturedBytes"), "max_captured_bytes");
  assertEquals(snakeCase("verbose"), "verbose");
  assertEquals(pythonName("pass"), "pass_");
  assertEquals(pythonName("import"), "import_");
  assertEquals(pythonName("toolPath"), "tool_path");
});

Deno.test("pythonType: keywords, literal unions, lists, records, aliases and the generics", () => {
  const tracked = uses();
  const scope = {
    aliases: new Map([["Ext", {
      kind: "union",
      value: [literal("ts"), literal("js")],
    }]]),
    classes: new Set(["Tuning"]),
    shapes: new Set(["Options"]),
    opaque: new Set(["AbortSignal"]),
    uses: tracked,
  };
  assertEquals(pythonType(keyword("string"), scope), "str");
  assertEquals(pythonType(keyword("number"), scope), "float");
  assertEquals(pythonType(keyword("boolean"), scope), "bool");
  assertEquals(pythonType(keyword("void"), scope), "None");
  assertEquals(pythonType(undefined, scope), "object");
  assertEquals(
    pythonType(
      {
        kind: "union",
        value: [literal("a"), literal("b"), keyword("undefined")],
      },
      scope,
    ),
    'Literal["a", "b"] | None',
  );
  assertEquals(
    pythonType(
      { kind: "union", value: [keyword("string"), keyword("number")] },
      scope,
    ),
    "str | float",
  );
  assertEquals(
    pythonType({ kind: "array", value: keyword("string") }, scope),
    "Sequence[str]",
  );
  assertEquals(
    pythonType(ref("Record", keyword("string"), keyword("string")), scope),
    "Mapping[str, str]",
  );
  assertEquals(
    pythonType(ref("Promise", ref("CommandOutput")), scope),
    "ExecResult",
  );
  assertEquals(
    pythonType(ref("Configure", ref("Tuning")), scope),
    "Callable[[Tuning], Tuning]",
  );
  assertEquals(pythonType(ref("Ext"), scope), 'Literal["ts", "js"]');
  assertEquals(pythonType(ref("PathLike"), scope), "str");
  assertEquals(pythonType(ref("Somewhere"), scope), "object");
  assertEquals(pythonType(ref("Options"), scope), "Mapping[str, object]");
  assertEquals(pythonType(ref("Date"), scope), "str");
  assertEquals(
    pythonType(ref("Exclude", ref("Ext"), literal("js")), scope),
    'Literal["ts", "js"]',
  );
  assertEquals(pythonType({ kind: "fnOrConstructor" }, scope), "object");
  assertEquals(pythonType({ kind: "this", repr: "this" }, scope), "Self");
  assertEquals(tracked, {
    callable: true,
    literal: true,
    mapping: true,
    sequence: true,
    self: true,
    execResult: true,
    settingsBase: false,
    configured: false,
  });
});

Deno.test("the fixture wrappers render their golden facades", async () => {
  const template = await Deno.readTextFile(PYTHON_TEMPLATE);
  const tooling = await docOf([TOOLING_ENTRYPOINT]);
  for (const name of ["widget", "tally"]) {
    const root = await docOf([`${FIXTURES}/${name}.ts`]);
    assertEquals(
      renderFacade(
        { package: name, version: "0.1.0", root, tooling },
        template,
      ),
      await golden(`${name}.py`),
      name,
    );
  }
});

Deno.test("a package that exports no task object renders no facade", async () => {
  const template = await Deno.readTextFile(PYTHON_TEMPLATE);
  const empty = { version: 2, nodes: {} };
  assertEquals(
    renderFacade({
      package: "x",
      version: "1.0.0",
      root: empty,
      tooling: empty,
    }, template),
    undefined,
  );
});

Deno.test("firstSentence joins the module doc's first paragraph up to its first sentence end", async () => {
  const root = await docOf([`${FIXTURES}/widget.ts`]);
  const sentence = firstSentence(root);
  assertStringIncludes(sentence, "A command wrapper of every shape");
  assertEquals(sentence.endsWith("through an interface."), true, sentence);
  assertEquals(sentence.includes("\n"), false);
  assertEquals(firstSentence({ version: 2, nodes: {} }), "");
});

Deno.test("renderTooling carries the base settings' public setters and not the reserved members", async () => {
  const text = renderTooling(
    await docOf([TOOLING_ENTRYPOINT]),
    await Deno.readTextFile(PYTHON_TEMPLATE),
  );
  assertStringIncludes(text, "class ToolSettings(Settings):");
  assertStringIncludes(text, "class DynamicToolSettings(ToolSettings):");
  assertStringIncludes(text, "    def env(");
  assertStringIncludes(text, "record: Mapping[str, str],");
  assertStringIncludes(text, "    def no_throw(self) -> Self:");
  assertEquals(text.includes("def run("), false);
  assertEquals(text.includes("def build_args("), false);
  assertEquals(text.includes("ToolNotFoundError"), false);
});

Deno.test("generatePythonFacades writes the init, the base module and a package's module", async () => {
  await withTemp(async (dir) => {
    const written = await generatePythonFacades(dir, ["deno"]);
    assertEquals(
      written.map((path) => path.slice(dir.length + 1)),
      ["__init__.py", "_tooling.py", "deno.py"],
    );
    const facade = await Deno.readTextFile(`${dir}/deno.py`);
    assertStringIncludes(facade, "class DenoTasks:");
    assertStringIncludes(facade, "    async def eval(");
    assertStringIncludes(facade, `VERSION = "${await localVersion("deno")}"`);
    assertStringIncludes(facade, "from zuke.tools._tooling import");
  });
  assertEquals(moduleOf("docker-compose"), "docker_compose.py");
});
