// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `@zuke/apple`: real builds, driven through the CLI
 * `main()` entry point, that sign from a temporary keychain and notarize.
 *
 * The unit tests prove each piece — the argv, the parsers, the keychain's step
 * order against a fake host. This proves the pieces hold together in a run:
 * the real `Deno`-backed host creates and removes a real temp directory and a
 * real `0600` certificate file, a failure inside a target still tears the
 * keychain down, the run's redactor and the wrappers' own masking keep the
 * passwords out of what the CLI prints, and a rejected notarization fails the
 * target with the log's issues in the message.
 *
 * Hermetic per AGENTS.md guideline 5: the "tools" are scripts the running
 * `deno` executes. Deno 2 runs `deno <file> <args…>` as a script, so a
 * wrapper pointed at `Deno.execPath()` from a directory holding a script named
 * after its subcommand (`notarytool`, `create-keychain`, …) spawns that script
 * with the wrapper's real argv — no shell, and the same on every OS.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { NotarytoolTasks, SecurityTasks } from "../../packages/apple/mod.ts";
import {
  fakeNotarytool,
  writeFakeSecurity,
} from "../../packages/apple/tests/_fake_tool.ts";
import {
  defaultKeychainHost,
  type KeychainHost,
} from "../../packages/apple/src/keychain_host.ts";
import { runCli } from "./_harness.ts";

const LOGIN = "/Users/ci/Library/Keychains/login.keychain-db";
const HASH = "0123456789ABCDEF0123456789ABCDEF01234567";
const IDENTITY = "Developer ID Application: Example (ABCDE12345)";
const P12_PASSWORD = "p12-export-password-that-must-not-escape";
const P12_BASE64 = btoa("not really a p12, but the fake does not care");

/** Every security subcommand the keychain runs, answering as a Mac would. */
const SECURITY = {
  "list-keychains": {
    stdout: '    "/Users/ci/Library/Keychains/login.keychain-db"',
  },
  "create-keychain": {},
  "set-keychain-settings": {},
  "unlock-keychain": {},
  "import": { stdout: "1 identity imported." },
  "set-key-partition-list": {},
  "find-identity": {
    stdout: `  1) ${HASH} "${IDENTITY}"\n     1 valid identities found`,
  },
  "delete-keychain": {},
};

/** Run `fn` from a temp dir holding the fake security subcommands. */
async function inFakeSecurityDir(
  overrides: Record<
    string,
    { stdout?: string; stderr?: string; code?: number }
  >,
  fn: () => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-apple-" });
  const previous = Deno.cwd();
  try {
    await writeFakeSecurity(dir, { ...SECURITY, ...overrides });
    Deno.chdir(dir);
    await fn();
  } finally {
    Deno.chdir(previous);
    await Deno.remove(dir, { recursive: true });
  }
}

/** Whether `path` exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("a target signs from a temporary keychain that is gone afterwards", async () => {
  await inFakeSecurityDir({}, async () => {
    let seen = { keychain: "", hash: "", certificateWasPrivate: false };
    class Sign extends Build {
      sign = target().executes(async () => {
        await SecurityTasks.temporaryKeychain(
          (s) =>
            s.toolPath(Deno.execPath()).certificate(P12_BASE64)
              .certificatePassword(P12_PASSWORD),
          async ({ keychain, identity }) => {
            const dir = keychain.slice(0, keychain.lastIndexOf("/"));
            seen = {
              keychain,
              hash: identity.hash,
              // Imported and deleted before the callback ever runs.
              certificateWasPrivate: !(await exists(`${dir}/certificate.p12`)),
            };
          },
        );
      });
    }
    const { code, out, err } = await runCli(Sign, ["sign"]);
    assertEquals(code, 0, err);
    assertEquals(seen.hash, HASH);
    assertEquals(seen.certificateWasPrivate, true);
    assertStringIncludes(seen.keychain, "zuke-keychain-");
    // The whole temp directory — keychain and certificate — is removed.
    assertEquals(await exists(seen.keychain), false);
    assertEquals(
      await exists(seen.keychain.slice(0, seen.keychain.lastIndexOf("/"))),
      false,
    );
    assertEquals(`${out}${err}`.includes(P12_PASSWORD), false);
  });
});

Deno.test("a failing keychain step fails the target, masks the password, and still cleans up", async () => {
  await inFakeSecurityDir({
    "unlock-keychain": { stderr: "SecKeychainUnlock: bad password", code: 51 },
  }, async () => {
    // The real host, with every security argv recorded on the way through.
    const sent: string[][] = [];
    const recording: KeychainHost = {
      ...defaultKeychainHost,
      security: (settings) => {
        sent.push(settings.argv());
        return defaultKeychainHost.security(settings);
      },
    };
    class Sign extends Build {
      sign = target().executes(async () => {
        await SecurityTasks.temporaryKeychain(
          (s) =>
            s.toolPath(Deno.execPath()).certificate(P12_BASE64)
              .certificatePassword(P12_PASSWORD).host(recording),
          () => Promise.resolve(),
        );
      });
    }
    const { code, err } = await runCli(Sign, ["sign"]);
    assertEquals(code, 1);
    assertStringIncludes(err, "unlock-keychain -p [redacted] ");
    const keychain = /unlock-keychain -p \[redacted\] (\S+)/.exec(err)?.[1];
    assertEquals(typeof keychain, "string");
    // The real temp directory the real host created is gone: the keychain's
    // cleanup ran (the fake create-keychain writes no file, so checking the
    // keychain path alone would prove nothing).
    const dir = String(keychain).slice(0, String(keychain).lastIndexOf("/"));
    assertStringIncludes(dir, "zuke-keychain-");
    assertEquals(await exists(dir), false);
    // The keychain was deleted, and the search list was put back as read.
    assertEquals(
      sent.some((a) => a[1] === "delete-keychain" && a[2] === keychain),
      true,
    );
    assertEquals(sent.at(-1)?.slice(1), [
      "list-keychains",
      "-d",
      "user",
      "-s",
      LOGIN,
    ]);
  });
});

Deno.test("a rejected notarization fails the target with the log's issues", async () => {
  const id = "2efe2717-52ef-43a5-96dc-0797e4ca1041";
  const dir = await fakeNotarytool({
    submit: {
      stdout: JSON.stringify({ id, status: "Invalid", message: "done" }),
      code: 1,
    },
    log: {
      needs: [id, "--keychain-profile", "ci"],
      stdout: JSON.stringify({
        status: "Invalid",
        issues: [{ severity: "error", message: "The binary is not signed." }],
      }),
    },
  });
  try {
    class Release extends Build {
      notarize = target().executes(async () => {
        await NotarytoolTasks.submit((s) =>
          s.toolPath(Deno.execPath()).cwd(dir).file("dist/a.zip")
            .keychainProfile("ci").wait().timeout("30m")
        );
      });
    }
    const { code, err } = await runCli(Release, ["notarize"]);
    assertEquals(code, 1);
    assertStringIncludes(
      err,
      `submission ${id} finished with status "Invalid"`,
    );
    assertStringIncludes(err, "error: The binary is not signed.");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an accepted notarization passes the target and returns the result", async () => {
  const id = "4b8c1c8e-0000-4000-8000-000000000000";
  const dir = await fakeNotarytool({
    submit: {
      needs: ["--wait", "--output-format", "json"],
      stdout: JSON.stringify({ id, status: "Accepted", message: "done" }),
    },
  });
  try {
    let status: string | undefined;
    class Release extends Build {
      notarize = target().executes(async () => {
        const result = await NotarytoolTasks.submit((s) =>
          s.toolPath(Deno.execPath()).cwd(dir).file("dist/a.zip")
            .keychainProfile("ci").wait()
        );
        status = result.status;
      });
    }
    const { code, err } = await runCli(Release, ["notarize"]);
    assertEquals(code, 0, err);
    assertEquals(status, "Accepted");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
