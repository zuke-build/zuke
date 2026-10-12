// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CommandError } from "@zuke/core/shell";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  SecurityCreateKeychainSettings,
  SecurityDeleteKeychainSettings,
  SecuritySetKeychainSettings,
  SecurityUnlockKeychainSettings,
} from "../src/security_keychain.ts";
import {
  SecurityImportSettings,
  SecuritySetKeyPartitionListSettings,
} from "../src/security_import.ts";
import {
  parseIdentities,
  parseKeychainList,
  SecurityFindIdentitySettings,
  SecurityListKeychainsSettings,
} from "../src/security_search.ts";
import { SecurityTasks } from "../src/security.ts";
import { rejection, writeFakeSecurity } from "./_fake_tool.ts";

const PW = "secret-keychain-password";
const HASH = "0123456789ABCDEF0123456789ABCDEF01234567";

Deno.test("security create-keychain: password then keychain", () => {
  assertEquals(
    new SecurityCreateKeychainSettings().password(PW).keychain("ci.keychain-db")
      .argv(),
    ["security", "create-keychain", "-p", PW, "ci.keychain-db"],
  );
  assertEquals(
    new SecurityCreateKeychainSettings().keychain("a", "-b").argv(),
    ["security", "create-keychain", "a", "./-b"],
  );
  assertThrows(
    () => new SecurityCreateKeychainSettings().argv(),
    Error,
    "no keychain",
  );
});

Deno.test("security delete-keychain: keychains, required", () => {
  assertEquals(
    new SecurityDeleteKeychainSettings().keychain("a", "b").argv(),
    ["security", "delete-keychain", "a", "b"],
  );
  assertThrows(
    () => new SecurityDeleteKeychainSettings().argv(),
    Error,
    "no keychain",
  );
});

Deno.test("security unlock-keychain: password and keychain are optional", () => {
  assertEquals(
    new SecurityUnlockKeychainSettings().password(PW).keychain("k").argv(),
    ["security", "unlock-keychain", "-p", PW, "k"],
  );
  assertEquals(new SecurityUnlockKeychainSettings().argv(), [
    "security",
    "unlock-keychain",
  ]);
});

Deno.test("security set-keychain-settings: no flags means never lock", () => {
  assertEquals(new SecuritySetKeychainSettings().keychain("k").argv(), [
    "security",
    "set-keychain-settings",
    "k",
  ]);
  assertEquals(
    new SecuritySetKeychainSettings().lockOnSleep().lockAfterTimeout()
      .timeout(21600).argv(),
    ["security", "set-keychain-settings", "-l", "-u", "-t", "21600"],
  );
});

Deno.test("security import: file, keychain, passphrase, apps, format", () => {
  assertEquals(
    new SecurityImportSettings().file("cert.p12").keychain("k")
      .passphrase(PW).application("/usr/bin/codesign", "/usr/bin/security")
      .type("agg").format("pkcs12").nonExtractable().argv(),
    [
      "security",
      "import",
      "cert.p12",
      "-k",
      "k",
      "-P",
      PW,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
      "-t",
      "agg",
      "-f",
      "pkcs12",
      "-x",
    ],
  );
  assertEquals(new SecurityImportSettings().file("-c.p12").argv(), [
    "security",
    "import",
    "./-c.p12",
  ]);
  assertThrows(() => new SecurityImportSettings().argv(), Error, "no file");
});

Deno.test("security set-key-partition-list: the CI incantation", () => {
  assertEquals(
    new SecuritySetKeyPartitionListSettings().partitionList("apple-tool:")
      .partitionList("apple:").privateKeys().password(PW).keychain("k")
      .argv(),
    [
      "security",
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-s",
      "-k",
      PW,
      "k",
    ],
  );
  assertEquals(new SecuritySetKeyPartitionListSettings().argv(), [
    "security",
    "set-key-partition-list",
  ]);
});

Deno.test("security list-keychains: read, set, and set to empty", () => {
  assertEquals(new SecurityListKeychainsSettings().domain("user").argv(), [
    "security",
    "list-keychains",
    "-d",
    "user",
  ]);
  assertEquals(
    new SecurityListKeychainsSettings().domain("user").set("a").set("b")
      .argv(),
    ["security", "list-keychains", "-d", "user", "-s", "a", "b"],
  );
  assertEquals(new SecurityListKeychainsSettings().set().argv(), [
    "security",
    "list-keychains",
    "-s",
  ]);
});

Deno.test("security find-identity: valid, policy, search, keychains", () => {
  assertEquals(
    new SecurityFindIdentitySettings().valid().policy("codesigning")
      .search("Developer ID").keychain("k").argv(),
    [
      "security",
      "find-identity",
      "-v",
      "-p",
      "codesigning",
      "-s",
      "Developer ID",
      "k",
    ],
  );
});

Deno.test("parseKeychainList reads the quoted paths, in order", () => {
  assertEquals(
    parseKeychainList(
      '    "/Users/ci/Library/Keychains/login.keychain-db"\n' +
        '    "/Library/Keychains/System.keychain"\n\n   bare-path\n',
    ),
    [
      "/Users/ci/Library/Keychains/login.keychain-db",
      "/Library/Keychains/System.keychain",
      "bare-path",
    ],
  );
  assertEquals(parseKeychainList(""), []);
});

Deno.test("parseIdentities reads hash and name, once each", () => {
  const out = [
    "Policy: Code Signing",
    "  Matching identities",
    `  1) ${HASH.toLowerCase()} "Developer ID Application: Example (ABCDE12345)"`,
    `  2) ${
      "F".repeat(40)
    } "Apple Development: \"Quoted\" Name" (CSSMERR_TP_CERT_EXPIRED)`,
    "     2 identities found",
    "",
    "  Valid identities only",
    `  1) ${HASH} "Developer ID Application: Example (ABCDE12345)"`,
    "     1 valid identities found",
  ].join("\n");
  assertEquals(parseIdentities(out), [
    { hash: HASH, name: "Developer ID Application: Example (ABCDE12345)" },
    { hash: "F".repeat(40), name: 'Apple Development: "Quoted" Name' },
  ]);
  assertEquals(parseIdentities("     0 valid identities found"), []);
});

Deno.test("every password setter registers the value as a secret", () => {
  // markSecret is a no-op outside a run; a subclass sees what is registered.
  const seen: string[] = [];
  class Spy extends SecurityUnlockKeychainSettings {
    protected override markSecret(value: string): void {
      seen.push(value);
    }
  }
  new Spy().password("one");
  class SpyCreate extends SecurityCreateKeychainSettings {
    protected override markSecret(value: string): void {
      seen.push(value);
    }
  }
  new SpyCreate().password("two");
  class SpyImport extends SecurityImportSettings {
    protected override markSecret(value: string): void {
      seen.push(value);
    }
  }
  new SpyImport().passphrase("three");
  class SpyPartition extends SecuritySetKeyPartitionListSettings {
    protected override markSecret(value: string): void {
      seen.push(value);
    }
  }
  new SpyPartition().password("four");
  assertEquals(seen, ["one", "two", "three", "four"]);
});

/** Run `fn` with a temp dir holding fake security subcommands. */
async function withFakeSecurity(
  responses: Parameters<typeof writeFakeSecurity>[1],
  fn: (configure: <S extends ToolSettings>(s: S) => S) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-apple-security-" });
  try {
    await writeFakeSecurity(dir, responses);
    await fn((s) => s.toolPath(Deno.execPath()).cwd(dir).quiet());
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a failed command never shows the password, in argv or stderr", async () => {
  await withFakeSecurity({
    "unlock-keychain": {
      stderr: `security: SecKeychainUnlock ${PW}: bad password`,
      code: 51,
    },
  }, async (fake) => {
    const error = await rejection(
      () =>
        SecurityTasks.unlockKeychain((s) => fake(s).password(PW).keychain("k")),
      CommandError,
    );
    assertEquals(error.code, 51);
    assertEquals(error.message.includes(PW), false);
    assertEquals(error.command.includes(PW), false);
    assertEquals(error.stderr.includes(PW), false);
    assertStringIncludes(error.command, "unlock-keychain -p [redacted] k");
  });
});

Deno.test("listKeychains and findIdentity return parsed results", async () => {
  await withFakeSecurity({
    "list-keychains": { stdout: '    "/k/login.keychain-db"' },
    "find-identity": { stdout: `  1) ${HASH} "Dev"\n     1 valid` },
  }, async (fake) => {
    assertEquals(
      await SecurityTasks.listKeychains((s) => fake(s).domain("user")),
      ["/k/login.keychain-db"],
    );
    assertEquals(
      await SecurityTasks.findIdentity((s) => fake(s).valid()),
      [{ hash: HASH, name: "Dev" }],
    );
  });
});

Deno.test("SecurityTasks reach execution", async () => {
  const runs: Array<() => Promise<unknown>> = [
    () => SecurityTasks.createKeychain((s) => missingTool(s).keychain("k")),
    () => SecurityTasks.deleteKeychain((s) => missingTool(s).keychain("k")),
    () => SecurityTasks.unlockKeychain(missingTool),
    () => SecurityTasks.setKeychainSettings(missingTool),
    () => SecurityTasks.import((s) => missingTool(s).file("c.p12")),
    () => SecurityTasks.setKeyPartitionList(missingTool),
    () => SecurityTasks.listKeychains(missingTool),
    () => SecurityTasks.findIdentity(missingTool),
  ];
  for (const run of runs) await assertRejects(run, ToolNotFoundError);
});

Deno.test("security wrappers resolve their binary from PATH", async () => {
  const makers: Array<() => ToolSettings> = [
    () => new SecurityCreateKeychainSettings().keychain("k"),
    () => new SecurityDeleteKeychainSettings().keychain("k"),
    () => new SecurityUnlockKeychainSettings(),
    () => new SecuritySetKeychainSettings(),
    () => new SecurityImportSettings().file("c.p12"),
    () => new SecuritySetKeyPartitionListSettings(),
    () => new SecurityListKeychainsSettings(),
    () => new SecurityFindIdentitySettings(),
  ];
  for (const make of makers) {
    await assertWrapperConformance(make, "security", { resolution: "path" });
  }
});
