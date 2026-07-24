import { assertEquals, assertRejects } from "./_assert.ts";
import { type DownloadFn, installTree } from "../src/install.ts";
import { gzip, tar, type TarEntry } from "../src/compression.ts";
import { makeZip, STORED } from "./_zip.ts";
import { GNU, longLink, ustarArchive } from "./_tar.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const POSIX = Deno.build.os !== "windows";

/** A download seam that writes fixed bytes to `dest`, counting its calls. */
function fakeDownload(
  bytes: Uint8Array,
  counter?: { calls: number },
): DownloadFn {
  return async (_url, dest) => {
    if (counter) counter.calls++;
    await Deno.writeFile(String(dest), bytes);
  };
}

/** Hex SHA-256 of bytes, matching installTree's own hashing. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * A Node-like release tarball: a `node-v1/` top directory, a real `bin/node`, a
 * `lib/` script, and a `bin/npm` symlink into it — the exact shape (top-dir wrap
 * + symlinked bins) that `installRelease` cannot handle but `installTree` can.
 */
function nodeTarball(): Promise<Uint8Array> {
  const entries: TarEntry[] = [
    { name: "node-v1/bin/node", data: enc("#!/bin/sh\necho node\n") },
  ];
  if (POSIX) {
    // Plant the symlinked bin only on POSIX: Windows symlink creation is
    // privileged (and Windows runtimes ship .zip of real bins, not symlinks), so
    // the symlink-preservation path is exercised on macOS/Linux runners.
    entries.push(
      {
        name: "node-v1/lib/node_modules/npm/bin/npm-cli.js",
        data: enc("#!/bin/sh\necho npm\n"),
      },
      {
        name: "node-v1/bin/npm",
        data: new Uint8Array(0),
        linkname: "../lib/node_modules/npm/bin/npm-cli.js",
      },
    );
  }
  return gzip(tar(entries));
}

Deno.test("installTree unpacks a runtime tree, strips, and returns the root", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const root = await installTree({
      name: "node",
      destDir: dir,
      archive: "tar.gz",
      strip: 1,
      bins: ["bin/node", "bin/npm"],
      url: () => "https://example.com/node.tar.gz",
      download: fakeDownload(await nodeTarball()),
    });
    assertEquals(root.path.endsWith("/node"), true);
    // The `node-v1/` wrapper is stripped: files sit directly under the root.
    assertEquals(
      await Deno.readTextFile(String(root("bin", "node"))),
      "#!/bin/sh\necho node\n",
    );
    if (POSIX) {
      const mode = (await Deno.stat(String(root("bin", "node")))).mode ?? 0;
      assertEquals(mode & 0o111, 0o111); // bin/node is executable
      // bin/npm is a real symlink; reading follows it to the lib script.
      const link = await Deno.lstat(String(root("bin", "npm")));
      assertEquals(link.isSymlink, true);
      assertEquals(
        await Deno.readTextFile(String(root("bin", "npm"))),
        "#!/bin/sh\necho npm\n",
      );
      // chmod of the symlinked bin follows to its target, so npm-cli.js is +x.
      const targetMode = (await Deno.stat(String(root("bin", "npm")))).mode ??
        0;
      assertEquals(targetMode & 0o111, 0o111);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installTree unpacks a GNU tarball with @LongLink long paths (Node's Linux form)", async () => {
  // The consumer-reported crash: Node's Linux tarball is GNU format, so a
  // >100-byte path arrives as a @LongLink pseudo-entry plus a truncated header.
  // One name here truncates exactly at a "/", which used to make the extractor
  // writeFile onto a directory — "Is a directory (os error 21)".
  const dir = await Deno.makeTempDir();
  try {
    const parent = `node-v1/lib/node_modules/npm/node_modules/${
      "x".repeat(57)
    }/`; // exactly 100 bytes
    const onSlash = `${parent}skipFirst.js`;
    const midName = `${parent}delay.base.js`;
    const raw = ustarArchive([
      { name: "node-v1/bin/node", prefix: "", data: enc("ELF"), magic: GNU },
      longLink(onSlash),
      { name: onSlash.slice(0, 100), prefix: "", data: enc("a"), magic: GNU },
      longLink(midName),
      { name: midName.slice(0, 100), prefix: "", data: enc("b"), magic: GNU },
    ]);
    const root = await installTree({
      name: "node",
      destDir: dir,
      archive: "tar.gz",
      strip: 1,
      url: () => "https://example.com/node.tar.gz",
      download: fakeDownload(await gzip(raw)),
    });
    const lib = onSlash.slice("node-v1/".length, -"skipFirst.js".length);
    assertEquals(
      await Deno.readTextFile(String(root(...`${lib}skipFirst.js`.split("/")))),
      "a",
    );
    assertEquals(
      await Deno.readTextFile(
        String(root(...`${lib}delay.base.js`.split("/"))),
      ),
      "b",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installTree verifies the archive checksum and reuses a cached tree", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const bytes = await nodeTarball();
    const counter = { calls: 0 };
    const spec = {
      name: "node",
      destDir: dir,
      archive: "tar.gz" as const,
      strip: 1,
      bins: ["bin/node"],
      url: () => "u",
      download: fakeDownload(bytes, counter),
      checksum: await sha256Hex(bytes),
    };
    const first = await installTree(spec);
    const second = await installTree(spec);
    assertEquals(counter.calls, 1); // the second call is a cache hit
    assertEquals(String(first), String(second));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installTree rejects a checksum mismatch and installs nothing", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const err = await assertRejects(() =>
      installTree({
        name: "node",
        destDir: dir,
        archive: "tar.gz",
        strip: 1,
        url: () => "u",
        download: fakeDownload(new TextEncoder().encode("nodeTarballBytes")),
        checksum: "0".repeat(64),
      })
    );
    assertEquals(err.message.includes("checksum mismatch"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installTree re-installs on a missing bin or a corrupt marker", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const bytes = await nodeTarball();
    const counter = { calls: 0 };
    const spec = {
      name: "node",
      destDir: dir,
      archive: "tar.gz" as const,
      strip: 1,
      bins: ["bin/node"],
      url: () => "u",
      download: fakeDownload(bytes, counter),
      checksum: await sha256Hex(bytes),
    };
    const root = await installTree(spec);
    // A deleted declared bin invalidates the cache → re-download and re-extract.
    await Deno.remove(String(root("bin", "node")));
    await installTree(spec);
    assertEquals(counter.calls, 2);
    // A corrupt marker is treated as no marker → re-install again.
    await Deno.writeTextFile(`${String(root)}.tree.json`, "not json{");
    await installTree(spec);
    assertEquals(counter.calls, 3);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installTree re-installs when the pinned checksum changes", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const v1 = await nodeTarball();
    // A second, distinct tarball (different bin contents → a different checksum).
    const v2 = await gzip(tar([
      { name: "node-v1/bin/node", data: enc("#!/bin/sh\necho node-v2\n") },
    ]));
    const counter = { calls: 0 };
    await installTree({
      name: "node",
      destDir: dir,
      archive: "tar.gz",
      strip: 1,
      bins: ["bin/node"],
      url: () => "u",
      download: fakeDownload(v1, counter),
      checksum: await sha256Hex(v1),
    });
    const root = await installTree({
      name: "node",
      destDir: dir,
      archive: "tar.gz",
      strip: 1,
      bins: ["bin/node"],
      url: () => "u",
      download: fakeDownload(v2, counter),
      checksum: await sha256Hex(v2), // a valid but different pin → cache miss
    });
    assertEquals(counter.calls, 2);
    assertEquals(
      await Deno.readTextFile(String(root("bin", "node"))),
      "#!/bin/sh\necho node-v2\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installTree unpacks a zip tree and skips chmod for a windows target", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Windows Node ships a .zip of real .exe/.cmd files (no symlinks). A windows
    // target skips chmod — which exercises that branch on a POSIX CI runner too.
    const bytes = await makeZip([
      { name: "node-v1/node.exe", data: enc("MZ"), method: STORED },
      { name: "node-v1/npm.cmd", data: enc("@echo off"), method: STORED },
    ]);
    const root = await installTree({
      name: "node",
      destDir: dir,
      archive: "zip",
      strip: 1,
      bins: ["node.exe"],
      platform: { os: "windows", arch: "x86_64" },
      url: () => "https://example.com/node.zip",
      download: fakeDownload(bytes),
    });
    assertEquals(await Deno.readTextFile(String(root("node.exe"))), "MZ");
    assertEquals(await Deno.readTextFile(String(root("npm.cmd"))), "@echo off");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installTree without a checksum downloads every time and writes no marker", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const counter = { calls: 0 };
    const spec = {
      name: "node",
      destDir: dir,
      archive: "tar.gz" as const,
      strip: 1,
      bins: ["bin/node"],
      url: () => "u",
      download: fakeDownload(await nodeTarball(), counter),
    };
    const root = await installTree(spec);
    await installTree(spec);
    assertEquals(counter.calls, 2); // no checksum → no cache
    assertEquals(
      await Deno.stat(`${String(root)}.tree.json`).then(() => true).catch(
        () => false,
      ),
      false, // no marker recorded without a checksum
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
