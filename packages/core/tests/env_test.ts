import { assertEquals } from "./_assert.ts";
import { prependPath } from "../src/env.ts";

/** Run `fn` with `PATH` set to `value`, restoring the real `PATH` afterwards. */
async function withPath(
  value: string,
  fn: () => void | Promise<void>,
): Promise<void> {
  const saved = Deno.env.get("PATH");
  Deno.env.set("PATH", value);
  try {
    await fn();
  } finally {
    if (saved === undefined) Deno.env.delete("PATH");
    else Deno.env.set("PATH", saved);
  }
}

Deno.test("prependPath puts a directory first (POSIX separator)", async () => {
  await withPath("/usr/bin:/bin", () => {
    const next = prependPath("/tools/bin", "linux");
    assertEquals(next, "/tools/bin:/usr/bin:/bin");
    assertEquals(Deno.env.get("PATH"), "/tools/bin:/usr/bin:/bin");
  });
});

Deno.test("prependPath uses the Windows separator", async () => {
  await withPath("C:\\Windows;C:\\bin", () => {
    const next = prependPath("C:\\tools", "windows");
    assertEquals(next, "C:\\tools;C:\\Windows;C:\\bin");
    assertEquals(Deno.env.get("PATH"), "C:\\tools;C:\\Windows;C:\\bin");
  });
});

Deno.test("prependPath is idempotent — an already-present dir is not duplicated", async () => {
  await withPath("/a:/b", () => {
    const next = prependPath("/a", "linux");
    assertEquals(next, "/a:/b"); // unchanged
    assertEquals(Deno.env.get("PATH"), "/a:/b");
  });
});

Deno.test("prependPath handles an empty PATH", async () => {
  await withPath("", () => {
    assertEquals(prependPath("/only", "linux"), "/only");
    assertEquals(Deno.env.get("PATH"), "/only");
  });
});

Deno.test("prependPath treats an unset PATH as empty", () => {
  // Distinct from an empty-string PATH: this exercises the `?? ""` fallback for
  // a PATH that is genuinely unset.
  const saved = Deno.env.get("PATH");
  Deno.env.delete("PATH");
  try {
    assertEquals(prependPath("/x", "linux"), "/x");
    assertEquals(Deno.env.get("PATH"), "/x");
  } finally {
    if (saved === undefined) Deno.env.delete("PATH");
    else Deno.env.set("PATH", saved);
  }
});

Deno.test("prependPath defaults to the host separator", async () => {
  await withPath("HOST", () => {
    const next = prependPath("FIRST"); // host os
    assertEquals(next.startsWith("FIRST"), true);
    assertEquals(next.endsWith("HOST"), true);
  });
});
