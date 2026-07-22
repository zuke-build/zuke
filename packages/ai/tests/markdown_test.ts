import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { codeSpan, fenceMarkdown } from "../src/markdown.ts";

Deno.test("fenceMarkdown wraps plain content in a three-backtick fence", () => {
  assertEquals(fenceMarkdown("hello"), "```\nhello\n```");
  assertEquals(fenceMarkdown("x", "diff"), "```diff\nx\n```");
});

Deno.test("fenceMarkdown outgrows any backtick run so content cannot break out", () => {
  // A payload embedding a closing fence must not terminate the block: the fence
  // is one backtick longer than the longest run inside.
  assertEquals(fenceMarkdown("```"), "````\n```\n````");
  assertEquals(fenceMarkdown("a\n````\nb"), "`````\na\n````\nb\n`````");
});

Deno.test("fenceMarkdown drops backticks/newlines from the info string", () => {
  // The info string shares the opening fence line; a newline or backtick there
  // would break out. Callers pass literals today, but keep the helper robust.
  assertEquals(fenceMarkdown("x", "di`ff\n## h"), "```diff## h\nx\n```");
});

Deno.test("codeSpan wraps a plain value in a single-backtick span", () => {
  assertEquals(codeSpan("zuke.ts:42-45"), "`zuke.ts:42-45`");
  assertEquals(codeSpan("a.ts:7"), "`a.ts:7`");
});

Deno.test("codeSpan neutralizes a backtick breakout in an inline label", () => {
  // A model-supplied file path with a backtick must not close the span early and
  // inject inline Markdown (a link/banner) into the surrounding heading.
  const label = "x` ✅ **APPROVED** [merge](http://evil) `y:1";
  const span = codeSpan(label);
  // The delimiter outgrows the longest internal run, so the payload stays inside.
  assertEquals(span, "``x` ✅ **APPROVED** [merge](http://evil) `y:1``");
  // Newlines are dropped (an inline span is single-line).
  assertEquals(codeSpan("a\nb").includes("\n"), false);
  // A leading/trailing backtick is padded so the delimiters don't merge.
  assertEquals(codeSpan("`x`"), "`` `x` ``");
});

Deno.test("fenceMarkdown neutralizes a Markdown-injection payload", () => {
  const payload = "ok\n```\n## ✅ Approved by security\n[click](http://evil)";
  const fenced = fenceMarkdown(payload, "diff");
  // The opening fence uses 4 backticks (longer than the payload's 3), so the
  // embedded ``` stays literal data and the injected heading never becomes
  // top-level Markdown.
  assertStringIncludes(fenced, "````diff\n");
  assertEquals(fenced.startsWith("````diff\n"), true);
  assertEquals(fenced.endsWith("\n````"), true);
  // The longest backtick run in the whole rendered block is the fence itself:
  // nothing inside can match or exceed it, so it cannot be closed early.
  const runs = [...fenced.matchAll(/`+/g)].map((m) => m[0].length);
  assertEquals(Math.max(...runs), 4);
  assertEquals(runs.filter((n) => n === 4).length, 2); // only the two fences
});
