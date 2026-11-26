// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { FileTasks, RuntimeTasks } from "@zuke/core";
import { test } from "../../../tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../../tests/_assert.ts";
import {
  defaultHost,
  delegatesImportMap,
  denoJsonState,
  existingBuildFile,
  isRecord,
  mergeDenoJson,
  remappedImports,
  runSetup,
  unrelatedBuildFile,
} from "../src/setup.ts";
import {
  PYTHON_SDK_COMMAND,
  STARTER_IMPORTS,
  starterBuild,
  starterConfig,
  starterPythonBuild,
  starterSdkConfig,
  zukeDependency,
} from "../src/starter.ts";
import { FakeHost, testPin } from "../../../tests/support/cli/_fakes.ts";
import { withTemp } from "../../../tests/_temp.ts";

test("isRecord distinguishes plain objects", () => {
  assertEquals(isRecord({}), true);
  assertEquals(isRecord({ a: 1 }), true);
  assertEquals(isRecord(null), false);
  assertEquals(isRecord([]), false);
  assertEquals(isRecord(42), false);
});

test("starterBuild embeds the class name and entry point", () => {
  const out = starterBuild("Acme");
  assertEquals(out.includes("import { Build, run, target }"), true);
  assertEquals(out.includes('from "@zuke/core";'), true);
  assertEquals(out.includes("class Acme extends Build"), true);
  assertEquals(out.includes("await run(Acme)"), true);
});

test("starterBuild imports no inline jsr: specifier", () => {
  // Deno's default lint set rejects an inline `jsr:`/`npm:`/`https:` specifier
  // (no-import-prefix), and the scaffold writes a deno.json that configures no
  // lint rules — so a specifier here fails `deno lint` on the project's own
  // first file. The dependency lives in STARTER_IMPORTS instead.
  const out = starterBuild("Acme");
  assertEquals(/from "(jsr|npm|https):/.test(out), false);
  assertEquals(STARTER_IMPORTS["@zuke/core"], "jsr:@zuke/core@^1");
});

test("zukeDependency pins the caret major", () => {
  // The pin the scaffold puts in deno.json in place of the inline specifier.
  assertEquals(zukeDependency("core"), "jsr:@zuke/core@^1");
  assertEquals(zukeDependency("cmd"), "jsr:@zuke/cmd@^1");
});

test("starterConfig records the build name as JSON", () => {
  const parsed: unknown = JSON.parse(starterConfig("Acme", "zuke.ts"));
  assertEquals(isRecord(parsed) && parsed.name === "Acme", true);
  assertEquals(starterConfig("Acme", "zuke.ts").endsWith("\n"), true);
});

test("starterPythonBuild names the class, depends on the SDK and ends in run", () => {
  const out = starterPythonBuild("Acme");
  // The inline metadata is what lets `uv run build.py` provide the SDK.
  assertEquals(out.startsWith("# /// script\n"), true);
  assertStringIncludes(out, '# dependencies = ["zuke"]');
  assertStringIncludes(out, "from zuke import Build, run, target");
  assertStringIncludes(out, "class Acme(Build):");
  assertEquals(out.endsWith("run(Acme)\n"), true);
});

test("starterSdkConfig records the name, the worker command and the engine pin", () => {
  const parsed: unknown = JSON.parse(starterSdkConfig("Acme", "1.2.0"));
  assertEquals(parsed, {
    name: "Acme",
    sdk: { command: PYTHON_SDK_COMMAND },
    engine: "1.2.0",
  });
  assertEquals(PYTHON_SDK_COMMAND, ["uv", "run", "build.py"]);
});

test("runSetup --sdk python writes build.py and the SDK config, and no deno.json", async () => {
  const host = new FakeHost();
  const result = await runSetup(
    {
      dir: ".",
      force: false,
      name: "Acme",
      sdk: { pin: testPin("2.4.0", "1.2.0") },
    },
    host,
  );
  assertEquals(
    result.files.map((f) => f.path),
    ["build.py", "zuke", "zuke.ps1", "zuke.json", ".gitignore"],
  );
  assertEquals(result.manualSteps, []);
  assertEquals(host.files.has("zuke.ts"), false);
  assertEquals(host.files.has("deno.json"), false);
  assertStringIncludes(host.files.get("build.py") ?? "", "class Acme(Build):");
  assertEquals(
    JSON.parse(host.files.get("zuke.json") ?? ""),
    { name: "Acme", sdk: { command: PYTHON_SDK_COMMAND }, engine: "1.2.0" },
  );
  // The launchers run the pinned zuke binary, and nothing from Deno's stack.
  const bash = host.files.get("zuke") ?? "";
  const pwsh = host.files.get("zuke.ps1") ?? "";
  assertStringIncludes(bash, 'ZUKE_VERSION="2.4.0"');
  assertStringIncludes(pwsh, '$ZukeVersion = "2.4.0"');
  for (const launcher of [bash, pwsh]) {
    assertEquals(/deno/i.test(launcher), false, launcher);
  }
  assertEquals(host.chmods, [["zuke", 0o755]]);
});

test("runSetup --sdk python --no-bootstrap writes launchers that require zuke on PATH", async () => {
  const host = new FakeHost();
  await runSetup(
    {
      dir: ".",
      force: false,
      name: "Acme",
      sdk: { pin: testPin() },
      bootstrapDeno: false,
    },
    host,
  );
  const bash = host.files.get("zuke") ?? "";
  assertStringIncludes(bash, "command -v zuke");
  assertEquals(bash.includes("ZUKE_VERSION="), false);
  assertStringIncludes(
    host.files.get("zuke.ps1") ?? "",
    "Get-Command zuke -CommandType Application",
  );
});

test("runSetup --sdk python --mcp registers zuke mcp, which needs no Deno", async () => {
  const host = new FakeHost();
  await runSetup(
    {
      dir: "app",
      force: false,
      name: "Acme",
      sdk: { pin: testPin("2.4.0", "1.2.0") },
      mcp: { allowRun: true },
    },
    host,
  );
  const config = JSON.parse(host.files.get("app/.mcp.json") ?? "{}");
  assertEquals(config.mcpServers.zuke, {
    command: "zuke",
    args: ["mcp", "--allow-run"],
  });
});

test("runSetup --sdk python reserves build.py, and leaves a deno.json directory alone", async () => {
  const host = new FakeHost();
  // Not a scaffold name for an SDK build, so not a collision.
  host.directories.add("deno.json");
  host.directories.add("build.py");
  await assertRejects(
    () =>
      runSetup(
        {
          dir: ".",
          force: false,
          name: "Acme",
          sdk: { pin: testPin("2.4.0", "1.2.0") },
        },
        host,
      ),
    Error,
    'cannot write "build.py"',
  );
  host.directories.delete("build.py");
  const result = await runSetup(
    {
      dir: ".",
      force: false,
      name: "Acme",
      sdk: { pin: testPin("2.4.0", "1.2.0") },
    },
    host,
  );
  assertEquals(result.files.length, 5);
  // The launcher cannot take the build file's name either.
  await assertRejects(
    () =>
      runSetup(
        {
          dir: ".",
          force: true,
          name: "Acme",
          sdk: { pin: testPin("2.4.0", "1.2.0") },
          launcherName: "build.py",
        },
        host,
      ),
    Error,
    "would overwrite a file setup writes",
  );
});

test("mergeDenoJson seeds tasks and imports from scratch", () => {
  const text = mergeDenoJson(null, STARTER_IMPORTS, "zuke.ts");
  const parsed: unknown = JSON.parse(text);
  assertEquals(isRecord(parsed) && isRecord(parsed.tasks), true);
  if (isRecord(parsed) && isRecord(parsed.tasks)) {
    assertEquals(parsed.tasks.zuke, "deno run -A zuke.ts");
    assertEquals(parsed.tasks.test, "deno test -A");
  }
  if (isRecord(parsed) && isRecord(parsed.imports)) {
    assertEquals(parsed.imports["@zuke/core"], "jsr:@zuke/core@^1");
  }
  // Dependencies first, the order deno.json conventionally uses.
  assertEquals(text.indexOf('"imports"') < text.indexOf('"tasks"'), true);
  assertEquals(text.endsWith("\n"), true);
});

test("mergeDenoJson preserves existing keys, tasks, and import pins", () => {
  const before =
    '{"name":"x","imports":{"@zuke/core":"jsr:@zuke/core@1.2.3"},"tasks":{"fmt":"custom"}}';
  const parsed: unknown = JSON.parse(
    mergeDenoJson(before, STARTER_IMPORTS, "zuke.ts"),
  );
  assertEquals(isRecord(parsed), true);
  if (isRecord(parsed) && isRecord(parsed.tasks) && isRecord(parsed.imports)) {
    assertEquals(parsed.name, "x");
    assertEquals(parsed.tasks.fmt, "custom");
    assertEquals(parsed.tasks.zuke, "deno run -A zuke.ts");
    // A deliberate pin is never rewritten to the caret range.
    assertEquals(parsed.imports["@zuke/core"], "jsr:@zuke/core@1.2.3");
  }
});

test("mergeDenoJson adds a missing import beside existing ones", () => {
  const before = '{"imports":{"@std/yaml":"jsr:@std/yaml@^1"}}';
  const parsed: unknown = JSON.parse(
    mergeDenoJson(before, {
      ...STARTER_IMPORTS,
      "@zuke/cmd": "jsr:@zuke/cmd@^1",
    }, "zuke.ts"),
  );
  if (isRecord(parsed) && isRecord(parsed.imports)) {
    assertEquals(parsed.imports["@std/yaml"], "jsr:@std/yaml@^1");
    assertEquals(parsed.imports["@zuke/core"], "jsr:@zuke/core@^1");
    assertEquals(parsed.imports["@zuke/cmd"], "jsr:@zuke/cmd@^1");
  }
});

test("mergeDenoJson ignores a non-object document", () => {
  const parsed: unknown = JSON.parse(
    mergeDenoJson("[]", STARTER_IMPORTS, "zuke.ts"),
  );
  assertEquals(isRecord(parsed) && isRecord(parsed.tasks), true);
  if (isRecord(parsed) && isRecord(parsed.tasks) && isRecord(parsed.imports)) {
    assertEquals(parsed.tasks.zuke, "deno run -A zuke.ts");
    assertEquals(parsed.imports["@zuke/core"], "jsr:@zuke/core@^1");
  }
});

test("mergeDenoJson ignores a non-object imports block", () => {
  const parsed: unknown = JSON.parse(
    mergeDenoJson('{"imports":5}', STARTER_IMPORTS, "zuke.ts"),
  );
  if (isRecord(parsed) && isRecord(parsed.imports)) {
    assertEquals(parsed.imports["@zuke/core"], "jsr:@zuke/core@^1");
  }
});

test("denoJsonState classifies deno.json text", () => {
  const complete =
    '{"tasks":{"zuke":"x"},"imports":{"@zuke/core":"jsr:@zuke/core@^1"}}';
  assertEquals(denoJsonState(complete, STARTER_IMPORTS, "zuke.ts"), "present");
  // The zuke task alone is not enough: the zuke.ts written in the same run
  // imports @zuke/core by bare specifier, so the import has to be there too.
  assertEquals(
    denoJsonState('{"tasks":{"zuke":"x"}}', STARTER_IMPORTS, "zuke.ts"),
    "absent",
  );
  assertEquals(
    denoJsonState(complete, {
      ...STARTER_IMPORTS,
      "@zuke/cmd": "jsr:@zuke/cmd@^1",
    }, "zuke.ts"),
    "absent",
  );
  assertEquals(
    denoJsonState('{"tasks":{"a":"b"}}', STARTER_IMPORTS, "zuke.ts"),
    "absent",
  );
  assertEquals(
    denoJsonState('{"tasks":5}', STARTER_IMPORTS, "zuke.ts"),
    "absent",
  );
  assertEquals(
    denoJsonState('{"imports":5}', STARTER_IMPORTS, "zuke.ts"),
    "absent",
  );
  assertEquals(denoJsonState("[]", STARTER_IMPORTS, "zuke.ts"), "absent");
  assertEquals(
    denoJsonState("not json", STARTER_IMPORTS, "zuke.ts"),
    "unparseable",
  );
  // Nothing to add: an empty import set makes the task the whole question.
  assertEquals(
    denoJsonState('{"tasks":{"zuke":"x"}}', {}, "zuke.ts"),
    "present",
  );
});

test("delegatesImportMap spots a document that points elsewhere", () => {
  // Deno ignores `importMap` the moment `imports` or `scopes` appears, so only
  // a lone `importMap` is still delegating.
  assertEquals(delegatesImportMap({ importMap: "./m.json" }), true);
  assertEquals(
    delegatesImportMap({ importMap: "./m.json", imports: {} }),
    false,
  );
  assertEquals(
    delegatesImportMap({ importMap: "./m.json", scopes: {} }),
    false,
  );
  assertEquals(delegatesImportMap({ importMap: 5 }), false);
  assertEquals(delegatesImportMap({}), false);
});

test("mergeDenoJson leaves a delegated import map alone", () => {
  // Writing `imports` beside a lone `importMap` makes Deno ignore the latter,
  // taking the project's whole module resolution down with it.
  const before = '{"importMap":"./import_map.json"}';
  const parsed: unknown = JSON.parse(
    mergeDenoJson(before, STARTER_IMPORTS, "zuke.ts"),
  );
  if (isRecord(parsed)) {
    assertEquals(parsed.importMap, "./import_map.json");
    assertEquals("imports" in parsed, false);
    // The tasks still land — only the imports are withheld.
    assertEquals(
      isRecord(parsed.tasks) && parsed.tasks.zuke,
      "deno run -A zuke.ts",
    );
  }
});

test("remappedImports names a scaffold specifier pointing elsewhere", () => {
  const core = "@zuke/core";
  assertEquals(
    remappedImports(
      { imports: { [core]: "./.ci/helper.ts" } },
      STARTER_IMPORTS,
    ),
    [core],
  );
  // A deliberate version pin is still the JSR package, so it is not a remap.
  assertEquals(
    remappedImports(
      { imports: { [core]: "jsr:@zuke/core@1.2.3" } },
      STARTER_IMPORTS,
    ),
    [],
  );
  assertEquals(remappedImports({}, STARTER_IMPORTS), []);
  assertEquals(
    remappedImports({ imports: { [core]: 5 } }, STARTER_IMPORTS),
    [],
  );
});

test("runSetup scaffolds an empty project", async () => {
  const host = new FakeHost();
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  assertEquals(result.files.map((f) => f.status), [
    "created",
    "created",
    "created",
    "created",
    "created",
    "created",
  ]);
  assertEquals(host.files.get("build.ts")?.includes("class Foo"), true);
  assertEquals(host.files.has("zuke"), true);
  assertEquals(host.files.has("zuke.ps1"), true);
  assertEquals(host.files.get("zuke.json")?.includes('"name": "Foo"'), true);
  assertEquals(host.files.has("deno.json"), true);
  assertEquals(host.files.get(".gitignore")?.includes(".zuke/"), true);
  assertEquals(host.chmods[0], ["zuke", 0o755]);
});

test("runSetup scaffolds the bootstrapping launchers by default", async () => {
  // Nothing installed up front is the default: the launchers carry the pinned
  // Deno release and its checksums, and the PowerShell one mirrors the bash.
  const host = new FakeHost();
  await runSetup({ dir: ".", force: false, name: "Acme" }, host);
  const bash = host.files.get("zuke") ?? "";
  const pwsh = host.files.get("zuke.ps1") ?? "";
  assertStringIncludes(bash, "DEFAULT_DENO_VERSION=");
  assertStringIncludes(bash, "deno_checksum_for()");
  assertStringIncludes(pwsh, "$DefaultDenoVersion =");
  assertStringIncludes(pwsh, "$DenoChecksums = @{");
  assertEquals(bash.includes("Deno not found on PATH"), false);
  assertEquals(pwsh.includes("Deno not found on PATH"), false);
});

test("runSetup scaffolds the plain launchers when bootstrapDeno is false", async () => {
  const host = new FakeHost();
  await runSetup(
    { dir: ".", force: false, name: "Acme", bootstrapDeno: false },
    host,
  );
  const bash = host.files.get("zuke") ?? "";
  const pwsh = host.files.get("zuke.ps1") ?? "";
  assertStringIncludes(bash, "Deno not found on PATH");
  assertStringIncludes(pwsh, "Deno not found on PATH");
  assertEquals(bash.includes("DEFAULT_DENO_VERSION"), false);
  assertEquals(pwsh.includes("DefaultDenoVersion"), false);
  // Still executable, still a launcher: the variant changes nothing else.
  assertEquals(host.chmods, [["zuke", 0o755]]);
});

test("runSetup writes the launcher under a custom --launcher-name", async () => {
  const host = new FakeHost();
  await runSetup(
    { dir: ".", force: false, name: "Foo", launcherName: "build" },
    host,
  );
  assertEquals(host.files.has("build"), true);
  assertEquals(host.files.has("build.ps1"), true);
  assertEquals(host.files.has("zuke"), false); // the default launcher isn't written
  assertEquals(host.files.has("build.ts"), true); // the build file keeps its name
  assertEquals(host.chmods[0], ["build", 0o755]);
});

test("runSetup fails when the launcher name is a directory, suggesting --launcher-name", async () => {
  const host = new FakeHost();
  host.directories.add("zuke"); // a zuke/ package directory occupies the name
  await assertRejects(
    () => runSetup({ dir: ".", force: false, name: "Foo" }, host),
    Error,
    "--launcher-name",
  );
  // Nothing was written — the guard aborts before any scaffolding.
  assertEquals(host.files.size, 0);
});

test("runSetup fails when a reserved non-launcher name is a directory", async () => {
  const host = new FakeHost();
  host.directories.add("zuke.ts");
  const err = await assertRejects(
    () => runSetup({ dir: ".", force: false, name: "Foo" }, host),
    Error,
    "reserved by Zuke",
  );
  assertEquals(err.message.includes("--launcher-name"), false); // not a launcher
});

test("runSetup rejects a launcher name with a path separator", async () => {
  const host = new FakeHost();
  await assertRejects(
    () =>
      runSetup(
        { dir: ".", force: false, name: "Foo", launcherName: "../evil" },
        host,
      ),
    Error,
    "invalid --launcher-name",
  );
});

test("runSetup fails when deno.json is a directory", async () => {
  const host = new FakeHost();
  host.directories.add("deno.json"); // a deno.json/ directory, not a file
  await assertRejects(
    () => runSetup({ dir: ".", force: false, name: "Foo" }, host),
    Error,
    "reserved by Zuke",
  );
  assertEquals(host.files.size, 0);
});

test("runSetup rejects a launcher name that shadows a scaffolded file", async () => {
  const host = new FakeHost();
  await assertRejects(
    () =>
      runSetup(
        { dir: ".", force: false, name: "Foo", launcherName: "build.ts" },
        host,
      ),
    Error,
    "would overwrite a file",
  );
});

test("runSetup rejects a case-variant launcher name that shadows a file", async () => {
  // On a case-insensitive filesystem `Build.ts` would clobber the `build.ts`
  // build file, so it must be rejected regardless of case.
  const host = new FakeHost();
  for (const shadow of ["Build.ts", "ZUKE.JSON", "Deno.json", ".GITIGNORE"]) {
    await assertRejects(
      () =>
        runSetup(
          { dir: ".", force: false, name: "Foo", launcherName: shadow },
          host,
        ),
      Error,
      "would overwrite a file",
    );
  }
});

test("runSetup rejects a launcher name containing a colon", async () => {
  const host = new FakeHost();
  for (const bad of ["C:evil", "foo:bar"]) {
    await assertRejects(
      () =>
        runSetup(
          { dir: ".", force: false, name: "Foo", launcherName: bad },
          host,
        ),
      Error,
      "invalid --launcher-name",
    );
  }
});

test("runSetup skips a .gitignore that already ignores .zuke/", async () => {
  const host = new FakeHost({ ".gitignore": "node_modules/\n.zuke/\n" });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  const gi = result.files.find((f) => f.path === ".gitignore");
  assertEquals(gi?.status, "skipped");
  assertEquals(host.files.get(".gitignore"), "node_modules/\n.zuke/\n");
});

test("runSetup appends .zuke/ to an existing .gitignore", async () => {
  const host = new FakeHost({ ".gitignore": "node_modules/" });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  const gi = result.files.find((f) => f.path === ".gitignore");
  assertEquals(gi?.status, "overwritten");
  assertEquals(host.files.get(".gitignore"), "node_modules/\n.zuke/\n");
});

test("runSetup skips existing files without --force", async () => {
  const host = new FakeHost({ "zuke.ts": "keep me" });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  assertEquals(result.files[0], { path: "zuke.ts", status: "skipped" });
  assertEquals(host.files.get("zuke.ts"), "keep me");
});

test("runSetup overwrites existing files with --force", async () => {
  const host = new FakeHost({ "zuke.ts": "old" });
  const result = await runSetup({ dir: ".", force: true, name: "Bar" }, host);
  assertEquals(result.files[0], { path: "zuke.ts", status: "overwritten" });
  assertEquals(host.files.get("zuke.ts")?.includes("class Bar"), true);
});

test("runSetup tolerates chmod failing", async () => {
  const host = new FakeHost();
  host.chmodFails = true;
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  assertEquals(result.files[1], { path: "zuke", status: "created" });
  assertEquals(host.files.has("zuke"), true);
});

test("runSetup skips deno.json that already has the zuke task and imports", async () => {
  const complete =
    '{"tasks":{"zuke":"x"},"imports":{"@zuke/core":"jsr:@zuke/core@^1"}}';
  const host = new FakeHost({ "deno.json": complete });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  const dj = result.files.find((f) => f.path === "deno.json");
  assertEquals(dj?.status, "skipped");
  assertEquals(host.files.get("deno.json"), complete);
});

test("runSetup completes a deno.json that has the zuke task but no imports", async () => {
  // The regression: skipping on the task alone left the zuke.ts written by the
  // same run importing "@zuke/core" with nothing to resolve it.
  const host = new FakeHost({ "deno.json": '{"tasks":{"zuke":"x"}}' });
  const result = await runSetup({ dir: ".", force: true, name: "Foo" }, host);
  const dj = result.files.find((f) => f.path === "deno.json");
  assertEquals(dj?.status, "overwritten");
  const parsed: unknown = JSON.parse(host.files.get("deno.json") ?? "{}");
  if (isRecord(parsed) && isRecord(parsed.imports) && isRecord(parsed.tasks)) {
    assertEquals(parsed.imports["@zuke/core"], "jsr:@zuke/core@^1");
    assertEquals(parsed.tasks.zuke, "x"); // the project's own task survives
  }
});

test("runSetup declares the imports the supplied buildContent needs", async () => {
  const host = new FakeHost();
  await runSetup({
    dir: ".",
    force: false,
    name: "Foo",
    buildContent: 'import { CmdTasks } from "@zuke/cmd";\n',
    imports: {
      "@zuke/core": "jsr:@zuke/core@^1",
      "@zuke/cmd": "jsr:@zuke/cmd@^1",
    },
  }, host);
  const parsed: unknown = JSON.parse(host.files.get("deno.json") ?? "{}");
  if (isRecord(parsed) && isRecord(parsed.imports)) {
    assertEquals(parsed.imports["@zuke/cmd"], "jsr:@zuke/cmd@^1");
  }
});

test("runSetup merges a deno.json missing the zuke task", async () => {
  const host = new FakeHost({ "deno.json": '{"tasks":{"a":"b"}}' });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  const dj = result.files.find((f) => f.path === "deno.json");
  assertEquals(dj?.status, "overwritten");
  assertEquals(host.files.get("deno.json")?.includes('"zuke"'), true);
});

test("runSetup leaves an unparseable deno.json alone", async () => {
  const host = new FakeHost({ "deno.json": "oops" });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  const dj = result.files.find((f) => f.path === "deno.json");
  assertEquals(dj?.status, "skipped");
  assertEquals(host.files.get("deno.json"), "oops");
});

test("runSetup reports a manual step for a JSONC deno.json", async () => {
  // deno.json is JSONC: Deno accepts `//` comments that JSON.parse rejects, and
  // rewriting the file would discard them. The build now resolves through this
  // file, so silently skipping it left a scaffold that could not start.
  const jsonc = '{\n  // cfg\n  "tasks": { "dev": "echo hi" }\n}\n';
  const host = new FakeHost({ "deno.json": jsonc });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  assertEquals(host.files.get("deno.json"), jsonc); // comments survive
  assertEquals(result.manualSteps.length, 1);
  assertStringIncludes(
    result.manualSteps[0],
    '"@zuke/core": "jsr:@zuke/core@^1"',
  );
  assertStringIncludes(result.manualSteps[0], "will not run until you do");
});

test("runSetup will not break a project that delegates its import map", async () => {
  // Deno ignores `importMap` as soon as `imports` appears beside it, so writing
  // one would disable the project's entire module resolution.
  const host = new FakeHost({
    "deno.json": '{"importMap":"./import_map.json"}',
  });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  const parsed: unknown = JSON.parse(host.files.get("deno.json") ?? "{}");
  assertEquals(isRecord(parsed) && "imports" in parsed, false);
  assertEquals(result.manualSteps.length, 1);
  assertStringIncludes(result.manualSteps[0], "./import_map.json");
  assertStringIncludes(result.manualSteps[0], 'that file\'s "imports" instead');
});

test("runSetup notes a kept mapping that is not the JSR package", async () => {
  // Keeping the mapping is right — it is how a pin or a local checkout link
  // survives — but the run must not go on to call the dependency verified.
  const host = new FakeHost({
    "deno.json":
      '{"tasks":{"zuke":"x"},"imports":{"@zuke/core":"./.ci/helper.ts"}}',
  });
  const result = await runSetup({ dir: ".", force: true, name: "Foo" }, host);
  assertEquals(result.manualSteps, []); // deliberate, so not a failure
  assertEquals(result.notes.length, 1);
  assertStringIncludes(result.notes[0], "kept that mapping");
  assertEquals(
    host.logs.some((l) => l.includes("already declared")),
    true, // "declared", not a claim that it was verified
  );
});

test("runSetup stops asking once the delegated import map declares it", async () => {
  // The project did exactly what the previous run asked. Re-running must not
  // report the same step again — setup has to read the delegated map, since it
  // is the one place the entry can legitimately live.
  const host = new FakeHost({
    "deno.json": '{"importMap":"./import_map.json","tasks":{"zuke":"x"}}',
    "import_map.json": '{"imports":{"@zuke/core":"jsr:@zuke/core@^1"}}',
  });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  assertEquals(result.manualSteps, []);
});

test("runSetup still asks when the delegated map cannot confirm it", async () => {
  // Every shape setup cannot read answers "not declared", so an unverifiable
  // map gets the step rather than a silent pass.
  const cases: Array<Record<string, string>> = [
    // Declares other things, but not @zuke/core.
    { "import_map.json": '{"imports":{"lib/":"./lib/"}}' },
    // Unparseable.
    { "import_map.json": "{oops" },
    // No imports block at all.
    { "import_map.json": "{}" },
    // Missing entirely.
    {},
  ];
  for (const extra of cases) {
    const host = new FakeHost({
      "deno.json": '{"importMap":"./import_map.json","tasks":{"zuke":"x"}}',
      ...extra,
    });
    const result = await runSetup(
      { dir: ".", force: false, name: "Foo" },
      host,
    );
    assertEquals(result.manualSteps.length, 1, JSON.stringify(extra));
  }
});

test("runSetup does not read an importMap pointing outside the directory", async () => {
  // An absolute path, a URL, or one climbing out with `..` names a file this
  // directory does not own; setup reports it unverified instead of reading it.
  for (
    const target of ["/etc/passwd", "../../outside.json", "https://x/m.json"]
  ) {
    const host = new FakeHost({
      "deno.json": `{"importMap":"${target}","tasks":{"zuke":"x"}}`,
    });
    const result = await runSetup(
      { dir: ".", force: false, name: "Foo" },
      host,
    );
    assertEquals(result.manualSteps.length, 1, target);
    assertEquals(host.reads.includes(target), false, target);
  }
});

test("runSetup notes that --mcp could not register into an unparseable file", async () => {
  // The user asked for the server and did not get it; that belongs in the
  // result, not only in a line of progress output.
  const host = new FakeHost({ ".mcp.json": "oops" });
  const result = await runSetup(
    { dir: ".", force: false, name: "Foo", mcp: { allowRun: false } },
    host,
  );
  assertEquals(result.manualSteps, []); // the build still runs
  assertEquals(result.notes.length, 1);
  assertStringIncludes(result.notes[0], "was not registered");
});

test("runSetup reports no manual steps or notes for a clean scaffold", async () => {
  const host = new FakeHost();
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  assertEquals(result.manualSteps, []);
  assertEquals(result.notes, []);
});

test("runSetup writes to disk via the default host", async () => {
  await withTemp(async (dir) => {
    const result = await runSetup({ dir, force: false, name: "Acme" });
    assertEquals(result.files.length, 6);
    const buildTs = await FileTasks.readText(`${dir}/build.ts`);
    assertEquals(buildTs.includes("class Acme extends Build"), true);
    const config = await FileTasks.readText(`${dir}/zuke.json`);
    assertEquals(config.includes('"name": "Acme"'), true);
    if (RuntimeTasks.os() !== "windows") {
      const info = await FileTasks.lstat(`${dir}/zuke`);
      assertEquals((info.mode ?? 0) & 0o100, 0o100);
    }
    // Second pass: everything now exists and is left untouched.
    const again = await runSetup({ dir, force: false, name: "Acme" });
    assertEquals(again.files.every((f) => f.status === "skipped"), true);
  });
});

test("defaultHost.exists rethrows non-NotFound errors", async () => {
  if (RuntimeTasks.os() === "windows") return; // ENOTDIR is POSIX-specific.
  const file = await FileTasks.makeTempFile();
  try {
    // Treating a file as a directory yields NotADirectory, not NotFound.
    await assertRejects(() => defaultHost.exists(`${file}/child`));
  } finally {
    await FileTasks.remove(file);
  }
});

test("defaultHost.isDirectory distinguishes dirs, files, and missing paths", async () => {
  await withTemp(async (dir) => {
    assertEquals(await defaultHost.isDirectory(dir), true);
    const file = `${dir}/f.txt`;
    await FileTasks.writeText(file, "x");
    assertEquals(await defaultHost.isDirectory(file), false);
    assertEquals(await defaultHost.isDirectory(`${dir}/missing`), false);
    if (RuntimeTasks.os() !== "windows") {
      // A non-NotFound error (NotADirectory) must propagate, not be swallowed.
      await assertRejects(() => defaultHost.isDirectory(`${file}/child`));
    }
  });
});

test("runSetup writes .mcp.json only when --mcp asks for it", async () => {
  const plain = new FakeHost();
  await runSetup({ dir: ".", force: false, name: "Foo" }, plain);
  assertEquals(plain.files.has(".mcp.json"), false);

  const host = new FakeHost();
  const result = await runSetup(
    { dir: ".", force: false, name: "Foo", mcp: { allowRun: false } },
    host,
  );
  assertEquals(result.files.at(-1), { path: ".mcp.json", status: "created" });
  const config = JSON.parse(host.files.get(".mcp.json") ?? "{}");
  assertEquals(config.mcpServers.zuke.args, ["run", "-A", "build.ts", "mcp"]);
});

test("runSetup --mcp --allow-run registers the server with execution enabled", async () => {
  const host = new FakeHost();
  await runSetup(
    { dir: "app", force: false, name: "Foo", mcp: { allowRun: true } },
    host,
  );
  const config = JSON.parse(host.files.get("app/.mcp.json") ?? "{}");
  assertEquals(config.mcpServers.zuke.args.at(-1), "--allow-run");
});

test("runSetup merges .mcp.json around other servers and skips a present zuke entry", async () => {
  const other = JSON.stringify({
    mcpServers: { github: { command: "gh-mcp" } },
  });
  const host = new FakeHost({ ".mcp.json": other });
  const first = await runSetup(
    { dir: ".", force: false, name: "Foo", mcp: { allowRun: false } },
    host,
  );
  assertEquals(first.files.at(-1)?.status, "overwritten");
  const merged = JSON.parse(host.files.get(".mcp.json") ?? "{}");
  assertEquals(merged.mcpServers.github, { command: "gh-mcp" });
  assertEquals(merged.mcpServers.zuke.command, "deno");

  // Already registered: left alone without --force (it may carry a deliberate
  // --allow-run choice), replaced with it.
  const again = await runSetup(
    { dir: ".", force: false, name: "Foo", mcp: { allowRun: true } },
    host,
  );
  assertEquals(again.files.at(-1)?.status, "skipped");
  assertEquals(host.logs.some((l) => l.includes("already registered")), true);
  const forced = await runSetup(
    { dir: ".", force: true, name: "Foo", mcp: { allowRun: true } },
    host,
  );
  assertEquals(forced.files.at(-1)?.status, "overwritten");
  const replaced = JSON.parse(host.files.get(".mcp.json") ?? "{}");
  assertEquals(replaced.mcpServers.zuke.args.at(-1), "--allow-run");
});

test("runSetup repairs a malformed zuke entry without --force", async () => {
  const host = new FakeHost({
    ".mcp.json": JSON.stringify({ mcpServers: { zuke: { command: "deno" } } }),
  });
  const result = await runSetup(
    { dir: ".", force: false, name: "Foo", mcp: { allowRun: false } },
    host,
  );
  assertEquals(result.files.at(-1)?.status, "overwritten");
  const repaired = JSON.parse(host.files.get(".mcp.json") ?? "{}");
  assertEquals(repaired.mcpServers.zuke.args, ["run", "-A", "build.ts", "mcp"]);
});

test("runSetup skips an unparseable .mcp.json with a notice", async () => {
  const host = new FakeHost({ ".mcp.json": "{not json" });
  const result = await runSetup(
    { dir: ".", force: true, name: "Foo", mcp: { allowRun: false } },
    host,
  );
  assertEquals(result.files.at(-1)?.status, "skipped");
  assertEquals(host.files.get(".mcp.json"), "{not json");
  assertEquals(host.logs.some((l) => l.includes("edit by hand")), true);
});

test("runSetup fails when .mcp.json is a directory, only if --mcp asked for it", async () => {
  const host = new FakeHost();
  host.directories.add(".mcp.json");
  await runSetup({ dir: ".", force: false, name: "Foo" }, host); // fine: not requested
  await assertRejects(
    () =>
      runSetup(
        { dir: ".", force: false, name: "Foo", mcp: { allowRun: false } },
        host,
      ),
    Error,
    ".mcp.json is reserved by Zuke",
  );
});

test("runSetup rejects a launcher name that shadows .mcp.json", async () => {
  const host = new FakeHost();
  await assertRejects(
    () =>
      runSetup(
        { dir: ".", force: false, name: "Foo", launcherName: ".mcp.json" },
        host,
      ),
    Error,
    "would overwrite a file setup writes",
  );
});

test("setup refuses a symlink at any scaffold name, writing nothing", async () => {
  // Setup is what a developer runs inside a freshly cloned project, so the
  // directory's layout is the untrusted input here. Writes follow links, and
  // the probes are lstat-based, so a link planted at a scaffold name would
  // otherwise redirect a write outside the directory entirely.
  for (
    const name of [
      ".gitignore", // rewritten on every run — no --force needed
      "deno.json",
      ".mcp.json",
      "zuke.ts",
      "zuke",
      "zuke.ps1",
      "zuke.json",
    ]
  ) {
    const host = new FakeHost();
    host.symlinks.add(name);
    await assertRejects(
      () =>
        runSetup(
          { dir: ".", force: true, name: "Acme", mcp: { allowRun: false } },
          host,
        ),
      Error,
      "symbolic link",
    );
    // Nothing was written or chmod'ed: the refusal precedes every write.
    assertEquals(host.files.size, 0);
    assertEquals(host.chmods.length, 0);
  }
});

test("setup refuses a real symlink rather than writing through it", async () => {
  if (RuntimeTasks.os() === "windows") return; // a symlink needs privileges.
  await withTemp(async (dir) => {
    await withTemp(async (outside) => {
      const victim = `${outside}/victim.txt`;
      await FileTasks.writeText(victim, "original");
      await FileTasks.symlink(victim, `${dir}/.gitignore`);

      await assertRejects(
        () => runSetup({ dir, force: false, name: "Acme" }),
        Error,
        "symbolic link",
      );
      // The file the link named is byte-identical, and the scaffold did not
      // half-write itself before noticing.
      assertEquals(await FileTasks.readText(victim), "original");
      assertEquals(await defaultHost.exists(`${dir}/zuke.ts`), false);
    }, { prefix: "zuke-setup-outside-" });
  });
});

test("defaultHost.isSymlink reads the link, not its target", async () => {
  if (RuntimeTasks.os() === "windows") return; // a symlink needs privileges.
  await withTemp(async (dir) => {
    const file = `${dir}/f.txt`;
    await FileTasks.writeText(file, "x");
    const link = `${dir}/link`;
    await FileTasks.symlink(file, link);
    assertEquals(await defaultHost.isSymlink(link), true);
    assertEquals(await defaultHost.isSymlink(file), false);
    assertEquals(await defaultHost.isSymlink(`${dir}/missing`), false);
    // A link to a directory is a link, not a directory — which is what makes
    // the collision pass see it at all.
    const dirLink = `${dir}/dirlink`;
    await FileTasks.symlink(dir, dirLink);
    assertEquals(await defaultHost.isSymlink(dirLink), true);
    assertEquals(await defaultHost.isDirectory(dirLink), false);
    // A dangling link still counts: writing through it would create the target.
    const dangling = `${dir}/dangling`;
    await FileTasks.symlink(`${dir}/nope`, dangling);
    assertEquals(await defaultHost.isSymlink(dangling), true);
  });
});

test("a link planted after the check is replaced, not written through", async () => {
  if (RuntimeTasks.os() === "windows") return; // a symlink needs privileges.
  // The pre-write check reports what is there when it runs, so a link planted
  // between the check and the write would escape it. Writing beside the
  // destination and renaming into place removes that race outright: renaming
  // replaces the link instead of following it. This drives the seam directly,
  // because the race itself cannot be scheduled reliably in a test.
  await withTemp(async (dir) => {
    await withTemp(async (outside) => {
      const victim = `${outside}/victim.txt`;
      await FileTasks.writeText(victim, "ORIGINAL");
      const target = `${dir}/deno.json`;
      await FileTasks.symlink(victim, target);

      await defaultHost.writeText(target, "SCAFFOLDED");

      // The file the link named is untouched, and the link is gone.
      assertEquals(await FileTasks.readText(victim), "ORIGINAL");
      assertEquals(await FileTasks.readText(target), "SCAFFOLDED");
      assertEquals((await FileTasks.lstat(target)).isSymlink, false);
    }, { prefix: "zuke-setup-victim-" });
  });
});

test("writeText leaves no temporary file behind, on success or failure", async () => {
  await withTemp(async (dir) => {
    await defaultHost.writeText(`${dir}/zuke.json`, "{}");
    const after: string[] = [];
    for (const entry of await FileTasks.readDirectory(dir)) {
      after.push(entry.name);
    }
    assertEquals(after, ["zuke.json"]);

    // A destination that is a directory with something in it fails the
    // rename; the temporary file must not survive it.
    await FileTasks.createDirectory(`${dir}/occupied`, { recursive: false });
    await FileTasks.writeText(`${dir}/occupied/keep`, "");
    await assertRejects(() => defaultHost.writeText(`${dir}/occupied`, "{}"));
    const still: string[] = [];
    for (const entry of await FileTasks.readDirectory(dir)) {
      still.push(entry.name);
    }
    assertEquals(still.sort(), ["occupied", "zuke.json"]);

    // A parent that is not there yet is created, as `--dir` needs.
    await defaultHost.writeText(`${dir}/missing/zuke.json`, "{}");
    assertEquals(await FileTasks.readText(`${dir}/missing/zuke.json`), "{}");
  });
});

test("runSetup follows the build file an existing zuke.json names", async () => {
  const config = '{\n  "name": "Acme",\n  "build": "build.ts"\n}\n';
  const host = new FakeHost({ "zuke.json": config });
  const result = await runSetup(
    { dir: ".", force: true, name: "Acme", mcp: { allowRun: false } },
    host,
  );
  assertEquals(result.manualSteps, []);
  assertEquals(host.files.has("zuke.ts"), false);
  assertStringIncludes(host.files.get("build.ts") ?? "", "class Acme extends");
  assertStringIncludes(host.files.get("zuke") ?? "", 'run -A build.ts "$@"');
  assertStringIncludes(host.files.get("zuke.ps1") ?? "", '"build.ts")');
  // --force rewrites zuke.json, and the name it was read from survives.
  assertEquals(host.files.get("zuke.json"), config);
  const deno: unknown = JSON.parse(host.files.get("deno.json") ?? "");
  assertEquals(
    isRecord(deno) && isRecord(deno.tasks) && deno.tasks.zuke,
    "deno run -A build.ts",
  );
  const mcp: unknown = JSON.parse(host.files.get(".mcp.json") ?? "");
  assertEquals(
    isRecord(mcp) && isRecord(mcp.mcpServers) && mcp.mcpServers.zuke,
    { command: "deno", args: ["run", "-A", "build.ts", "mcp"] },
  );
});

test("runSetup refuses a launcher name that would shadow the named build file, and a bad build name", async () => {
  await assertRejects(
    () =>
      runSetup(
        { dir: ".", force: false, name: "Acme", launcherName: "Build.ts" },
        new FakeHost({ "zuke.json": '{ "build": "build.ts" }' }),
      ),
    Error,
    "would overwrite a file setup writes",
  );
  const host = new FakeHost({ "zuke.json": '{ "build": "../x.ts" }' });
  await assertRejects(
    () => runSetup({ dir: ".", force: true, name: "Acme" }, host),
    Error,
    "not a plain TypeScript file name",
  );
  assertEquals([...host.files.keys()], ["zuke.json"]);
});

test("starterConfig records a build file only when it is not the default", () => {
  assertEquals(JSON.parse(starterConfig("Acme", "zuke.ts")), { name: "Acme" });
  assertEquals(JSON.parse(starterConfig("Acme", "build.ts")), {
    name: "Acme",
    build: "build.ts",
  });
});

test("a new project gets build.ts, recorded in zuke.json", async () => {
  const host = new FakeHost();
  const result = await runSetup({ dir: ".", force: false, name: "Acme" }, host);
  assertEquals(result.files.map((f) => f.path), [
    "build.ts",
    "zuke",
    "zuke.ps1",
    "zuke.json",
    "deno.json",
    ".gitignore",
  ]);
  assertEquals(JSON.parse(host.files.get("zuke.json") ?? ""), {
    name: "Acme",
    build: "build.ts",
  });
  assertEquals(await existingBuildFile(".", host), "build.ts");
});

test("--build-file names a new project's build file, and only a valid TypeScript one", async () => {
  const host = new FakeHost();
  await runSetup(
    { dir: "sub", force: false, name: "Acme", buildFile: "ci.ts" },
    host,
  );
  assertStringIncludes(host.files.get("sub/ci.ts") ?? "", "class Acme");
  assertStringIncludes(host.files.get("sub/zuke") ?? "", 'run -A ci.ts "$@"');
  assertEquals(JSON.parse(host.files.get("sub/zuke.json") ?? ""), {
    name: "Acme",
    build: "ci.ts",
  });
  for (const buildFile of ["../ci.ts", "ci.py", "-A.ts"]) {
    const empty = new FakeHost();
    await assertRejects(
      () => runSetup({ dir: ".", force: true, name: "Acme", buildFile }, empty),
      Error,
      "--build-file",
    );
    assertEquals(empty.files.size, 0);
  }
  // A Python build is always build.py.
  await assertRejects(
    () =>
      runSetup({
        dir: ".",
        force: false,
        name: "Acme",
        buildFile: "ci.ts",
        sdk: { pin: testPin("2.4.0", "1.2.0") },
      }, new FakeHost()),
    Error,
    "a Python build is always build.py",
  );
});

test("an existing zuke.ts project stays one, with or without a zuke.json", async () => {
  const projects: Record<string, string>[] = [
    { "zuke.ts": "old" },
    { "zuke.json": '{ "name": "Old" }\n' },
  ];
  for (const files of projects) {
    const host = new FakeHost(files);
    assertEquals(await existingBuildFile(".", host), "zuke.ts");
    await runSetup({ dir: ".", force: true, name: "Acme" }, host);
    assertEquals(host.files.has("build.ts"), false);
    assertStringIncludes(host.files.get("zuke.ts") ?? "", "class Acme");
    assertEquals(JSON.parse(host.files.get("zuke.json") ?? ""), {
      name: "Acme",
    });
  }
  assertEquals(await existingBuildFile(".", new FakeHost()), undefined);
});

test("--build-file never moves an existing project's build file, --force or not", async () => {
  const before = {
    "zuke.json": '{ "name": "Old" }\n',
    "zuke.ts": "old",
    "deploy.ts": "console.log('my own script');\n",
  };
  for (const force of [false, true]) {
    for (const buildFile of ["build.ts", "deploy.ts"]) {
      const host = new FakeHost(before);
      await assertRejects(
        () => runSetup({ dir: ".", force, name: "Acme", buildFile }, host),
        Error,
        `this project's build file is zuke.ts, not ${buildFile}`,
      );
      assertEquals(Object.fromEntries(host.files), before);
    }
  }
  // Naming the file it already has is not a move.
  const kept = new FakeHost(before);
  await runSetup(
    { dir: ".", force: false, name: "Acme", buildFile: "zuke.ts" },
    kept,
  );
  assertEquals(kept.files.get("zuke.ts"), "old");
});

test("a project renamed in zuke.json gets its scaffolded zuke task moved, and a task of its own kept", async () => {
  const config = '{\n  "name": "Acme",\n  "build": "build.ts"\n}\n';
  const tasks = (host: FakeHost): unknown => {
    const deno: unknown = JSON.parse(host.files.get("deno.json") ?? "");
    return isRecord(deno) ? deno.tasks : undefined;
  };
  const imports = { "@zuke/core": "jsr:@zuke/core@^1" };
  // The task an earlier setup wrote for zuke.ts follows the new name, with
  // or without --force, and everything else in the file is kept.
  const stale = JSON.stringify({
    imports,
    tasks: { zuke: "deno run -A zuke.ts", dev: "deno run -A main.ts" },
  });
  assertEquals(denoJsonState(stale, imports, "build.ts"), "absent");
  assertEquals(denoJsonState(stale, imports, "zuke.ts"), "present");
  const host = new FakeHost({ "zuke.json": config, "deno.json": stale });
  await runSetup({ dir: ".", force: false, name: "Acme" }, host);
  const moved = tasks(host);
  assertEquals(isRecord(moved) && moved.zuke, "deno run -A build.ts");
  assertEquals(isRecord(moved) && moved.dev, "deno run -A main.ts");

  // A zuke task the project wrote itself is not setup's to change.
  const own = JSON.stringify({
    imports,
    tasks: { zuke: "deno run -A --frozen zuke.ts ci" },
  });
  assertEquals(denoJsonState(own, imports, "build.ts"), "present");
  const custom = new FakeHost({ "zuke.json": config, "deno.json": own });
  await runSetup({ dir: ".", force: true, name: "Acme" }, custom);
  const kept = tasks(custom);
  assertEquals(isRecord(kept) && kept.zuke, "deno run -A --frozen zuke.ts ci");
});

test("a new project never takes over an unrelated build.ts, even with --force", async () => {
  const unrelated = "console.log('my own script');\n";
  for (const force of [false, true]) {
    const host = new FakeHost({ "build.ts": unrelated });
    assertEquals(await unrelatedBuildFile(".", "build.ts", host), true);
    await assertRejects(
      () => runSetup({ dir: ".", force, name: "Acme" }, host),
      Error,
      "build.ts already exists and is not a Zuke build",
    );
    // Nothing was written, zuke.json included: it must not point at the file.
    assertEquals(Object.fromEntries(host.files), { "build.ts": unrelated });
  }
  // A build.ts that is a Zuke build is the project's own: kept, and named.
  const mine = 'import { Build, FileTasks, RuntimeTasks } from "@zuke/core";\n';
  const host = new FakeHost({ "build.ts": mine });
  assertEquals(await unrelatedBuildFile(".", "build.ts", host), false);
  await runSetup({ dir: ".", force: false, name: "Acme" }, host);
  assertEquals(host.files.get("build.ts"), mine);
  assertEquals(await existingBuildFile(".", host), "build.ts");
});

test("a link or a directory at the build file name is left to the collision check", async () => {
  const linked = new FakeHost();
  linked.symlinks.add("build.ts");
  assertEquals(await unrelatedBuildFile(".", "build.ts", linked), false);
  assertEquals(linked.reads, []);
  await assertRejects(
    () => runSetup({ dir: ".", force: true, name: "Acme" }, linked),
    Error,
    "symbolic link",
  );
  const directory = new FakeHost();
  directory.directories.add("build.ts");
  assertEquals(await unrelatedBuildFile(".", "build.ts", directory), false);
  await assertRejects(
    () => runSetup({ dir: ".", force: true, name: "Acme" }, directory),
    Error,
    "a directory exists",
  );
});

const NODE_CORE = "npm:@zuke-build/core@^1";

test("runSetup --runtime node writes build.ts, package.json, a Node zuke.json and launchers, and no deno.json", async () => {
  const host = new FakeHost();
  const result = await runSetup(
    {
      dir: "My App",
      force: false,
      name: "Acme",
      runtime: "node",
      mcp: { allowRun: false },
    },
    host,
  );
  assertEquals(result.manualSteps, []);
  const at = (name: string) => host.files.get(`My App/${name}`) ?? "";
  assertEquals(host.files.has("My App/deno.json"), false);
  assertStringIncludes(at("build.ts"), "class Acme extends Build");
  assertEquals(JSON.parse(at("package.json")), {
    name: "my-app",
    private: true,
    type: "module",
    dependencies: { "@zuke/core": NODE_CORE },
  });
  assertEquals(JSON.parse(at("zuke.json")), {
    name: "Acme",
    build: "build.ts",
    runtime: "node",
  });
  assertEquals(at(".gitignore"), ".zuke/\nnode_modules/\n");
  assertEquals(JSON.parse(at(".mcp.json")).mcpServers.zuke, {
    command: "node",
    args: ["build.ts", "mcp"],
  });
  for (const name of ["zuke", "zuke.ps1", ".mcp.json", "build.ts"]) {
    assertEquals(/deno/i.test(at(name)), false, name);
  }
});

test("runSetup --runtime node names a package after the working directory for '.'", async () => {
  const host = new FakeHost();
  await runSetup({ dir: ".", force: false, name: "A", runtime: "node" }, host);
  const name = JSON.parse(host.files.get("package.json") ?? "").name;
  assertEquals(/^[a-z0-9][a-z0-9._-]*$/.test(name), true, name);
  const root = new FakeHost();
  await runSetup({ dir: "/", force: false, name: "A", runtime: "node" }, root);
  assertEquals(
    JSON.parse(root.files.get("//package.json") ?? "").name,
    "zuke-build",
  );
});

test("runSetup --runtime node merges into an existing package.json", async () => {
  const host = new FakeHost({
    "package.json": JSON.stringify({
      name: "keep",
      dependencies: { left: "1" },
    }),
  });
  const result = await runSetup(
    { dir: ".", force: false, name: "A", runtime: "node" },
    host,
  );
  assertEquals(
    result.files.find((f) => f.path === "package.json")?.status,
    "overwritten",
  );
  assertEquals(JSON.parse(host.files.get("package.json") ?? ""), {
    name: "keep",
    dependencies: { left: "1", "@zuke/core": NODE_CORE },
    type: "module",
  });
});

test("runSetup --runtime node asks for one npm install when it adds @zuke/core beside a lockfile", async () => {
  const locked = new FakeHost({
    "package.json": JSON.stringify({ name: "p", type: "module" }),
    "package-lock.json": "{}",
  });
  const result = await runSetup(
    { dir: ".", force: false, name: "A", runtime: "node" },
    locked,
  );
  assertEquals(result.manualSteps.length, 1);
  assertStringIncludes(result.manualSteps[0], "npm install --ignore-scripts");
  assertStringIncludes(result.manualSteps[0], "package-lock.json");

  // Nothing to record: the dependency was already declared, or there is no lock.
  const declared = new FakeHost({
    "package.json": JSON.stringify({
      dependencies: { "@zuke/core": NODE_CORE },
    }),
    "package-lock.json": "{}",
  });
  const unlocked = new FakeHost({ "package.json": "{}" });
  for (const host of [declared, unlocked]) {
    const quiet = await runSetup(
      { dir: ".", force: false, name: "A", runtime: "node" },
      host,
    );
    assertEquals(quiet.manualSteps, []);
  }
});

test("runSetup --runtime node leaves a complete package.json, and keeps another type with a note", async () => {
  const complete = {
    name: "p",
    type: "module",
    dependencies: { "@zuke/core": "npm:@zuke-build/core@^1.2.0" },
  };
  const host = new FakeHost({ "package.json": JSON.stringify(complete) });
  const result = await runSetup(
    { dir: ".", force: false, name: "A", runtime: "node" },
    host,
  );
  assertEquals(
    result.files.find((f) => f.path === "package.json")?.status,
    "skipped",
  );
  assertEquals(JSON.parse(host.files.get("package.json") ?? ""), complete);

  const cjs = new FakeHost({ "package.json": '{"type":"commonjs"}' });
  const noted = await runSetup(
    { dir: ".", force: false, name: "A", runtime: "node" },
    cjs,
  );
  assertEquals(
    JSON.parse(cjs.files.get("package.json") ?? "").type,
    "commonjs",
  );
  assertEquals(noted.notes.length, 1);
  assertStringIncludes(noted.notes[0], '"commonjs"');
});

test("runSetup --runtime node leaves a package.json that is not a JSON object and reports a manual step", async () => {
  for (const text of ["{ nope", "[1, 2]", "null", '"text"']) {
    const host = new FakeHost({ "package.json": text });
    const result = await runSetup(
      { dir: ".", force: false, name: "A", runtime: "node" },
      host,
    );
    assertEquals(host.files.get("package.json"), text);
    assertEquals(
      result.files.find((f) => f.path === "package.json")?.status,
      "skipped",
    );
    assertEquals(result.manualSteps.length, 1, text);
    assertStringIncludes(result.manualSteps[0], NODE_CORE);
  }
});

test("runSetup --runtime node merges node_modules/ into an existing .gitignore", async () => {
  const host = new FakeHost({ ".gitignore": "dist\n.zuke/" });
  await runSetup({ dir: ".", force: false, name: "A", runtime: "node" }, host);
  assertEquals(host.files.get(".gitignore"), "dist\n.zuke/\nnode_modules/\n");
  await runSetup({ dir: ".", force: false, name: "A", runtime: "node" }, host);
  assertEquals(host.files.get(".gitignore"), "dist\n.zuke/\nnode_modules/\n");
});

test("runSetup refuses --runtime node with --sdk, and treats deno as today's setup", async () => {
  await assertRejects(
    () =>
      runSetup(
        {
          dir: ".",
          force: false,
          name: "A",
          runtime: "node",
          sdk: { pin: testPin("2.4.0", "1.2.0") },
        },
        new FakeHost(),
      ),
    Error,
    "--runtime",
  );
  const host = new FakeHost();
  await runSetup({ dir: ".", force: false, name: "A", runtime: "deno" }, host);
  assertEquals(host.files.has("deno.json"), true);
  assertEquals(host.files.has("package.json"), false);
  assertEquals(host.files.get("zuke.json")?.includes("runtime"), false);
});

/** A Deno project as `zuke setup` leaves it: build, zuke.json, deno.json, launchers. */
function denoProject(build = 'import { Build } from "@zuke/core";\n') {
  return new FakeHost({
    "build.ts": build,
    "zuke.json": JSON.stringify({ name: "Acme", build: "build.ts", extra: 1 }),
    "deno.json": JSON.stringify({
      imports: {
        "@zuke/core": "jsr:@zuke/core@^1",
        "@zuke/docker": "jsr:@zuke/docker@^1",
        "@zuke/core/shell": "jsr:@zuke/core@^1/shell",
        "@std/yaml": "jsr:@std/yaml@^1",
      },
    }),
    zuke: "old deno launcher",
    "zuke.ps1": "old deno launcher",
  });
}

test("runSetup --runtime node converts a Deno project in place, without --force", async () => {
  const host = denoProject();
  const result = await runSetup(
    { dir: ".", force: false, name: "Other", runtime: "node" },
    host,
  );
  assertEquals(result.manualSteps, []);
  // zuke.json keeps its own fields and gains the runtime.
  assertEquals(JSON.parse(host.files.get("zuke.json") ?? ""), {
    name: "Acme",
    build: "build.ts",
    extra: 1,
    runtime: "node",
  });
  for (const launcher of ["zuke", "zuke.ps1"]) {
    const text = host.files.get(launcher) ?? "";
    assertEquals(/deno/i.test(text), false, launcher);
    assertEquals(
      result.files.find((f) => f.path === launcher)?.status,
      "overwritten",
    );
  }
  // Every @zuke package deno.json imported, through its npm alias.
  assertEquals(JSON.parse(host.files.get("package.json") ?? "").dependencies, {
    "@zuke/core": NODE_CORE,
    "@zuke/docker": "npm:@zuke-build/docker@^1",
  });
  // The build file and deno.json are the project's own, and kept.
  assertEquals(
    host.files.get("build.ts"),
    'import { Build } from "@zuke/core";\n',
  );
  assertStringIncludes(host.files.get("deno.json") ?? "", "@std/yaml");
  assertEquals(result.notes.length, 1);
  assertStringIncludes(result.notes[0], "@std/yaml");
  assertEquals(result.notes[0].includes("@zuke/core/shell"), true);
});

test("runSetup --runtime node converting asks for the jsr: imports Node cannot load", async () => {
  const host = denoProject('import { Build } from "jsr:@zuke/core@^1";\n');
  host.files.delete("deno.json");
  const result = await runSetup(
    { dir: ".", force: false, name: "A", runtime: "node" },
    host,
  );
  assertEquals(result.manualSteps.length, 1);
  assertStringIncludes(result.manualSteps[0], "jsr:");
  // With no deno.json there is nothing to note, and only @zuke/core to add.
  assertEquals(result.notes, []);
  assertEquals(JSON.parse(host.files.get("package.json") ?? "").dependencies, {
    "@zuke/core": NODE_CORE,
  });
});

test("runSetup --runtime node converting a build with no zuke.json writes a Node one", async () => {
  const host = new FakeHost({ "zuke.ts": 'import "@zuke/core";\n' });
  await runSetup({ dir: ".", force: false, name: "A", runtime: "node" }, host);
  assertEquals(JSON.parse(host.files.get("zuke.json") ?? ""), {
    name: "A",
    runtime: "node",
  });
  assertEquals(host.files.get("zuke.ts"), 'import "@zuke/core";\n');
});

test("runSetup --runtime node refuses to convert a zuke.json it cannot merge into", async () => {
  for (const text of ["[1]", "{ nope"]) {
    const broken = denoProject();
    broken.files.set("zuke.json", text);
    await assertRejects(
      () =>
        runSetup(
          { dir: ".", force: false, name: "A", runtime: "node" },
          broken,
        ),
      Error,
      "not a JSON object",
    );
    assertEquals(broken.files.get("zuke.json"), text);
  }
  const linked = denoProject();
  linked.symlinks.add("zuke.json");
  await assertRejects(
    () =>
      runSetup({ dir: ".", force: false, name: "A", runtime: "node" }, linked),
    Error,
    "symbolic link",
  );
});

test("runSetup refuses to move a Node project back to Deno", async () => {
  const host = new FakeHost({
    "build.ts": 'import "@zuke/core";\n',
    "zuke.json": JSON.stringify({ name: "A", runtime: "node" }),
  });
  for (const runtime of ["deno", undefined] as const) {
    await assertRejects(
      () => runSetup({ dir: ".", force: false, name: "A", runtime }, host),
      Error,
      "does not move it back to Deno",
    );
  }
  assertEquals(host.files.has("deno.json"), false);
  // Re-running it on Node is fine, and converts nothing.
  const again = await runSetup(
    { dir: ".", force: false, name: "A", runtime: "node" },
    host,
  );
  assertEquals(
    again.files.find((f) => f.path === "zuke.json")?.status,
    "skipped",
  );
});

test("runSetup --runtime node converting reads past a deno.json it cannot parse, and a jsr: in a comment", async () => {
  const host = denoProject(
    '// once imported jsr:@zuke/core\nimport "@zuke/core";\n',
  );
  host.files.set("deno.json", "{ // jsonc\n}");
  const result = await runSetup(
    { dir: ".", force: false, name: "A", runtime: "node" },
    host,
  );
  assertEquals(result.manualSteps, []);
  assertEquals(result.notes.length, 1);
  assertStringIncludes(result.notes[0], "Remove it once nothing else uses it");
  assertEquals(host.files.get("deno.json"), "{ // jsonc\n}");
});
