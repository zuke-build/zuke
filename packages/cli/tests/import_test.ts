// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { VERSION } from "../src/version.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  FakeHost,
  FakePrompter,
  noProjectProbe,
  pinRegistry,
  testPin,
} from "./_fakes.ts";
import { main, parseImportFlags } from "../mod.ts";
import {
  generateBuild,
  parseMakefile,
  parsePackageJson,
  runImport,
  toIdentifier,
  translateCommand,
} from "../src/import.ts";

/** A pin resolver for imports that must never reach the network. */
const noPin = () =>
  Promise.reject(new Error("the pin must not be resolved for this source"));

// --- parsePackageJson ---

Deno.test("parsePackageJson reads scripts in order and detects delegations", () => {
  const pkg = JSON.stringify({
    scripts: {
      build: "tsc -p .",
      test: "jest",
      ci: "npm run build && pnpm test",
      bad: 42, // non-string is skipped
    },
  });
  const tasks = parsePackageJson(pkg);
  assertEquals(tasks.map((t) => t.name), ["build", "test", "ci"]);
  const ci = tasks.find((t) => t.name === "ci");
  assertEquals(ci?.deps, ["build", "test"]); // both runners → dependencies
  assertEquals(ci?.command, ""); // pure delegation leaves no inline command
});

Deno.test("parsePackageJson returns nothing without a scripts object", () => {
  assertEquals(parsePackageJson("{}"), []);
  assertEquals(parsePackageJson(JSON.stringify({ scripts: "nope" })), []);
});

Deno.test("parsePackageJson keeps a runner command that is not a script delegation", () => {
  const pkg = JSON.stringify({
    scripts: {
      // `npm ci` (no such script) and `npm run test extra` are real commands,
      // not delegations, so they stay inline rather than becoming a dependency.
      setup: "npm ci",
      run2: "npm run test extra",
    },
  });
  const tasks = parsePackageJson(pkg);
  assertEquals(tasks.find((t) => t.name === "setup")?.deps, []);
  assertEquals(tasks.find((t) => t.name === "setup")?.command, "npm ci");
  assertEquals(tasks.find((t) => t.name === "run2")?.deps, []);
});

// --- parseMakefile ---

Deno.test("parseMakefile reads rules, prerequisites, and recipes", () => {
  const mk = [
    "CC = gcc", // variable assignment, skipped
    "all: build test",
    "\t@echo done", // '@' prefix stripped
    "build:",
    "\t-go build ./...", // '-' prefix stripped",
    "test: build out.o", // out.o is a file, not a target → dropped",
    "\tgo test ./...",
    ".PHONY: all", // special target, skipped
  ].join("\n");
  const tasks = parseMakefile(mk);
  assertEquals(tasks.map((t) => t.name), ["all", "build", "test"]);
  assertEquals(tasks.find((t) => t.name === "all")?.deps, ["build", "test"]);
  assertEquals(tasks.find((t) => t.name === "all")?.command, "echo done");
  assertEquals(
    tasks.find((t) => t.name === "build")?.command,
    "go build ./...",
  );
  // A prerequisite that is not itself a target (a file) is not a dependency.
  assertEquals(tasks.find((t) => t.name === "test")?.deps, ["build"]);
});

// --- translateCommand ---

Deno.test("translateCommand maps clean commands and chains", () => {
  assertEquals(translateCommand("tsc -p ."), [
    { code: `CmdTasks.exec("tsc", (s) => s.args("-p", "."))`, runnable: true },
  ]);
  assertEquals(translateCommand("jest").length, 1);
  const chain = translateCommand("eslint . && prettier -w .");
  assertEquals(chain.length, 2);
  assertEquals(chain.every((i) => i.runnable), true);
});

Deno.test("translateCommand escapes line separators in generated literals", () => {
  // U+2028 is legal inside a JSON string but is a line terminator to a
  // JavaScript parser — embedded raw by JSON.stringify, it would split the
  // generated string literal across lines. The quotes keep the tokenizer from
  // treating it as argument-separating whitespace, so it reaches the literal.
  const [item] = translateCommand('echo "a b"');
  assertEquals(item.runnable, true);
  assertEquals(item.code.includes(" "), false);
  assertEquals(item.code, 'CmdTasks.exec("echo", (s) => s.args("a\\u2028b"))');
});

Deno.test("translateCommand flags shell-specific commands as TODO", () => {
  for (
    const shellCmd of [
      "cat x | grep y", // pipe
      "esbuild in > out.js", // redirect
      "echo `date`", // backtick substitution
      "run $HOME/x", // env expansion
      "NODE_ENV=prod webpack", // env assignment
      "server &", // background
    ]
  ) {
    const items = translateCommand(shellCmd);
    assertEquals(items.length, 1);
    assertEquals(items[0].runnable, false);
    assertStringIncludes(items[0].code, "// TODO");
  }
});

Deno.test("translateCommand keeps a newline from breaking out of the TODO comment", () => {
  // A command whose text spans lines must stay on one `//` comment line.
  const items = translateCommand("cat x | grep y\nmalicious()");
  assertEquals(items.length, 1);
  assertEquals(items[0].runnable, false);
  assertEquals(items[0].code.includes("\n"), false);
  assertStringIncludes(items[0].code, "cat x | grep y malicious()");
});

Deno.test("generateBuild escapes an unusual task name in the description", () => {
  // A name with a quote/newline is emitted through a string literal, so it
  // cannot break out of the generated source.
  const { source: out } = generateBuild("B", [
    { name: 'weird"\nname', command: "echo hi", deps: [] },
  ]);
  assertStringIncludes(out, String.raw`imported: weird\"\nname`);
});

Deno.test("translateCommand keeps quoted arguments together", () => {
  const items = translateCommand(`prettier --write "src/**/*.ts"`);
  assertEquals(
    items[0].code,
    `CmdTasks.exec("prettier", (s) => s.args("--write", "src/**/*.ts"))`,
  );
});

Deno.test("translateCommand keeps a backslash inside a double-quoted argument", () => {
  // The old hand-rolled splitter had no backslash handling, so `"\d+"` imported
  // as `d+` — a test-selection pattern that silently matches other tests.
  const items = translateCommand(String.raw`vitest run -t "\d+"`);
  assertEquals(
    items[0].code,
    String.raw`CmdTasks.exec("vitest", (s) => s.args("run", "-t", "\\d+"))`,
  );
});

Deno.test("translateCommand preserves a segment with an unquoted backslash", () => {
  // A Windows-authored script (npm runs scripts through cmd.exe there) uses the
  // backslash as a path separator, while POSIX argv splitting reads it as an
  // escape and drops it, gluing the two path segments together into a silently
  // broken path. Ambiguous, so the segment is preserved for a human instead.
  const items = translateCommand(String.raw`node scripts\build.js`);
  assertEquals(items.length, 1);
  assertEquals(items[0].runnable, false);
  assertStringIncludes(items[0].code, String.raw`node scripts\build.js`);
});

Deno.test("translateCommand still translates a backslash that is quoted", () => {
  // Quoting removes the ambiguity, so these must NOT be pushed into a TODO —
  // and the unquoted check must not be fooled by an escaped closing quote.
  const items = translateCommand(String.raw`grep "a\"b" '\d+'`);
  assertEquals(items.length, 1);
  assertEquals(items[0].runnable, true);
  assertEquals(
    items[0].code,
    String.raw`CmdTasks.exec("grep", (s) => s.args("a\"b", "\\d+"))`,
  );
});

Deno.test("translateCommand preserves a segment whose quoting is unbalanced", () => {
  const items = translateCommand('echo "oops');
  assertEquals(items.length, 1);
  assertEquals(items[0].runnable, false);
  assertStringIncludes(items[0].code, `echo "oops`);
});

Deno.test("parsePackageJson keeps an unbalanced delegation as a command", () => {
  // `delegatedScript` cannot tokenise it, so it is not mistaken for a `npm run`
  // delegation and stays a (TODO-preserved) command.
  const tasks = parsePackageJson(
    JSON.stringify({ scripts: { lint: "eslint .", all: `npm run 'lint` } }),
  );
  assertEquals(tasks[1].deps, []);
  assertEquals(tasks[1].command, `npm run 'lint`);
});

// --- toIdentifier ---

Deno.test("toIdentifier produces valid camelCase field names", () => {
  assertEquals(toIdentifier("build"), "build");
  assertEquals(toIdentifier("build:prod"), "buildProd");
  assertEquals(toIdentifier("test-watch"), "testWatch");
  assertEquals(toIdentifier("lint.fix"), "lintFix");
  assertEquals(toIdentifier("2fast"), "task_2fast");
  assertEquals(toIdentifier("---"), "task");
});

// --- generateBuild ---

Deno.test("generateBuild emits a runnable class with ordered deps", () => {
  const { source: out } = generateBuild("MyBuild", [
    { name: "test", command: "jest", deps: ["build"] },
    { name: "build", command: "tsc", deps: [] },
  ]);
  // Bare specifiers, like the `setup` scaffold — an inline `jsr:` one trips
  // Deno's default no-import-prefix lint rule on the generated file.
  assertStringIncludes(out, `import { Build, run, target } from "@zuke/core";`);
  assertStringIncludes(out, `import { CmdTasks } from "@zuke/cmd";`);
  assertEquals(/from "(jsr|npm|https):/.test(out), false);
  assertStringIncludes(out, "class MyBuild extends Build");
  assertStringIncludes(out, "await run(MyBuild);");
  // A dependency must be declared before its dependent (topological order).
  assertEquals(
    out.indexOf("build = target()") < out.indexOf("test = target()"),
    true,
  );
  assertStringIncludes(out, ".dependsOn(this.build)");
});

Deno.test("generateBuild omits the cmd import when nothing runs", () => {
  const { source: out, imports } = generateBuild("B", [{
    name: "aggregate",
    command: "",
    deps: [],
  }]);
  assertEquals(out.includes("@zuke/cmd"), false);
  assertEquals("@zuke/cmd" in imports, false);
  assertStringIncludes(out, ".executes(() => {})");
});

Deno.test("generateBuild reports the imports its bare specifiers need", () => {
  // The caret major is pinned here, in the map the scaffolder merges into
  // deno.json, rather than inline in the source — an imported build must not
  // silently resolve a future @zuke major either way.
  const plain = generateBuild("B", [{ name: "a", command: "", deps: [] }]);
  assertEquals(plain.imports, { "@zuke/core": "jsr:@zuke/core@^1" });

  const running = generateBuild("B", [{ name: "a", command: "tsc", deps: [] }]);
  assertEquals(running.imports, {
    "@zuke/core": "jsr:@zuke/core@^1",
    "@zuke/cmd": "jsr:@zuke/cmd@^1",
  });
});

Deno.test("generateBuild breaks a dependency cycle with a note", () => {
  const { source: out } = generateBuild("B", [
    { name: "a", command: "", deps: ["b"] },
    { name: "b", command: "", deps: ["a"] },
  ]);
  assertStringIncludes(out, "dependency cycle");
  // The dropped edge is only in the note: `b` is declared first, so a live
  // `.dependsOn(this.a)` on it would be a forward reference to `undefined`.
  const b = out.slice(out.indexOf("b = target()"), out.indexOf("a = target()"));
  assertEquals(b.includes("    .dependsOn(this.a)"), false);
  assertStringIncludes(out, "    .dependsOn(this.b)");
});

Deno.test("translateCommand keeps a multi-line script for a human", () => {
  // A newline separates two commands; read as whitespace it would have
  // become one command with the second's words as its arguments.
  const [item] = translateCommand("echo one\necho two");
  assertEquals(item.runnable, false);
  assertStringIncludes(item.code, "echo one echo two");
});

Deno.test("generateBuild de-duplicates colliding identifiers", () => {
  const { source: out } = generateBuild("B", [
    { name: "build:prod", command: "a", deps: [] },
    { name: "build-prod", command: "b", deps: [] },
  ]);
  assertStringIncludes(out, "buildProd = target()");
  assertStringIncludes(out, "buildProd_ = target()");
});

Deno.test("generateBuild renders a shell-only task as a TODO body without async", () => {
  const { source: out } = generateBuild("B", [
    { name: "bundle", command: "esbuild in > out.js", deps: [] },
  ]);
  assertEquals(out.includes("@zuke/cmd"), false); // nothing runnable
  assertStringIncludes(out, ".executes(() => {");
  assertStringIncludes(
    out,
    "// TODO: translate this shell command: esbuild in > out.js",
  );
  assertEquals(out.includes("async"), false);
});

Deno.test("generateBuild handles an empty task list", () => {
  const { source: out } = generateBuild("Empty", []);
  assertStringIncludes(out, "No tasks were found to import");
});

// --- runImport (orchestration) ---

Deno.test("runImport auto-detects package.json and scaffolds", async () => {
  const host = new FakeHost({
    "package.json": JSON.stringify({ scripts: { build: "tsc" } }),
  });
  const result = await runImport(
    { dir: ".", force: true, name: "MyBuild", pin: noPin },
    host,
  );
  assertEquals(result.source, "package.json");
  assertEquals(result.taskCount, 1);
  assertStringIncludes(host.files.get("build.ts") ?? "", "build = target()");
  assertEquals(host.files.has("zuke"), true); // launcher scaffolded too
});

Deno.test("runImport keeps a Windows-style script path intact in the scaffold", async () => {
  const host = new FakeHost({
    "package.json": JSON.stringify({
      scripts: { build: String.raw`node scripts\build.js` },
    }),
  });
  const result = await runImport({
    dir: ".",
    force: true,
    name: "B",
    pin: noPin,
  }, host);
  assertEquals(result.taskCount, 1);
  const zuke = host.files.get("build.ts") ?? "";
  // The path separator survives into the generated file, flagged for a human,
  // instead of being silently swallowed by POSIX escape handling.
  assertStringIncludes(zuke, String.raw`node scripts\build.js`);
  assertStringIncludes(zuke, "// TODO"); // flagged, not silently mistranslated
  assertEquals(zuke.includes("CmdTasks.exec"), false);
});

Deno.test("runImport falls back to a Makefile", async () => {
  const host = new FakeHost({ "Makefile": "build:\n\tgo build\n" });
  const result = await runImport({
    dir: ".",
    force: true,
    name: "B",
    pin: noPin,
  }, host);
  assertEquals(result.source, "Makefile");
  assertEquals(result.taskCount, 1);
});

Deno.test("runImport honours an explicit --from source", async () => {
  const host = new FakeHost({
    "package.json": JSON.stringify({ scripts: { a: "x" } }),
    "Makefile": "b:\n\ty\n",
  });
  const result = await runImport(
    { dir: ".", force: true, name: "B", from: "Makefile", pin: noPin },
    host,
  );
  assertEquals(result.source, "Makefile");
  assertStringIncludes(host.files.get("build.ts") ?? "", "b = target()");
});

Deno.test("runImport reports when there is nothing to import", async () => {
  const host = new FakeHost({});
  const result = await runImport({
    dir: ".",
    force: true,
    name: "B",
    pin: noPin,
  }, host);
  assertEquals(result.source, null);
  assertEquals(result.taskCount, 0);
  assertEquals(host.files.has("zuke.ts"), false); // wrote nothing
});

// --- CLI wiring ---

Deno.test("parseImportFlags reads --from, --dir, --name, --force", () => {
  const flags = parseImportFlags([
    "--from",
    "makefile",
    "--dir=app",
    "--name",
    "CI",
    "-f",
  ]);
  assertEquals(flags.from, "Makefile");
  assertEquals(flags.dir, "app");
  assertEquals(flags.name, "CI");
  assertEquals(flags.force, true);
  // An unrecognised source is ignored (auto-detect).
  assertEquals(parseImportFlags(["--from=nonsense"]).from, undefined);
});

Deno.test("main dispatches the import command", async () => {
  const host = new FakeHost({
    "package.json": JSON.stringify({ scripts: { lint: "eslint ." } }),
  });
  const code = await main(
    ["import", "--yes", "--force"],
    host,
    new FakePrompter(false),
  );
  assertEquals(code, 0);
  assertStringIncludes(host.files.get("build.ts") ?? "", "lint = target()");
  assertStringIncludes(
    host.logs.join("\n"),
    "imported 1 task(s) from package.json",
  );
});

Deno.test("main import prompts for the name at an interactive terminal", async () => {
  const host = new FakeHost({
    "package.json": JSON.stringify({ scripts: { build: "tsc" } }),
  });
  // Interactive: the prompter supplies the class name and confirms overwrite.
  const code = await main(
    ["import"],
    host,
    new FakePrompter(true, "Pipeline", true),
  );
  assertEquals(code, 0);
  assertStringIncludes(
    host.files.get("build.ts") ?? "",
    "class Pipeline extends Build",
  );
});

Deno.test("main import returns 1 when nothing is found (with --from)", async () => {
  const host = new FakeHost({});
  const code = await main(
    ["import", "--yes", "--from", "makefile"],
    host,
    new FakePrompter(false),
  );
  assertEquals(code, 1);
  assertStringIncludes(host.logs.join("\n"), "for --from Makefile");
});

Deno.test("help lists the import command", async () => {
  const host = new FakeHost({});
  // No project probe: this test reads help text, and the real probe would
  // find the repository's own build and spawn it.
  await main(
    ["--help"],
    host,
    new FakePrompter(false),
    undefined,
    undefined,
    undefined,
    noProjectProbe,
  );
  // Listed as a row under the CLI's own commands, which is the section that
  // says these work anywhere, project or not.
  assertStringIncludes(host.logs.join("\n"), "import [options]");
});

Deno.test("import refuses a symlinked source file rather than reading through it", async () => {
  // `Makefile` / `package.json` are names import chooses, so a repository that
  // ships a link at one decides what gets read — and what is read is parsed
  // into the build file import then writes back into that repository.
  for (const file of ["package.json", "Makefile", "pyproject.toml"]) {
    const host = new FakeHost();
    host.symlinks.add(file);
    await assertRejects(
      () =>
        runImport(
          { dir: ".", force: false, name: "Acme", pin: noPin },
          host,
        ),
      Error,
      "symbolic link",
    );
    assertEquals(host.files.size, 0);
  }
});

// --- pyproject.toml ---

/** A poe-flavoured pyproject.toml with one plain and one sequence task. */
const PYPROJECT = `[project]
name = "app"

[tool.poe.tasks]
lint = "ruff check ."
ci.sequence = ["lint", "pytest -q"]
`;

Deno.test("runImport scaffolds a Python build from pyproject.toml, last in precedence", async () => {
  const host = new FakeHost({ "pyproject.toml": PYPROJECT });
  let asked = 0;
  const result = await runImport({
    dir: ".",
    force: true,
    name: "App",
    pin: () => {
      asked++;
      return Promise.resolve(testPin("2.4.0", "1.4.0"));
    },
  }, host);
  assertEquals(result.source, "pyproject.toml");
  assertEquals(result.taskCount, 2);
  assertEquals(asked, 1);
  const build = host.files.get("build.py") ?? "";
  assertStringIncludes(build, "class App(Build):");
  assertStringIncludes(build, 'await ctx.sh("ruff", "check", ".")');
  assertStringIncludes(build, ".depends_on(lint)");
  // The project `setup --sdk python` makes: no zuke.ts, no deno.json.
  assertEquals(host.files.has("zuke.ts"), false);
  assertEquals(host.files.has("deno.json"), false);
  assertEquals(JSON.parse(host.files.get("zuke.json") ?? "{}"), {
    name: "App",
    sdk: { command: ["uv", "run", "build.py"] },
    engine: "1.4.0",
  });
  // Its launchers run that zuke release, with no Deno anywhere.
  assertStringIncludes(host.files.get("zuke") ?? "", 'ZUKE_VERSION="2.4.0"');
  assertEquals(/deno/i.test(host.files.get("zuke.ps1") ?? ""), false);

  // package.json keeps precedence, and never asks for a pin.
  const both = new FakeHost({
    "pyproject.toml": PYPROJECT,
    "package.json": JSON.stringify({ scripts: { a: "x" } }),
  });
  const first = await runImport(
    { dir: ".", force: true, name: "B", pin: noPin },
    both,
  );
  assertEquals(first.source, "package.json");
  assertEquals(both.files.has("build.py"), false);
});

Deno.test("runImport writes nothing when the pin cannot be resolved", async () => {
  const host = new FakeHost({ "pyproject.toml": PYPROJECT });
  await assertRejects(
    () => runImport({ dir: ".", force: true, name: "B", pin: noPin }, host),
    Error,
    "must not be resolved",
  );
  assertEquals([...host.files.keys()], ["pyproject.toml"]);
});

Deno.test("runImport names the line of a pyproject.toml it cannot read", async () => {
  const host = new FakeHost({ "pyproject.toml": "[tool]\nx = 1979-05-27\n" });
  await assertRejects(
    () => runImport({ dir: ".", force: true, name: "B", pin: noPin }, host),
    Error,
    "cannot read pyproject.toml — line 2:",
  );
});

Deno.test("parseImportFlags reads --from pyproject", () => {
  assertEquals(
    parseImportFlags(["--from", "pyproject"]).from,
    "pyproject.toml",
  );
  assertEquals(
    parseImportFlags(["--from=pyproject.toml"]).from,
    "pyproject.toml",
  );
});

Deno.test("main import pins --zuke for a pyproject.toml, or this zuke's own release", async () => {
  // 0.9.9 is a release this CLI can never be, whatever a bump makes it.
  const releases = [testPin(VERSION, "1.5.0"), testPin("0.9.9", "1.2.0")];
  const host = new FakeHost({ "pyproject.toml": PYPROJECT });
  const code = await main(
    ["import", "--yes", "--from", "pyproject", "--zuke", "0.9.9"],
    host,
    new FakePrompter(false),
    undefined,
    undefined,
    undefined,
    undefined,
    pinRegistry(releases),
  );
  assertEquals(code, 0, host.logs.join("\n"));
  assertStringIncludes(host.files.get("zuke.json") ?? "", '"engine": "1.2.0"');
  assertStringIncludes(
    host.logs.join("\n"),
    "imported 2 task(s) from pyproject.toml",
  );
  const own = new FakeHost({ "pyproject.toml": PYPROJECT });
  assertEquals(
    await main(
      ["import", "--yes"],
      own,
      new FakePrompter(false),
      undefined,
      undefined,
      undefined,
      undefined,
      pinRegistry(releases),
    ),
    0,
  );
  assertStringIncludes(own.files.get("zuke.json") ?? "", '"engine": "1.5.0"');
});

Deno.test("main import rejects a loose --zuke, and writes nothing", async () => {
  const loose = new FakeHost({ "pyproject.toml": PYPROJECT });
  assertEquals(
    await main(
      ["import", "--yes", "--zuke", "^2"],
      loose,
      new FakePrompter(false),
      undefined,
      undefined,
      undefined,
      undefined,
      pinRegistry(new Error("offline")),
    ),
    1,
  );
  assertStringIncludes(
    loose.logs.join("\n"),
    'zuke import: --zuke "^2" is not an exact version',
  );
  assertEquals(loose.files.has("build.py"), false);
});
