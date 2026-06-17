/**
 * Compression helpers for build scripts: gzip/gunzip byte streams and read or
 * write `tar` / `.tar.gz` archives. Dependency-free — gzip uses the platform
 * `CompressionStream`, and the tar reader/writer implements the POSIX `ustar`
 * format directly.
 *
 * ```ts
 * import { createTarGzip, extractTarGzip } from "jsr:@zuke/core";
 *
 * await createTarGzip(["dist/app.js", "README.md"], "artifact.tar.gz");
 * await extractTarGzip("artifact.tar.gz", "out");
 * ```
 *
 * `tar` entry names are limited to 100 bytes (the `ustar` name field); longer
 * names throw. Archives are written with a fixed mtime so output is
 * reproducible.
 *
 * @module
 */

import type { PathLike } from "./path.ts";

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
  const root = String(destDir);
  for (const entry of archive) {
    const path = `${root}/${entry.name}`;
    const slash = path.lastIndexOf("/");
    if (slash !== -1) {
      await Deno.mkdir(path.slice(0, slash), { recursive: true });
    }
    await Deno.writeFile(path, entry.data);
  }
}
