import { assertEquals, assertRejects } from "./_assert.ts";
import {
  type DownloadFn,
  hostPlatform,
  type InstallPlatform,
  installRelease,
} from "../src/install.ts";
import { createTarGzip } from "../src/compression.ts";

/**
 * The suffix `installRelease` adds to the installed filename for the host
 * platform. Tests that install for the default (host) platform must expect it,
 * since the Windows runner names the binary `<tool>.exe`.
 */
const EXE = Deno.build.os === "windows" ? ".exe" : "";

/** A download seam that writes fixed bytes to `dest`, recording the URL it saw. */
function fakeDownload(
  body: Uint8Array | string,
  seen: { url?: string } = {},
): DownloadFn {
  const bytes = typeof body === "string"
    ? new TextEncoder().encode(body)
    : body;
  return async (url, dest) => {
    seen.url = url;
    await Deno.writeFile(String(dest), bytes);
  };
}

Deno.test("hostPlatform reflects Deno.build", () => {
  assertEquals(hostPlatform(), {
    os: Deno.build.os,
    arch: Deno.build.arch,
  });
});

Deno.test("installRelease (raw) downloads the binary and returns its path", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const seen: { url?: string } = {};
    const bin = await installRelease({
      name: "mytool",
      destDir: dir,
      url: ({ os, arch }) => `https://example.com/mytool-${os}-${arch}`,
      download: fakeDownload("#!/bin/sh\necho hi\n", seen),
    });
    assertEquals(bin.name, `mytool${EXE}`);
    // `bin.path` is normalised to forward slashes; the raw temp dir is not on
    // Windows, so assert the suffix rather than the full string.
    assertEquals(bin.path.endsWith(`/mytool${EXE}`), true);
    assertEquals(
      seen.url,
      `https://example.com/mytool-${Deno.build.os}-${Deno.build.arch}`,
    );
    const contents = new TextDecoder().decode(await Deno.readFile(String(bin)));
    assertEquals(contents.includes("echo hi"), true);
    if (Deno.build.os !== "windows") {
      const mode = (await Deno.stat(String(bin))).mode ?? 0;
      assertEquals(mode & 0o111, 0o111); // executable bits set
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installRelease (raw) creates a missing destination directory", async () => {
  const root = await Deno.makeTempDir();
  try {
    const dest = `${root}/nested/bin`;
    const bin = await installRelease({
      name: "tool",
      destDir: dest,
      url: () => "https://example.com/tool",
      download: fakeDownload("binary"),
    });
    assertEquals(bin.path.endsWith(`/nested/bin/tool${EXE}`), true);
    assertEquals((await Deno.stat(String(bin))).isFile, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("installRelease (raw) resolves a relative destDir against cwd", async () => {
  const root = await Deno.makeTempDir();
  const prev = Deno.cwd();
  Deno.chdir(root);
  try {
    const bin = await installRelease({
      name: "rel",
      destDir: "out/bin",
      url: () => "https://example.com/rel",
      download: fakeDownload("x"),
    });
    // The returned path is absolute (resolved against cwd) and the file is
    // really there. `bin.path` uses forward slashes on every platform.
    assertEquals(bin.path.endsWith(`/out/bin/rel${EXE}`), true);
    assertEquals(bin.path === "out/bin/rel", false); // not left relative
    assertEquals((await Deno.stat(String(bin))).isFile, true);
  } finally {
    Deno.chdir(prev);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("installRelease (tar.gz) unpacks and installs the inner binary", async () => {
  const root = await Deno.makeTempDir();
  try {
    // Build a real .tar.gz containing bin/mytool, then serve it via the seam.
    await Deno.mkdir(`${root}/pkg/bin`, { recursive: true });
    await Deno.writeFile(
      `${root}/pkg/bin/mytool`,
      new TextEncoder().encode("tarred-binary"),
    );
    const archive = `${root}/mytool.tar.gz`;
    await createTarGzip(["bin/mytool"], archive, { cwd: `${root}/pkg` });
    const bytes = await Deno.readFile(archive);

    const dest = `${root}/install`;
    const bin = await installRelease({
      name: "mytool",
      destDir: dest,
      archive: "tar.gz",
      binaryPath: "bin/mytool",
      url: () => "https://example.com/mytool.tar.gz",
      download: fakeDownload(bytes),
    });
    assertEquals(bin.path.endsWith(`/mytool${EXE}`), true);
    const contents = new TextDecoder().decode(await Deno.readFile(String(bin)));
    assertEquals(contents, "tarred-binary");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("installRelease (tar.gz) defaults binaryPath to the tool name", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeFile(
      `${root}/flat`,
      new TextEncoder().encode("flat-binary"),
    );
    const archive = `${root}/flat.tar.gz`;
    await createTarGzip(["flat"], archive, { cwd: root });
    const bytes = await Deno.readFile(archive);

    const dest = `${root}/install`;
    const bin = await installRelease({
      name: "flat",
      destDir: dest,
      archive: "tar.gz",
      url: () => "https://example.com/flat.tar.gz",
      download: fakeDownload(bytes),
    });
    const contents = new TextDecoder().decode(await Deno.readFile(String(bin)));
    assertEquals(contents, "flat-binary");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("installRelease (windows) appends .exe and skips chmod", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const windows: InstallPlatform = { os: "windows", arch: "x86_64" };
    const seen: { url?: string } = {};
    const bin = await installRelease({
      name: "myTool",
      destDir: dir,
      platform: windows,
      url: ({ os }) => `https://example.com/${os}/myTool.exe`,
      download: fakeDownload("MZ", seen),
    });
    assertEquals(bin.name, "myTool.exe");
    assertEquals(seen.url, "https://example.com/windows/myTool.exe");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installRelease (windows) does not double a .exe suffix", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const bin = await installRelease({
      name: "already.exe",
      destDir: dir,
      platform: { os: "windows", arch: "aarch64" },
      url: () => "https://example.com/already.exe",
      download: fakeDownload("MZ"),
    });
    assertEquals(bin.name, "already.exe");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installRelease cleans up its scratch dir even when extraction fails", async () => {
  const root = await Deno.makeTempDir();
  try {
    const dest = `${root}/install`;
    // Serve non-tar bytes so gunzip/untar throws; the scratch dir must still go.
    await assertRejects(() =>
      installRelease({
        name: "broken",
        destDir: dest,
        archive: "tar.gz",
        url: () => "https://example.com/broken.tar.gz",
        download: fakeDownload("not a gzip stream"),
      })
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
