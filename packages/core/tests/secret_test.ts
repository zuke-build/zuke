import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "./_assert.ts";
import {
  execSecret,
  ExecSecretSettings,
  fileSecret,
  FileSecretSettings,
  SecretError,
} from "../src/secret.ts";

/** The running `deno`, used as a hermetic, always-present subprocess. */
const deno = Deno.execPath();

Deno.test("execSecret runs a command and returns its trimmed stdout", async () => {
  const source = execSecret((s) =>
    s.command(deno).arg("eval", "console.log('  s3cr3t-value  ')")
  );
  assertEquals(await source.resolve(), "s3cr3t-value");
});

Deno.test("execSecret with trim(false) keeps surrounding whitespace", async () => {
  const source = execSecret((s) =>
    s.command(deno).arg(
      "eval",
      "Deno.stdout.write(new TextEncoder().encode('tok\\n'))",
    )
      .trim(false)
  );
  assertEquals(await source.resolve(), "tok\n");
});

Deno.test("execSecret passes environment variables to the command", async () => {
  const source = execSecret((s) =>
    s.command(deno)
      .arg("eval", "console.log(Deno.env.get('ZUKE_TEST_SECRET'))")
      .env({ ZUKE_TEST_SECRET: "from-env" })
  );
  assertEquals(await source.resolve(), "from-env");
});

Deno.test("execSecret honours the working directory", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/token.txt`, "in-cwd");
    const source = execSecret((s) =>
      s.command(deno)
        .arg("eval", "console.log(Deno.readTextFileSync('token.txt'))")
        .cwd(dir)
    );
    assertEquals(await source.resolve(), "in-cwd");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("execSecret without a command throws SecretError", async () => {
  const source = execSecret((s) => s.trim());
  await assertRejects(
    () => source.resolve(),
    SecretError,
    "requires a command",
  );
});

Deno.test("execSecret surfaces a non-zero exit as SecretError", async () => {
  const source = execSecret((s) =>
    s.command(deno).arg("eval", "console.error('nope'); Deno.exit(3)")
  );
  const error = await assertRejects(() => source.resolve(), SecretError);
  assertStringIncludes(error.message, "exited with code 3");
  assertStringIncludes(error.message, "nope");
});

Deno.test("execSecret reports a non-zero exit with no stderr", async () => {
  const source = execSecret((s) => s.command(deno).arg("eval", "Deno.exit(4)"));
  const error = await assertRejects(() => source.resolve(), SecretError);
  assertStringIncludes(error.message, "exited with code 4");
});

Deno.test("execSecret wraps a missing binary as SecretError", async () => {
  const source = execSecret((s) => s.command("zuke-no-such-binary-xyz"));
  await assertRejects(() => source.resolve(), SecretError, "failed");
});

Deno.test("fileSecret reads a file and trims by default", async () => {
  const file = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(file, "  file-secret\n");
    const source = fileSecret((s) => s.path(file));
    assertEquals(await source.resolve(), "file-secret");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("fileSecret with trim(false) preserves the raw content", async () => {
  const file = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(file, "raw\n");
    const source = fileSecret((s) => s.path(file).trim(false));
    assertEquals(await source.resolve(), "raw\n");
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("fileSecret without a path throws SecretError", async () => {
  const source = fileSecret((s) => s.trim());
  await assertRejects(() => source.resolve(), SecretError, "requires a path");
});

Deno.test("fileSecret surfaces a missing file as SecretError", async () => {
  const source = fileSecret((s) => s.path("/no/such/zuke/secret/file"));
  await assertRejects(
    () => source.resolve(),
    SecretError,
    "could not read",
  );
});

Deno.test("the settings classes are exported for direct configuration", () => {
  // The fluent classes are part of the public surface (parity with the tool
  // settings), so a build can construct and inspect one directly.
  const exec = new ExecSecretSettings().command("op").arg("read", "op://v/i/f");
  const file = new FileSecretSettings().path("/run/secrets/x");
  assertEquals(exec instanceof ExecSecretSettings, true);
  assertEquals(file instanceof FileSecretSettings, true);
});
