import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  API_END,
  API_START,
  apiBlock,
  buildIndex,
  buildReference,
  cleanDoc,
  type DocEntry,
  summarize,
  withApiBlock,
} from "../src/render.ts";
import { resolveOptions } from "../src/options.ts";

const FOO: DocEntry = {
  name: "@acme/foo",
  dir: "foo",
  summary: "does a thing",
  doc: "`@acme/foo` — does a thing.\n\nfunction go(): void",
};

Deno.test("cleanDoc strips machine paths, trailing space, and blank runs", () => {
  const raw = [
    "`@acme/foo` — does a thing.   ",
    "",
    "Defined in file:///home/someone/repo/packages/foo/mod.ts:1:1",
    "",
    "",
    "",
    "function go(): void\t",
    "  Defined in file:///home/someone/repo/packages/foo/mod.ts:9:1",
    "",
  ].join("\n");
  const out = cleanDoc(raw);
  assertEquals(/Defined in/.test(out), false);
  assertEquals(/\n{3,}/.test(out), false);
  assertEquals(/[ \t]+\n/.test(out + "\n"), false); // no trailing whitespace
  assertStringIncludes(out, "`@acme/foo` — does a thing.");
  assertStringIncludes(out, "function go(): void");
});

Deno.test("cleanDoc strips deno doc multi-file file:// headers and reference lines", () => {
  // `deno doc a.ts b.ts` (a multi-entrypoint package) emits bare `file://`
  // section headers and `reference X: file://` re-export pointers, both with an
  // absolute checkout path. Neither is a `Defined in` line, so both must be
  // dropped explicitly or they leak the path and drift apiDocsCheck per machine.
  const raw = [
    "file:///Users/someone/work/zuke/packages/core/mod.ts",
    "`@zuke/core` — the core.",
    "",
    "reference Style: file:///Users/someone/work/zuke/packages/core/src/render.ts:41:1",
    "file:///Users/someone/work/zuke/packages/core/src/shell.ts",
    "class Command",
  ].join("\n");
  const out = cleanDoc(raw);
  assertEquals(/file:\/\//.test(out), false);
  assertEquals(/reference Style/.test(out), false);
  assertStringIncludes(out, "`@zuke/core` — the core.");
  assertStringIncludes(out, "class Command");
  // The summary is the real description, not the leading path header.
  assertEquals(summarize(out), "the core");
});

Deno.test("summarize takes the text after the em dash, without trailing dot", () => {
  assertEquals(summarize("`@acme/foo` — does a thing."), "does a thing");
});

Deno.test("summarize returns empty string for blank doc text", () => {
  assertEquals(summarize("\n\n"), "");
});

Deno.test("summarize falls back to the whole first line without a dash", () => {
  assertEquals(
    summarize("A module with no dash.\nmore"),
    "A module with no dash",
  );
});

Deno.test("apiBlock wraps the doc in markers and a four-backtick fence", () => {
  const block = apiBlock(FOO.doc);
  assertStringIncludes(block, API_START);
  assertStringIncludes(block, API_END);
  assertStringIncludes(block, "````text"); // four backticks
  assertStringIncludes(block, FOO.doc);
});

Deno.test("withApiBlock appends when there are no markers", () => {
  const out = withApiBlock("# @acme/foo\n\nIntro.\n", FOO.doc);
  assertStringIncludes(out, "Intro.");
  assertStringIncludes(out, API_START);
  assertEquals(out.split(API_START).length - 1, 1); // exactly one block
});

Deno.test("withApiBlock replaces an existing block in place", () => {
  const once = withApiBlock("# @acme/foo\n\nIntro.\n", FOO.doc);
  const twice = withApiBlock(once, "function go2(): void");
  assertEquals(twice.split(API_START).length - 1, 1); // still one block
  assertStringIncludes(twice, "function go2(): void");
  assertEquals(/go\(\): void/.test(twice), false); // old doc gone
  assertStringIncludes(twice, "Intro."); // surrounding prose preserved
});

Deno.test("buildIndex renders title, blockquote, example, install, guidance, links", () => {
  const opts = resolveOptions({
    full: "out/llms-full.txt",
    project: {
      title: "Acme",
      summary: "Line one.\nLine two.",
      example: "const x = 1;",
      install: "deno add jsr:@acme/cli",
      guidance: ["A single package: `deno doc jsr:@acme/<package>`"],
      cli: "Run `acme <target>`.",
    },
  });
  const index = buildIndex([FOO], opts);
  assertStringIncludes(index, "# Acme");
  assertStringIncludes(index, "> Line one.");
  assertStringIncludes(index, "> Line two.");
  assertStringIncludes(index, "## Example");
  assertStringIncludes(index, "const x = 1;");
  assertStringIncludes(index, "## CLI");
  assertStringIncludes(index, "Run `acme <target>`.");
  assertStringIncludes(index, "Scaffold/install: `deno add jsr:@acme/cli`");
  assertStringIncludes(
    index,
    "- A single package: `deno doc jsr:@acme/<package>`",
  );
  // link uses the basename of `full`, not its full path
  assertStringIncludes(index, "[llms-full.txt](./llms-full.txt)");
  assertStringIncludes(
    index,
    "[@acme/foo](https://jsr.io/@acme/foo) — does a thing",
  );
});

Deno.test("buildIndex omits the optional example, install, and guidance", () => {
  const opts = resolveOptions({
    project: { title: "Bare", summary: "Just a summary." },
  });
  const index = buildIndex([FOO], opts);
  assertEquals(/## Example/.test(index), false);
  assertEquals(/Scaffold\/install/.test(index), false);
  assertEquals(/## CLI/.test(index), false);
});

Deno.test("buildReference renders the header and one section per package", () => {
  const opts = resolveOptions({
    project: { title: "Acme", summary: "x" },
    regenerateCommand: "./build docs",
  });
  const ref = buildReference([FOO], opts);
  assertStringIncludes(ref, "# Acme — full API reference");
  assertStringIncludes(ref, "Regenerate with `./build docs`.");
  assertStringIncludes(ref, "# @acme/foo");
  assertStringIncludes(ref, FOO.doc);
  assertStringIncludes(ref, "=".repeat(72));
});
