import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { FakeHost, FakePrompter } from "./_fakes.ts";
import { main, parseImportFlags } from "../mod.ts";
import {
  generateBuild,
  parseMakefile,
  parsePackageJson,
  runImport,
  toIdentifier,
  translateCommand,
} from "../src/import.ts";

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
  const out = generateBuild("B", [
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
  const out = generateBuild("MyBuild", [
    { name: "test", command: "jest", deps: ["build"] },
    { name: "build", command: "tsc", deps: [] },
  ]);
  assertStringIncludes(out, `import { CmdTasks } from "jsr:@zuke/cmd";`);
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
  const out = generateBuild("B", [{
    name: "aggregate",
    command: "",
    deps: [],
  }]);
  assertEquals(out.includes("@zuke/cmd"), false);
  assertStringIncludes(out, ".executes(() => {})");
});

Deno.test("generateBuild breaks a dependency cycle with a note", () => {
  const out = generateBuild("B", [
    { name: "a", command: "", deps: ["b"] },
    { name: "b", command: "", deps: ["a"] },
  ]);
  assertStringIncludes(out, "dependency cycle");
});

Deno.test("generateBuild de-duplicates colliding identifiers", () => {
  const out = generateBuild("B", [
    { name: "build:prod", command: "a", deps: [] },
    { name: "build-prod", command: "b", deps: [] },
  ]);
  assertStringIncludes(out, "buildProd = target()");
  assertStringIncludes(out, "buildProd_ = target()");
});

Deno.test("generateBuild renders a shell-only task as a TODO body without async", () => {
  const out = generateBuild("B", [
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
  const out = generateBuild("Empty", []);
  assertStringIncludes(out, "No tasks were found to import");
});

// --- runImport (orchestration) ---

Deno.test("runImport auto-detects package.json and scaffolds", async () => {
  const host = new FakeHost({
    "package.json": JSON.stringify({ scripts: { build: "tsc" } }),
  });
  const result = await runImport(
    { dir: ".", force: true, name: "MyBuild" },
    host,
  );
  assertEquals(result.source, "package.json");
  assertEquals(result.taskCount, 1);
  assertStringIncludes(host.files.get("zuke.ts") ?? "", "build = target()");
  assertEquals(host.files.has("zuke"), true); // launcher scaffolded too
});

Deno.test("runImport falls back to a Makefile", async () => {
  const host = new FakeHost({ "Makefile": "build:\n\tgo build\n" });
  const result = await runImport({ dir: ".", force: true, name: "B" }, host);
  assertEquals(result.source, "Makefile");
  assertEquals(result.taskCount, 1);
});

Deno.test("runImport honours an explicit --from source", async () => {
  const host = new FakeHost({
    "package.json": JSON.stringify({ scripts: { a: "x" } }),
    "Makefile": "b:\n\ty\n",
  });
  const result = await runImport(
    { dir: ".", force: true, name: "B", from: "Makefile" },
    host,
  );
  assertEquals(result.source, "Makefile");
  assertStringIncludes(host.files.get("zuke.ts") ?? "", "b = target()");
});

Deno.test("runImport reports when there is nothing to import", async () => {
  const host = new FakeHost({});
  const result = await runImport({ dir: ".", force: true, name: "B" }, host);
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
  assertStringIncludes(host.files.get("zuke.ts") ?? "", "lint = target()");
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
    host.files.get("zuke.ts") ?? "",
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
  await main(["--help"], host, new FakePrompter(false));
  assertStringIncludes(host.logs.join("\n"), "zuke import");
});
