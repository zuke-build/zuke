import { assertEquals, assertRejects } from "./_assert.ts";
import {
  createTarGzip,
  extractTarGzip,
  gunzip,
  gzip,
  tar,
  type TarEntry,
  untar,
} from "../src/compression.ts";

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
