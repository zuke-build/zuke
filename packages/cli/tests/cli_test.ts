import { assertEquals } from "../../core/tests/_assert.ts";
import { defaultPrompter, main, parseSetupFlags } from "../mod.ts";
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
  assertEquals(parseSetupFlags(["whatever"]).name, undefined);
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
