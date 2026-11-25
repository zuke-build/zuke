// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { FileTasks, RuntimeTasks } from "../mod.ts";
import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { type DownloadFn, installTree } from "../src/install.ts";
import { gzip, tar, type TarEntry } from "../src/compression.ts";
import { sha256Hex } from "../src/internal.ts";
import { makeZip, STORED } from "../../../tests/_zip.ts";
import { GNU, longLink, ustarArchive } from "../../../tests/_tar.ts";
import { withTemp } from "../../../tests/_temp.ts";
import {
  ESCAPING_TAR_XZ,
  fixture,
  FLUTTER_TAR_XZ,
} from "../../../tests/_xz.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const POSIX = RuntimeTasks.os() !== "windows";

/** A download seam that writes fixed bytes to `dest`, counting its calls. */
function fakeDownload(
  bytes: Uint8Array,
  counter?: { calls: number },
): DownloadFn {
  return async (_url, dest) => {
    if (counter) counter.calls++;
    await FileTasks.writeBytes(String(dest), bytes);
  };
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

test("installTree unpacks a runtime tree, strips, and returns the root", async () => {
  await withTemp(async (dir) => {
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
      await FileTasks.readText(String(root("bin", "node"))),
      "#!/bin/sh\necho node\n",
    );
    if (POSIX) {
      const mode = (await FileTasks.stat(String(root("bin", "node")))).mode ??
        0;
      assertEquals(mode & 0o111, 0o111); // bin/node is executable
      // bin/npm is a real symlink; reading follows it to the lib script.
      const link = await FileTasks.lstat(String(root("bin", "npm")));
      assertEquals(link.isSymlink, true);
      assertEquals(
        await FileTasks.readText(String(root("bin", "npm"))),
        "#!/bin/sh\necho npm\n",
      );
      // chmod of the symlinked bin follows to its target, so npm-cli.js is +x.
      const targetMode =
        (await FileTasks.stat(String(root("bin", "npm")))).mode ??
          0;
      assertEquals(targetMode & 0o111, 0o111);
    }
  });
});

test("installTree unpacks a GNU tarball with @LongLink long paths (Node's Linux form)", async () => {
  // The consumer-reported crash: Node's Linux tarball is GNU format, so a
  // >100-byte path arrives as a @LongLink pseudo-entry plus a truncated header.
  // One name here truncates exactly at a "/", which used to make the extractor
  // writeFile onto a directory — "Is a directory (os error 21)".
  await withTemp(async (dir) => {
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
      await FileTasks.readText(
        String(root(...`${lib}skipFirst.js`.split("/"))),
      ),
      "a",
    );
    assertEquals(
      await FileTasks.readText(
        String(root(...`${lib}delay.base.js`.split("/"))),
      ),
      "b",
    );
  });
});

test("installTree verifies the archive checksum and reuses a cached tree", async () => {
  await withTemp(async (dir) => {
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
  });
});

test("installTree rejects a checksum mismatch and installs nothing", async () => {
  await withTemp(async (dir) => {
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
  });
});

test("installTree re-installs on a missing bin or a corrupt marker", async () => {
  await withTemp(async (dir) => {
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
    await FileTasks.remove(String(root("bin", "node")));
    await installTree(spec);
    assertEquals(counter.calls, 2);
    // A corrupt marker is treated as no marker → re-install again.
    await FileTasks.writeText(`${String(root)}.tree.json`, "not json{");
    await installTree(spec);
    assertEquals(counter.calls, 3);
  });
});

test("installTree re-installs when the pinned checksum changes", async () => {
  await withTemp(async (dir) => {
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
      await FileTasks.readText(String(root("bin", "node"))),
      "#!/bin/sh\necho node-v2\n",
    );
  });
});

test("installTree unpacks a zip tree and skips chmod for a windows target", async () => {
  await withTemp(async (dir) => {
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
    assertEquals(await FileTasks.readText(String(root("node.exe"))), "MZ");
    assertEquals(
      await FileTasks.readText(String(root("npm.cmd"))),
      "@echo off",
    );
  });
});

test("installTree without a checksum downloads every time and writes no marker", async () => {
  await withTemp(async (dir) => {
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
      await FileTasks.stat(`${String(root)}.tree.json`).then(() => true).catch(
        () => false,
      ),
      false, // no marker recorded without a checksum
    );
  });
});

test("installTree (tar.xz) verifies the checksum, strips, marks bins and keeps symlinks", async () => {
  await withTemp(async (dir) => {
    const bytes = fixture(FLUTTER_TAR_XZ);
    const counter = { calls: 0 };
    const options = {
      name: "flutter",
      destDir: dir,
      archive: "tar.xz" as const,
      strip: 1,
      bins: POSIX ? ["bin/flutter", "bin/dart"] : ["bin/flutter"],
      url: () => "https://example.com/flutter_linux_3.47.7-stable.tar.xz",
      download: fakeDownload(bytes, counter),
    };
    // A wrong checksum is refused before anything is unpacked.
    await assertRejects(
      () => installTree({ ...options, checksum: "0".repeat(64) }),
      Error,
      "checksum",
    );
    assertEquals(
      await FileTasks.stat(`${dir}/flutter/version`).catch(() => null),
      null,
    );

    const checksum = await sha256Hex(bytes);
    const root = await installTree({ ...options, checksum });
    assertEquals(await FileTasks.readText(String(root("version"))), "3.47.7\n");
    if (POSIX) {
      const mode =
        (await FileTasks.stat(String(root("bin", "flutter")))).mode ?? 0;
      assertEquals(mode & 0o111, 0o111);
      // bin/dart is a real symlink into the Dart SDK cache, as Flutter ships it.
      assertEquals(
        (await FileTasks.lstat(String(root("bin", "dart")))).isSymlink,
        true,
      );
      assertEquals(
        await FileTasks.readText(String(root("bin", "dart"))),
        "#!/bin/sh\necho dart\n",
      );
    }
    // A matching prior install is reused without downloading again.
    await installTree({ ...options, checksum });
    assertEquals(counter.calls, 2); // the refused attempt, then the real one
  });
});

test("installTree (tar.xz) refuses an archive with a path-traversal entry", async () => {
  await withTemp(async (dir) => {
    await assertRejects(
      () =>
        installTree({
          name: "pkg",
          destDir: `${dir}/tools`,
          archive: "tar.xz",
          url: () => "https://example.com/pkg.tar.xz",
          download: fakeDownload(fixture(ESCAPING_TAR_XZ)),
        }),
      Error,
      "escapes the destination",
    );
    assertEquals(await FileTasks.stat(`${dir}/escape`).catch(() => null), null);
  });
});
