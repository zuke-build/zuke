import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CmdSettings, CmdTasks } from "../src/cmd.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";

Deno.test("CmdSettings argv is the tool plus raw args", () => {
  const s = new CmdSettings("git").args("rev-parse", "HEAD");
  assertEquals(s.argv(), ["git", "rev-parse", "HEAD"]);
});

Deno.test("CmdSettings rejects an empty tool name", () => {
  assertThrows(() => new CmdSettings(""), Error, "tool name is required");
});

Deno.test("CmdTasks.exec runs a real process", async () => {
  const out = await CmdTasks.exec(
    Deno.execPath(),
    (s) => s.args("eval", "console.log('cmd-ok')").quiet(),
  );
  assertEquals(out.code, 0);
  assertEquals(out.stdout.includes("cmd-ok"), true);
});

Deno.test("CmdTasks.exec works with a flag-only invocation", async () => {
  // NOT a bare `deno` invocation — that would start the interactive REPL.
  const out = await CmdTasks.exec(
    Deno.execPath(),
    (s) => s.args("--version").quiet(),
  );
  assertEquals(out.code, 0);
  assertEquals(out.stdout.includes("deno"), true);
});

Deno.test("CmdTasks.exec surfaces ToolNotFoundError for missing tools", async () => {
  await assertRejects(
    () =>
      CmdTasks.exec("zuke-no-such-tool-xyz", (s) => {
        s.os_ = "linux"; // deterministic no-shim path on every platform
        return s;
      }),
    ToolNotFoundError,
    "zuke-no-such-tool-xyz",
  );
});
