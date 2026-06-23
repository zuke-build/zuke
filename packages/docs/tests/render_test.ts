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
  type PackageApi,
  summarize,
  withApiBlock,
} from "../src/render.ts";
import { resolveOptions } from "../src/options.ts";

const FOO: PackageApi = {
  name: "@acme/foo",
  dir: "foo",
  summary: "does a thing",
  doc: "`@acme/foo` — does a thing.\n\nfunction go(): void",
};

Deno.test("cleanDoc strips machine paths and collapses blank runs", () => {
  const raw = [
    "`@acme/foo` — does a thing.",
    "",
    "Defined in file:///home/someone/repo/packages/foo/mod.ts:1:1",
    "",
    "",
    "",
    "function go(): void",
    "  Defined in file:///home/someone/repo/packages/foo/mod.ts:9:1",
    "",
  ].join("\n");
  const out = cleanDoc(raw);
  assertEquals(/Defined in/.test(out), false);
  assertEquals(/\n{3,}/.test(out), false);
  assertStringIncludes(out, "`@acme/foo` — does a thing.");
  assertStringIncludes(out, "function go(): void");
});

Deno.test("summarize takes the text after the em dash, without trailing dot", () => {
  assertEquals(summarize("`@acme/foo` — does a thing."), "does a thing");
});

Deno.test("summarize falls back to the whole first line without a dash", () => {
  assertEquals(
    summarize("A module with no dash.\nmore"),
    "A module with no dash",
  );
});

Deno.test("apiBlock wraps the doc in markers and a four-backtick fence", () => {
  const block = apiBlock(FOO);
  assertStringIncludes(block, API_START);
  assertStringIncludes(block, API_END);
  // four backticks so inner ```ts fences can't close it
  assertStringIncludes(block, "````text");
  assertStringIncludes(block, FOO.doc);
});

Deno.test("withApiBlock appends when there are no markers", () => {
  const out = withApiBlock("# @acme/foo\n\nIntro.\n", FOO);
  assertStringIncludes(out, "Intro.");
  assertStringIncludes(out, API_START);
  // exactly one block
  assertEquals(out.split(API_START).length - 1, 1);
});

Deno.test("withApiBlock replaces an existing block in place", () => {
  const once = withApiBlock("# @acme/foo\n\nIntro.\n", FOO);
  const twice = withApiBlock(once, { ...FOO, doc: "function go2(): void" });
  assertEquals(twice.split(API_START).length - 1, 1); // still one block
  assertStringIncludes(twice, "function go2(): void");
  assertEquals(/go\(\): void/.test(twice), false); // old doc gone
  assertStringIncludes(twice, "Intro."); // surrounding prose preserved
});

Deno.test("buildIndex renders title, blockquote, example, install, and links", () => {
  const opts = resolveOptions({
    scope: "@acme",
    full: "out/llms-full.txt",
    project: {
      title: "Acme",
      summary: "Line one.\nLine two.",
      example: "const x = 1;",
      install: "deno add jsr:@acme/cli",
    },
  });
  const index = buildIndex([FOO], opts);
  assertStringIncludes(index, "# Acme");
  assertStringIncludes(index, "> Line one.");
  assertStringIncludes(index, "> Line two.");
  assertStringIncludes(index, "## Example");
  assertStringIncludes(index, "const x = 1;");
  assertStringIncludes(index, "Scaffold/install: `deno add jsr:@acme/cli`");
  assertStringIncludes(index, "`deno doc jsr:@acme/<package>`");
  // link uses the basename of `full`, not its full path
  assertStringIncludes(index, "[llms-full.txt](./llms-full.txt)");
  assertStringIncludes(
    index,
    "[@acme/foo](https://jsr.io/@acme/foo) — does a thing",
  );
});

Deno.test("buildIndex omits the optional example and install sections", () => {
  const opts = resolveOptions({
    project: { title: "Bare", summary: "Just a summary." },
  });
  const index = buildIndex([FOO], opts);
  assertEquals(/## Example/.test(index), false);
  assertEquals(/Scaffold\/install/.test(index), false);
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
