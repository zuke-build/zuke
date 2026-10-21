// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A dependency-free `.xz` decoder — the container, LZMA2, and LZMA — behind
 * {@link "./compression.ts".extractTarXz}. The platform `DecompressionStream`
 * knows gzip and deflate but not xz, and releases such as the Flutter SDK and
 * Zig ship only `.tar.xz`. It decodes the filter chain `xz` writes by default
 * (a single LZMA2 filter), verifies each block's check (`CRC32`, `CRC64`,
 * `SHA-256`, or none), and reports a BCJ/delta filter chain as unsupported.
 * Like `gunzip`, it decodes in memory.
 *
 * The format is specified at <https://tukaani.org/xz/xz-file-format.txt>; the
 * LZMA decoder follows the reference decoder in the LZMA specification.
 *
 * @module
 */

import { crc32, sha256Hex } from "./internal.ts";

/** The `.xz` stream header magic. */
const MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
/** The filter id of LZMA2 in a block header's filter flags. */
const LZMA2_FILTER = 0x21;
/** The size in bytes of each check type (the low nibble of the stream flags). */
const CHECK_SIZES = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];
/** Every probability starts at 0.5 (11-bit fixed point). */
const PROB_INIT = 1024;

function corrupt(detail: string): Error {
  return new Error(`xz: corrupt archive — ${detail}.`);
}

function readU16BE(data: Uint8Array, p: number): number {
  if (p + 2 > data.length) throw corrupt("data ends inside a chunk header");
  return (data[p] << 8) | data[p + 1];
}

function readU32LE(data: Uint8Array, p: number): number {
  return (data[p] | (data[p + 1] << 8) | (data[p + 2] << 16) |
    (data[p + 3] << 24)) >>> 0;
}

/** Read an xz variable-length integer at `p`; returns the value and the next offset. */
function varint(data: Uint8Array, p: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 9; i++) {
    if (p >= data.length) throw corrupt("data ends inside a size field");
    const byte = data[p++];
    value += (byte & 0x7f) * 2 ** (7 * i);
    if ((byte & 0x80) === 0) return [value, p];
  }
  throw corrupt("a size field is too long");
}

/** CRC-64 (ECMA-182, reflected) as two 32-bit halves, since JS has no fast u64. */
const CRC64_LO = new Uint32Array(256);
const CRC64_HI = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let lo = n;
  let hi = 0;
  for (let k = 0; k < 8; k++) {
    const carry = lo & 1;
    lo = ((lo >>> 1) | (hi << 31)) >>> 0;
    hi >>>= 1;
    if (carry) {
      lo = (lo ^ 0xd7870f42) >>> 0;
      hi = (hi ^ 0xc96c5795) >>> 0;
    }
  }
  CRC64_LO[n] = lo;
  CRC64_HI[n] = hi;
}

/** The CRC-64 of `data` as its 8 little-endian bytes, the form the block check stores. */
function crc64Bytes(data: Uint8Array): Uint8Array {
  let lo = 0xffffffff;
  let hi = 0xffffffff;
  for (const byte of data) {
    const i = (lo ^ byte) & 0xff;
    lo = (((lo >>> 8) | (hi << 24)) ^ CRC64_LO[i]) >>> 0;
    hi = ((hi >>> 8) ^ CRC64_HI[i]) >>> 0;
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setUint32(0, (lo ^ 0xffffffff) >>> 0, true);
  new DataView(out.buffer).setUint32(4, (hi ^ 0xffffffff) >>> 0, true);
  return out;
}

/** Verify a block's stored `check` against the `decoded` bytes it covers. */
async function verifyCheck(
  type: number,
  check: Uint8Array,
  decoded: Uint8Array,
): Promise<void> {
  let name: string;
  let ok: boolean;
  if (type === 0) return;
  if (type === 1) {
    name = "CRC32";
    ok = readU32LE(check, 0) === crc32(decoded);
  } else if (type === 4) {
    name = "CRC64";
    const expected = crc64Bytes(decoded);
    ok = check.every((b, i) => b === expected[i]);
  } else {
    name = "SHA-256";
    const hex = Array.from(check, (b) => b.toString(16).padStart(2, "0"))
      .join("");
    ok = hex === await sha256Hex(decoded);
  }
  if (!ok) throw corrupt(`block ${name} check mismatch`);
}

/** The decoded output; the dictionary is everything written since the last reset. */
class Output {
  buf = new Uint8Array(1 << 14);
  pos = 0;
  dictStart = 0;

  resetDict(): void {
    this.dictStart = this.pos;
  }

  ensure(n: number): void {
    const need = this.pos + n;
    if (need > this.buf.length) {
      const grown = new Uint8Array(Math.max(need, this.buf.length * 2));
      grown.set(this.buf.subarray(0, this.pos));
      this.buf = grown;
    }
  }

  append(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  bytes(): Uint8Array {
    return this.buf.subarray(0, this.pos);
  }
}

/** The LZMA range decoder over one LZMA2 chunk's compressed bytes. */
class RangeDecoder {
  range = 0xffffffff;
  code = 0;
  pos: number;

  constructor(readonly data: Uint8Array, start: number, readonly end: number) {
    if (end - start < 5 || data[start] !== 0) {
      throw corrupt("bad range coder header");
    }
    this.pos = start + 1;
    for (let i = 0; i < 4; i++) {
      this.code = ((this.code << 8) | this.next()) >>> 0;
    }
  }

  next(): number {
    if (this.pos >= this.end) throw corrupt("compressed data ends early");
    return this.data[this.pos++];
  }

  normalize(): void {
    if (this.range < 0x1000000) {
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | this.next()) >>> 0;
    }
  }

  bit(probs: Uint16Array, i: number): number {
    const p = probs[i];
    const bound = (this.range >>> 11) * p;
    let bit: number;
    if (this.code < bound) {
      this.range = bound;
      probs[i] = p + ((2048 - p) >> 5);
      bit = 0;
    } else {
      this.range -= bound;
      this.code -= bound;
      probs[i] = p - (p >> 5);
      bit = 1;
    }
    this.normalize();
    return bit;
  }

  direct(numBits: number): number {
    let result = 0;
    for (let i = 0; i < numBits; i++) {
      this.range >>>= 1;
      this.code -= this.range;
      if (this.code < 0) {
        this.code += this.range;
        result *= 2;
      } else {
        result = result * 2 + 1;
      }
      this.normalize();
    }
    return result;
  }

  bitTree(probs: Uint16Array, base: number, numBits: number): number {
    let m = 1;
    for (let i = 0; i < numBits; i++) m = (m << 1) | this.bit(probs, base + m);
    return m - (1 << numBits);
  }

  reverseBitTree(probs: Uint16Array, base: number, numBits: number): number {
    let m = 1;
    let symbol = 0;
    for (let i = 0; i < numBits; i++) {
      const bit = this.bit(probs, base + m);
      m = (m << 1) | bit;
      symbol |= bit << i;
    }
    return symbol;
  }
}

/** The match-length decoder (one for matches, one for repeated matches). */
class LenDecoder {
  choice = new Uint16Array(2);
  low = new Uint16Array(16 << 3);
  mid = new Uint16Array(16 << 3);
  high = new Uint16Array(256);

  reset(): void {
    for (const p of [this.choice, this.low, this.mid, this.high]) {
      p.fill(PROB_INIT);
    }
  }

  decode(rc: RangeDecoder, posState: number): number {
    if (rc.bit(this.choice, 0) === 0) {
      return rc.bitTree(this.low, posState << 3, 3);
    }
    if (rc.bit(this.choice, 1) === 0) {
      return 8 + rc.bitTree(this.mid, posState << 3, 3);
    }
    return 16 + rc.bitTree(this.high, 0, 8);
  }
}

/** The LZMA decoder state shared by the LZMA chunks of one LZMA2 stream. */
class LzmaDecoder {
  lc = 0;
  lp = 0;
  pb = 0;
  literal = new Uint16Array(0x300);
  isMatch = new Uint16Array(12 << 4);
  isRep = new Uint16Array(12);
  isRepG0 = new Uint16Array(12);
  isRepG1 = new Uint16Array(12);
  isRepG2 = new Uint16Array(12);
  isRep0Long = new Uint16Array(12 << 4);
  posSlot = new Uint16Array(4 << 6);
  posDecoders = new Uint16Array(115);
  align = new Uint16Array(16);
  lenDecoder = new LenDecoder();
  repLenDecoder = new LenDecoder();
  state = 0;
  rep0 = 0;
  rep1 = 0;
  rep2 = 0;
  rep3 = 0;

  /** Apply an LZMA2 properties byte (`lc`, `lp`, `pb`). */
  setProps(byte: number): void {
    const pb = Math.floor(byte / 45);
    const rest = byte - pb * 45;
    const lp = Math.floor(rest / 9);
    const lc = rest - lp * 9;
    if (byte >= 225 || lc + lp > 4) {
      throw corrupt(`invalid LZMA properties byte ${byte}`);
    }
    this.lc = lc;
    this.lp = lp;
    this.pb = pb;
    this.literal = new Uint16Array(0x300 << (lc + lp));
  }

  resetState(): void {
    for (
      const p of [
        this.literal,
        this.isMatch,
        this.isRep,
        this.isRepG0,
        this.isRepG1,
        this.isRepG2,
        this.isRep0Long,
        this.posSlot,
        this.posDecoders,
        this.align,
      ]
    ) p.fill(PROB_INIT);
    this.lenDecoder.reset();
    this.repLenDecoder.reset();
    this.state = 0;
    this.rep0 =
      this.rep1 =
      this.rep2 =
      this.rep3 =
        0;
  }

  decodeLiteral(rc: RangeDecoder, out: Output): void {
    const pos = out.pos - out.dictStart;
    const prev = pos === 0 ? 0 : out.buf[out.pos - 1];
    const base = 0x300 *
      (((pos & ((1 << this.lp) - 1)) << this.lc) + (prev >> (8 - this.lc)));
    let symbol = 1;
    if (this.state >= 7) {
      // After a match the literal is coded against the byte the match predicts.
      let matchByte = out.buf[out.pos - this.rep0 - 1];
      do {
        const matchBit = (matchByte >> 7) & 1;
        matchByte <<= 1;
        const bit = rc.bit(
          this.literal,
          base + ((1 + matchBit) << 8) + symbol,
        );
        symbol = (symbol << 1) | bit;
        if (matchBit !== bit) break;
      } while (symbol < 0x100);
    }
    while (symbol < 0x100) {
      symbol = (symbol << 1) | rc.bit(this.literal, base + symbol);
    }
    out.buf[out.pos++] = symbol & 0xff;
  }

  decodeDistance(rc: RangeDecoder, len: number): number {
    const posSlot = rc.bitTree(this.posSlot, Math.min(len, 3) << 6, 6);
    if (posSlot < 4) return posSlot;
    const numDirectBits = (posSlot >>> 1) - 1;
    let dist = (2 | (posSlot & 1)) * 2 ** numDirectBits;
    if (posSlot < 14) {
      dist += rc.reverseBitTree(
        this.posDecoders,
        dist - posSlot,
        numDirectBits,
      );
    } else {
      dist += rc.direct(numDirectBits - 4) * 16;
      dist += rc.reverseBitTree(this.align, 0, 4);
    }
    return dist;
  }

  /** Copy `len` bytes from `dist + 1` bytes back (the dictionary window). */
  copyMatch(out: Output, dist: number, len: number, end: number): void {
    if (dist >= out.pos - out.dictStart) {
      throw corrupt("a match reaches before the start of the dictionary");
    }
    if (out.pos + len > end) {
      throw corrupt("a match runs past the chunk's uncompressed size");
    }
    let src = out.pos - dist - 1;
    for (let i = 0; i < len; i++) out.buf[out.pos++] = out.buf[src++];
  }

  /** Decode one LZMA chunk until `out.pos` reaches `end`. */
  decode(rc: RangeDecoder, out: Output, end: number): void {
    const pbMask = (1 << this.pb) - 1;
    while (out.pos < end) {
      const posState = (out.pos - out.dictStart) & pbMask;
      const s = this.state;
      if (rc.bit(this.isMatch, (s << 4) + posState) === 0) {
        this.decodeLiteral(rc, out);
        this.state = s < 4 ? 0 : s < 10 ? s - 3 : s - 6;
        continue;
      }
      let len: number;
      if (rc.bit(this.isRep, s) === 0) {
        len = this.lenDecoder.decode(rc, posState);
        this.rep3 = this.rep2;
        this.rep2 = this.rep1;
        this.rep1 = this.rep0;
        this.rep0 = this.decodeDistance(rc, len);
        this.state = s < 7 ? 7 : 10;
      } else {
        if (rc.bit(this.isRepG0, s) === 0) {
          if (rc.bit(this.isRep0Long, (s << 4) + posState) === 0) {
            this.state = s < 7 ? 9 : 11; // a "short rep": one byte at rep0
            this.copyMatch(out, this.rep0, 1, end);
            continue;
          }
        } else {
          let dist: number;
          if (rc.bit(this.isRepG1, s) === 0) {
            dist = this.rep1;
          } else {
            if (rc.bit(this.isRepG2, s) === 0) {
              dist = this.rep2;
            } else {
              dist = this.rep3;
              this.rep3 = this.rep2;
            }
            this.rep2 = this.rep1;
          }
          this.rep1 = this.rep0;
          this.rep0 = dist;
        }
        len = this.repLenDecoder.decode(rc, posState);
        this.state = s < 7 ? 8 : 11;
      }
      this.copyMatch(out, this.rep0, len + 2, end);
    }
  }
}

/**
 * Decode the LZMA2 chunks starting at `p` into `out`, returning the offset just
 * past the end-of-data marker.
 */
function decodeLzma2(data: Uint8Array, p: number, out: Output): number {
  const lzma = new LzmaDecoder();
  let needDict = true;
  let needProps = true;
  let needState = true;
  for (;;) {
    if (p >= data.length) throw corrupt("LZMA2 data ends without its marker");
    const control = data[p++];
    if (control === 0x00) return p;
    if (control === 0x01 || control === 0x02) {
      if (control === 0x01) out.resetDict();
      else if (needDict) throw corrupt("a dictionary reset is required");
      const size = readU16BE(data, p) + 1;
      p += 2;
      if (p + size > data.length) throw corrupt("an uncompressed chunk is cut");
      out.append(data.subarray(p, p + size));
      p += size;
      needDict = false;
      needState = true;
      continue;
    }
    if (control < 0x80) throw corrupt(`invalid LZMA2 control byte ${control}`);
    const unpackSize = ((control & 0x1f) << 16) + readU16BE(data, p) + 1;
    const packSize = readU16BE(data, p + 2) + 1;
    p += 4;
    const reset = (control >> 5) & 3;
    if (reset === 3) out.resetDict();
    else if (needDict) throw corrupt("a dictionary reset is required");
    if (reset >= 2) lzma.setProps(data[p++]);
    else if (needProps) throw corrupt("LZMA properties are required");
    if (reset >= 1) lzma.resetState();
    else if (needState) throw corrupt("a state reset is required");
    needDict = needProps = needState = false;
    if (p + packSize > data.length) throw corrupt("an LZMA chunk is cut");
    const rc = new RangeDecoder(data, p, p + packSize);
    out.ensure(unpackSize);
    lzma.decode(rc, out, out.pos + unpackSize);
    if (rc.pos !== p + packSize || rc.code !== 0) {
      throw corrupt("an LZMA chunk did not end where its header says");
    }
    p += packSize;
  }
}

/** Decode one `.xz` stream at `p` into `out`, returning the offset past its footer. */
async function decodeStream(
  data: Uint8Array,
  p: number,
  out: Output,
): Promise<number> {
  if (
    data.length - p < 12 || MAGIC.some((byte, i) => data[p + i] !== byte)
  ) {
    throw new Error("xz: not an xz archive (bad stream header).");
  }
  const flags = data.subarray(p + 6, p + 8);
  const checkType = flags[1];
  if (
    flags[0] !== 0 || checkType > 15 || readU32LE(data, p + 8) !== crc32(flags)
  ) {
    throw corrupt("bad stream flags");
  }
  if (![0, 1, 4, 10].includes(checkType)) {
    throw new Error(
      `xz: unsupported check type ${checkType} — only none, CRC32, CRC64 ` +
        `and SHA-256 are supported.`,
    );
  }
  p += 12;
  let blocks = 0;
  while (data[p] !== 0) {
    if (p >= data.length) throw corrupt("data ends before the index");
    const headerEnd = p + (data[p] + 1) * 4;
    if (headerEnd > data.length) throw corrupt("a block header is cut");
    const blockFlags = data[p + 1];
    let q = p + 2;
    let compressedSize: number | undefined;
    let uncompressedSize: number | undefined;
    if (blockFlags & 0x40) [compressedSize, q] = varint(data, q);
    if (blockFlags & 0x80) [uncompressedSize, q] = varint(data, q);
    const [filterId, afterId] = varint(data, q);
    const [propsSize] = varint(data, afterId);
    if (
      (blockFlags & 0x3f) !== 0 || filterId !== LZMA2_FILTER || propsSize !== 1
    ) {
      throw new Error(
        "xz: unsupported filter chain — only a single LZMA2 filter (what " +
          "`xz` writes by default) is supported.",
      );
    }
    if (
      readU32LE(data, headerEnd - 4) !== crc32(data.subarray(p, headerEnd - 4))
    ) {
      throw corrupt("block header CRC32 mismatch");
    }
    const outStart = out.pos;
    p = decodeLzma2(data, headerEnd, out);
    if (
      (compressedSize !== undefined && p - headerEnd !== compressedSize) ||
      (uncompressedSize !== undefined &&
        out.pos - outStart !== uncompressedSize)
    ) {
      throw corrupt("a block's size does not match its header");
    }
    while ((p - headerEnd) % 4 !== 0) {
      if (data[p++] !== 0) throw corrupt("non-zero block padding");
    }
    const checkSize = CHECK_SIZES[checkType];
    if (p + checkSize > data.length) throw corrupt("a block check is cut");
    await verifyCheck(
      checkType,
      data.subarray(p, p + checkSize),
      out.buf.subarray(outStart, out.pos),
    );
    p += checkSize;
    blocks++;
  }
  // The index: one record per block, then padding, a CRC32, and the footer.
  const indexStart = p;
  let [records, q] = varint(data, p + 1);
  if (records !== blocks) throw corrupt("the index does not match the blocks");
  for (; records > 0; records--) q = varint(data, varint(data, q)[1])[1];
  while ((q - indexStart) % 4 !== 0) q++;
  p = q + 4;
  if (
    p + 12 > data.length || data[p + 10] !== 0x59 || data[p + 11] !== 0x5a ||
    readU32LE(data, p + 4) !== (p - indexStart) / 4 - 1
  ) {
    throw corrupt("bad stream footer");
  }
  return p + 12;
}

/**
 * Decompress `.xz` `data` (one or more concatenated streams, as `xz -d`
 * accepts) and return the decoded bytes. Each block's integrity check is
 * verified; a corrupt or truncated archive, or one using a filter chain other
 * than plain LZMA2, throws an `Error` whose message starts with `xz:`.
 */
export async function unxz(data: Uint8Array): Promise<Uint8Array> {
  const out = new Output();
  let streams = 0;
  let p = 0;
  while (p < data.length) {
    // Stream padding: four-byte groups of zeros between concatenated streams.
    if (data[p] === 0) {
      if (data.length - p < 4 || data[p + 1] | data[p + 2] | data[p + 3]) {
        throw corrupt("bad stream padding");
      }
      p += 4;
      continue;
    }
    p = await decodeStream(data, p, out);
    streams++;
  }
  if (streams === 0) throw new Error("xz: not an xz archive (empty input).");
  return out.bytes();
}
