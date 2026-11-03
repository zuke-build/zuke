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

/** Poll until `done()` holds, so a test can wait on a pump nobody awaits. */
async function until(done: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

Deno.test("withAmbientOutput: console output inside the scope goes to the sink", async () => {
  const origLog = console.log;
  const origError = console.error;
  const direct: string[] = [];
  console.log = (...data: unknown[]) =>
    void direct.push(`log:${data.join(" ")}`);
  console.error = (...data: unknown[]) =>
    void direct.push(`error:${data.join(" ")}`);
  try {
    const stdout = recorder();
    const stderr = recorder();
    await withAmbientOutput({ stdout, stderr }, () => {
      console.log("hello %s", "world", 42);
      console.error("oops");
      return Promise.resolve();
    });
    // A second scope must not wrap the wrapper: outside, one call is one line.
    await withAmbientOutput({ stdout, stderr }, () => {
      console.log("again");
      return Promise.resolve();
    });
    console.log("outside");
    console.error("outside err");
    assertEquals(stdout.text(), "hello world 42\nagain\n");
    assertEquals(stderr.text(), "oops\n");
    assertEquals(direct, ["log:outside", "error:outside err"]);
  } finally {
    console.log = origLog;
    console.error = origError;
  }
});

Deno.test("withAmbientOutput: a console replaced after the first wrap is wrapped too", async () => {
  const origLog = console.log;
  try {
    // Wrap whatever is installed now.
    await withAmbientOutput(
      { stdout: recorder(), stderr: recorder() },
      () => Promise.resolve(),
    );
    const direct: string[] = [];
    console.log = (...data: unknown[]) => void direct.push(data.join(" "));
    const stdout = recorder();
    await withAmbientOutput({ stdout, stderr: recorder() }, () => {
      console.log("routed");
      return Promise.resolve();
    });
    console.log("direct");
    assertEquals(stdout.text(), "routed\n");
    assertEquals(direct, ["direct"]);
  } finally {
    console.log = origLog;
  }
});

Deno.test("withAmbientOutput: a spawned process's output goes to the sink", async () => {
  const stdout = recorder();
  const stderr = recorder();
  const code = `console.log("svc-out"); console.error("svc-err");`;
  const proc = await withAmbientOutput(
    { stdout, stderr },
    () => Promise.resolve($`${Deno.execPath()} eval ${code}`.spawn()),
  );
  assertEquals((await proc.status).code, 0);
  await until(() => stdout.text() !== "" && stderr.text() !== "");
  assertEquals(stdout.text(), "svc-out\n");
  assertEquals(stderr.text(), "svc-err\n");
});

Deno.test("withAmbientOutput: a spawned process does not hang when the sink fails", async () => {
  const broken: ByteWriter = {
    writeSync: () => {
      throw new Deno.errors.BrokenPipe("terminal closed");
    },
  };
  // Far more than a pipe buffer holds, so an undrained pipe would block it.
  const code = `const line = "x".repeat(1023) + "\\n";
for (let i = 0; i < 512; i++) console.log(line);`;
  const proc = await withAmbientOutput(
    { stdout: broken, stderr: recorder() },
    () => Promise.resolve($`${Deno.execPath()} eval ${code}`.spawn()),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<"hung">((r) => {
    timer = setTimeout(() => r("hung"), 10_000);
  });
  try {
    const result = await Promise.race([proc.status, hung]);
    assertEquals(result === "hung", false, "the service blocked on its pipe");
  } finally {
    clearTimeout(timer);
    await proc.stop();
  }
});
