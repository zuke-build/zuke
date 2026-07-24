/**
 * Hand-built `ustar`/GNU tar archives for tests. The production `tar()` writer
 * refuses names over 100 bytes, so archives exercising the long-path forms —
 * the POSIX `prefix` split and GNU `@LongLink` pseudo-entries (what Node's
 * Linux release tarballs use) — can only be synthesised directly.
 */

/** One hand-built header + data block pair for {@link ustarArchive}. */
export interface RawTarEntry {
  /** The 100-byte `name` field's content (what a truncated GNU name holds). */
  name: string;
  /** The 155-byte POSIX `prefix` field's content (empty for none). */
  prefix: string;
  /** The entry's data blocks. */
  data: Uint8Array;
  /** The magic at byte 257; defaults to POSIX `"ustar\0"`. */
  magic?: string;
  /** The typeflag byte; defaults to `0x30` (a regular file). */
  typeflag?: number;
}

/** Build a raw tar archive from hand-specified headers (see module doc). */
export function ustarArchive(entries: RawTarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const e of entries) {
    const header = new Uint8Array(512);
    const put = (offset: number, s: string) =>
      header.set(new TextEncoder().encode(s), offset);
    put(0, e.name);
    put(124, e.data.length.toString(8).padStart(11, "0")); // size, octal
    header[156] = e.typeflag ?? 0x30; // typeflag; '0' (regular file) by default
    put(257, e.magic ?? "ustar\0"); // POSIX magic (a trailing space → non-ustar)
    put(263, "00"); // version
    put(345, e.prefix);
    blocks.push(header);
    const body = new Uint8Array(Math.ceil(e.data.length / 512) * 512);
    body.set(e.data);
    blocks.push(body);
  }
  blocks.push(new Uint8Array(512)); // zero-block trailer
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

/** The GNU magic: a trailing space, not the POSIX NUL. */
export const GNU = "ustar ";

/**
 * A GNU `@LongLink` pseudo-entry announcing the next entry's full name
 * (typeflag `'L'`, the default) or link target (`0x4b`, `'K'`).
 */
export function longLink(fullName: string, typeflag = 0x4c): RawTarEntry {
  return {
    name: "././@LongLink",
    prefix: "",
    data: new TextEncoder().encode(`${fullName}\0`),
    magic: GNU,
    typeflag,
  };
}
