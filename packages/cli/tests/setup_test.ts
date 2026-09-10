// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  defaultHost,
  isRecord,
  mergeDenoJson,
  runSetup,
  starterBuild,
  starterConfig,
  zukeTaskState,
} from "../src/setup.ts";
import { FakeHost } from "./_fakes.ts";
import { withTemp } from "../../core/tests/_temp.ts";

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
  assertEquals(out.includes('jsr:@zuke/core@^1"'), true);
  assertEquals(out.includes("class Acme extends Build"), true);
  assertEquals(out.includes("await run(Acme)"), true);
});

Deno.test("starterConfig records the build name as JSON", () => {
  const parsed: unknown = JSON.parse(starterConfig("Acme"));
  assertEquals(isRecord(parsed) && parsed.name === "Acme", true);
  assertEquals(starterConfig("Acme").endsWith("\n"), true);
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

Deno.test("runSetup scaffolds the bootstrapping launchers by default", async () => {
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

Deno.test("runSetup scaffolds the plain launchers when bootstrapDeno is false", async () => {
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
  await withTemp(async (dir) => {
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
  });
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
  await withTemp(async (dir) => {
    assertEquals(await defaultHost.isDirectory(dir), true);
    const file = `${dir}/f.txt`;
    await Deno.writeTextFile(file, "x");
    assertEquals(await defaultHost.isDirectory(file), false);
    assertEquals(await defaultHost.isDirectory(`${dir}/missing`), false);
    if (Deno.build.os !== "windows") {
      // A non-NotFound error (NotADirectory) must propagate, not be swallowed.
      await assertRejects(() => defaultHost.isDirectory(`${file}/child`));
    }
  });
});

Deno.test("runSetup writes .mcp.json only when --mcp asks for it", async () => {
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
  assertEquals(config.mcpServers.zuke.args, ["run", "-A", "zuke.ts", "mcp"]);
});

Deno.test("runSetup --mcp --allow-run registers the server with execution enabled", async () => {
  const host = new FakeHost();
  await runSetup(
    { dir: "app", force: false, name: "Foo", mcp: { allowRun: true } },
    host,
  );
  const config = JSON.parse(host.files.get("app/.mcp.json") ?? "{}");
  assertEquals(config.mcpServers.zuke.args.at(-1), "--allow-run");
});

Deno.test("runSetup merges .mcp.json around other servers and skips a present zuke entry", async () => {
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

Deno.test("runSetup repairs a malformed zuke entry without --force", async () => {
  const host = new FakeHost({
    ".mcp.json": JSON.stringify({ mcpServers: { zuke: { command: "deno" } } }),
  });
  const result = await runSetup(
    { dir: ".", force: false, name: "Foo", mcp: { allowRun: false } },
    host,
  );
  assertEquals(result.files.at(-1)?.status, "overwritten");
  const repaired = JSON.parse(host.files.get(".mcp.json") ?? "{}");
  assertEquals(repaired.mcpServers.zuke.args, ["run", "-A", "zuke.ts", "mcp"]);
});

Deno.test("runSetup skips an unparseable .mcp.json with a notice", async () => {
  const host = new FakeHost({ ".mcp.json": "{not json" });
  const result = await runSetup(
    { dir: ".", force: true, name: "Foo", mcp: { allowRun: false } },
    host,
  );
  assertEquals(result.files.at(-1)?.status, "skipped");
  assertEquals(host.files.get(".mcp.json"), "{not json");
  assertEquals(host.logs.some((l) => l.includes("edit by hand")), true);
});

Deno.test("runSetup fails when .mcp.json is a directory, only if --mcp asked for it", async () => {
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

Deno.test("runSetup rejects a launcher name that shadows .mcp.json", async () => {
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

Deno.test("setup refuses a symlink at any scaffold name, writing nothing", async () => {
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

Deno.test("setup refuses a real symlink rather than writing through it", async () => {
  if (Deno.build.os === "windows") return; // Deno.symlink needs privileges.
  await withTemp(async (dir) => {
    await withTemp(async (outside) => {
      const victim = `${outside}/victim.txt`;
      await Deno.writeTextFile(victim, "original");
      await Deno.symlink(victim, `${dir}/.gitignore`);

      await assertRejects(
        () => runSetup({ dir, force: false, name: "Acme" }),
        Error,
        "symbolic link",
      );
      // The file the link named is byte-identical, and the scaffold did not
      // half-write itself before noticing.
      assertEquals(await Deno.readTextFile(victim), "original");
      assertEquals(await defaultHost.exists(`${dir}/zuke.ts`), false);
    }, { prefix: "zuke-setup-outside-" });
  });
});

Deno.test("defaultHost.isSymlink reads the link, not its target", async () => {
  if (Deno.build.os === "windows") return; // Deno.symlink needs privileges.
  await withTemp(async (dir) => {
    const file = `${dir}/f.txt`;
    await Deno.writeTextFile(file, "x");
    const link = `${dir}/link`;
    await Deno.symlink(file, link);
    assertEquals(await defaultHost.isSymlink(link), true);
    assertEquals(await defaultHost.isSymlink(file), false);
    assertEquals(await defaultHost.isSymlink(`${dir}/missing`), false);
    // A link to a directory is a link, not a directory — which is what makes
    // the collision pass see it at all.
    const dirLink = `${dir}/dirlink`;
    await Deno.symlink(dir, dirLink);
    assertEquals(await defaultHost.isSymlink(dirLink), true);
    assertEquals(await defaultHost.isDirectory(dirLink), false);
    // A dangling link still counts: writing through it would create the target.
    const dangling = `${dir}/dangling`;
    await Deno.symlink(`${dir}/nope`, dangling);
    assertEquals(await defaultHost.isSymlink(dangling), true);
  });
});

Deno.test("a link planted after the check is replaced, not written through", async () => {
  if (Deno.build.os === "windows") return; // Deno.symlink needs privileges.
  // The pre-write check reports what is there when it runs, so a link planted
  // between the check and the write would escape it. Writing beside the
  // destination and renaming into place removes that race outright: renaming
  // replaces the link instead of following it. This drives the seam directly,
  // because the race itself cannot be scheduled reliably in a test.
  await withTemp(async (dir) => {
    await withTemp(async (outside) => {
      const victim = `${outside}/victim.txt`;
      await Deno.writeTextFile(victim, "ORIGINAL");
      const target = `${dir}/deno.json`;
      await Deno.symlink(victim, target);

      await defaultHost.writeText(target, "SCAFFOLDED");

      // The file the link named is untouched, and the link is gone.
      assertEquals(await Deno.readTextFile(victim), "ORIGINAL");
      assertEquals(await Deno.readTextFile(target), "SCAFFOLDED");
      assertEquals((await Deno.lstat(target)).isSymlink, false);
    }, { prefix: "zuke-setup-victim-" });
  });
});

Deno.test("writeText leaves no temporary file behind, on success or failure", async () => {
  await withTemp(async (dir) => {
    await defaultHost.writeText(`${dir}/zuke.json`, "{}");
    const after: string[] = [];
    for await (const entry of Deno.readDir(dir)) after.push(entry.name);
    assertEquals(after, ["zuke.json"]);

    // A destination whose parent does not exist fails the rename; the
    // temporary file must not survive it.
    await assertRejects(() =>
      defaultHost.writeText(`${dir}/missing/zuke.json`, "{}")
    );
    const still: string[] = [];
    for await (const entry of Deno.readDir(dir)) still.push(entry.name);
    assertEquals(still, ["zuke.json"]);
  });
});
