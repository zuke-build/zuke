import { assertEquals } from "./_assert.ts";
import { toYaml } from "../src/yaml.ts";

Deno.test("toYaml renders scalars with type-correct tokens", () => {
  assertEquals(toYaml("hello"), "hello\n");
  assertEquals(toYaml(42), "42\n");
  assertEquals(toYaml(true), "true\n");
  assertEquals(toYaml(false), "false\n");
  assertEquals(toYaml(null), "null\n");
});

Deno.test("toYaml quotes strings that would be misread", () => {
  assertEquals(toYaml(""), `""\n`);
  assertEquals(toYaml("on"), `"on"\n`);
  assertEquals(toYaml("No"), `"No"\n`);
  assertEquals(toYaml("123"), `"123"\n`);
  assertEquals(toYaml("-1.5"), `"-1.5"\n`);
  assertEquals(toYaml("a: b"), `"a: b"\n`);
  assertEquals(toYaml(" trim "), `" trim "\n`);
  assertEquals(toYaml("${{ matrix.os }}"), `"\${{ matrix.os }}"\n`);
});

Deno.test("toYaml leaves safe plain scalars unquoted", () => {
  assertEquals(toYaml("ubuntu-latest"), "ubuntu-latest\n");
  assertEquals(toYaml("deno task ci"), "deno task ci\n");
  assertEquals(toYaml("actions/checkout@v4"), "actions/checkout@v4\n");
});

Deno.test("toYaml renders a mapping with nested maps and quoted keys", () => {
  assertEquals(
    toYaml({ name: "CI", "runs-on": "ubuntu-latest", env: { KEY: "v" } }),
    "name: CI\nruns-on: ubuntu-latest\nenv:\n  KEY: v\n",
  );
  // A reserved key like `on` is quoted so it stays a string, not a boolean.
  assertEquals(toYaml({ on: { push: "x" } }), `"on":\n  push: x\n`);
});

Deno.test("toYaml skips undefined entries", () => {
  assertEquals(toYaml({ a: 1, b: undefined, c: 2 }), "a: 1\nc: 2\n");
});

Deno.test("toYaml renders empty collections inline", () => {
  assertEquals(toYaml({ items: [], opts: {} }), "items: []\nopts: {}\n");
});

Deno.test("toYaml renders sequences of scalars under a key", () => {
  assertEquals(
    toYaml({ branches: ["main", "dev"] }),
    "branches:\n  - main\n  - dev\n",
  );
});

Deno.test("toYaml renders a sequence of maps with a hanging dash", () => {
  assertEquals(
    toYaml({ steps: [{ name: "a", run: "x" }, { uses: "u" }] }),
    "steps:\n  - name: a\n    run: x\n  - uses: u\n",
  );
});

Deno.test("toYaml renders a top-level sequence", () => {
  assertEquals(toYaml(["a", "b"]), "- a\n- b\n");
});

Deno.test("toYaml renders an empty map item in a sequence", () => {
  assertEquals(toYaml([{}, "x"]), "- {}\n- x\n");
});

Deno.test("toYaml renders nested sequences", () => {
  assertEquals(toYaml([["a", "b"], ["c"]]), "-\n  - a\n  - b\n-\n  - c\n");
});

Deno.test("toYaml renders multi-line strings as block literals", () => {
  assertEquals(
    toYaml({ script: "line1\nline2" }),
    "script: |\n  line1\n  line2\n",
  );
  // Blank interior lines stay blank (no trailing indentation).
  assertEquals(toYaml({ script: "a\n\nb" }), "script: |\n  a\n\n  b\n");
});
