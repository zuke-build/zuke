import { assertEquals } from "./_assert.ts";
import {
  captureStream,
  DEFAULT_MAX_CAPTURED_BYTES,
  formatByteCap,
  truncationNotice,
} from "../src/capture.ts";

const encoder = new TextEncoder();

/** A stream that yields each string as its own chunk — the chunk seam matters. */
function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
}

/** A sink that records every byte written, standing in for `Deno.stdout`. */
function recordingSink() {
  const written: string[] = [];
  const decoder = new TextDecoder();
  return {
    written,
    writeSync(p: Uint8Array): number {
      written.push(decoder.decode(p));
      return p.length;
    },
  };
}

Deno.test("captureStream keeps everything under the cap", async () => {
  const got = await captureStream(streamOf("abc", "def"), null, 1024);
  assertEquals(got, { text: "abcdef", truncated: false });
});

Deno.test("captureStream slices the oldest chunk when it straddles the cap", async () => {
  const got = await captureStream(streamOf("1111", "2222"), null, 6);
  assertEquals(got.text, "112222");
  assertEquals(got.truncated, true);
});

Deno.test("captureStream drops whole chunks that fall out of the window", async () => {
  const got = await captureStream(streamOf("1111", "2222", "3333"), null, 4);
  assertEquals(got.text, "3333");
  assertEquals(got.truncated, true);
});

Deno.test("captureStream still streams every byte to the sink", async () => {
  const sink = recordingSink();
  const got = await captureStream(streamOf("1111", "2222"), sink, 4);
  // Capture kept only the tail…
  assertEquals(got.text, "2222");
  // …but the live sink saw the whole thing.
  assertEquals(sink.written.join(""), "11112222");
});

Deno.test("captureStream handles an empty stream", async () => {
  const got = await captureStream(streamOf(), null, 8);
  assertEquals(got, { text: "", truncated: false });
});

Deno.test("formatByteCap renders whole MiB, whole KiB, then bytes", () => {
  assertEquals(formatByteCap(DEFAULT_MAX_CAPTURED_BYTES), "8 MiB");
  assertEquals(formatByteCap(4096), "4 KiB");
  assertEquals(formatByteCap(1500), "1500 bytes");
  assertEquals(formatByteCap(10), "10 bytes");
});

Deno.test("truncationNotice names the cap that applied", () => {
  assertEquals(
    truncationNotice(4096),
    "[output truncated to last 4 KiB]",
  );
});
