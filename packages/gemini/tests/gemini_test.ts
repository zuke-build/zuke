import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  GeminiExtensionsSettings,
  GeminiMcpSettings,
  GeminiRunSettings,
  GeminiTasks,
} from "../src/gemini.ts";

Deno.test("run: the default binary is gemini and --prompt carries the prompt", () => {
  assertEquals(new GeminiRunSettings().prompt("hi").argv(), [
    "gemini",
    "--prompt",
    "hi",
  ]);
});

Deno.test("run: a prompt is required", () => {
  assertThrows(
    () => new GeminiRunSettings().argv(),
    Error,
    ".prompt() is required",
  );
});

Deno.test("run: every typed option renders in order", () => {
  const argv = new GeminiRunSettings()
    .prompt("do it")
    .model("gemini-2.5-pro")
    .sandbox()
    .sandboxImage("ghcr.io/acme/sbx")
    .allFiles()
    .yolo()
    .approvalMode("auto_edit")
    .includeDirectories("packages", "docs")
    .extensions("ext-a", "ext-b")
    .allowedTools("read_file", "run_shell_command")
    .allowedMcpServerNames("fs")
    .outputFormat("json")
    .debug()
    .checkpointing()
    .showMemoryUsage()
    .argv();
  assertEquals(argv, [
    "gemini",
    "--prompt",
    "do it",
    "--model",
    "gemini-2.5-pro",
    "--sandbox",
    "--sandbox-image",
    "ghcr.io/acme/sbx",
    "--all-files",
    "--yolo",
    "--approval-mode",
    "auto_edit",
    "--include-directories",
    "packages",
    "--include-directories",
    "docs",
    "--extensions",
    "ext-a",
    "--extensions",
    "ext-b",
    "--allowed-tools",
    "read_file",
    "--allowed-tools",
    "run_shell_command",
    "--allowed-mcp-server-names",
    "fs",
    "--output-format",
    "json",
    "--debug",
    "--checkpointing",
    "--show-memory-usage",
  ]);
});

Deno.test("mcp: minimal runs just the group", () => {
  assertEquals(new GeminiMcpSettings().argv(), ["gemini", "mcp"]);
});

Deno.test("mcp: command then flags", () => {
  const argv = new GeminiMcpSettings()
    .command("add", "fs")
    .flag("transport", "stdio")
    .argv();
  assertEquals(argv, [
    "gemini",
    "mcp",
    "add",
    "fs",
    "--transport",
    "stdio",
  ]);
});

Deno.test("extensions: numeric operands and bare/valued flags", () => {
  const argv = new GeminiExtensionsSettings()
    .command("install", 1)
    .flag("force")
    .flag("ref", "main")
    .argv();
  assertEquals(argv, [
    "gemini",
    "extensions",
    "install",
    "1",
    "--force",
    "--ref",
    "main",
  ]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-gemini-zz");
};

Deno.test("GeminiTasks.run reaches execution", async () => {
  await assertRejects(
    () => GeminiTasks.run((s) => missing(s.prompt("hi"))),
    ToolNotFoundError,
  );
});

Deno.test("GeminiTasks.mcp reaches execution", async () => {
  await assertRejects(
    () => GeminiTasks.mcp((s) => missing(s.command("list"))),
    ToolNotFoundError,
  );
});

Deno.test("GeminiTasks.extensions reaches execution", async () => {
  await assertRejects(
    () => GeminiTasks.extensions((s) => missing(s.command("list"))),
    ToolNotFoundError,
  );
});
