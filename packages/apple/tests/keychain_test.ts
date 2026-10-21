// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { CommandOutput } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import { KeychainCleanupError, KeychainError } from "../src/errors.ts";
import {
  defaultKeychainHost,
  type KeychainHost,
} from "../src/keychain_host.ts";
import { TemporaryKeychainSettings } from "../src/keychain.ts";
import { SecurityTasks } from "../src/security.ts";
import { SecurityListKeychainsSettings } from "../src/security_search.ts";
import type { SecuritySettings } from "../src/security_settings.ts";
import { rejection } from "./_fake_tool.ts";

const DIR = "/tmp/zuke-keychain-test";
const KEYCHAIN = `${DIR}/zuke-hex8.keychain-db`;
const PASSWORD = "hex32";
const HASH = "0123456789ABCDEF0123456789ABCDEF01234567";
const P12 = new Uint8Array([0x30, 0x82, 0x01, 0xff]);
const P12_BASE64 = btoa(String.fromCharCode(...P12));
const LOGIN = "/Users/ci/Library/Keychains/login.keychain-db";

/** A fake host that records every effect, answering `security` by subcommand. */
class FakeHost implements KeychainHost {
  /** Every effect, in order: a `security` argv joined by spaces, or a file op. */
  readonly log: string[] = [];
  /** The bytes written per path. */
  readonly written = new Map<string, Uint8Array>();
  /** Canned stdout per subcommand. */
  stdout: Record<string, string> = {
    "list-keychains": `    "${LOGIN}"\n`,
    "find-identity": `  1) ${HASH} "Developer ID Application: Example (T)"\n` +
      "     1 valid identities found\n",
  };
  /** Subcommands (or file ops) that throw, keyed to the message. */
  failures: Record<string, string> = {};

  security(settings: SecuritySettings): Promise<CommandOutput> {
    const argv = settings.argv();
    this.log.push(argv.join(" "));
    const sub = argv[1] ?? "";
    const failure = this.failures[argv.slice(1).join(" ")] ??
      this.failures[sub];
    if (failure !== undefined) return Promise.reject(new Error(failure));
    return Promise.resolve(new CommandOutput(0, this.stdout[sub] ?? "", ""));
  }
  makeTempDir(): Promise<string> {
    this.log.push("mkdtemp");
    return Promise.resolve(DIR);
  }
  writePrivateFile(path: string, data: Uint8Array): Promise<void> {
    this.log.push(`write ${path}`);
    this.written.set(path, data);
    const failure = this.failures["write"];
    return failure === undefined
      ? Promise.resolve()
      : Promise.reject(new Error(failure));
  }
  remove(path: string): Promise<void> {
    this.log.push(`rm ${path}`);
    const failure = this.failures[`rm ${path}`];
    return failure === undefined
      ? Promise.resolve()
      : Promise.reject(new Error(failure));
  }
  randomHex(bytes: number): string {
    return `hex${bytes}`;
  }
}

/** Settings with the certificate and the fake host. */
function keychain(host: FakeHost): TemporaryKeychainSettings {
  return new TemporaryKeychainSettings().certificate(P12_BASE64)
    .certificatePassword("p12-pass").host(host);
}

/** The whole successful setup, in order. */
const SETUP = [
  "mkdtemp",
  "security list-keychains -d user",
  `security create-keychain -p ${PASSWORD} ${KEYCHAIN}`,
  `security set-keychain-settings ${KEYCHAIN}`,
  `security unlock-keychain -p ${PASSWORD} ${KEYCHAIN}`,
  `write ${DIR}/certificate.p12`,
  `security import ${DIR}/certificate.p12 -k ${KEYCHAIN} -P p12-pass ` +
  "-T /usr/bin/codesign -f pkcs12",
  `rm ${DIR}/certificate.p12`,
  `security set-key-partition-list -S apple-tool:,apple: -s -k ${PASSWORD} ` +
  KEYCHAIN,
  `security list-keychains -d user -s ${KEYCHAIN} ${LOGIN}`,
  `security find-identity -v -p codesigning ${KEYCHAIN}`,
];

/** The whole cleanup, in order. */
const CLEANUP = [
  `security delete-keychain ${KEYCHAIN}`,
  `security list-keychains -d user -s ${LOGIN}`,
  `rm ${DIR}`,
];

Deno.test("temporaryKeychain sets up, runs the callback, and tears down, in order", async () => {
  const host = new FakeHost();
  const result = await SecurityTasks.temporaryKeychain(
    () => keychain(host),
    ({ keychain, identity }) => {
      host.log.push(`use ${keychain} ${identity.hash}`);
      return Promise.resolve(identity.name);
    },
  );
  assertEquals(result, "Developer ID Application: Example (T)");
  assertEquals(host.log, [...SETUP, `use ${KEYCHAIN} ${HASH}`, ...CLEANUP]);
  // The decoded .p12 is what reached the private file.
  assertEquals([...(host.written.get(`${DIR}/certificate.p12`) ?? [])], [
    ...P12,
  ]);
});

Deno.test("cleanup runs in full when the callback throws, and the error survives", async () => {
  const host = new FakeHost();
  await assertRejects(
    () =>
      SecurityTasks.temporaryKeychain(
        () => keychain(host),
        () => Promise.reject(new Error("signing failed")),
      ),
    Error,
    "signing failed",
  );
  assertEquals(host.log, [...SETUP, ...CLEANUP]);
});

Deno.test("a failed create-keychain leaves nothing to delete, but still restores and removes", async () => {
  const host = new FakeHost();
  host.failures["create-keychain"] = "create failed";
  await assertRejects(
    () => keychain(host).open_(() => Promise.resolve()),
    Error,
    "create failed",
  );
  assertEquals(host.log, [
    ...SETUP.slice(0, 3),
    `security list-keychains -d user -s ${LOGIN}`,
    `rm ${DIR}`,
  ]);
});

Deno.test("a failed read of the search list changes nothing and removes the directory", async () => {
  const host = new FakeHost();
  host.failures["list-keychains -d user"] = "no list";
  await assertRejects(
    () => keychain(host).open_(() => Promise.resolve()),
    Error,
    "no list",
  );
  assertEquals(host.log, [...SETUP.slice(0, 2), `rm ${DIR}`]);
});

Deno.test("a failed import still deletes the certificate file at once", async () => {
  const host = new FakeHost();
  host.failures["import"] = "bad passphrase";
  await assertRejects(
    () => keychain(host).open_(() => Promise.resolve()),
    Error,
    "bad passphrase",
  );
  assertEquals(host.log, [...SETUP.slice(0, 8), ...CLEANUP]);
});

Deno.test("a failed certificate write still removes the file and cleans up", async () => {
  const host = new FakeHost();
  host.failures["write"] = "disk full";
  await assertRejects(
    () => keychain(host).open_(() => Promise.resolve()),
    Error,
    "disk full",
  );
  assertEquals(host.log, [
    ...SETUP.slice(0, 6),
    `rm ${DIR}/certificate.p12`,
    ...CLEANUP,
  ]);
});

Deno.test("every cleanup step runs even when one fails, and the failures are reported", async () => {
  const host = new FakeHost();
  host.failures["delete-keychain"] = "keychain busy";
  host.failures[`rm ${DIR}`] = "permission denied";
  const error = await rejection(
    () => keychain(host).open_(() => Promise.resolve(1)),
    KeychainCleanupError,
  );
  assertEquals(host.log.slice(-3), CLEANUP);
  assertEquals(error.failures, [
    { step: "delete the keychain", message: "keychain busy" },
    { step: "remove the keychain directory", message: "permission denied" },
  ]);
  assertEquals(error.cause, undefined);
  assertEquals(error.message.includes("see the cause"), false);
});

Deno.test("a cleanup failure after a callback failure keeps the callback's error as the cause", async () => {
  const host = new FakeHost();
  const failure = new Error("signing failed");
  host.failures["delete-keychain"] = "keychain busy";
  const error = await rejection(
    () => keychain(host).open_(() => Promise.reject(failure)),
    KeychainCleanupError,
  );
  assertEquals(error.cause === failure, true);
  assertStringIncludes(error.message, "see the cause");
});

Deno.test("a callback that rejects with undefined is still reported as failed when cleanup fails", async () => {
  // Regression: the cause used to be read as "absent" when it was undefined,
  // so the error claimed the callback had succeeded.
  const host = new FakeHost();
  host.failures["delete-keychain"] = "keychain busy";
  const error = await rejection(
    () => keychain(host).open_(() => Promise.reject(undefined)),
    KeychainCleanupError,
  );
  assertStringIncludes(error.message, "see the cause");
  assertEquals("cause" in error, true);
});

Deno.test("a non-Error thrown by a cleanup step is still reported", async () => {
  const host = new FakeHost();
  host.remove = () => Promise.reject("plain string");
  const error = await rejection(
    () => keychain(host).open_(() => Promise.resolve()),
    KeychainCleanupError,
  );
  assertEquals(error.failures.at(-1)?.message, "plain string");
});

/**
 * A fake host whose `list-keychains` reads and writes one search list shared
 * with other hosts — the per-user list two keychains in one process contend
 * for — and whose temp dirs and keychain names are its own.
 */
class SharedListHost extends FakeHost {
  /** Every list this host saw while its callback ran. */
  readonly seenDuringUse: string[][] = [];

  constructor(readonly name: string, readonly shared: { list: string[] }) {
    super();
  }
  override security(settings: SecuritySettings): Promise<CommandOutput> {
    const argv = settings.argv();
    if (argv[1] !== "list-keychains") return super.security(settings);
    this.log.push(argv.join(" "));
    const set = argv.indexOf("-s");
    if (set === -1) {
      const listed = this.shared.list.map((k) => `    "${k}"`).join("\n");
      return Promise.resolve(new CommandOutput(0, listed, ""));
    }
    this.shared.list = argv.slice(set + 1);
    return Promise.resolve(new CommandOutput(0, "", ""));
  }
  override makeTempDir(): Promise<string> {
    this.log.push("mkdtemp");
    return Promise.resolve(`/tmp/${this.name}`);
  }
  override randomHex(bytes: number): string {
    return `${this.name}${bytes}`;
  }
}

Deno.test("overlapping keychains in one process are serialized, so the search list survives", async () => {
  // Regression (finding 1): each keychain restores the list it read, so two
  // that overlapped left a deleted keychain on the list, or dropped the
  // other's keychain while it was signing.
  const shared = { list: [LOGIN] };
  const a = new SharedListHost("a", shared);
  const b = new SharedListHost("b", shared);
  const order: string[] = [];
  /** A callback that yields to the event loop while it "signs". */
  const use = (host: SharedListHost) => async (k: { keychain: string }) => {
    order.push(`${host.name} start`);
    for (let i = 0; i < 5; i++) {
      host.seenDuringUse.push([...shared.list]);
      assertEquals(shared.list[0], k.keychain);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    order.push(`${host.name} end`);
  };
  await Promise.all([
    keychain(a).open_(use(a)),
    keychain(b).open_(use(b)),
  ]);
  assertEquals(order, ["a start", "a end", "b start", "b end"]);
  assertEquals(shared.list, [LOGIN]);
  // Each saw only its own keychain ahead of the original list.
  assertEquals(
    a.seenDuringUse.every((l) =>
      l.join() === `/tmp/a/zuke-a8.keychain-db,${LOGIN}`
    ),
    true,
  );
  assertEquals(
    b.seenDuringUse.every((l) =>
      l.join() === `/tmp/b/zuke-b8.keychain-db,${LOGIN}`
    ),
    true,
  );
  // b did not even read the list until a had been torn down.
  assertEquals(b.log[0], "mkdtemp");
});

Deno.test("a failed keychain does not block the next one in the process", async () => {
  const failing = new FakeHost();
  failing.failures["create-keychain"] = "create failed";
  const first = keychain(failing).open_(() => Promise.resolve("first"));
  const second = keychain(new FakeHost()).open_(() =>
    Promise.resolve("second")
  );
  await assertRejects(() => first, Error, "create failed");
  assertEquals(await second, "second");
});

Deno.test("no identity in the certificate is a friendly KeychainError, and still cleans up", async () => {
  const host = new FakeHost();
  host.stdout["find-identity"] = "     0 valid identities found\n";
  await assertRejects(
    () => keychain(host).open_(() => Promise.resolve()),
    KeychainError,
    "holds no valid codesigning identity.",
  );
  assertEquals(host.log.slice(-3), CLEANUP);
});

Deno.test("several identities need a filter, by name or by hash", async () => {
  const other = "F".repeat(40);
  const listing = `  1) ${HASH} "Developer ID Application: A (T)"\n` +
    `  2) ${other} "Developer ID Installer: \u001b[31mB (T)"\n`;
  const host = new FakeHost();
  host.stdout["find-identity"] = listing;
  const error = await rejection(
    () => keychain(host).open_(() => Promise.resolve()),
    KeychainError,
  );
  assertStringIncludes(error.message, "2 codesigning identities");
  assertStringIncludes(
    error.message,
    `${other} Developer ID Installer:  [31mB`,
  );
  assertEquals(error.message.includes("\u001b"), false);

  const byName = new FakeHost();
  byName.stdout["find-identity"] = listing;
  const named = await keychain(byName).identity("Installer").open_((k) =>
    Promise.resolve(k.identity.hash)
  );
  assertEquals(named, other);

  const byHash = new FakeHost();
  byHash.stdout["find-identity"] = listing;
  const hashed = await keychain(byHash).identity(HASH.toLowerCase()).open_(
    (k) => Promise.resolve(k.identity.name),
  );
  assertEquals(hashed, "Developer ID Application: A (T)");

  const none = new FakeHost();
  none.stdout["find-identity"] = listing;
  await assertRejects(
    () => keychain(none).identity("Mac App").open_(() => Promise.resolve()),
    KeychainError,
    'no valid codesigning identity matching "Mac App"',
  );
});

Deno.test("a bad certificate is refused before anything is created, without echoing it", async () => {
  const cases: Array<[string | undefined, string]> = [
    [undefined, "no certificate"],
    ["", "not base64"],
    ["not*base64!", "not base64"],
    ["abcde", "not base64"],
  ];
  for (const [certificate, message] of cases) {
    const host = new FakeHost();
    const settings = new TemporaryKeychainSettings().host(host);
    if (certificate !== undefined) settings.certificate(certificate);
    const error = await rejection(
      () => settings.open_(() => Promise.resolve()),
      KeychainError,
    );
    assertStringIncludes(error.message, message);
    if (certificate) assertEquals(error.message.includes(certificate), false);
    assertEquals(host.log, []);
  }
});

Deno.test("whitespace in the base64 certificate is ignored", async () => {
  const host = new FakeHost();
  const spaced = `${P12_BASE64.slice(0, 2)}\n ${P12_BASE64.slice(2)}\n`;
  await new TemporaryKeychainSettings().certificate(spaced).host(host)
    .open_(() => Promise.resolve());
  assertEquals([...(host.written.get(`${DIR}/certificate.p12`) ?? [])], [
    ...P12,
  ]);
  // No password given: an empty one is passed, so security never prompts.
  assertEquals(
    host.log.some((l) => l.endsWith(" -P  -T /usr/bin/codesign -f pkcs12")),
    true,
  );
});

Deno.test("toolPath and application reach every security command", async () => {
  const host = new FakeHost();
  await keychain(host).toolPath("/opt/security").application(
    "/usr/bin/productsign",
  ).open_(() => Promise.resolve());
  const commands = host.log.filter((l) => !/^(mkdtemp|write|rm)\b/.test(l));
  assertEquals(commands.every((l) => l.startsWith("/opt/security ")), true);
  assertEquals(
    commands.some((l) => l.includes("-T /usr/bin/productsign -f pkcs12")),
    true,
  );
});

Deno.test("the real host writes a private file, refuses to overwrite, and removes", async () => {
  const dir = await defaultKeychainHost.makeTempDir();
  try {
    assertStringIncludes(dir, "zuke-keychain-");
    // Canonical already, so it matches how security lists keychain paths.
    assertEquals(await Deno.realPath(dir), dir);
    const file = `${dir}/certificate.p12`;
    await defaultKeychainHost.writePrivateFile(file, P12);
    assertEquals([...await Deno.readFile(file)], [...P12]);
    if (Deno.build.os !== "windows") {
      const mode = (await Deno.stat(file)).mode;
      assertEquals(mode === null ? null : mode & 0o777, 0o600);
    }
    await assertRejects(
      () => defaultKeychainHost.writePrivateFile(file, P12),
      Deno.errors.AlreadyExists,
    );
    await defaultKeychainHost.remove(file);
    // Already gone is fine.
    await defaultKeychainHost.remove(file);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the real host's remove still reports a failure that is not 'missing'", async () => {
  await assertRejects(
    () => defaultKeychainHost.remove("bad\0path"),
    Error,
  );
});

Deno.test("the real host makes random hex of the requested length", () => {
  const a = defaultKeychainHost.randomHex(32);
  assertEquals(/^[0-9a-f]{64}$/.test(a), true);
  assertEquals(a === defaultKeychainHost.randomHex(32), false);
});

Deno.test("the real host runs security commands for real", async () => {
  await assertRejects(
    () =>
      defaultKeychainHost.security(
        missingTool(new SecurityListKeychainsSettings()),
      ),
    ToolNotFoundError,
  );
});
