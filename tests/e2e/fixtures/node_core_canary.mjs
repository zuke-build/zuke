// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Run under real Node by `node_process_e2e.ts`: every entry point of
 * `@zuke/core`, loaded as TypeScript source. Node only strips types, so a
 * construct that needs compiling, such as a constructor parameter that
 * declares a field, fails the import here. Then the readiness probe, whose
 * module could not load under Node before, against a port that is open and
 * one that is not. Then the runtime task objects packages use in place of a
 * runtime's own API: files, streams, the environment, processes, the runtime
 * facts and sockets.
 */

import assert from "node:assert/strict";
import { createServer } from "node:net";
import process from "node:process";

const core = new URL("../../../packages/core/", import.meta.url);
const ENTRIES = [
  "mod.ts",
  "src/shell.ts",
  "src/tooling.ts",
  "src/tooling_conformance.ts",
  "src/render.ts",
  "src/conformance.ts",
];
for (const entry of ENTRIES) await import(new URL(entry, core).href);

const { tcpReachable } = await import(new URL("mod.ts", core).href);
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const open = server.address().port;
assert.equal(await tcpReachable(`127.0.0.1:${open}`), true);
await new Promise((resolve) => server.close(resolve));
assert.equal(await tcpReachable(`127.0.0.1:${open}`), false);

const {
  EnvTasks,
  FileTasks,
  NetTasks,
  ProcessTasks,
  RuntimeTasks,
  StreamTasks,
} = await import(new URL("mod.ts", core).href);

const dir = await FileTasks.makeTempDirectory((s) => s.prefix("zuke-canary-"));
try {
  await FileTasks.writeBytes(
    `${dir}/a.bin`,
    new Uint8Array([1, 2]),
    (s) => s.createNew(),
  );
  assert.deepEqual([...await FileTasks.readBytes(`${dir}/a.bin`)], [1, 2]);
  await assert.rejects(() =>
    FileTasks.writeBytes(
      `${dir}/a.bin`,
      new Uint8Array([3]),
      (s) => s.createNew(),
    )
  );
  const missing = await FileTasks.readText(`${dir}/none`).catch((e) => e);
  assert.equal(FileTasks.isNotFound(missing), true);
  await StreamTasks.toFile(
    `${dir}/b.bin`,
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([7]));
        controller.close();
      },
    }),
  );
  assert.equal((await FileTasks.stat(`${dir}/b.bin`)).size, 1);
  assert.deepEqual(
    (await FileTasks.readDirectory(dir)).map((entry) => entry.name).sort(),
    ["a.bin", "b.bin"],
  );
} finally {
  await FileTasks.remove(dir, { recursive: true });
}

assert.equal(EnvTasks.get("ZUKE_CANARY_VALUE"), "set");
assert.equal(RuntimeTasks.facts().name, "node");
assert.equal(RuntimeTasks.execPath(), process.execPath);
assert.deepEqual(RuntimeTasks.args(), process.argv.slice(2));
assert.equal(RuntimeTasks.cwd(), process.cwd());
assert.equal(
  RuntimeTasks.arch(),
  { x64: "x86_64", arm64: "aarch64" }[process.arch] ?? process.arch,
);
assert.equal(RuntimeTasks.isTerminal("stdin"), process.stdin.isTTY === true);

const output = await ProcessTasks.run(
  process.execPath,
  (s) => s.args("-e", "process.stdout.write('child')").stdout("piped"),
);
assert.equal(new TextDecoder().decode(output.stdout), "child");
const handler = () => {};
ProcessTasks.addSignalListener("SIGINT", handler);
ProcessTasks.removeSignalListener("SIGINT", handler);

const listener = await NetTasks.listen();
const { connect } = await import("node:net");
const client = connect(listener.port, "127.0.0.1");
const accepted = await listener.accept();
listener.close();
client.end("ping");
assert.equal(await new Response(accepted.readable).text(), "ping");
accepted.close();

console.log("node core canary ok");
