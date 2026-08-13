// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { Command, splitShellArgs } from "../../packages/core/src/shell.ts";
import { runCli } from "./_harness.ts";

// A build that takes an already-written command line — the shape `zuke import`
// deals with — splits it into argv, and hands it to a real process. Proves the
// quoting survives the whole way: splitter → Command → the OS.
class SplitBuild extends Build {
  run = target()
    .description("split a command string and run it")
    .executes(async () => {
      const args = splitShellArgs(
        String.raw`eval "console.log(Deno.args.join('|'))" -- -t "\d+" 'a b'`,
      );
      const out = await new Command([Deno.execPath(), ...args]).quiet().text();
      console.log(`argc=${args.length} received=${out}`);
    });
}

Deno.test("splitShellArgs feeds a real process discrete argv through the CLI", async () => {
  const { code, out } = await runCli(SplitBuild, ["run"]);
  assertEquals(code, 0);
  // 6 argv entries: eval, the code, --, -t, the regex, and the spaced argument.
  assertStringIncludes(out, "argc=6");
  // The backslash is intact and `a b` arrived as ONE argument, not two.
  assertStringIncludes(out, String.raw`received=-t|\d+|a b`);
});
