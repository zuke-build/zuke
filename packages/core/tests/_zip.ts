/**
 * Build a `.zip` archive in memory for the compression/install tests — no
 * network, no ambient tools. Supports the two methods a release asset uses
 * (`stored` and `deflate`) plus the knobs the adversarial tests need
 * (encryption flag, zip64 sentinels, a bogus method), so a fixture is a plain
 * value the reader can be driven against.
 */

/** Compression method: stored (no compression). */
export const STORED = 0;
/** Compression method: DEFLATE. */
export const DEFLATE = 8;

/** One entry to place in a fixture zip. */
export interface ZipEntrySpec {
  /** The entry name (a trailing `/` marks a directory entry, which carries no data). */
  name: string;
  /** The uncompressed contents (omitted for a directory entry). */
  data?: Uint8Array;
  /** The compression method (default {@link STORED}). */
  method?: number;
  /** General-purpose flags (set `0x0001` to mark the entry encrypted). */
  flags?: number;
  /** Force the zip64 sentinels in the central directory (compressed/uncompressed size + offset). */
  zip64?: boolean;
  /**
   * Bytes for the LOCAL header's extra field (the central directory's stays
   * empty) — so a reader that uses the central-directory extra length instead of
   * the local one lands on the wrong data offset.
   */
  localExtra?: Uint8Array;
}

/** Raw-DEFLATE `data` via the platform `CompressionStream` (matches the reader). */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(
    new CompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const SENTINEL = 0xffffffff;

/** Assemble a valid `.zip` byte array from `specs` (local headers → central dir → EOCD). */
export async function makeZip(specs: ZipEntrySpec[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const spec of specs) {
    const method = spec.method ?? STORED;
    const flags = spec.flags ?? 0;
    const data = spec.data ?? new Uint8Array(0);
    const localExtra = spec.localExtra ?? new Uint8Array(0);
    const nameBytes = enc.encode(spec.name);
    const comp = method === DEFLATE ? await deflateRaw(data) : data;

    const lh = new Uint8Array(
      30 + nameBytes.length + localExtra.length + comp.length,
    );
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, 0, true); // crc (the reader does not validate it)
    lv.setUint32(18, comp.length, true); // real sizes so the data is locatable
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, localExtra.length, true); // local extra field (CD's stays 0)
    lh.set(nameBytes, 30);
    lh.set(localExtra, 30 + nameBytes.length);
    lh.set(comp, 30 + nameBytes.length + localExtra.length);
    local.push(lh);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, 0, true); // crc
    cv.setUint32(20, spec.zip64 ? SENTINEL : comp.length, true);
    cv.setUint32(24, spec.zip64 ? SENTINEL : data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, spec.zip64 ? SENTINEL : offset, true); // local header offset
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length;
  }

  const cdStart = offset;
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, specs.length, true); // records on this disk
  ev.setUint16(10, specs.length, true); // total records
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);

  const chunks = [...local, ...central, eocd];
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
