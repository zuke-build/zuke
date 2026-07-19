import { assertEquals } from "../../core/tests/_assert.ts";
import {
  defaultPrompter,
  main,
  parseSetupFlags,
  resolveDocSpec,
} from "../mod.ts";
import { VERSION } from "../src/version.ts";
import { FakeHost, FakePrompter } from "./_fakes.ts";

Deno.test("parseSetupFlags reads every flag form", () => {
  assertEquals(parseSetupFlags([]), { force: false, yes: false });
  assertEquals(parseSetupFlags(["--force"]).force, true);
  assertEquals(parseSetupFlags(["-f"]).force, true);
  assertEquals(parseSetupFlags(["--yes"]).yes, true);
  assertEquals(parseSetupFlags(["-y"]).yes, true);
  assertEquals(parseSetupFlags(["--name", "Foo"]).name, "Foo");
  assertEquals(parseSetupFlags(["--name=Bar"]).name, "Bar");
  assertEquals(parseSetupFlags(["--name"]).name, undefined);
  assertEquals(parseSetupFlags(["--dir", "app"]).dir, "app");
  assertEquals(parseSetupFlags(["--dir=pkg"]).dir, "pkg");
  assertEquals(parseSetupFlags(["--dir"]).dir, undefined);
  assertEquals(
    parseSetupFlags(["--launcher-name", "build"]).launcherName,
    "build",
  );
  assertEquals(parseSetupFlags(["--launcher-name=go"]).launcherName, "go");
  assertEquals(parseSetupFlags(["--launcher-name"]).launcherName, undefined);
  assertEquals(parseSetupFlags(["whatever"]).name, undefined);
});

Deno.test("main setup surfaces a directory collision as a friendly exit 1", async () => {
  const host = new FakeHost();
  host.directories.add("zuke"); // a zuke/ directory is in the way
  const code = await main(["setup", "--yes"], host, new FakePrompter(false));
  assertEquals(code, 1);
  assertEquals(host.logs.some((l) => l.includes("--launcher-name")), true);
  assertEquals(host.files.size, 0); // nothing scaffolded
});

Deno.test("main setup --launcher-name renames the launcher and reports it", async () => {
  const host = new FakeHost();
  const code = await main(
    ["setup", "--yes", "--launcher-name", "build"],
    host,
    new FakePrompter(false),
  );
  assertEquals(code, 0);
  assertEquals(host.files.has("build"), true);
  assertEquals(host.logs.some((l) => l.includes("./build")), true);
});

Deno.test("resolveDocSpec resolves bare, scoped, and explicit specifiers", () => {
  assertEquals(resolveDocSpec("core"), "jsr:@zuke/core");
  assertEquals(resolveDocSpec("@scope/pkg"), "jsr:@scope/pkg");
  assertEquals(resolveDocSpec("jsr:@zuke/deno"), "jsr:@zuke/deno");
  assertEquals(resolveDocSpec("npm:cowsay"), "npm:cowsay");
  assertEquals(resolveDocSpec("https://x/y.ts"), "https://x/y.ts");
  assertEquals(resolveDocSpec("./local.ts"), "./local.ts");
  assertEquals(resolveDocSpec(""), undefined);
  assertEquals(resolveDocSpec(undefined), undefined);
});

Deno.test("main doc runs `deno doc <spec>` in an isolated temp-dir cwd", async () => {
  const host = new FakeHost();
  let seen: string[] = [];
  const code = await main(["doc", "core"], host, defaultPrompter, (args) => {
    seen = args;
    return Promise.resolve(0);
  });
  assertEquals(code, 0);
  assertEquals(seen, ["doc", "jsr:@zuke/core"]);
});

Deno.test("main doc pins a relative path to an absolute spec (cwd changes under it)", async () => {
  const host = new FakeHost();
  let seen: string[] = [];
  const code = await main(
    ["doc", "./lib.ts"],
    host,
    defaultPrompter,
    (args) => {
      seen = args;
      return Promise.resolve(0);
    },
  );
  assertEquals(code, 0);
  // The relative path was resolved against the user's cwd, not left relative
  // (which would resolve against the runner's throwaway directory).
  assertEquals(seen[0], "doc");
  assertEquals(seen[1].startsWith("."), false);
  assertEquals(seen[1].endsWith("/lib.ts"), true);
});

Deno.test("main doc forwards extra flags and propagates the exit code", async () => {
  const host = new FakeHost();
  let seen: string[] = [];
  const code = await main(
    ["doc", "deno", "--filter", "DenoTasks"],
    host,
    defaultPrompter,
    (args) => {
      seen = args;
      return Promise.resolve(3);
    },
  );
  assertEquals(code, 3);
  assertEquals(seen, ["doc", "--filter", "DenoTasks", "jsr:@zuke/deno"]);
});

Deno.test("main doc without a package prints usage and never spawns", async () => {
  const host = new FakeHost();
  let called = false;
  const runner = () => {
    called = true;
    return Promise.resolve(0);
  };
  assertEquals(await main(["doc"], host, defaultPrompter, runner), 1);
  assertEquals(
    await main(["doc", "--filter"], host, defaultPrompter, runner),
    1,
  );
  assertEquals(called, false);
  assertEquals(host.logs.some((l) => l.includes("name a package")), true);
});

Deno.test("main doc runs a real `deno doc` via the default runner (end-to-end)", async () => {
  const host = new FakeHost();
  const dir = await Deno.makeTempDir();
  try {
    const fixture = `${dir}/lib.ts`;
    await Deno.writeTextFile(
      fixture,
      '/** A documented greeting. */\nexport const hello = "hi";\n',
    );
    // No injected runner → the real defaultDocRunner spawns `deno doc` in its
    // own throwaway directory against the fixture's absolute path.
    const code = await main(["doc", fixture], host);
    assertEquals(code, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("main doc propagates a non-zero exit from the real runner", async () => {
  const host = new FakeHost();
  // A missing file → `deno doc` exits non-zero. No injected runner, so the real
  // defaultDocRunner runs and its temp dir is still cleaned up on failure.
  const code = await main(["doc", "/no/such/zuke-doc-fixture.ts"], host);
  assertEquals(code !== 0, true);
});

Deno.test("main setup honours --dir", async () => {
  const host = new FakeHost();
  const code = await main(
    ["setup", "--yes", "--dir", "sub", "--name", "Widget"],
    host,
    new FakePrompter(false),
  );
  assertEquals(code, 0);
  assertEquals(host.files.get("sub/zuke.ts")?.includes("class Widget"), true);
  assertEquals(host.files.has("sub/deno.json"), true);
  assertEquals(host.logs[0].includes("into sub"), true);
});

Deno.test("main --version prints the version", async () => {
  const host = new FakeHost();
  assertEquals(await main(["--version"], host), 0);
  assertEquals(host.logs, [VERSION]);
  const host2 = new FakeHost();
  assertEquals(await main(["-V"], host2), 0);
  assertEquals(host2.logs, [VERSION]);
});

Deno.test("main shows help for --help, -h and no args", async () => {
  for (const args of [[], ["--help"], ["-h"]]) {
    const host = new FakeHost();
    assertEquals(await main(args, host), 0);
    assertEquals(host.logs[0].includes("Usage:"), true);
  }
});

Deno.test("main rejects an unknown command", async () => {
  const host = new FakeHost();
  const code = await main(["bogus"], host);
  assertEquals(code, 1);
  assertEquals(host.logs[0].includes("Unknown command: bogus"), true);
});

Deno.test("main setup (non-interactive) scaffolds with flags", async () => {
  const host = new FakeHost();
  const code = await main(
    ["setup", "--yes", "--name", "Widget"],
    host,
    new FakePrompter(true, "IGNORED", true),
  );
  assertEquals(code, 0);
  assertEquals(host.files.get("zuke.ts")?.includes("class Widget"), true);
});

Deno.test("main setup (non-tty) uses defaults without prompting", async () => {
  const host = new FakeHost();
  const code = await main(["setup"], host, new FakePrompter(false));
  assertEquals(code, 0);
  assertEquals(host.files.get("zuke.ts")?.includes("class MyBuild"), true);
});

Deno.test("main setup (interactive) asks for name and overwrite", async () => {
  const host = new FakeHost({ "zuke.ts": "old" });
  const code = await main(
    ["setup"],
    host,
    new FakePrompter(true, "Chosen", true),
  );
  assertEquals(code, 0);
  // confirm() returned true -> existing zuke.ts is overwritten.
  assertEquals(host.files.get("zuke.ts")?.includes("class Chosen"), true);
});

Deno.test("main setup (interactive) keeps --force without asking", async () => {
  const host = new FakeHost();
  // confirm would return false, but --force already set: files still written.
  const code = await main(
    ["setup", "--force"],
    host,
    new FakePrompter(true, "Named", false),
  );
  assertEquals(code, 0);
  assertEquals(host.files.get("zuke.ts")?.includes("class Named"), true);
});

Deno.test("main uses default host/prompter when omitted", async () => {
  // --version touches only host.log; safe to exercise the real defaults.
  assertEquals(await main(["--version"]), 0);
});

Deno.test("defaultPrompter wraps prompt/confirm", () => {
  assertEquals(typeof defaultPrompter.interactive(), "boolean");

  const realPrompt = globalThis.prompt;
  const realConfirm = globalThis.confirm;
  try {
    globalThis.prompt = () => "typed";
    assertEquals(defaultPrompter.ask("q", "fallback"), "typed");
    globalThis.prompt = () => null;
    assertEquals(defaultPrompter.ask("q", "fallback"), "fallback");
    globalThis.confirm = () => true;
    assertEquals(defaultPrompter.confirm("q"), true);
  } finally {
    globalThis.prompt = realPrompt;
    globalThis.confirm = realConfirm;
  }
});
