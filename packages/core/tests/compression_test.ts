import { assertEquals, assertRejects, assertThrows } from "./_assert.ts";
import {
  assertSafeEntryName,
  assertSafeLinkTarget,
  createTarGzip,
  extractTarGzip,
  extractZip,
  gunzip,
  gzip,
  tar,
  type TarEntry,
  untar,
  unzip,
} from "../src/compression.ts";
import { DEFLATE, makeZip, STORED } from "./_zip.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

Deno.test("gzip/gunzip round-trips bytes", async () => {
  const original = enc("hello, world".repeat(100));
  const compressed = await gzip(original);
  // gzip has a header; the magic bytes are 0x1f 0x8b.
  assertEquals([compressed[0], compressed[1]], [0x1f, 0x8b]);
  assertEquals(dec(await gunzip(compressed)), dec(original));
});

Deno.test("tar/untar round-trips entries in order", () => {
  const entries: TarEntry[] = [
    { name: "a.txt", data: enc("alpha") },
    { name: "dir/b.bin", data: enc("beta-content-longer-than-a-bit") },
    { name: "empty", data: new Uint8Array(0) },
  ];
  const archive = tar(entries);
  // Archive length is a multiple of the 512-byte block size.
  assertEquals(archive.length % 512, 0);
  const out = untar(archive);
  assertEquals(out.map((e) => e.name), ["a.txt", "dir/b.bin", "empty"]);
  assertEquals(dec(out[0].data), "alpha");
  assertEquals(dec(out[1].data), "beta-content-longer-than-a-bit");
  assertEquals(out[2].data.length, 0);
});

Deno.test("tar output is reproducible (fixed mtime)", () => {
  const e: TarEntry[] = [{ name: "x", data: enc("same") }];
  assertEquals(tar(e), tar(e));
});

Deno.test("tar rejects names longer than the ustar limit", () => {
  const longName = "a/".repeat(60); // > 100 bytes
  // assertThrows would need sync; use a try to assert the message.
  let message = "";
  try {
    tar([{ name: longName, data: enc("x") }]);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message.includes("exceeds 100 bytes"), true);
});

Deno.test("untar stops at the zero-block trailer and ignores non-files", () => {
  // A valid archive followed by trailing zero blocks decodes to just its files.
  const archive = tar([{ name: "only.txt", data: enc("data") }]);
  const out = untar(archive);
  assertEquals(out.length, 1);
  assertEquals(out[0].name, "only.txt");
});

Deno.test("createTarGzip then extractTarGzip round-trips files on disk", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/src`);
    await Deno.writeTextFile(`${dir}/src/app.js`, "console.log(1)");
    await Deno.writeTextFile(`${dir}/README.md`, "# hi");

    const archive = `${dir}/out.tar.gz`;
    await createTarGzip(["src/app.js", "README.md"], archive, { cwd: dir });

    const outDir = `${dir}/unpacked`;
    await extractTarGzip(archive, outDir);
    assertEquals(
      await Deno.readTextFile(`${outDir}/src/app.js`),
      "console.log(1)",
    );
    assertEquals(await Deno.readTextFile(`${outDir}/README.md`), "# hi");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractTarGzip writes top-level entries without a subdirectory", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/flat.txt`, "flat");
    const archive = `${dir}/a.tar.gz`;
    await createTarGzip(["flat.txt"], archive, { cwd: dir });
    await extractTarGzip(archive, `${dir}/out`);
    assertEquals(await Deno.readTextFile(`${dir}/out/flat.txt`), "flat");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("createTarGzip fails clearly when a file is missing", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => createTarGzip(["nope.txt"], `${dir}/x.tar.gz`, { cwd: dir }),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractTarGzip refuses a path that escapes the destination", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // A hand-built archive with a traversing entry — a poisoned tarball.
    const archive = `${dir}/evil.tar.gz`;
    await Deno.writeFile(
      String(archive),
      await gzip(tar([
        { name: "../escape.txt", data: enc("pwned") },
      ])),
    );
    await assertRejects(
      () => extractTarGzip(archive, `${dir}/out`),
      Error,
      "escapes the destination",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("unzip round-trips a stored and a deflate entry", async () => {
  const compressible = enc("deflate ".repeat(200));
  const zip = await makeZip([
    { name: "raw.txt", data: enc("stored-bytes"), method: STORED },
    { name: "packed.txt", data: compressible, method: DEFLATE },
  ]);
  const out = await unzip(zip);
  assertEquals(out.map((e) => e.name), ["raw.txt", "packed.txt"]);
  assertEquals(dec(out[0].data), "stored-bytes");
  assertEquals(dec(out[1].data), dec(compressible));
});

Deno.test("unzip skips directory entries and keeps nested files", async () => {
  const zip = await makeZip([
    { name: "bin/" }, // directory entry — no data
    { name: "bin/tool", data: enc("#!/bin/sh\n"), method: DEFLATE },
  ]);
  const out = await unzip(zip);
  assertEquals(out.map((e) => e.name), ["bin/tool"]);
  assertEquals(dec(out[0].data), "#!/bin/sh\n");
});

Deno.test("extractZip writes files (stored + deflate + nested) to disk", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const zip = `${dir}/tool.zip`;
    await Deno.writeFile(
      zip,
      await makeZip([
        { name: "dprint", data: enc("BINARY"), method: STORED },
        {
          name: "lib/notes.txt",
          data: enc("read me".repeat(50)),
          method: DEFLATE,
        },
      ]),
    );
    await extractZip(zip, `${dir}/out`);
    assertEquals(await Deno.readTextFile(`${dir}/out/dprint`), "BINARY");
    assertEquals(
      await Deno.readTextFile(`${dir}/out/lib/notes.txt`),
      "read me".repeat(50),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractZip refuses a traversing or absolute entry (zip slip)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const evil = `${dir}/evil.zip`;
    await Deno.writeFile(
      evil,
      await makeZip([{ name: "../escape", data: enc("x") }]),
    );
    await assertRejects(
      () => extractZip(evil, `${dir}/out`),
      Error,
      "escapes the destination",
    );
    const abs = `${dir}/abs.zip`;
    await Deno.writeFile(
      abs,
      await makeZip([{ name: "/etc/x", data: enc("x") }]),
    );
    await assertRejects(
      () => extractZip(abs, `${dir}/out`),
      Error,
      "absolute path",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("unzip rejects an encrypted entry", async () => {
  const zip = await makeZip([
    { name: "secret", data: enc("x"), flags: 0x0001 },
  ]);
  await assertRejects(() => unzip(zip), Error, "encrypted");
});

Deno.test("unzip rejects a zip64 archive", async () => {
  const zip = await makeZip([{ name: "big", data: enc("x"), zip64: true }]);
  await assertRejects(() => unzip(zip), Error, "zip64");
});

Deno.test("unzip rejects an unsupported compression method", async () => {
  const zip = await makeZip([{ name: "bz", data: enc("x"), method: 12 }]);
  await assertRejects(
    () => unzip(zip),
    Error,
    "unsupported compression method",
  );
});

Deno.test("unzip rejects bytes that are not a zip", async () => {
  await assertRejects(
    () => unzip(enc("not a zip at all, no signature here")),
    Error,
    "not a zip archive",
  );
});

Deno.test("unzip rejects a corrupt local file header", async () => {
  const zip = await makeZip([{ name: "x", data: enc("data") }]);
  zip[0] = 0; // corrupt the local file-header signature
  await assertRejects(() => unzip(zip), Error, "malformed local header");
});

Deno.test("unzip rejects a zip64 end-of-central-directory", async () => {
  const zip = await makeZip([{ name: "x", data: enc("data") }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Point the central-directory offset at the zip64 sentinel.
  view.setUint32(zip.length - 22 + 16, 0xffffffff, true);
  await assertRejects(() => unzip(zip), Error, "zip64");
});

Deno.test("unzip rejects a corrupt central directory", async () => {
  const zip = await makeZip([{ name: "x", data: enc("data") }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const cdOffset = view.getUint32(zip.length - 22 + 16, true);
  view.setUint32(cdOffset, 0, true); // corrupt the central-directory signature
  await assertRejects(() => unzip(zip), Error, "malformed central directory");
});

Deno.test("unzip reports an out-of-range central-directory offset as malformed, not a RangeError", async () => {
  const zip = await makeZip([{ name: "x", data: enc("data") }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  view.setUint32(zip.length - 22 + 16, zip.length + 100, true); // cdOffset past end
  const err = await assertRejects(() => unzip(zip), Error);
  assertEquals(err.message.includes("malformed central directory"), true);
  assertEquals(err.message.includes("RangeError"), false);
});

Deno.test("unzip rejects a central-directory name that runs past the end", async () => {
  const zip = await makeZip([{ name: "x", data: enc("data") }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const cdOffset = view.getUint32(zip.length - 22 + 16, true);
  view.setUint16(cdOffset + 28, 5000, true); // absurd name length
  await assertRejects(() => unzip(zip), Error, "name runs past end");
});

Deno.test("unzip reports an out-of-range local-header offset as malformed", async () => {
  const zip = await makeZip([{ name: "x", data: enc("data") }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const cdOffset = view.getUint32(zip.length - 22 + 16, true);
  view.setUint32(cdOffset + 42, zip.length + 100, true); // localOffset past end
  await assertRejects(() => unzip(zip), Error, "malformed local header");
});

Deno.test("unzip rejects an entry whose data runs past the archive", async () => {
  const zip = await makeZip([{ name: "x", data: enc("data") }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const cdOffset = view.getUint32(zip.length - 22 + 16, true);
  view.setUint32(cdOffset + 20, zip.length * 10, true); // absurd compressed size
  await assertRejects(() => unzip(zip), Error, "runs past the archive");
});

Deno.test("unzip uses the local header's extra length, not the central directory's", async () => {
  // The local header carries a 5-byte extra field the central directory omits.
  // A reader that used the central-directory extra length would land 5 bytes
  // early and decode garbage; this proves it reads the local length.
  const zip = await makeZip([
    {
      name: "x",
      data: enc("payload"),
      localExtra: new Uint8Array([1, 2, 3, 4, 5]),
    },
  ]);
  const out = await unzip(zip);
  assertEquals(dec(out[0].data), "payload");
});

Deno.test("tar/untar round-trips a symlink entry (linkname, no data)", () => {
  const archive = tar([
    { name: "bin/node", data: enc("ELF-binary") },
    {
      name: "bin/npm",
      data: new Uint8Array(0),
      linkname: "../lib/node_modules/npm/bin/npm-cli.js",
    },
  ]);
  assertEquals(archive.length % 512, 0);
  const out = untar(archive);
  assertEquals(out.map((e) => e.name), ["bin/node", "bin/npm"]);
  assertEquals(out[0].linkname, undefined); // a regular file
  assertEquals(dec(out[0].data), "ELF-binary");
  assertEquals(out[1].linkname, "../lib/node_modules/npm/bin/npm-cli.js");
  assertEquals(out[1].data.length, 0); // a symlink carries no data
});

Deno.test("tar rejects a symlink target longer than the ustar limit", () => {
  let message = "";
  try {
    tar([{ name: "l", data: new Uint8Array(0), linkname: "x/".repeat(60) }]);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message.includes("symlink target exceeds 100 bytes"), true);
});

Deno.test("extractTarGzip strips leading path components", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const archive = `${dir}/a.tar.gz`;
    await Deno.writeFile(
      archive,
      await gzip(tar([
        { name: "pkg-1.0/bin/tool", data: enc("BIN") },
        { name: "pkg-1.0/README", data: enc("hi") },
        { name: "pkg-1.0", data: new Uint8Array(0) }, // top dir → fully stripped
      ])),
    );
    await extractTarGzip(archive, `${dir}/out`, { strip: 1 });
    assertEquals(await Deno.readTextFile(`${dir}/out/bin/tool`), "BIN");
    assertEquals(await Deno.readTextFile(`${dir}/out/README`), "hi");
    // The stripped-to-nothing top-level entry left no stray file.
    assertEquals(
      await Deno.stat(`${dir}/out`).then((s) => s.isDirectory),
      true,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractTarGzip recreates an in-tree symlink on disk (POSIX)", async () => {
  if (Deno.build.os === "windows") return; // symlink creation is privileged there
  const dir = await Deno.makeTempDir();
  try {
    const archive = `${dir}/a.tar.gz`;
    await Deno.writeFile(
      archive,
      await gzip(tar([
        { name: "lib/real.txt", data: enc("payload") },
        { name: "link", data: new Uint8Array(0), linkname: "lib/real.txt" },
      ])),
    );
    await extractTarGzip(archive, `${dir}/out`);
    const info = await Deno.lstat(`${dir}/out/link`);
    assertEquals(info.isSymlink, true);
    assertEquals(await Deno.readTextFile(`${dir}/out/link`), "payload"); // resolves
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractTarGzip lets a later symlink overwrite an earlier entry (no AlreadyExists crash)", async () => {
  if (Deno.build.os === "windows") return; // symlink creation is privileged there
  const dir = await Deno.makeTempDir();
  try {
    const archive = `${dir}/dup.tar.gz`;
    // A duplicate name: first a file, then a symlink. A raw Deno.symlink would
    // throw AlreadyExists; extraction must instead be "last one wins".
    await Deno.writeFile(
      archive,
      await gzip(tar([
        { name: "real.txt", data: enc("target") },
        { name: "x", data: enc("first-as-file") },
        { name: "x", data: new Uint8Array(0), linkname: "real.txt" },
      ])),
    );
    await extractTarGzip(archive, `${dir}/out`);
    const info = await Deno.lstat(`${dir}/out/x`);
    assertEquals(info.isSymlink, true); // the symlink won
    assertEquals(await Deno.readTextFile(`${dir}/out/x`), "target");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractTarGzip refuses a symlink whose target escapes the destination", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const archive = `${dir}/evil.tar.gz`;
    await Deno.writeFile(
      archive,
      await gzip(tar([
        {
          name: "bin/pwn",
          data: new Uint8Array(0),
          linkname: "../../../../etc/passwd",
        },
      ])),
    );
    await assertRejects(
      () => extractTarGzip(archive, `${dir}/out`),
      Error,
      "escapes the destination",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("assertSafeLinkTarget accepts in-tree targets and rejects escapes", () => {
  assertSafeLinkTarget("bin/npm", "../lib/npm-cli.js"); // resolves inside the tree
  assertSafeLinkTarget("bin/x", "./sibling");
  assertSafeLinkTarget("a/b/c", "../../top"); // climbs to root, not above
  assertThrows(
    () => assertSafeLinkTarget("bin/x", "/etc/passwd"),
    Error,
    "absolute path",
  );
  assertThrows(
    () => assertSafeLinkTarget("bin/x", "C:/win"),
    Error,
    "absolute path",
  );
  assertThrows(
    () => assertSafeLinkTarget("bin/x", "../../etc"),
    Error,
    "escapes",
  );
});

Deno.test("assertSafeEntryName accepts safe names and rejects escapes", () => {
  assertSafeEntryName("bin/tool"); // no throw
  assertSafeEntryName("a/b/c.txt");
  assertThrows(() => assertSafeEntryName("/abs"), Error, "absolute path");
  assertThrows(() => assertSafeEntryName("C:/win"), Error, "absolute path");
  assertThrows(
    () => assertSafeEntryName("a/../b"),
    Error,
    "escapes the destination",
  );
  assertThrows(
    () => assertSafeEntryName("..\\win"),
    Error,
    "escapes the destination",
  );
});
