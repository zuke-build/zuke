// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import {
  TargetSummary,
  withAmbientSummary,
} from "../../core/src/summary_note.ts";
import { CommandError, CommandOutput } from "@zuke/core/shell";
import {
  parseDenoCheckSummary,
  parseDenoFmtSummary,
  parseDenoLintSummary,
} from "../src/quality_summary.ts";
import { DenoTasks } from "../src/deno.ts";

/** A run's output with the given streams and exit code. */
function out(code: number, stdout = "", stderr = ""): CommandOutput {
  return new CommandOutput(code, stdout, stderr);
}

Deno.test("deno lint: Checked yields Files, Found yields Problems", () => {
  assertEquals(parseDenoLintSummary(out(0, "", "Checked 312 files\n")), {
    Files: 312,
    Problems: 0,
  });
  assertEquals(
    parseDenoLintSummary(
      out(1, "", "error[no-var]: ...\n\nFound 2 problems\nChecked 1 file\n"),
    ),
    { Files: 1, Problems: 2 },
  );
  assertEquals(
    parseDenoLintSummary(out(1, "", "error: No target files found.")),
    undefined,
  );
});

Deno.test("deno fmt: Checked yields Files, and --check's closing line the Unformatted count", () => {
  assertEquals(parseDenoFmtSummary(out(0, "", "Checked 312 files\n")), {
    Files: 312,
    Unformatted: 0,
  });
  assertEquals(
    parseDenoFmtSummary(
      out(1, "", "\nerror: Found 1 not formatted file in 312 files\n"),
    ),
    { Files: 312, Unformatted: 1 },
  );
  assertEquals(
    parseDenoFmtSummary(out(1, "", "error: No target files found.")),
    undefined,
  );
});

Deno.test("deno check: the closing line or the diagnostics yield Errors, silence and exit 0 is zero", () => {
  assertEquals(parseDenoCheckSummary(out(0)), { Errors: 0 });
  assertEquals(
    parseDenoCheckSummary(
      out(
        1,
        "",
        "TS2322 [ERROR]: Type 'string' is not assignable to type 'number'.\n",
      ),
    ),
    { Errors: 1 },
  );
  assertEquals(
    parseDenoCheckSummary(
      out(
        1,
        "",
        "TS2322 [ERROR]: ...\n\nTS2322 [ERROR]: ...\n\nFound 2 errors.\n",
      ),
    ),
    { Errors: 2 },
  );
  assertEquals(
    parseDenoCheckSummary(out(1, "", "error: Module not found")),
    undefined,
  );
});

// The real deno drives the wrapper end to end: it is always present under the
// test runner, so these stay hermetic.
Deno.test("DenoTasks.lint, fmt and check report onto the ambient summary for real", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/ok.ts`, "export const n: number = 1;\n");
    await Deno.writeTextFile(`${dir}/bad.ts`, "export const s: number = 'x'\n");
    const lint = new TargetSummary();
    await withAmbientSummary(
      lint,
      () => DenoTasks.lint((s) => s.paths(`${dir}/ok.ts`).quiet()),
    );
    assertEquals(lint.entries(), [{ key: "Files", value: "1" }, {
      key: "Problems",
      value: "0",
    }]);

    const fmt = new TargetSummary();
    await assertRejects(
      () =>
        withAmbientSummary(
          fmt,
          () => DenoTasks.fmt((s) => s.check().paths(`${dir}/bad.ts`).quiet()),
        ),
      CommandError,
    );
    assertEquals(fmt.entries(), [{ key: "Files", value: "1" }, {
      key: "Unformatted",
      value: "1",
    }]);

    const check = new TargetSummary();
    await assertRejects(
      () =>
        withAmbientSummary(
          check,
          () => DenoTasks.check((s) => s.paths(`${dir}/bad.ts`).quiet()),
        ),
      CommandError,
    );
    assertEquals(check.entries(), [{ key: "Errors", value: "1" }]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
