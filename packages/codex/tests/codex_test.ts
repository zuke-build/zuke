import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  CodexExecSettings,
  CodexMcpSettings,
  CodexTasks,
} from "../src/codex.ts";

Deno.test("exec: the default binary is codex and minimal runs just exec", () => {
  assertEquals(new CodexExecSettings().argv(), ["codex", "exec"]);
});

Deno.test("exec: a prompt is appended as the trailing positional", () => {
  assertEquals(new CodexExecSettings().prompt("hi").argv(), [
    "codex",
    "exec",
    "hi",
  ]);
});

Deno.test("exec: every typed option renders in order", () => {
  const argv = new CodexExecSettings()
    .model("gpt-5-codex")
    .image("a.png")
    .image("b.png")
    .config("model_reasoning_effort", "high")
    .config("foo", "bar")
    .sandbox("workspace-write")
    .cd("packages")
    .askForApproval("never")
    .fullAuto()
    .dangerouslyBypassApprovalsAndSandbox()
    .skipGitRepoCheck()
    .json()
    .outputLastMessage("last.txt")
    .outputSchema("schema.json")
    .color("never")
    .profile("ci")
    .oss()
    .prompt("do it")
    .argv();
  assertEquals(argv, [
    "codex",
    "exec",
    "--model",
    "gpt-5-codex",
    "--image",
    "a.png",
    "--image",
    "b.png",
    "--config",
    "model_reasoning_effort=high",
    "--config",
    "foo=bar",
    "--sandbox",
    "workspace-write",
    "--cd",
    "packages",
    "--ask-for-approval",
    "never",
    "--full-auto",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--json",
    "--output-last-message",
    "last.txt",
    "--output-schema",
    "schema.json",
    "--color",
    "never",
    "--profile",
    "ci",
    "--oss",
    "do it",
  ]);
});

Deno.test("mcp: minimal runs just the group", () => {
  assertEquals(new CodexMcpSettings().argv(), ["codex", "mcp"]);
});

Deno.test("mcp: command then bare and valued flags", () => {
  const argv = new CodexMcpSettings()
    .command("add", "fs")
    .flag("env", "K=V")
    .flag("yes")
    .argv();
  assertEquals(argv, [
    "codex",
    "mcp",
    "add",
    "fs",
    "--env",
    "K=V",
    "--yes",
  ]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-codex-zz");
};

Deno.test("CodexTasks.exec reaches execution", async () => {
  await assertRejects(
    () => CodexTasks.exec((s) => missing(s.prompt("hi"))),
    ToolNotFoundError,
  );
});

Deno.test("CodexTasks.mcp reaches execution", async () => {
  await assertRejects(
    () => CodexTasks.mcp((s) => missing(s.command("list"))),
    ToolNotFoundError,
  );
});
