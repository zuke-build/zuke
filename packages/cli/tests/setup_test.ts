import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import {
  defaultHost,
  isRecord,
  launcherBash,
  launcherPwsh,
  mergeDenoJson,
  runSetup,
  starterBuild,
  starterConfig,
  zukeTaskState,
} from "../src/setup.ts";
import { FakeHost } from "./_fakes.ts";

Deno.test("isRecord distinguishes plain objects", () => {
  assertEquals(isRecord({}), true);
  assertEquals(isRecord({ a: 1 }), true);
  assertEquals(isRecord(null), false);
  assertEquals(isRecord([]), false);
  assertEquals(isRecord(42), false);
});

Deno.test("starterBuild embeds the class name and entry point", () => {
  const out = starterBuild("Acme");
  assertEquals(out.includes("import { Build, run, target }"), true);
  assertEquals(out.includes("class Acme extends Build"), true);
  assertEquals(out.includes("await run(Acme)"), true);
});

Deno.test("starterConfig records the build name as JSON", () => {
  const parsed: unknown = JSON.parse(starterConfig("Acme"));
  assertEquals(isRecord(parsed) && parsed.name === "Acme", true);
  assertEquals(starterConfig("Acme").endsWith("\n"), true);
});

Deno.test("launchers carry a shebang and run zuke.ts", () => {
  const bash = launcherBash();
  assertEquals(bash.startsWith("#!/usr/bin/env bash"), true);
  assertEquals(bash.includes("deno run -A zuke.ts"), true);
  const pwsh = launcherPwsh();
  assertEquals(pwsh.startsWith("#!/usr/bin/env pwsh"), true);
  assertEquals(pwsh.includes("zuke.ts"), true);
});

Deno.test("mergeDenoJson seeds tasks from scratch", () => {
  const text = mergeDenoJson(null);
  const parsed: unknown = JSON.parse(text);
  assertEquals(isRecord(parsed) && isRecord(parsed.tasks), true);
  if (isRecord(parsed) && isRecord(parsed.tasks)) {
    assertEquals(parsed.tasks.zuke, "deno run -A zuke.ts");
    assertEquals(parsed.tasks.test, "deno test -A");
  }
  assertEquals(text.endsWith("\n"), true);
});

Deno.test("mergeDenoJson preserves existing keys and tasks", () => {
  const before = '{"name":"x","tasks":{"fmt":"custom"}}';
  const parsed: unknown = JSON.parse(mergeDenoJson(before));
  assertEquals(isRecord(parsed), true);
  if (isRecord(parsed) && isRecord(parsed.tasks)) {
    assertEquals(parsed.name, "x");
    assertEquals(parsed.tasks.fmt, "custom");
    assertEquals(parsed.tasks.zuke, "deno run -A zuke.ts");
  }
});

Deno.test("mergeDenoJson ignores a non-object document", () => {
  const parsed: unknown = JSON.parse(mergeDenoJson("[]"));
  assertEquals(isRecord(parsed) && isRecord(parsed.tasks), true);
  if (isRecord(parsed) && isRecord(parsed.tasks)) {
    assertEquals(parsed.tasks.zuke, "deno run -A zuke.ts");
  }
});

Deno.test("zukeTaskState classifies deno.json text", () => {
  assertEquals(zukeTaskState('{"tasks":{"zuke":"x"}}'), "present");
  assertEquals(zukeTaskState('{"tasks":{"a":"b"}}'), "absent");
  assertEquals(zukeTaskState('{"tasks":5}'), "absent");
  assertEquals(zukeTaskState("[]"), "absent");
  assertEquals(zukeTaskState("not json"), "unparseable");
});

Deno.test("runSetup scaffolds an empty project", async () => {
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
  assertEquals(host.files.get("zuke.ts")?.includes("class Foo"), true);
  assertEquals(host.files.has("zuke"), true);
  assertEquals(host.files.has("zuke.ps1"), true);
  assertEquals(host.files.get("zuke.json")?.includes('"name": "Foo"'), true);
  assertEquals(host.files.has("deno.json"), true);
  assertEquals(host.files.get(".gitignore")?.includes(".zuke/"), true);
  assertEquals(host.chmods[0], ["zuke", 0o755]);
});

Deno.test("runSetup writes the launcher under a custom --launcher-name", async () => {
  const host = new FakeHost();
  await runSetup(
    { dir: ".", force: false, name: "Foo", launcherName: "build" },
    host,
  );
  assertEquals(host.files.has("build"), true);
  assertEquals(host.files.has("build.ps1"), true);
  assertEquals(host.files.has("zuke"), false); // the default launcher isn't written
  assertEquals(host.files.has("zuke.ts"), true); // the build file keeps its name
  assertEquals(host.chmods[0], ["build", 0o755]);
});

Deno.test("runSetup fails when the launcher name is a directory, suggesting --launcher-name", async () => {
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

Deno.test("runSetup fails when a reserved non-launcher name is a directory", async () => {
  const host = new FakeHost();
  host.directories.add("zuke.ts");
  const err = await assertRejects(
    () => runSetup({ dir: ".", force: false, name: "Foo" }, host),
    Error,
    "reserved by Zuke",
  );
  assertEquals(err.message.includes("--launcher-name"), false); // not a launcher
});

Deno.test("runSetup rejects a launcher name with a path separator", async () => {
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

Deno.test("runSetup fails when deno.json is a directory", async () => {
  const host = new FakeHost();
  host.directories.add("deno.json"); // a deno.json/ directory, not a file
  await assertRejects(
    () => runSetup({ dir: ".", force: false, name: "Foo" }, host),
    Error,
    "reserved by Zuke",
  );
  assertEquals(host.files.size, 0);
});

Deno.test("runSetup rejects a launcher name that shadows a scaffolded file", async () => {
  const host = new FakeHost();
  await assertRejects(
    () =>
      runSetup(
        { dir: ".", force: false, name: "Foo", launcherName: "zuke.ts" },
        host,
      ),
    Error,
    "would overwrite a file",
  );
});

Deno.test("runSetup rejects a case-variant launcher name that shadows a file", async () => {
  // On a case-insensitive filesystem `Zuke.ts` would clobber the `zuke.ts`
  // build file, so it must be rejected regardless of case.
  const host = new FakeHost();
  for (const shadow of ["Zuke.ts", "ZUKE.JSON", "Deno.json", ".GITIGNORE"]) {
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

Deno.test("runSetup rejects a launcher name containing a colon", async () => {
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

Deno.test("runSetup skips a .gitignore that already ignores .zuke/", async () => {
  const host = new FakeHost({ ".gitignore": "node_modules/\n.zuke/\n" });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  const gi = result.files.find((f) => f.path === ".gitignore");
  assertEquals(gi?.status, "skipped");
  assertEquals(host.files.get(".gitignore"), "node_modules/\n.zuke/\n");
});

Deno.test("runSetup appends .zuke/ to an existing .gitignore", async () => {
  const host = new FakeHost({ ".gitignore": "node_modules/" });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  const gi = result.files.find((f) => f.path === ".gitignore");
  assertEquals(gi?.status, "overwritten");
  assertEquals(host.files.get(".gitignore"), "node_modules/\n.zuke/\n");
});

Deno.test("runSetup skips existing files without --force", async () => {
  const host = new FakeHost({ "zuke.ts": "keep me" });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  assertEquals(result.files[0], { path: "zuke.ts", status: "skipped" });
  assertEquals(host.files.get("zuke.ts"), "keep me");
});

Deno.test("runSetup overwrites existing files with --force", async () => {
  const host = new FakeHost({ "zuke.ts": "old" });
  const result = await runSetup({ dir: ".", force: true, name: "Bar" }, host);
  assertEquals(result.files[0], { path: "zuke.ts", status: "overwritten" });
  assertEquals(host.files.get("zuke.ts")?.includes("class Bar"), true);
});

Deno.test("runSetup tolerates chmod failing", async () => {
  const host = new FakeHost();
  host.chmodFails = true;
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  assertEquals(result.files[1], { path: "zuke", status: "created" });
  assertEquals(host.files.has("zuke"), true);
});

Deno.test("runSetup skips deno.json that already has the zuke task", async () => {
  const host = new FakeHost({ "deno.json": '{"tasks":{"zuke":"x"}}' });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  const dj = result.files.find((f) => f.path === "deno.json");
  assertEquals(dj?.status, "skipped");
  assertEquals(host.files.get("deno.json"), '{"tasks":{"zuke":"x"}}');
});

Deno.test("runSetup merges a deno.json missing the zuke task", async () => {
  const host = new FakeHost({ "deno.json": '{"tasks":{"a":"b"}}' });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  const dj = result.files.find((f) => f.path === "deno.json");
  assertEquals(dj?.status, "overwritten");
  assertEquals(host.files.get("deno.json")?.includes('"zuke"'), true);
});

Deno.test("runSetup leaves an unparseable deno.json alone", async () => {
  const host = new FakeHost({ "deno.json": "oops" });
  const result = await runSetup({ dir: ".", force: false, name: "Foo" }, host);
  const dj = result.files.find((f) => f.path === "deno.json");
  assertEquals(dj?.status, "skipped");
  assertEquals(host.files.get("deno.json"), "oops");
});

Deno.test("runSetup writes to disk via the default host", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await runSetup({ dir, force: false, name: "Acme" });
    assertEquals(result.files.length, 6);
    const zukeTs = await Deno.readTextFile(`${dir}/zuke.ts`);
    assertEquals(zukeTs.includes("class Acme extends Build"), true);
    const config = await Deno.readTextFile(`${dir}/zuke.json`);
    assertEquals(config.includes('"name": "Acme"'), true);
    if (Deno.build.os !== "windows") {
      const info = await Deno.lstat(`${dir}/zuke`);
      assertEquals((info.mode ?? 0) & 0o100, 0o100);
    }
    // Second pass: everything now exists and is left untouched.
    const again = await runSetup({ dir, force: false, name: "Acme" });
    assertEquals(again.files.every((f) => f.status === "skipped"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("defaultHost.exists rethrows non-NotFound errors", async () => {
  if (Deno.build.os === "windows") return; // ENOTDIR is POSIX-specific.
  const file = await Deno.makeTempFile();
  try {
    // Treating a file as a directory yields NotADirectory, not NotFound.
    await assertRejects(() => defaultHost.exists(`${file}/child`));
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("defaultHost.isDirectory distinguishes dirs, files, and missing paths", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await defaultHost.isDirectory(dir), true);
    const file = `${dir}/f.txt`;
    await Deno.writeTextFile(file, "x");
    assertEquals(await defaultHost.isDirectory(file), false);
    assertEquals(await defaultHost.isDirectory(`${dir}/missing`), false);
    if (Deno.build.os !== "windows") {
      // A non-NotFound error (NotADirectory) must propagate, not be swallowed.
      await assertRejects(() => defaultHost.isDirectory(`${file}/child`));
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
