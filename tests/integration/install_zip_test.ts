import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target, toolchain } from "../../packages/core/mod.ts";
import type { DownloadFn } from "../../packages/core/mod.ts";
import { makeZip } from "../../packages/core/tests/_zip.ts";
import { runCli } from "./_harness.ts";

// A build that provisions a zip-packaged tool. The fixture zip and install root
// are module-scoped so the target body (captured at field-init) reads them at
// execution time — set before each run.
let zipBytes: Uint8Array = new Uint8Array(0);
let toolsDir = "";

/** A download seam that writes the prepared fixture zip to `dest`. */
const fixtureDownload: DownloadFn = async (_url, dest) => {
  await Deno.writeFile(String(dest), zipBytes);
};

class ZipToolBuild extends Build {
  tools = toolchain((t) =>
    t.tool((s) =>
      s.name("dprint").archive("zip").binaryPath("bin/dprint")
        .url(() => "https://example.test/dprint.zip")
        .download(fixtureDownload)
    )
  );

  install = target()
    .description("install a zip-packaged tool")
    .executes(async () => {
      const bins = await this.tools.install({ destDir: toolsDir });
      const bin = bins.get("dprint");
      console.log(`dprint=${bin} :: ${await Deno.readTextFile(String(bin))}`);
    });
}

Deno.test("a build installs a zip-packaged tool end-to-end via the CLI", async () => {
  zipBytes = await makeZip([
    { name: "bin/dprint", data: new TextEncoder().encode("ZIP-TOOL") },
  ]);
  toolsDir = await Deno.makeTempDir({ prefix: "zuke-zip-it-" });
  try {
    const { code, out } = await runCli(ZipToolBuild, ["install"]);
    assertEquals(code, 0);
    assertStringIncludes(out, "/dprint");
    assertStringIncludes(out, ":: ZIP-TOOL"); // the unpacked binary's contents
  } finally {
    await Deno.remove(toolsDir, { recursive: true });
  }
});
