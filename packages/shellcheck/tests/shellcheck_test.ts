// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { ShellcheckSettings, ShellcheckTasks } from "../src/shellcheck.ts";

Deno.test("the minimal invocation is the binary and its scripts", () => {
  assertEquals(
    new ShellcheckSettings().paths("sh/lib.sh", "bin/gate").argv(),
    ["shellcheck", "sh/lib.sh", "bin/gate"],
  );
});

Deno.test("shellcheck: every option renders, scripts last", () => {
  const argv = new ShellcheckSettings()
    .shell("sh").severity("warning").format("gcc")
    .exclude("SC2086").exclude("1091", "2034").externalSources()
    .paths("sh/lib.sh").argv();
  assertEquals(argv, [
    "shellcheck",
    "-s",
    "sh",
    "-S",
    "warning",
    "-f",
    "gcc",
    "-e",
    "SC2086,1091,2034",
    "-x",
    "sh/lib.sh",
  ]);
});

Deno.test("shellcheck: the dialect is what makes a portability gate mean anything", () => {
  // Without -s, a script with a bash shebang (or none) is checked as bash, so
  // the POSIX violations the gate exists to catch go unreported.
  assertEquals(
    new ShellcheckSettings().shell("sh").paths("bin/gate").argv(),
    ["shellcheck", "-s", "sh", "bin/gate"],
  );
  assertEquals(
    new ShellcheckSettings().shell("busybox").paths("bin/gate").argv(),
    ["shellcheck", "-s", "busybox", "bin/gate"],
  );
});

Deno.test("shellcheck: stdin is a path, spelled the way shellcheck spells it", () => {
  // `shellcheck -` reads the script from stdin; an empty argv does not — it
  // prints usage and exits non-zero. So stdin mode needs no special case here,
  // and the refusal below does not stand in its way.
  assertEquals(
    new ShellcheckSettings().shell("sh").paths("-").argv(),
    ["shellcheck", "-s", "sh", "-"],
  );
});

Deno.test("shellcheck: a run with no scripts is refused, not sent", () => {
  assertThrows(
    () => new ShellcheckSettings().shell("sh").argv(),
    Error,
    "no scripts to check",
  );
});

Deno.test("ShellcheckTasks.lint reaches execution", async () => {
  await assertRejects(
    () => ShellcheckTasks.lint((s) => missingTool(s).paths("sh/lib.sh")),
    ToolNotFoundError,
  );
});

Deno.test("shellcheck: resolves its binary from PATH by default", async () => {
  await assertWrapperConformance(
    () => new ShellcheckSettings().paths("sh/lib.sh"),
    "shellcheck",
    { resolution: "path" },
  );
});
