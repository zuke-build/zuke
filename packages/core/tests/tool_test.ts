import { assertEquals, assertThrows } from "./_assert.ts";
import type { DownloadFn } from "../src/install.ts";
import {
  DEFAULT_TOOLS_DIR,
  Toolchain,
  toolchain,
  ToolInstallSettings,
  ToolTasks,
} from "../src/tool.ts";

const EXE = Deno.build.os === "windows" ? ".exe" : "";

/** A download seam that writes the URL's own text, recording each URL fetched. */
function recordingDownload(seen: string[]): DownloadFn {
  return async (url, dest) => {
    seen.push(url);
    await Deno.writeFile(String(dest), new TextEncoder().encode(url));
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

Deno.test("the default tools directory is .zuke/tools", () => {
  assertEquals(DEFAULT_TOOLS_DIR, ".zuke/tools");
});
