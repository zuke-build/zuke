// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import {
  ambientOutput,
  type ByteWriter,
  withAmbientOutput,
} from "../src/ambient_output.ts";
import { bufferReporter } from "../src/reporter.ts";
import { $ } from "../src/shell.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** A writer that records what it was given, at most `max` bytes per call. */
function recorder(max = Infinity): ByteWriter & { text: () => string } {
  const chunks: string[] = [];
  return {
    writeSync: (p) => {
      const n = Math.min(p.length, max);
      chunks.push(decoder.decode(p.subarray(0, n)));
      return n;
    },
    text: () => chunks.join(""),
  };
}

Deno.test("ambientOutput: defaults to the process's own stdout and stderr", () => {
  const out = ambientOutput();
  assertEquals(out.stdout === Deno.stdout, true);
  assertEquals(out.stderr === Deno.stderr, true);
});

Deno.test("withAmbientOutput: a command's live output goes to the installed sink", async () => {
  const stdout = recorder();
  const stderr = recorder();
  const code = `console.log("to-out"); console.error("to-err");`;
  const result = await withAmbientOutput(
    { stdout, stderr },
    async () => await $`${Deno.execPath()} eval ${code}`,
  );
  assertEquals(stdout.text(), "to-out\n");
  assertEquals(stderr.text(), "to-err\n");
  // Capture is unaffected by where the live copy goes.
  assertEquals(result.stdout, "to-out\n");
  // The sink is scoped to the call.
  assertEquals(ambientOutput().stdout === Deno.stdout, true);
});

Deno.test("bufferReporter: flushes lines and command bytes in arrival order", () => {
  const buffer = bufferReporter();
  buffer.reporter.info("header");
  buffer.output.stdout.writeSync(encoder.encode("child out\n"));
  buffer.output.stderr.writeSync(encoder.encode("child err\n"));
  buffer.reporter.error("footer");
  // One shared transcript shows the interleaving across all four streams.
  const both = recorder();
  const record = (prefix: string): ByteWriter => ({
    writeSync: (p) => {
      both.writeSync(encoder.encode(prefix + decoder.decode(p)));
      return p.length;
    },
  });
  buffer.flush(
    {
      info: (l) => void both.writeSync(encoder.encode(`info:${l}\n`)),
      error: (l) => void both.writeSync(encoder.encode(`error:${l}\n`)),
    },
    { stdout: record("out:"), stderr: record("err:") },
  );
  assertEquals(both.text().split("\n"), [
    "info:header",
    "out:child out",
    "err:child err",
    "error:footer",
    "",
  ]);
});

Deno.test("bufferReporter: keeps a chunk the stream reuses, and writes it whole", () => {
  const buffer = bufferReporter();
  const chunk = encoder.encode("abcdef");
  buffer.output.stdout.writeSync(chunk);
  chunk.fill(0); // the stream reusing its read buffer
  // A writer that accepts two bytes per call, like a short write to a pipe.
  const out = recorder(2);
  buffer.flush({ info: () => {}, error: () => {} }, {
    stdout: out,
    stderr: recorder(),
  });
  assertEquals(out.text(), "abcdef");
});

Deno.test("bufferReporter: writes after a flush pass straight through", () => {
  const buffer = bufferReporter();
  const out = recorder();
  const lines: string[] = [];
  const to = { info: (l: string) => void lines.push(l), error: () => {} };
  buffer.flush(to, { stdout: out, stderr: recorder() });
  // A command that outlived its timed-out target keeps writing.
  buffer.output.stdout.writeSync(encoder.encode("late\n"));
  buffer.reporter.info("late line");
  assertEquals(out.text(), "late\n");
  assertEquals(lines, ["late line"]);
});

Deno.test("bufferReporter: flushes into the ambient sink by default", async () => {
  const outer = recorder();
  const buffer = bufferReporter();
  buffer.output.stdout.writeSync(encoder.encode("item\n"));
  // A fan-out item's block flushes inside its parent's buffered scope.
  await withAmbientOutput({ stdout: outer, stderr: recorder() }, () => {
    buffer.flush({ info: () => {}, error: () => {} });
    return Promise.resolve();
  });
  assertEquals(outer.text(), "item\n");
});
