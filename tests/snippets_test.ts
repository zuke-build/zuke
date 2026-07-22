/**
 * Unit tests for the doc-snippet type-check gate (`build/snippets.ts`): the
 * extractor is pure and fully exercised here; the checker's orchestration is
 * driven through an injected fake, and one end-to-end case runs the real
 * `deno check` against the local workspace to prove a genuinely broken example
 * (the pilot's `.array().required()`) is caught and a correct one passes.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import {
  CHECK_MARKER,
  checkSnippets,
  collectCheckedSnippets,
  extractCheckedSnippets,
  formatSnippetFailures,
  reduceTempPath,
  type SnippetChecker,
} from "../build/snippets.ts";

Deno.test("extract: a marked ts block is captured with jsr specifiers rewritten", () => {
  const md = [
    "# Title",
    "",
    CHECK_MARKER,
    "```ts",
    'import { Build } from "jsr:@zuke/core";',
    "class B extends Build {}",
    "```",
    "",
  ].join("\n");
  const snippets = extractCheckedSnippets(md, "docs/x.md");
  assertEquals(snippets.length, 1);
  assertEquals(snippets[0].file, "docs/x.md");
  assertEquals(snippets[0].line, 4); // 1-based line of the opening fence
  assertStringIncludes(snippets[0].code, 'import { Build } from "@zuke/core";');
  assertEquals(snippets[0].code.includes("jsr:@zuke/"), false);
});

Deno.test("extract: an unmarked ts block is left as prose", () => {
  const md = ["```ts", "const broken: number = 'x';", "```"].join("\n");
  assertEquals(extractCheckedSnippets(md, "docs/x.md").length, 0);
});

Deno.test("extract: a blank line between the marker and the fence is tolerated", () => {
  const md = [CHECK_MARKER, "", "", "```ts", "const a = 1;", "```"].join("\n");
  const snippets = extractCheckedSnippets(md, "docs/x.md");
  assertEquals(snippets.length, 1);
  assertEquals(snippets[0].line, 4);
  assertEquals(snippets[0].code, "const a = 1;");
});

Deno.test("extract: the marker only attaches to a ts/typescript fence", () => {
  const yaml = [CHECK_MARKER, "```yaml", "a: 1", "```"].join("\n");
  assertEquals(extractCheckedSnippets(yaml, "docs/x.md").length, 0);
  // A tsx fence is not a ts fence.
  const tsx = [CHECK_MARKER, "```tsx", "const a = 1;", "```"].join("\n");
  assertEquals(extractCheckedSnippets(tsx, "docs/x.md").length, 0);
  // The marker followed by prose (not a fence) is ignored.
  const prose = [CHECK_MARKER, "just text", "```ts", "const a = 1;", "```"]
    .join("\n");
  assertEquals(extractCheckedSnippets(prose, "docs/x.md").length, 0);
  // A `typescript` fence is accepted.
  const ts = [CHECK_MARKER, "```typescript", "const a = 1;", "```"].join("\n");
  assertEquals(extractCheckedSnippets(ts, "docs/x.md").length, 1);
});

Deno.test("extract: multiple marked blocks keep document order and line numbers", () => {
  const md = [
    CHECK_MARKER,
    "```ts",
    "const a = 1;",
    "```",
    "prose",
    CHECK_MARKER,
    "```ts",
    "const b = 2;",
    "```",
  ].join("\n");
  const snippets = extractCheckedSnippets(md, "docs/x.md");
  assertEquals(snippets.map((s) => s.line), [2, 7]);
  assertEquals(snippets.map((s) => s.code), ["const a = 1;", "const b = 2;"]);
});

Deno.test("collect: reads and aggregates marked snippets across files in order", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const a = `${dir}/a.md`;
    const b = `${dir}/b.md`;
    await Deno.writeTextFile(
      a,
      [CHECK_MARKER, "```ts", "const a = 1;", "```"].join("\n"),
    );
    await Deno.writeTextFile(
      b,
      [CHECK_MARKER, "```ts", "const b = 2;", "```"].join("\n"),
    );
    const snippets = await collectCheckedSnippets([a, b]);
    assertEquals(snippets.map((s) => s.file), [a, b]);
    assertEquals(snippets.map((s) => s.code), ["const a = 1;", "const b = 2;"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("check: no marked snippets means no work and no failures", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const md = `${dir}/x.md`;
    await Deno.writeTextFile(md, "```ts\nconst broken: number = 'x';\n```");
    let called = false;
    const spy: SnippetChecker = () => {
      called = true;
      return Promise.resolve({ ok: true, detail: "" });
    };
    assertEquals(await checkSnippets([md], spy), []);
    assertEquals(called, false); // the checker is never invoked
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("check: a failing snippet is reported with its source location, temp path reduced", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const md = `${dir}/x.md`;
    await Deno.writeTextFile(
      md,
      [CHECK_MARKER, "```ts", "const a = 1;", "```"].join("\n"),
    );
    // A fake checker that fails and echoes the snippet's `file://` URL the way
    // `deno check` does (forward slashes on every OS), so the reduction to
    // `snippet.ts` is asserted through the full orchestration.
    const fake: SnippetChecker = (path) => {
      const forward = path.replaceAll("\\", "/");
      const url = `file://${forward.startsWith("/") ? forward : `/${forward}`}`;
      return Promise.resolve({ ok: false, detail: `error at ${url}:2:1` });
    };
    const failures = await checkSnippets([md], fake);
    assertEquals(failures.length, 1);
    assertEquals(failures[0].file, md);
    assertEquals(failures[0].line, 2);
    assertEquals(failures[0].detail, "error at snippet.ts:2:1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("reduceTempPath normalises POSIX and Windows path forms to snippet.ts", () => {
  // POSIX: the forward-slash path and its file:// URL both reduce.
  assertEquals(
    reduceTempPath("at file:///t/s_0.ts:1:1 then /t/s_0.ts", "/t/s_0.ts"),
    "at snippet.ts:1:1 then snippet.ts",
  );
  // Windows: the temp path uses backslashes, but deno emits a forward-slash
  // file:// URL — both forms must still reduce.
  assertEquals(
    reduceTempPath(
      "at file:///C:/t/s_0.ts:1:1 then C:/t/s_0.ts",
      "C:\\t\\s_0.ts",
    ),
    "at snippet.ts:1:1 then snippet.ts",
  );
});

Deno.test("format: renders every failure by source location above its detail", () => {
  const message = formatSnippetFailures([
    { file: "docs/x.md", line: 12, detail: "TS2684 boom" },
    { file: "skills/y.md", line: 3, detail: "TS2322 nope" },
  ]);
  assertStringIncludes(message, "2 marked doc snippet(s) failed");
  assertStringIncludes(message, "docs/x.md:12");
  assertStringIncludes(message, "    TS2684 boom");
  assertStringIncludes(message, "skills/y.md:3");
  assertStringIncludes(message, "<!-- check -->");
});

Deno.test("check (real deno): the pilot's wrong order fails, the correct order passes", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const md = `${dir}/params.md`;
    await Deno.writeTextFile(
      md,
      [
        CHECK_MARKER,
        "```ts",
        'import { Build, parameter, run } from "jsr:@zuke/core";',
        "class Good extends Build {",
        '  repos = parameter("r").required().array();',
        "}",
        "await run(Good);",
        "```",
        "",
        CHECK_MARKER,
        "```ts",
        'import { Build, parameter, run } from "jsr:@zuke/core";',
        "class Bad extends Build {",
        '  repos = parameter("r").array().required();',
        "}",
        "await run(Bad);",
        "```",
      ].join("\n"),
    );
    const failures = await checkSnippets([md]); // real deno check
    assertEquals(failures.length, 1); // only the wrong-order block fails
    assertEquals(failures[0].file, md);
    assertEquals(failures[0].line, 11); // the second (Bad) block's fence line
    assertStringIncludes(failures[0].detail, "snippet.ts"); // temp path reduced
    assertEquals(failures[0].detail.includes(dir), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
