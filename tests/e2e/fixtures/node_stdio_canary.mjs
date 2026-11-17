// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Run under real Node by `node_process_e2e.ts`: core's standard streams,
 * loaded as TypeScript source. The first argument picks what it does.
 *
 * - `flood`: writes more than a pipe holds to stdout and a line to stderr,
 *   flushes, and exits 3 at once. Without the flush Node drops what is still
 *   queued.
 * - `prompt`: asks three times and prints the answers as JSON on stderr.
 * - `echo`: copies stdin to stdout until stdin ends.
 */

import process from "node:process";

const { flushOutput, processOutput, promptLine, stdinBytes, stdoutWriter } =
  await import(
    new URL("../../../packages/core/src/stdio.ts", import.meta.url).href
  );

if (process.argv[2] === "flood") {
  const { stdout, stderr } = processOutput();
  const chunk = new Uint8Array(64 * 1024).fill(120);
  for (let written = 0; written < 32; written++) stdout.writeSync(chunk);
  stderr.writeSync(new TextEncoder().encode("to stderr\n"));
  await flushOutput();
  process.exit(3);
}

if (process.argv[2] === "prompt") {
  console.error(
    JSON.stringify([
      promptLine("first:"),
      promptLine("second:"),
      promptLine("third:"),
    ]),
  );
  process.exit(0);
}

const output = stdoutWriter();
for await (const chunk of stdinBytes()) await output.write(chunk);
