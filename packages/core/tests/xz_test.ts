// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "./_assert.ts";
import { unxz } from "../src/xz.ts";
import { crc32 } from "../src/internal.ts";
import {
  CRC32_XZ,
  fixture,
  LPPB_XZ,
  NONE_XZ,
  STRESS_XZ,
  stressPayload,
} from "./_xz.ts";

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const HELLO = "hello from xz\n".repeat(3);

Deno.test("unxz decodes a multi-block SHA-256-checked stream byte for byte", async () => {
  assertEquals(await unxz(fixture(STRESS_XZ)), stressPayload());
});

Deno.test("unxz decodes non-default lc/lp/pb literal and position contexts", async () => {
  assertEquals(
    await unxz(fixture(LPPB_XZ)),
    stressPayload().subarray(0, 3000),
  );
});

Deno.test("unxz verifies a CRC32 check and accepts a stream with no check", async () => {
  assertEquals(dec(await unxz(fixture(CRC32_XZ))), HELLO);
  assertEquals(dec(await unxz(fixture(NONE_XZ))), HELLO);
});

Deno.test("unxz decodes concatenated streams separated by stream padding", async () => {
  const a = fixture(CRC32_XZ);
  const b = fixture(NONE_XZ);
  const joined = new Uint8Array(a.length + 4 + b.length);
  joined.set(a, 0);
  joined.set(b, a.length + 4); // four zero bytes of stream padding between
  assertEquals(dec(await unxz(joined)), HELLO + HELLO);
});

/** The offset of a single-block stream's check field, located from its footer. */
function checkOffset(data: Uint8Array): number {
  const footer = data.length - 12;
  const view = new DataView(data.buffer, data.byteOffset);
  const indexSize = (view.getUint32(footer + 4, true) + 1) * 4;
  return footer - indexSize - 4; // the CRC32 check sits just before the index
}

Deno.test("unxz reports a block check mismatch", async () => {
  const data = fixture(CRC32_XZ);
  data[checkOffset(data)] ^= 0xff;
  await assertRejects(() => unxz(data), Error, "block CRC32 check mismatch");
  const sha = fixture(STRESS_XZ);
  // The first block's check follows its header and LZMA2 data; corrupting the
  // data itself instead trips the decoder, so flip a byte of the stored hash.
  const firstHeaderEnd = 12 + (sha[12] + 1) * 4;
  let p = firstHeaderEnd;
  // Walk the first block's chunks to its end-of-data marker.
  for (;;) {
    const control = sha[p++];
    if (control === 0) break;
    if (control <= 2) p += 2 + ((sha[p] << 8) | sha[p + 1]) + 1;
    else {
      const packed = ((sha[p + 2] << 8) | sha[p + 3]) + 1;
      p += 4 + (control >= 0xc0 ? 1 : 0) + packed;
    }
  }
  while ((p - firstHeaderEnd) % 4 !== 0) p++;
  sha[p] ^= 0xff;
  await assertRejects(() => unxz(sha), Error, "block SHA-256 check mismatch");
});

Deno.test("unxz rejects bytes that are not an xz archive", async () => {
  await assertRejects(() => unxz(new Uint8Array(0)), Error, "empty input");
  await assertRejects(
    () => unxz(new TextEncoder().encode("definitely not xz data")),
    Error,
    "not an xz archive",
  );
  const padded = new Uint8Array([0, 0, 1, 0]);
  await assertRejects(() => unxz(padded), Error, "bad stream padding");
});

Deno.test("unxz rejects a truncated archive", async () => {
  const data = fixture(CRC32_XZ);
  await assertRejects(() => unxz(data.subarray(0, 40)), Error, "xz: corrupt");
  await assertRejects(
    () => unxz(data.subarray(0, data.length - 1)),
    Error,
    "bad stream footer",
  );
});

Deno.test("unxz rejects unsupported stream flags, check types and filters", async () => {
  const flags = fixture(CRC32_XZ);
  flags[6] = 1; // a reserved stream-flags byte (CRC32 no longer matches either)
  await assertRejects(() => unxz(flags), Error, "bad stream flags");

  const check = fixture(CRC32_XZ);
  check[7] = 2; // CRC32-sized but not a check xz ever writes; re-sign the flags
  const view = new DataView(check.buffer, check.byteOffset);
  view.setUint32(8, crc32(check.subarray(6, 8)), true);
  await assertRejects(() => unxz(check), Error, "unsupported check type 2");

  const filter = fixture(CRC32_XZ);
  // Byte 14 is the block header's filter id (0x21 = LZMA2); make it x86 BCJ.
  filter[14] = 0x04;
  await assertRejects(() => unxz(filter), Error, "unsupported filter chain");
});

Deno.test("unxz rejects corrupt LZMA2 chunk sequences", async () => {
  const headerEnd = (data: Uint8Array) => 12 + (data[12] + 1) * 4;
  for (
    const [control, message] of [
      [0x02, "dictionary reset is required"],
      [0x80, "dictionary reset is required"],
      [0xa0, "dictionary reset is required"],
      [0x01, "xz: corrupt"], // its "size" bytes swallow the real chunk
      [0x03, "invalid LZMA2 control byte 3"],
      [0x00, "non-zero block padding"],
    ] as const
  ) {
    const data = fixture(CRC32_XZ);
    data[headerEnd(data)] = control;
    await assertRejects(() => unxz(data), Error, message);
  }
  const props = fixture(CRC32_XZ);
  props[headerEnd(props) + 5] = 0xff; // the LZMA properties byte
  await assertRejects(() => unxz(props), Error, "invalid LZMA properties");
  const rc = fixture(CRC32_XZ);
  rc[headerEnd(rc) + 6] = 0x01; // the range coder's first byte must be zero
  await assertRejects(() => unxz(rc), Error, "bad range coder header");
  // A chunk whose uncompressed size exceeds what its LZMA data encodes.
  const long = fixture(CRC32_XZ);
  long[headerEnd(long) + 2] = 0xff;
  await assertRejects(() => unxz(long), Error, "xz: corrupt");
});

Deno.test("unxz rejects a block header whose CRC32 does not match", async () => {
  const data = fixture(CRC32_XZ);
  data[16] ^= 0x01; // the LZMA2 dictionary-size byte, covered by the header CRC32
  await assertRejects(() => unxz(data), Error, "block header CRC32 mismatch");
});
