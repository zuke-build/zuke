/**
 * Compression helpers for build scripts: gzip/gunzip byte streams, read or write
 * `tar` / `.tar.gz` archives, and read `.zip` archives. Dependency-free — gzip
 * and deflate use the platform `CompressionStream`/`DecompressionStream`, and
 * the tar reader/writer and the zip reader implement the formats directly.
 *
 * ```ts
 * import { createTarGzip, extractTarGzip, extractZip } from "jsr:@zuke/core";
 *
 * await createTarGzip(["dist/app.js", "README.md"], "artifact.tar.gz");
 * await extractTarGzip("artifact.tar.gz", "out");
 * await extractZip("tool.zip", "out"); // read-only: many release assets ship zip
 * ```
 *
 * `tar` entry names are limited to 100 bytes (the `ustar` name field); longer
 * names throw. Archives are written with a fixed mtime so output is
 * reproducible. Zip reading supports the two methods release assets use —
 * `stored` and `deflate` — and rejects encrypted or zip64 archives with a
 * friendly error; every extractor rejects an entry name that would escape the
 * destination directory (a "zip slip").
 *
 * @module
 */

import type { PathLike } from "./path.ts";

/**
 * Reject an archive entry whose name would escape the destination directory — an
 * absolute path or one with a `..` segment (a "zip slip"). A downloaded or
 * poisoned archive must never place files outside where it is being unpacked.
 */
export function assertSafeEntryName(name: string): void {
  const normalized = name.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`archive: refusing to unpack an absolute path: "${name}".`);
  }
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(
      `archive: refusing to unpack a path that escapes the destination: ` +
        `"${name}".`,
    );
  }
}

/** Gzip-compress `data` using the platform `CompressionStream`. */
export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer-backed view so the Blob accepts it.
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Gunzip-decompress `data` using the platform `DecompressionStream`. */
export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A single file entry within a tar archive. */
export interface TarEntry {
  /** The entry's path inside the archive (≤ 100 bytes). */
  name: string;
  /** The file contents. */
  data: Uint8Array;
}

/** The tar block size; headers and data are padded to a multiple of this. */
const BLOCK = 512;

/** Round `n` up to the next multiple of {@link BLOCK}. */
function padded(n: number): number {
  return Math.ceil(n / BLOCK) * BLOCK;
}

/** Write `value` into `block` at `offset` as NUL-terminated ASCII. */
function writeString(block: Uint8Array, offset: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  block.set(bytes, offset);
}

/** Write `value` as zero-padded octal of `width` digits plus a NUL terminator. */
function writeOctal(
  block: Uint8Array,
  offset: number,
  width: number,
  value: number,
): void {
  const text = value.toString(8).padStart(width, "0");
  writeString(block, offset, text);
}

/** Build the 512-byte `ustar` header for one entry. */
function tarHeader(name: string, size: number): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  if (nameBytes.length > 100) {
    throw new Error(
      `tar: entry name exceeds 100 bytes (ustar limit): "${name}"`,
    );
  }
  const header = new Uint8Array(BLOCK);
  writeString(header, 0, name);
  writeOctal(header, 100, 7, 0o644); // mode
  writeOctal(header, 108, 7, 0); // uid
  writeOctal(header, 116, 7, 0); // gid
  writeOctal(header, 124, 11, size); // size
  writeOctal(header, 136, 11, 0); // mtime (fixed for reproducibility)
  header[156] = 0x30; // typeflag '0' (regular file)
  writeString(header, 257, "ustar\0"); // magic
  header[263] = 0x30; // version "00"
  header[264] = 0x30;
  // Checksum: computed with the checksum field filled with spaces.
  header.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of header) sum += byte;
  writeOctal(header, 148, 6, sum);
  header[154] = 0; // NUL after the 6 octal digits
  header[155] = 0x20; // trailing space
  return header;
}

/** Create a `ustar` archive from the given entries (in order). */
export function tar(entries: TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  let total = 0;
  for (const entry of entries) {
    const header = tarHeader(entry.name, entry.data.length);
    blocks.push(header);
    total += BLOCK;
    const body = new Uint8Array(padded(entry.data.length));
    body.set(entry.data);
    blocks.push(body);
    total += body.length;
  }
  // Two zero blocks terminate the archive.
  const trailer = new Uint8Array(BLOCK * 2);
  blocks.push(trailer);
  total += trailer.length;

  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

/** Parse octal digits from a header field, ignoring NUL/space padding. */
function readOctal(block: Uint8Array, offset: number, width: number): number {
  let text = "";
  for (let i = offset; i < offset + width; i++) {
    const c = block[i];
    if (c === 0 || c === 0x20) continue;
    text += String.fromCharCode(c);
  }
  return text === "" ? 0 : parseInt(text, 8);
}

/** Read a NUL-terminated string from a header field. */
function readString(block: Uint8Array, offset: number, width: number): string {
  let end = offset;
  while (end < offset + width && block[end] !== 0) end++;
  return new TextDecoder().decode(block.subarray(offset, end));
}

/** Whether the 512-byte block at `offset` is entirely zero (archive trailer). */
function isZeroBlock(archive: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + BLOCK; i++) {
    if (archive[i] !== 0) return false;
  }
  return true;
}

/** Extract the entries from a `ustar` archive (regular files only). */
export function untar(archive: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    if (isZeroBlock(archive, offset)) break;
    const name = readString(archive, offset, 100);
    // Read the full 12-byte size field; the trailing byte is a NUL terminator.
    const size = readOctal(archive, offset + 124, 12);
    const typeflag = archive[offset + 156];
    offset += BLOCK;
    // Only regular files ('0' or legacy '\0') carry extractable data.
    if (typeflag === 0x30 || typeflag === 0) {
      entries.push({ name, data: archive.slice(offset, offset + size) });
    }
    offset += padded(size);
  }
  return entries;
}

/**
 * Read `files` (relative to `cwd`), pack them into a tar archive named by their
 * path relative to `cwd`, gzip it, and write the result to `dest`.
 */
export async function createTarGzip(
  files: PathLike[],
  dest: PathLike,
  options: { cwd?: string } = {},
): Promise<void> {
  const cwd = options.cwd ?? Deno.cwd();
  const entries: TarEntry[] = [];
  for (const file of files) {
    const name = String(file);
    const data = await Deno.readFile(`${cwd}/${name}`);
    entries.push({ name, data });
  }
  await Deno.writeFile(String(dest), await gzip(tar(entries)));
}

/**
 * Read the `.tar.gz` at `src`, gunzip and unpack it, and write each entry under
 * `destDir` (creating parent directories as needed).
 */
export async function extractTarGzip(
  src: PathLike,
  destDir: PathLike,
): Promise<void> {
  const archive = untar(await gunzip(await Deno.readFile(String(src))));
  await writeEntries(archive, destDir);
}

/**
 * Write each archive `entry` under `destDir`, creating parent directories as
 * needed. Every entry name is validated first ({@link assertSafeEntryName}), so
 * a malicious archive cannot plant a file outside `destDir` (a "zip slip").
 */
async function writeEntries(
  entries: TarEntry[],
  destDir: PathLike,
): Promise<void> {
  for (const entry of entries) assertSafeEntryName(entry.name);
  const root = String(destDir);
  for (const entry of entries) {
    const path = `${root}/${entry.name}`;
    const slash = path.lastIndexOf("/");
    if (slash !== -1) {
      await Deno.mkdir(path.slice(0, slash), { recursive: true });
    }
    await Deno.writeFile(path, entry.data);
  }
}

// --- ZIP reading -----------------------------------------------------------
// Many release assets (dprint, deno, …) ship a `.zip`, so installing a tool
// needs to read one. This is a *reader* only — the central directory is the
// authoritative index — supporting the two methods release zips use.

/** The End Of Central Directory record signature. */
const ZIP_EOCD_SIG = 0x06054b50;
/** The central-directory file-header signature. */
const ZIP_CD_SIG = 0x02014b50;
/** The local file-header signature. */
const ZIP_LOCAL_SIG = 0x04034b50;
/** Compression method: stored (no compression). */
const ZIP_STORED = 0;
/** Compression method: DEFLATE. */
const ZIP_DEFLATE = 8;
/** The 32-bit sentinel a field carries when its real value lives in a zip64 record. */
const ZIP64_SENTINEL = 0xffffffff;

/** Inflate a raw DEFLATE stream via the platform `DecompressionStream`. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Find the offset of the End Of Central Directory record, scanning back from the
 * end past a possible trailing comment (≤ 65535 bytes). Throws if none is found.
 */
function findEocd(view: DataView, length: number): number {
  const earliest = Math.max(0, length - 22 - 0xffff);
  for (let i = length - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) === ZIP_EOCD_SIG) return i;
  }
  throw new Error(
    "zip: no end-of-central-directory record found (not a zip archive?).",
  );
}

/** Read one entry's bytes from its local header, decompressing per `method`. */
async function readLocalEntry(
  view: DataView,
  archive: Uint8Array,
  offset: number,
  compressedSize: number,
  method: number,
  name: string,
): Promise<Uint8Array> {
  if (
    offset + 30 > archive.length ||
    view.getUint32(offset, true) !== ZIP_LOCAL_SIG
  ) {
    throw new Error(`zip: malformed local header for entry "${name}".`);
  }
  // The local header's own name/extra lengths can differ from the central
  // directory's, so re-read them here to locate the compressed data.
  const nameLen = view.getUint16(offset + 26, true);
  const extraLen = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLen + extraLen;
  if (start + compressedSize > archive.length) {
    throw new Error(
      `zip: entry "${name}" data runs past the archive (malformed).`,
    );
  }
  const raw = archive.subarray(start, start + compressedSize);
  if (method === ZIP_STORED) return raw.slice();
  if (method === ZIP_DEFLATE) return await inflateRaw(raw);
  throw new Error(
    `zip: unsupported compression method ${method} for entry "${name}".`,
  );
}

/**
 * Read the entries of a `.zip` archive, decompressing `stored` and `deflate`
 * members. The central directory is the source of truth. Directory entries (a
 * trailing `/`) are skipped. Encrypted, zip64, or otherwise-compressed entries
 * throw a friendly error naming the offending entry, and a header or data field
 * that runs past the archive is reported as a malformed zip (not a raw
 * out-of-bounds error). Every offset read from the archive is bounds-checked;
 * for integrity against a tampered download, pin a `.checksum(...)`, which is
 * verified before the archive is ever parsed.
 */
export async function unzip(archive: Uint8Array): Promise<TarEntry[]> {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const eocd = findEocd(view, archive.length);
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === ZIP64_SENTINEL) {
    throw new Error("zip: unsupported zip feature (zip64).");
  }
  const entries: TarEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    // Bounds-check every field read from the untrusted archive: a header
    // running past the end is a malformed zip, not a raw DataView RangeError.
    if (p + 46 > archive.length || view.getUint32(p, true) !== ZIP_CD_SIG) {
      throw new Error("zip: malformed central directory.");
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    if (p + 46 + nameLen > archive.length) {
      throw new Error("zip: malformed central directory (name runs past end).");
    }
    const name = new TextDecoder().decode(
      archive.subarray(p + 46, p + 46 + nameLen),
    );
    if ((flags & 0x0001) !== 0) {
      throw new Error(
        `zip: unsupported zip feature (encrypted entry "${name}").`,
      );
    }
    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL || localOffset === ZIP64_SENTINEL
    ) {
      throw new Error(`zip: unsupported zip feature (zip64 entry "${name}").`);
    }
    if (!name.endsWith("/")) {
      entries.push({
        name,
        data: await readLocalEntry(
          view,
          archive,
          localOffset,
          compressedSize,
          method,
          name,
        ),
      });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Read the `.zip` at `src`, unpack it, and write each entry under `destDir`
 * (creating parent directories as needed) — the zip counterpart of
 * {@link extractTarGzip}. Entry names are validated so a malicious archive
 * cannot escape `destDir`.
 */
export async function extractZip(
  src: PathLike,
  destDir: PathLike,
): Promise<void> {
  await writeEntries(await unzip(await Deno.readFile(String(src))), destDir);
}
