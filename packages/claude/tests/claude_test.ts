// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../../tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  ClaudeConfigSettings,
  ClaudeMcpSettings,
  ClaudeRunSettings,
  ClaudeTasks,
  ClaudeUpdateSettings,
} from "../src/claude.ts";

test("run: the default binary is claude and --print carries the prompt", () => {
  assertEquals(new ClaudeRunSettings().prompt("hi").argv(), [
    "claude",
    "--print",
    "hi",
  ]);
});

test("run: a prompt is required", () => {
  assertThrows(
    () => new ClaudeRunSettings().argv(),
    Error,
    ".prompt() is required",
  );
});

test("run: every typed option renders in order", () => {
  const argv = new ClaudeRunSettings()
    .prompt("do it")
    .model("sonnet")
    .fallbackModel("haiku")
    .outputFormat("json")
    .inputFormat("stream-json")
    .allowedTools("Read", "Grep")
    .disallowedTools("Bash")
    .addDir("packages", "docs")
    .permissionMode("plan")
    .dangerouslySkipPermissions()
    .appendSystemPrompt("Be terse")
    .maxTurns(3)
    .mcpConfig("mcp.json")
    .settings("settings.json")
    .sessionId("session-1")
    .continueSession()
    .resume("prev-1")
    .verbose()
    .argv();
  assertEquals(argv, [
    "claude",
    "--print",
    "do it",
    "--model",
    "sonnet",
    "--fallback-model",
    "haiku",
    "--output-format",
    "json",
    "--input-format",
    "stream-json",
    "--allowedTools",
    "Read,Grep",
    "--disallowedTools",
    "Bash",
    "--add-dir",
    "packages",
    "docs",
    "--permission-mode",
    "plan",
    "--dangerously-skip-permissions",
    "--append-system-prompt",
    "Be terse",
    "--max-turns",
    "3",
    "--mcp-config",
    "mcp.json",
    "--settings",
    "settings.json",
    "--session-id",
    "session-1",
    "--continue",
    "--resume",
    "prev-1",
    "--verbose",
  ]);
});

test("run: resume without a session id omits the trailing id", () => {
  assertEquals(new ClaudeRunSettings().prompt("hi").resume().argv(), [
    "claude",
    "--print",
    "hi",
    "--resume",
  ]);
});

test("mcp: minimal runs just the group", () => {
  assertEquals(new ClaudeMcpSettings().argv(), ["claude", "mcp"]);
});

test("mcp: command then flags", () => {
  const argv = new ClaudeMcpSettings()
    .command("add", "fs")
    .flag("transport", "stdio")
    .flag("scope", "project")
    .argv();
  assertEquals(argv, [
    "claude",
    "mcp",
    "add",
    "fs",
    "--transport",
    "stdio",
    "--scope",
    "project",
  ]);
});

test("config: numeric operands and bare/valued flags", () => {
  const argv = new ClaudeConfigSettings()
    .command("set", 1)
    .flag("global")
    .flag("count", 5)
    .argv();
  assertEquals(argv, [
    "claude",
    "config",
    "set",
    "1",
    "--global",
    "--count",
    "5",
  ]);
});

test("update: builds the update subcommand", () => {
  assertEquals(new ClaudeUpdateSettings().argv(), ["claude", "update"]);
});

test("ClaudeTasks.run reaches execution", async () => {
  await assertRejects(
    () => ClaudeTasks.run((s) => missingTool(s.prompt("hi"))),
    ToolNotFoundError,
  );
});

test("ClaudeTasks.mcp reaches execution", async () => {
  await assertRejects(
    () => ClaudeTasks.mcp((s) => missingTool(s.command("list"))),
    ToolNotFoundError,
  );
});

test("ClaudeTasks.config reaches execution", async () => {
  await assertRejects(
    () => ClaudeTasks.config((s) => missingTool(s.command("list"))),
    ToolNotFoundError,
  );
});

test("ClaudeTasks.update reaches execution", async () => {
  await assertRejects(
    () => ClaudeTasks.update((s) => missingTool(s)),
    ToolNotFoundError,
  );
});

test("claude: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(
    () => new ClaudeRunSettings().prompt("hi"),
    "claude",
    {
      resolution: "path",
    },
  );
});
