// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { FileTasks, RuntimeTasks } from "../mod.ts";
import { test } from "../../../tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../../tests/_assert.ts";
import {
  execSecret,
  ExecSecretSettings,
  fileSecret,
  FileSecretSettings,
  SecretError,
} from "../src/secret.ts";
import { withTemp } from "../../../tests/_temp.ts";
import { EVAL } from "../../../tests/_eval.ts";

/** The running `deno`, used as a hermetic, always-present subprocess. */
const deno = RuntimeTasks.execPath();

test("execSecret runs a command and returns its trimmed stdout", async () => {
  const source = execSecret((s) =>
    s.command(deno).arg(EVAL, "console.log('  s3cr3t-value  ')")
  );
  assertEquals(await source.resolve(), "s3cr3t-value");
});

test("execSecret with trim(false) keeps surrounding whitespace", async () => {
  const source = execSecret((s) =>
    s.command(deno).arg(
      EVAL,
      "process.stdout.write(new TextEncoder().encode('tok\\n'))",
    )
      .trim(false)
  );
  assertEquals(await source.resolve(), "tok\n");
});

test("execSecret passes environment variables to the command", async () => {
  const source = execSecret((s) =>
    s.command(deno)
      .arg(EVAL, "console.log(process.env['ZUKE_TEST_SECRET'])")
      .env({ ZUKE_TEST_SECRET: "from-env" })
  );
  assertEquals(await source.resolve(), "from-env");
});

test("execSecret honours the working directory", async () => {
  await withTemp(async (dir) => {
    await FileTasks.writeText(`${dir}/token.txt`, "in-cwd");
    const source = execSecret((s) =>
      s.command(deno)
        .arg(
          EVAL,
          "console.log(process.getBuiltinModule('node:fs').readFileSync('token.txt', 'utf8'))",
        )
        .cwd(dir)
    );
    assertEquals(await source.resolve(), "in-cwd");
  });
});

test("execSecret without a command throws SecretError", async () => {
  const source = execSecret((s) => s.trim());
  await assertRejects(
    () => source.resolve(),
    SecretError,
    "requires a command",
  );
});

test("execSecret surfaces a non-zero exit as SecretError", async () => {
  const source = execSecret((s) =>
    s.command(deno).arg(EVAL, "console.error('nope'); process.exit(3)")
  );
  const error = await assertRejects(() => source.resolve(), SecretError);
  assertStringIncludes(error.message, "exited with code 3");
  assertStringIncludes(error.message, "nope");
});

test("execSecret reports a non-zero exit with no stderr", async () => {
  const source = execSecret((s) =>
    s.command(deno).arg(EVAL, "process.exit(4)")
  );
  const error = await assertRejects(() => source.resolve(), SecretError);
  assertStringIncludes(error.message, "exited with code 4");
});

test("execSecret wraps a missing binary as SecretError", async () => {
  const source = execSecret((s) => s.command("zuke-no-such-binary-xyz"));
  await assertRejects(() => source.resolve(), SecretError, "failed");
});

test("fileSecret reads a file and trims by default", async () => {
  const file = await FileTasks.makeTempFile();
  try {
    await FileTasks.writeText(file, "  file-secret\n");
    const source = fileSecret((s) => s.path(file));
    assertEquals(await source.resolve(), "file-secret");
  } finally {
    await FileTasks.remove(file);
  }
});

test("fileSecret with trim(false) preserves the raw content", async () => {
  const file = await FileTasks.makeTempFile();
  try {
    await FileTasks.writeText(file, "raw\n");
    const source = fileSecret((s) => s.path(file).trim(false));
    assertEquals(await source.resolve(), "raw\n");
  } finally {
    await FileTasks.remove(file);
  }
});

test("fileSecret without a path throws SecretError", async () => {
  const source = fileSecret((s) => s.trim());
  await assertRejects(() => source.resolve(), SecretError, "requires a path");
});

test("fileSecret surfaces a missing file as SecretError", async () => {
  const source = fileSecret((s) => s.path("/no/such/zuke/secret/file"));
  await assertRejects(
    () => source.resolve(),
    SecretError,
    "could not read",
  );
});

test("the settings classes are exported for direct configuration", () => {
  // The fluent classes are part of the public surface (parity with the tool
  // settings), so a build can construct and inspect one directly.
  const exec = new ExecSecretSettings().command("op").arg("read", "op://v/i/f");
  const file = new FileSecretSettings().path("/run/secrets/x");
  assertEquals(exec instanceof ExecSecretSettings, true);
  assertEquals(file instanceof FileSecretSettings, true);
});
