import { assertEquals } from "./_assert.ts";
import type { DownloadFn } from "../src/install.ts";
import { DEFAULT_TOOLS_DIR, Toolchain, toolchain } from "../src/toolchain.ts";

const EXE = Deno.build.os === "windows" ? ".exe" : "";

/** A download seam that writes the URL's own text, recording each URL fetched. */
function recordingDownload(seen: string[]): DownloadFn {
  return async (url, dest) => {
    seen.push(url);
    await Deno.writeFile(String(dest), new TextEncoder().encode(url));
  };
}

Deno.test("toolchain installs every declared tool and maps names to paths", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const seen: string[] = [];
    const tools = toolchain((t) =>
      t
        .tool({ name: "helm", url: () => "https://tools.test/helm" })
        .tool({ name: "kubectl", url: () => "https://tools.test/kubectl" })
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

Deno.test("toolchain exposes its declared tools in order", () => {
  const chain = new Toolchain()
    .tool({ name: "a", url: () => "a" })
    .tool({ name: "b", url: () => "b" });
  assertEquals(chain.tools.map((t) => t.name), ["a", "b"]);
});

Deno.test("a per-tool destDir overrides the toolchain default", async () => {
  const shared = await Deno.makeTempDir();
  const special = await Deno.makeTempDir();
  try {
    const tools = toolchain()
      .tool({ name: "one", url: () => "u1" })
      .tool({ name: "two", destDir: special, url: () => "u2" });
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

Deno.test("the default tools directory is .zuke/tools", () => {
  assertEquals(DEFAULT_TOOLS_DIR, ".zuke/tools");
});

Deno.test("install with no destDir uses .zuke/tools under the working directory", async () => {
  const dir = await Deno.makeTempDir();
  const original = Deno.cwd();
  try {
    Deno.chdir(dir);
    const bins = await toolchain()
      .tool({ name: "solo", url: () => "u" })
      .install({ download: recordingDownload([]) }); // no destDir
    assertEquals(
      bins.get("solo")?.path.endsWith(`/.zuke/tools/solo${EXE}`),
      true,
    );
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});
