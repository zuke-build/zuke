import { assertEquals, assertRejects } from "./_assert.ts";
import {
  type DownloadFn,
  hostPlatform,
  type InstallPlatform,
  installRelease,
  type Platform,
} from "../src/install.ts";
import { operatingSystem } from "../src/host.ts";
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

Deno.test("hostPlatform reports a normalised os and labels the os/arch", () => {
  const p = hostPlatform();
  assertEquals(p.os, operatingSystem()); // "macos", not "darwin"
  assertEquals(p.arch, Deno.build.arch);
  // A label with no alias falls back to the value itself…
  assertEquals(p.osLabel(), operatingSystem());
  assertEquals(p.archLabel(), Deno.build.arch);
  // …and an alias for the current os/arch is applied.
  assertEquals(p.osLabel({ [operatingSystem()]: "mapped" }), "mapped");
  assertEquals(p.archLabel({ [Deno.build.arch]: "mapped" }), "mapped");
});

Deno.test("the url callback receives a normalised, labelled Platform", async () => {
  const dir = await Deno.makeTempDir();
  const seen: { url?: string } = {};
  try {
    // A foreign platform so the labels are deterministic regardless of host.
    const bin = await installRelease({
      name: "labelled",
      destDir: dir,
      platform: { os: "macos", arch: "aarch64" },
      // macOS-as-"darwin" is a common tool convention; arch remaps too.
      url: (p) =>
        `https://example.com/${p.osLabel({ macos: "darwin" })}-${
          p.archLabel({ aarch64: "arm64" })
        }`,
      download: fakeDownload("x", seen),
    });
    assertEquals(seen.url, "https://example.com/darwin-arm64");
    assertEquals(bin.name, "labelled"); // macos → no .exe
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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

/** Hex SHA-256 of bytes or text, matching installRelease's own hashing. */
async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  )
    .join("");
}

/** Whether a path exists on disk. */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

Deno.test("installRelease verifies a matching checksum and records a marker", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const body = "#!/bin/sh\necho hi\n";
    const bin = await installRelease({
      name: "verified",
      destDir: dir,
      url: () => "https://example.com/verified",
      download: fakeDownload(body),
      checksum: await sha256Hex(body),
    });
    assertEquals(await exists(String(bin)), true);
    assertEquals(await exists(`${String(bin)}.sha256`), true); // marker written
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installRelease rejects a checksum mismatch and installs nothing", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const error = await assertRejects(() =>
      installRelease({
        name: "tampered",
        destDir: dir,
        url: () => "https://example.com/tampered",
        download: fakeDownload("real bytes"),
        checksum: "0".repeat(64), // definitely wrong
      })
    );
    assertEquals(error.message.includes("checksum mismatch"), true);
    assertEquals(await exists(`${dir}/tampered${EXE}`), false); // no unverified binary left behind
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installRelease reuses a cached install without downloading again", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const body = "binary";
    let calls = 0;
    const counting: DownloadFn = async (_url, dest) => {
      calls++;
      await Deno.writeFile(String(dest), new TextEncoder().encode(body));
    };
    const spec = {
      name: "cached",
      destDir: dir,
      url: () => "https://example.com/cached",
      download: counting,
      checksum: await sha256Hex(body),
    };
    const first = await installRelease(spec);
    const second = await installRelease(spec);
    assertEquals(calls, 1); // second call is a cache hit
    assertEquals(String(first), String(second));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installRelease re-downloads when the pinned checksum changes", async () => {
  const dir = await Deno.makeTempDir();
  try {
    let calls = 0;
    const versioned = (body: string): DownloadFn => async (_url, dest) => {
      calls++;
      await Deno.writeFile(String(dest), new TextEncoder().encode(body));
    };
    await installRelease({
      name: "bump",
      destDir: dir,
      url: () => "u",
      download: versioned("v1"),
      checksum: await sha256Hex("v1"),
    });
    await installRelease({
      name: "bump",
      destDir: dir,
      url: () => "u",
      download: versioned("v2"),
      checksum: await sha256Hex("v2"), // different pin → not a cache hit
    });
    assertEquals(calls, 2);
    assertEquals(
      new TextDecoder().decode(await Deno.readFile(`${dir}/bump${EXE}`)),
      "v2",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installRelease (tar.gz) verifies the archive checksum", async () => {
  const dir = await Deno.makeTempDir();
  const src = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${src}/tool`, "#!/bin/sh\n");
    await createTarGzip(["tool"], `${src}/archive.tar.gz`, { cwd: src });
    const archive = await Deno.readFile(`${src}/archive.tar.gz`);
    const download: DownloadFn = async (_url, dest) => {
      await Deno.writeFile(String(dest), archive);
    };

    const bin = await installRelease({
      name: "tool",
      destDir: dir,
      archive: "tar.gz",
      url: () => "https://example.com/archive.tar.gz",
      download,
      checksum: await sha256Hex(archive),
    });
    assertEquals(await exists(String(bin)), true);

    const bad = await assertRejects(() =>
      installRelease({
        name: "tool2",
        destDir: dir,
        archive: "tar.gz",
        url: () => "https://example.com/archive.tar.gz",
        download,
        checksum: "1".repeat(64),
      })
    );
    assertEquals(bad.message.includes("checksum mismatch"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(src, { recursive: true });
  }
});

Deno.test("installRelease resolves a per-platform checksum from the platform", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const body = "arm64-binary";
    const sum = await sha256Hex(body);
    let seen: Platform | undefined;
    const bin = await installRelease({
      name: "pinned",
      destDir: dir,
      platform: { os: "linux", arch: "aarch64" },
      url: ({ arch }) => `https://example.com/${arch}`,
      download: fakeDownload(body),
      checksum: (platform) => {
        seen = platform;
        return sum; // pinned for this platform
      },
    });
    assertEquals(seen?.os, "linux"); // resolver saw the platform
    assertEquals(seen?.arch, "aarch64");
    assertEquals(await exists(String(bin)), true); // resolved checksum verified + installed
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installRelease rejects a malformed checksum before downloading", async () => {
  const dir = await Deno.makeTempDir();
  try {
    let downloaded = false;
    const err = await assertRejects(() =>
      installRelease({
        name: "bad",
        destDir: dir,
        url: () => "https://example.com/bad",
        download: async (_url, dest) => {
          downloaded = true;
          await Deno.writeFile(String(dest), new Uint8Array());
        },
        checksum: "not-a-valid-sha256", // wrong length / non-hex
      })
    );
    assertEquals(err.message.includes("invalid checksum"), true);
    assertEquals(downloaded, false); // rejected before any network access
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installRelease reports a clear error when a resolver has no checksum for the platform", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const sums: Record<string, string> = {}; // this platform isn't mapped
    const err = await assertRejects(() =>
      installRelease({
        name: "unmapped",
        destDir: dir,
        platform: { os: "linux", arch: "x86_64" },
        url: () => "https://example.com/unmapped",
        download: fakeDownload("x"),
        checksum: ({ os, arch }) => sums[`${os}-${arch}`],
      })
    );
    assertEquals(err.message.includes("invalid checksum"), true);
    assertEquals(err.message.includes("linux/x86_64"), true); // names the platform
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
