import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  gzip,
  tar,
  target,
  toolchain,
} from "../../packages/core/mod.ts";
import type { DownloadFn, TarEntry } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

// A build that provisions a multi-file runtime tree. The fixture tarball and
// install root are module-scoped so the target body (captured at field-init)
// reads them at execution time — set before the run.
let tarballBytes: Uint8Array = new Uint8Array(0);
let toolsDir = "";
const POSIX = Deno.build.os !== "windows";

/** A download seam that writes the prepared fixture tarball to `dest`. */
const fixtureDownload: DownloadFn = async (_url, dest) => {
  await Deno.writeFile(String(dest), tarballBytes);
};

class TreeBuild extends Build {
  tools = toolchain((t) =>
    t.tree((s) =>
      s.name("node").archive("tar.gz").strip(1).bins("bin/node", "bin/npm")
        .url(() => "https://example.test/node.tar.gz")
        .download(fixtureDownload)
    )
  );

  install = target()
    .description("install a multi-file runtime tree")
    .executes(async () => {
      const roots = await this.tools.install({ destDir: toolsDir });
      const root = roots.get("node");
      if (root === undefined) throw new Error("node tree not installed");
      if (Deno.build.os !== "windows") {
        // The symlinked bin resolves to the lib script it points at…
        const npm = await Deno.readTextFile(String(root("bin", "npm")));
        console.log(`npm-via-symlink=${npm.trim()}`);
        // …and chmod made the real bin executable, so it actually runs.
        const cmd = new Deno.Command(String(root("bin", "node")), {
          stdout: "piped",
        });
        const { stdout } = await cmd.output();
        console.log(`ran=${new TextDecoder().decode(stdout).trim()}`);
      } else {
        const node = await Deno.stat(String(root("bin", "node")));
        console.log(`node-exists=${node.isFile}`);
      }
    });
}

Deno.test("a build installs a multi-file runtime tree end-to-end via the CLI", async () => {
  const entries: TarEntry[] = [
    {
      name: "node-v1/bin/node",
      data: new TextEncoder().encode("#!/bin/sh\necho NODE-RAN\n"),
    },
  ];
  if (POSIX) {
    // Only plant the symlink on POSIX; Windows symlink creation is privileged
    // and Windows runtimes ship real .exe bins, not symlinks.
    entries.push(
      {
        name: "node-v1/lib/npm-cli.js",
        data: new TextEncoder().encode("#!/bin/sh\necho NPM\n"),
      },
      {
        name: "node-v1/bin/npm",
        data: new Uint8Array(0),
        linkname: "../lib/npm-cli.js",
      },
    );
  }
  tarballBytes = await gzip(tar(entries));
  toolsDir = await Deno.makeTempDir({ prefix: "zuke-tree-it-" });
  try {
    const { code, out } = await runCli(TreeBuild, ["install"]);
    assertEquals(code, 0);
    if (POSIX) {
      // Reading the symlinked bin returns the lib script it points at.
      assertStringIncludes(out, "npm-via-symlink=#!/bin/sh");
      assertStringIncludes(out, "echo NPM"); // symlink resolved to npm-cli.js
      assertStringIncludes(out, "ran=NODE-RAN"); // bin made executable, so it ran
    } else {
      assertStringIncludes(out, "node-exists=true"); // tree extracted
    }
  } finally {
    await Deno.remove(toolsDir, { recursive: true });
  }
});
