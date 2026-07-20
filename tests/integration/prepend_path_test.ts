import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, prependPath, target } from "../../packages/core/mod.ts";
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
      const cmd = new Deno.Command("zuke-fixture-tool", { stdout: "piped" });
      const { success, stdout } = await cmd.output();
      console.log(
        `resolved=${success} out=${new TextDecoder().decode(stdout).trim()}`,
      );
    });
}

Deno.test("prependPath makes a provisioned bin resolve by bare name via the CLI", async () => {
  if (Deno.build.os === "windows") return; // bare-name shell scripts are POSIX
  const dir = await Deno.makeTempDir({ prefix: "zuke-path-it-" });
  const savedPath = Deno.env.get("PATH");
  try {
    binDir = `${dir}/bin`;
    await Deno.mkdir(binDir);
    const tool = `${binDir}/zuke-fixture-tool`;
    await Deno.writeTextFile(tool, "#!/bin/sh\necho PATH-RESOLVED\n");
    await Deno.chmod(tool, 0o755);

    const { code, out } = await runCli(PathBuild, ["run"]);
    assertEquals(code, 0);
    assertStringIncludes(out, "resolved=true"); // the subprocess spawned…
    assertStringIncludes(out, "out=PATH-RESOLVED"); // …and it was the provisioned one
  } finally {
    // Restore the real PATH the in-process run mutated.
    if (savedPath === undefined) Deno.env.delete("PATH");
    else Deno.env.set("PATH", savedPath);
    await Deno.remove(dir, { recursive: true });
  }
});
