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
import { GNU, longLink, ustarArchive } from "./_tar.ts";

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

Deno.test("untar reconstructs a long path from the ustar prefix field", () => {
  // A >100-byte path POSIX tar split across prefix + name (as Node's tarball
  // does for npm's deeply-nested bundled deps).
  const prefix =
    "lib/node_modules/npm/node_modules/@npmcli/config/lib/definitions";
  const out = untar(ustarArchive([
    { name: "definitions.js", prefix, data: enc("module.exports = {};") },
    // A short path with the ustar magic but an empty prefix stays unchanged.
    { name: "short.txt", prefix: "", data: enc("no prefix") },
  ]));
  assertEquals(out.map((e) => e.name), [
    `${prefix}/definitions.js`,
    "short.txt",
  ]);
  assertEquals(dec(out[0].data), "module.exports = {};");
  assertEquals(dec(out[1].data), "no prefix");
});

Deno.test("untar ignores the prefix field for a non-ustar (GNU) header", () => {
  // GNU tar writes "ustar " (trailing space) and reuses the byte-345 region for
  // other fields, so the prefix must not be treated as a path there.
  const out = untar(ustarArchive([
    { name: "short.js", prefix: "not/a/path", data: enc("x"), magic: "ustar " },
  ]));
  assertEquals(out.length, 1);
  assertEquals(out[0].name, "short.js"); // prefix not prepended
});

// GNU tar (which builds Node's Linux tarballs) stores a >100-byte path as a
// `@LongLink` pseudo-entry (typeflag 'L') whose *data* is the full name; the
// following real header carries the name truncated to 100 bytes.
Deno.test("untar reconstructs a GNU @LongLink long name", () => {
  const full =
    "node-v1/lib/node_modules/npm/node_modules/exponential-backoff/dist/delay/always/alwaysDelayStrategy.class.js";
  const out = untar(ustarArchive([
    longLink(full),
    { name: full.slice(0, 100), prefix: "", data: enc("long"), magic: GNU },
    // The long name applies only to the entry right after it.
    { name: "short.js", prefix: "", data: enc("short"), magic: GNU },
  ]));
  assertEquals(out.map((e) => e.name), [full, "short.js"]);
  assertEquals(dec(out[0].data), "long");
});

Deno.test("untar reconstructs a GNU @LongLink symlink target (typeflag K)", () => {
  const target = `../${"t".repeat(100)}/npm-cli.js`; // > 100 bytes
  const out = untar(ustarArchive([
    longLink(target, 0x4b), // 'K' — the next entry's link target
    {
      name: "bin/npm",
      prefix: "",
      data: new Uint8Array(0),
      magic: GNU,
      typeflag: 0x32,
    },
  ]));
  assertEquals(out.length, 1);
  assertEquals(out[0].linkname, target);
});

Deno.test("extractTarGzip refuses a @LongLink symlink target that escapes or is absolute", async () => {
  // A 'K'-provided long target goes through the same assertSafeLinkTarget as a
  // short one — a poisoned GNU tarball can't use @LongLink to smuggle an
  // escaping or absolute symlink past the guard.
  const dir = await Deno.makeTempDir();
  try {
    const escaping = `../../${"e".repeat(100)}/etc/passwd`;
    const evil = `${dir}/evil.tar.gz`;
    await Deno.writeFile(
      evil,
      await gzip(ustarArchive([
        longLink(escaping, 0x4b),
        {
          name: "bin/pwn",
          prefix: "",
          data: new Uint8Array(0),
          magic: GNU,
          typeflag: 0x32,
        },
      ])),
    );
    await assertRejects(
      () => extractTarGzip(evil, `${dir}/out`),
      Error,
      "escapes the destination",
    );

    const absolute = `/etc/${"a".repeat(100)}/passwd`;
    const abs = `${dir}/abs.tar.gz`;
    await Deno.writeFile(
      abs,
      await gzip(ustarArchive([
        longLink(absolute, 0x4b),
        {
          name: "bin/pwn2",
          prefix: "",
          data: new Uint8Array(0),
          magic: GNU,
          typeflag: 0x32,
        },
      ])),
    );
    await assertRejects(
      () => extractTarGzip(abs, `${dir}/out`),
      Error,
      "absolute path",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractTarGzip handles a @LongLink name whose 100-byte truncation ends on a slash", async () => {
  // The consumer-reported crash: the truncated name ends exactly at a "/", so
  // the un-fixed reader mkdir'd that path and then writeFile'd the directory —
  // "Is a directory (os error 21)".
  const dir = await Deno.makeTempDir();
  try {
    const parent = `node-v1/lib/${"x".repeat(87)}/`; // exactly 100 bytes
    const full = `${parent}file.js`;
    const raw = ustarArchive([
      longLink(full),
      { name: full.slice(0, 100), prefix: "", data: enc("ok"), magic: GNU },
    ]);
    const archive = `${dir}/node.tar.gz`;
    await Deno.writeFile(archive, await gzip(raw));
    await extractTarGzip(archive, `${dir}/out`);
    assertEquals(await Deno.readTextFile(`${dir}/out/${full}`), "ok");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("untar ignores an empty @LongLink and keeps the following entry's real name", () => {
  // A zero-size 'L' pseudo-entry must not blank the next name: `longName = ""`
  // would defeat the `?? entryName(...)` fallback and drop the file.
  const out = untar(ustarArchive([
    {
      name: "././@LongLink",
      prefix: "",
      data: enc(""),
      magic: GNU,
      typeflag: 0x4c,
    },
    { name: "real-file.txt", prefix: "", data: enc("hello"), magic: GNU },
  ]));
  assertEquals(out.map((e) => e.name), ["real-file.txt"]);
  assertEquals(dec(out[0].data), "hello");
});

Deno.test("untar reconstructs a pax path= long name and lets pax win over a GNU name", () => {
  const paxPath = `deep/${"p".repeat(120)}/module.js`; // > 100 bytes
  const paxRecord = (key: string, value: string) => {
    // A pax record is "<len> key=value\n", where len counts the whole record —
    // including its own digits, so solve for the fixed point.
    const body = ` ${key}=${value}\n`;
    let len = body.length;
    while (`${len}`.length + body.length !== len) {
      len = `${len}`.length + body.length;
    }
    return `${len}${body}`;
  };
  // 'x' path= alone → the file takes the pax path.
  const outPax = untar(ustarArchive([
    {
      name: "PaxHeader",
      prefix: "",
      data: enc(paxRecord("path", paxPath)),
      magic: GNU,
      typeflag: 0x78,
    },
    { name: "short.js", prefix: "", data: enc("body"), magic: GNU },
  ]));
  assertEquals(outPax.map((e) => e.name), [paxPath]);
  assertEquals(dec(outPax[0].data), "body");

  // 'L' then 'x' path= then the file → pax wins over the GNU long name.
  const outBoth = untar(ustarArchive([
    longLink("gnu/name/ignored.js"),
    {
      name: "PaxHeader",
      prefix: "",
      data: enc(paxRecord("path", paxPath)),
      magic: GNU,
      typeflag: 0x78,
    },
    { name: "short.js", prefix: "", data: enc("both"), magic: GNU },
  ]));
  assertEquals(outBoth.map((e) => e.name), [paxPath]);
});

Deno.test("untar keeps a GNU long name across a pax metadata header (accumulation)", () => {
  const full = `keep/${"k".repeat(120)}/index.js`; // > 100 bytes
  // 'L' (name) then an 'x' header carrying only mtime (no path=) then the file:
  // the long name must survive the intervening metadata, not be dropped.
  const out = untar(ustarArchive([
    longLink(full),
    {
      name: "PaxHeader",
      prefix: "",
      data: enc("30 mtime=1700000000.000000000\n"),
      magic: GNU,
      typeflag: 0x78,
    },
    { name: full.slice(0, 100), prefix: "", data: enc("kept"), magic: GNU },
  ]));
  assertEquals(out.map((e) => e.name), [full]);
  assertEquals(dec(out[0].data), "kept");
});

Deno.test("untar emits a '5' directory entry (with the GNU long name consumed by it)", () => {
  const longDir = `d/${"l".repeat(120)}`; // > 100 bytes, a long-named directory
  const out = untar(ustarArchive([
    longLink(`${longDir}/`),
    {
      name: `${longDir.slice(0, 99)}/`,
      prefix: "",
      data: new Uint8Array(0),
      magic: GNU,
      typeflag: 0x35,
    },
    // The long name was consumed by the directory, so this file keeps its own.
    { name: "plain.txt", prefix: "", data: enc("f"), magic: GNU },
  ]));
  assertEquals(out.map((e) => e.name), [`${longDir}/`, "plain.txt"]);
  assertEquals(out[0].data.length, 0);
});

Deno.test("untar attaches a 'K' long target to a symlink and does not leak it to a regular file", () => {
  const target = `../${"t".repeat(120)}/npm-cli.js`; // > 100 bytes
  // 'K' then a regular file (not a symlink): the file has no linkname and the
  // pending target is consumed, not leaked onto a later symlink.
  const out = untar(ustarArchive([
    longLink(target, 0x4b),
    { name: "not-a-link.txt", prefix: "", data: enc("x"), magic: GNU },
    {
      name: "later-link",
      prefix: "",
      data: new Uint8Array(0),
      magic: GNU,
      typeflag: 0x32,
    },
  ]));
  assertEquals(out.map((e) => e.name), ["not-a-link.txt", "later-link"]);
  assertEquals(out[0].linkname, undefined); // regular file, no target
  assertEquals(out[1].linkname, ""); // its own (empty) header target, not the 'K'
});

Deno.test("untar clamps a malformed huge @LongLink size (no out-of-bounds scan or hang)", () => {
  // A hand-built 'L' header whose size field claims far more than the archive
  // holds, with no trailing NUL: the clamp bounds the read to what's present.
  const header = new Uint8Array(512);
  header.set(enc("././@LongLink"), 0);
  header.set(enc("77777777777"), 124); // ~8.5e9 bytes claimed
  header[156] = 0x4c; // 'L'
  header.set(enc(GNU), 257);
  const data = enc("abc/def"); // far short of the claimed size, no NUL padding
  const archive = new Uint8Array(512 + data.length);
  archive.set(header, 0);
  archive.set(data, 512);
  // Must return promptly without throwing; the truncated archive yields no
  // real member after the clamped long-name block. (Without the clamp,
  // readString scans to the ~8.5e9-byte claimed width — a multi-second hang.)
  const out = untar(archive);
  assertEquals(out.length, 0);
});

Deno.test("extractTarGzip refuses to extract through an archive-planted symlink chain", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // The confirmed high-severity escape: chain in-tree symlinks so a later
    // entry's parent is redirected above the destination. Each link target
    // passes the lexical check; the escape only exists once both are on disk.
    const archive = `${dir}/evil.tar.gz`;
    await Deno.writeFile(
      archive,
      await gzip(tar([
        { name: "w/link", data: new Uint8Array(0), linkname: ".." },
        { name: "w/link/escape", data: new Uint8Array(0), linkname: ".." },
        { name: "w/link/escape/pwned.txt", data: enc("PWNED") },
      ])),
    );
    await assertRejects(
      () => extractTarGzip(archive, `${dir}/out`),
      Error,
      "through the symlink",
    );
    // Nothing was planted in the parent of the destination.
    assertEquals(
      await Deno.stat(`${dir}/pwned.txt`).then(() => true).catch(() => false),
      false,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractTarGzip lets a directory entry replace an existing file at that path", async () => {
  if (Deno.build.os === "windows") return; // symlink-adjacent edge; keep POSIX
  const dir = await Deno.makeTempDir();
  try {
    const archive = `${dir}/dup.tar.gz`;
    // A malformed duplicate: a file "pkg" then a directory "pkg/". The dir must
    // win (last one wins) rather than crash with "Not a directory".
    await Deno.writeFile(
      archive,
      await gzip(ustarArchive([
        { name: "pkg", prefix: "", data: enc("i am a file") },
        { name: "pkg/", prefix: "", data: new Uint8Array(0), typeflag: 0x35 },
        { name: "pkg/child.txt", prefix: "", data: enc("child") },
      ])),
    );
    await extractTarGzip(archive, `${dir}/out`);
    assertEquals((await Deno.stat(`${dir}/out/pkg`)).isDirectory, true);
    assertEquals(await Deno.readTextFile(`${dir}/out/pkg/child.txt`), "child");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractTarGzip creates a trailing-slash directory entry instead of writing a file", async () => {
  // Old (pre-ustar) tar marks a directory as a size-0 *file* entry with a
  // trailing slash; writing it as a file would crash on the just-created dir.
  const dir = await Deno.makeTempDir();
  try {
    const raw = ustarArchive([
      { name: "pkg/lib/", prefix: "", data: new Uint8Array(0) },
      { name: "pkg/lib/a.js", prefix: "", data: enc("a") },
    ]);
    const archive = `${dir}/v7.tar.gz`;
    await Deno.writeFile(archive, await gzip(raw));
    await extractTarGzip(archive, `${dir}/out`);
    assertEquals((await Deno.stat(`${dir}/out/pkg/lib`)).isDirectory, true);
    assertEquals(await Deno.readTextFile(`${dir}/out/pkg/lib/a.js`), "a");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractTarGzip lands a >100-byte prefixed path at its full location", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const prefix =
      "lib/node_modules/npm/node_modules/@npmcli/config/lib/definitions";
    const raw = ustarArchive([
      { name: "definitions.js", prefix, data: enc("ok") },
    ]);
    const archive = `${dir}/node.tar.gz`;
    await Deno.writeFile(archive, await gzip(raw));
    const outDir = `${dir}/out`;
    await extractTarGzip(archive, outDir);
    // The file lands at its full nested path, not truncated under the root.
    assertEquals(
      await Deno.readTextFile(`${outDir}/${prefix}/definitions.js`),
      "ok",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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
