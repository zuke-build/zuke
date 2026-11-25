// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../_testing.ts";
import { assertEquals, assertStringIncludes } from "../_assert.ts";
import {
  Build,
  EnvTasks,
  FileTasks,
  prependPath,
  ProcessTasks,
  RuntimeTasks,
  target,
} from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

// The bin directory to put on PATH is module-scoped so the target body (captured
// at field-init) reads it at execution time — set before the run.
let binDir = "";

class PathBuild extends Build {
  run = target()
    .description("resolve a provisioned tool by bare name via PATH")
    .executes(async () => {
      prependPath(binDir);
      // A bare command name must now resolve through the prepended directory,
      // proving the mutation reaches spawned subprocesses.
      const { success, stdout } = await ProcessTasks.run(
        "zuke-fixture-tool",
        (s) => s.stdout("piped"),
      );
      console.log(
        `resolved=${success} out=${new TextDecoder().decode(stdout).trim()}`,
      );
    });
}

test("prependPath makes a provisioned bin resolve by bare name via the CLI", async () => {
  if (RuntimeTasks.os() === "windows") return; // bare-name shell scripts are POSIX
  const dir = await FileTasks.makeTempDirectory((s) =>
    s.prefix("zuke-path-it-")
  );
  const savedPath = EnvTasks.get("PATH");
  try {
    binDir = `${dir}/bin`;
    await FileTasks.createDirectory(binDir, { recursive: false });
    const tool = `${binDir}/zuke-fixture-tool`;
    await FileTasks.writeText(tool, "#!/bin/sh\necho PATH-RESOLVED\n");
    await FileTasks.chmod(tool, 0o755);

    const { code, out } = await runCli(PathBuild, ["run"]);
    assertEquals(code, 0);
    assertStringIncludes(out, "resolved=true"); // the subprocess spawned…
    assertStringIncludes(out, "out=PATH-RESOLVED"); // …and it was the provisioned one
  } finally {
    // Restore the real PATH the in-process run mutated.
    if (savedPath === undefined) EnvTasks.delete("PATH");
    else EnvTasks.set("PATH", savedPath);
    await FileTasks.remove(dir, { recursive: true });
  }
});
