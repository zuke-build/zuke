import { assertEquals, assertThrows } from "./_assert.ts";
import type { DownloadFn } from "../src/install.ts";
import type { NpmRunner } from "../src/npm_tool.ts";
import { gzip, tar } from "../src/compression.ts";
import {
  DEFAULT_TOOLS_DIR,
  Toolchain,
  toolchain,
  ToolInstallSettings,
  ToolTasks,
} from "../src/tool.ts";

/** A tiny release tarball wrapping a `pkg/bin/tool` under a top directory. */
function toolTarball(): Promise<Uint8Array> {
  return gzip(tar([
    { name: "pkg/bin/tool", data: new TextEncoder().encode("TREE-BIN") },
  ]));
}

/** A download seam that writes prepared archive bytes to `dest`. */
function bytesDownload(bytes: Uint8Array): DownloadFn {
  return async (_url, dest) => {
    await Deno.writeFile(String(dest), bytes);
  };
}

const EXE = Deno.build.os === "windows" ? ".exe" : "";
/** The npm bin-shim suffix on the host (`.cmd` on Windows, else none). */
const NPM_EXE = Deno.build.os === "windows" ? ".cmd" : "";

/** A download seam that writes the URL's own text, recording each URL fetched. */
function recordingDownload(seen: string[]): DownloadFn {
  return async (url, dest) => {
    seen.push(url);
    await Deno.writeFile(String(dest), new TextEncoder().encode(url));
  };
}

/** A fake npm runner that records argv and plants the named bin under `--prefix`. */
function recordingNpm(
  bin: string,
  calls: string[][],
): NpmRunner {
  return async (args) => {
    calls.push(args);
    const prefix = args[args.indexOf("--prefix") + 1];
    await Deno.mkdir(`${prefix}/node_modules/.bin`, { recursive: true });
    await Deno.writeTextFile(
      `${prefix}/node_modules/.bin/${bin}${NPM_EXE}`,
      "x",
    );
  };
}

Deno.test("ToolTasks.install fetches a single tool via a settings-lambda", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const seen: string[] = [];
    const bin = await ToolTasks.install((s) =>
      s
        .name("kubectl")
        .destDir(dir)
        .url(({ arch }) => `https://tools.test/kubectl-${arch}`)
        .download(recordingDownload(seen))
    );
    assertEquals(bin.name, `kubectl${EXE}`);
    assertEquals(bin.path.endsWith(`/kubectl${EXE}`), true);
    assertEquals(seen, [`https://tools.test/kubectl-${Deno.build.arch}`]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("toolchain installs every declared tool and maps names to paths", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const seen: string[] = [];
    const tools = toolchain((t) =>
      t
        .tool((s) => s.name("helm").url(() => "https://tools.test/helm"))
        .tool((s) => s.name("kubectl").url(() => "https://tools.test/kubectl"))
    );
    const bins = await tools.install({
      destDir: dir,
      download: recordingDownload(seen),
    });

    assertEquals([...bins.keys()].sort(), ["helm", "kubectl"]);
    assertEquals(bins.get("helm")?.name, `helm${EXE}`);
    assertEquals(bins.get("helm")?.path.endsWith(`/helm${EXE}`), true);
    assertEquals(seen.sort(), [
      "https://tools.test/helm",
      "https://tools.test/kubectl",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("toolchain exposes its configured tools in order", () => {
  const chain = new Toolchain()
    .tool((s) => s.name("a").url(() => "a"))
    .tool((s) => s.name("b").url(() => "b"));
  assertEquals(chain.tools.map((s) => s.name_), ["a", "b"]);
});

Deno.test("toolchain provisions npm tools alongside release tools", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const seen: string[] = [];
    const npmCalls: string[][] = [];
    const tools = toolchain((t) =>
      t.tool((s) => s.name("helm").url(() => "https://tools.test/helm"))
        .npm({ name: "vitest", version: "4.1.9" })
    );
    const bins = await tools.install({
      destDir: dir,
      download: recordingDownload(seen),
      npmRun: recordingNpm("vitest", npmCalls),
    });

    assertEquals([...bins.keys()].sort(), ["helm", "vitest"]);
    assertEquals(
      bins.get("vitest")?.path.endsWith(
        `/npm/vitest@4.1.9/node_modules/.bin/vitest${NPM_EXE}`,
      ),
      true,
    );
    assertEquals(npmCalls.length, 1);
    assertEquals(npmCalls[0][4], "vitest@4.1.9");
    assertEquals(seen, ["https://tools.test/helm"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("toolchain exposes its npm tools in declaration order", () => {
  const chain = new Toolchain()
    .npm({ name: "a", version: "1" })
    .npm({ name: "b", version: "2" });
  assertEquals(chain.npmTools.map((s) => s.name), ["a", "b"]);
});

Deno.test("ToolTasks.npm provisions a single npm package with a distinct bin", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const npmCalls: string[][] = [];
    const bin = await ToolTasks.npm(
      { name: "@nestjs/cli", version: "10.0.0", bin: "nest" },
      { destDir: dir, run: recordingNpm("nest", npmCalls) },
    );
    assertEquals(bin.name, `nest${NPM_EXE}`);
    assertEquals(npmCalls[0][4], "@nestjs/cli@10.0.0");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a per-tool destDir overrides the toolchain default", async () => {
  const shared = await Deno.makeTempDir();
  const special = await Deno.makeTempDir();
  try {
    const tools = toolchain()
      .tool((s) => s.name("one").url(() => "u1"))
      .tool((s) => s.name("two").destDir(special).url(() => "u2"));
    const bins = await tools.install({
      destDir: shared,
      download: recordingDownload([]),
    });

    assertEquals(
      bins.get("one")?.path.startsWith(shared.replace(/\\/g, "/")),
      true,
    );
    assertEquals(
      bins.get("two")?.path.startsWith(special.replace(/\\/g, "/")),
      true,
    );
  } finally {
    await Deno.remove(shared, { recursive: true });
    await Deno.remove(special, { recursive: true });
  }
});

Deno.test("a per-tool download seam is used when the toolchain sets none", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const seen: string[] = [];
    const bins = await toolchain()
      .tool((s) =>
        s.name("solo").destDir(dir).url(() => "https://tools.test/solo")
          .download(recordingDownload(seen))
      )
      .install(); // no download override at the toolchain level
    assertEquals(bins.get("solo")?.name, `solo${EXE}`);
    assertEquals(seen, ["https://tools.test/solo"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("install with no destDir uses .zuke/tools under the working directory", async () => {
  const dir = await Deno.makeTempDir();
  const original = Deno.cwd();
  try {
    Deno.chdir(dir);
    const bins = await toolchain()
      .tool((s) =>
        s.name("here").url(() => "u").download(recordingDownload([]))
      )
      .install(); // no destDir
    assertEquals(
      bins.get("here")?.path.endsWith(`/.zuke/tools/here${EXE}`),
      true,
    );
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("ToolInstallSettings.options_ requires name and url", () => {
  const noName = new ToolInstallSettings();
  assertThrows(
    () => noName.options_(DEFAULT_TOOLS_DIR),
    Error,
    "requires .name",
  );

  const noUrl = new ToolInstallSettings().name("x");
  assertThrows(() => noUrl.options_(DEFAULT_TOOLS_DIR), Error, "requires .url");
});

Deno.test("ToolInstallSettings carries every option through to the install spec", () => {
  const platform = { os: "linux", arch: "aarch64" } as const;
  const url = () => "u";
  const download: DownloadFn = () => Promise.resolve();
  const checksum = () => "a".repeat(64);
  const spec = new ToolInstallSettings()
    .name("t")
    .url(url)
    .archive("tar.gz")
    .binaryPath("dir/t")
    .checksum(checksum)
    .platform(platform)
    .download(download)
    .options_(".fallback");

  assertEquals(spec.name, "t");
  assertEquals(spec.destDir, ".fallback"); // fallback used when destDir unset
  assertEquals(spec.archive, "tar.gz");
  assertEquals(spec.binaryPath, "dir/t");
  assertEquals(spec.platform, platform);
  assertEquals(spec.checksum, checksum);
});

Deno.test("ToolTasks.installTree unpacks a runtime tree via a settings-lambda", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const tarball = await toolTarball();
    const root = await ToolTasks.installTree((s) =>
      s.name("node").destDir(dir).archive("tar.gz").strip(1).bins("bin/tool")
        .url(() => "https://tools.test/node.tar.gz")
        .download(bytesDownload(tarball))
    );
    assertEquals(root.path.endsWith("/node"), true);
    assertEquals(
      await Deno.readTextFile(String(root("bin", "tool"))),
      "TREE-BIN",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("toolchain installs a runtime tree alongside release tools", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const seen: string[] = [];
    const tarball = await toolTarball();
    // Each tool carries its own download seam (a tree needs a real archive, not
    // the URL-text a toolchain-level seam would write), so set none globally.
    const tools = toolchain((t) =>
      t.tool((s) =>
        s.name("helm").url(() => "https://tools.test/helm")
          .download(recordingDownload(seen))
      )
        .tree((s) =>
          s.name("node").archive("tar.gz").strip(1).bins("bin/tool")
            .url(() => "https://tools.test/node.tar.gz")
            .download(bytesDownload(tarball))
        )
    );
    const bins = await tools.install({ destDir: dir });
    assertEquals([...bins.keys()].sort(), ["helm", "node"]);
    // The tree's entry is its extracted root directory (a callable path).
    const root = bins.get("node");
    assertEquals(root?.path.endsWith("/node"), true);
    assertEquals(
      await Deno.readTextFile(String(root?.("bin", "tool"))),
      "TREE-BIN",
    );
    // The tree carried its own download seam; the toolchain default fetched helm.
    assertEquals(seen, ["https://tools.test/helm"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a toolchain-level download seam is applied to a tree without its own", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const tarball = await toolTarball();
    // The tree sets no .download(), so the toolchain-level seam must be used.
    const bins = await toolchain()
      .tree((s) =>
        s.name("node").archive("tar.gz").strip(1).bins("bin/tool").url(() =>
          "u"
        )
      )
      .install({ destDir: dir, download: bytesDownload(tarball) });
    const root = bins.get("node");
    assertEquals(
      await Deno.readTextFile(String(root?.("bin", "tool"))),
      "TREE-BIN",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("toolchain exposes its configured trees in order", () => {
  const chain = new Toolchain()
    .tree((s) => s.name("node").url(() => "n"))
    .tree((s) => s.name("bun").url(() => "b"));
  assertEquals(chain.trees.map((s) => s.name_), ["node", "bun"]);
});

Deno.test("treeOptions_ requires name and url and rejects a raw archive", () => {
  assertThrows(
    () => new ToolInstallSettings().treeOptions_(DEFAULT_TOOLS_DIR),
    Error,
    "requires .name",
  );
  assertThrows(
    () => new ToolInstallSettings().name("x").treeOptions_(DEFAULT_TOOLS_DIR),
    Error,
    "requires .url",
  );
  assertThrows(
    () =>
      new ToolInstallSettings().name("x").url(() => "u").archive("raw")
        .treeOptions_(DEFAULT_TOOLS_DIR),
    Error,
    'not "raw"',
  );
});

Deno.test("treeOptions_ carries strip/bins and defaults the archive to tar.gz", () => {
  const spec = new ToolInstallSettings()
    .name("node")
    .url(() => "u")
    .strip(1)
    .bins("bin/node", "bin/npm")
    .treeOptions_(".fallback");
  assertEquals(spec.name, "node");
  assertEquals(spec.destDir, ".fallback");
  assertEquals(spec.archive, "tar.gz"); // defaulted, since a tree ships packed
  assertEquals(spec.strip, 1);
  assertEquals(spec.bins, ["bin/node", "bin/npm"]);
});

Deno.test("the default tools directory is .zuke/tools", () => {
  assertEquals(DEFAULT_TOOLS_DIR, ".zuke/tools");
});
