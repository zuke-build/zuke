// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `DprintTasks.fmt` formatting given text: a real
 * build, driven through the CLI `main()`, runs a fake `dprint` that echoes
 * what it was given, so the text is seen to reach the tool's standard input
 * and to come back as the command's stdout, never through its argv.
 *
 * Hermetic per AGENTS.md guideline 5: the "dprint" is a POSIX shell shim that
 * runs a small script with the running runtime. Like the other fakes, the shim
 * does not run on Windows.
 *
 * @module
 */

import { test } from "../_testing.ts";
import { assertEquals } from "../_assert.ts";
import {
  Build,
  FileTasks,
  RuntimeTasks,
  target,
} from "../../packages/core/mod.ts";
import { DprintTasks } from "../../packages/dprint/mod.ts";
import { runCli } from "./_harness.ts";
import { RUN_SCRIPT } from "../_eval.ts";
import { withTemp } from "../_temp.ts";

/** The fake `dprint`: prints its argv, then everything it read on stdin. */
const FAKE = `
let input = "";
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(JSON.stringify(process.argv.slice(2)) + "\\n" + input);
`;

test({
  name: "dprint fmt: given text reaches the tool's stdin and returns as stdout",
  ignore: RuntimeTasks.os() === "windows",
  fn: () =>
    withTemp(async (dir) => {
      await FileTasks.writeText(`${dir}/fake.ts`, FAKE);
      const shim = `${dir}/dprint`;
      await FileTasks.writeText(
        shim,
        `#!/bin/sh\nexec "${RuntimeTasks.execPath()}" ${
          RUN_SCRIPT.join(" ")
        } ` +
          `"${dir}/fake.ts" "$@"\n`,
        (s) => s.mode(0o755),
      );
      let printed = "";
      class Format extends Build {
        format = target().executes(async () => {
          const out = await DprintTasks.fmt((s) =>
            s.toolPath(shim).stdin("ts", "const  x=1\n").quiet()
          );
          printed = out.stdout;
        });
      }
      const result = await runCli(Format, ["format"]);
      assertEquals(result.code, 0, result.err);
      assertEquals(printed, '["fmt","--stdin","ts"]\nconst  x=1\n');
    }),
});
