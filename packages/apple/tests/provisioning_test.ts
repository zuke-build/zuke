// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT
// cspell:ignore frob

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { rejection } from "./_fake_tool.ts";
import { ProvisioningProfileError, ProvisioningProfileTasks } from "../mod.ts";
import { readProvisioningProfile } from "../src/provisioning_profile.ts";
import { base64, MemoryHost, profileBytes, profilePlist } from "./_profile.ts";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = Date.parse("2026-06-01T00:00:00Z");

Deno.test("profile: identity read from the embedded plist", () => {
  assertEquals(readProvisioningProfile(profileBytes()), {
    uuid: UUID,
    name: "Example App Store",
    teamIds: ["ABCDE12345"],
    teamName: "Example Ltd",
    appIdName: "Example & Co",
    bundleId: "com.example.app",
    platforms: ["iOS"],
    kind: "app-store",
    creationDate: new Date("2026-01-01T00:00:00Z"),
    expirationDate: new Date("2027-01-01T00:00:00Z"),
    xcodeManaged: false,
  });
});

Deno.test("profile: the kind follows devices and debugging", () => {
  const kind = (p: Parameters<typeof profileBytes>[0]) =>
    readProvisioningProfile(profileBytes(p)).kind;
  assertEquals(kind({ devices: true, getTaskAllow: true }), "development");
  assertEquals(kind({ devices: true }), "ad-hoc");
  assertEquals(kind({ allDevices: true }), "enterprise");
  assertEquals(
    readProvisioningProfile(profileBytes({ xcodeManaged: true, appId: "TEAM" }))
      .bundleId,
    "TEAM",
  );
});

Deno.test("profile: what is not a profile is refused with a reason", () => {
  const fails = (bytes: Uint8Array, reason: string) =>
    assertThrows(
      () => readProvisioningProfile(bytes),
      ProvisioningProfileError,
      reason,
    );
  fails(new Uint8Array([1, 2, 3]), "no property list found");
  fails(
    new Uint8Array([
      ...new TextEncoder().encode("<?xml"),
      0xff,
      ...new TextEncoder().encode("</plist>"),
    ]),
    "Provisioning profile:",
  );
  const plist = (body: string) =>
    profileBytes({ plist: `<?xml version="1.0"?><plist>${body}</plist>` });
  fails(plist("<array/>"), "not a dictionary");
  fails(plist("<dict/>"), "has no Entitlements");
  const withEntitlements = (extra: string) =>
    plist(
      `<dict><key>Entitlements</key><dict><key>application-identifier</key><string>T.a</string></dict>${extra}</dict>`,
    );
  fails(withEntitlements(""), "the profile has no UUID");
  fails(withEntitlements("<key>UUID</key><true/>"), "UUID is not a string");
  fails(
    plist("<dict><key>Entitlements</key><dict/></dict>"),
    "has no application-identifier",
  );
  const full = profilePlist();
  fails(
    profileBytes({
      plist: full.replace(
        "<array><string>iOS</string></array>",
        "<string>iOS</string>",
      ),
    }),
    "Platform is not a list of strings",
  );
  fails(
    profileBytes({
      plist: full.replace(
        "<array><string>ABCDE12345</string></array>",
        "<array><true/></array>",
      ),
    }),
    "TeamIdentifier is not a list of strings",
  );
  fails(
    profileBytes({
      plist: full.replace(
        "<date>2026-01-01T00:00:00Z</date>",
        "<string>x</string>",
      ),
    }),
    "CreationDate is not a date",
  );
});

Deno.test("inspect: from a file or from base64, exactly one", async () => {
  const host = new MemoryHost();
  host.files.set("/p.mobileprovision", profileBytes());
  const fromFile = await ProvisioningProfileTasks.inspect((s) =>
    s.host(host).file("/p.mobileprovision")
  );
  assertEquals(fromFile.uuid, UUID);
  const fromBase64 = await ProvisioningProfileTasks.inspect((s) =>
    s.base64(base64(profileBytes()).replace(/.{40}/g, "$&\n"))
  );
  assertEquals(fromBase64.uuid, UUID);
  await assertRejects(
    () => ProvisioningProfileTasks.inspect((s) => s),
    ProvisioningProfileError,
    "set exactly one of .file() and .base64()",
  );
  await assertRejects(
    () => ProvisioningProfileTasks.inspect((s) => s.file("a").base64("b")),
    ProvisioningProfileError,
    "set exactly one",
  );
  await assertRejects(
    () => ProvisioningProfileTasks.inspect((s) => s.base64("!!not base64!!")),
    ProvisioningProfileError,
    "the .base64() value is not base64",
  );
});

Deno.test("install: into Xcode's two directories, named by UUID", async () => {
  const host = new MemoryHost();
  const installed = await ProvisioningProfileTasks.install((s) =>
    s.host(host).now(() => NOW).base64(base64(profileBytes()))
  );
  const paths = [
    `/Users/ci/Library/Developer/Xcode/UserData/Provisioning Profiles/${UUID}.mobileprovision`,
    `/Users/ci/Library/MobileDevice/Provisioning Profiles/${UUID}.mobileprovision`,
  ];
  assertEquals(installed.paths, paths);
  assertEquals([...host.files.keys()], paths);
  assertEquals(host.directories.length, 2);
  assertEquals(installed.profile.uuid, UUID);
});

Deno.test("install: custom directories, expiry and unsafe UUIDs", async () => {
  const host = new MemoryHost();
  const installed = await ProvisioningProfileTasks.install((s) =>
    s.host(host).now(() => NOW).directory("/tmp/a").base64(
      base64(profileBytes()),
    )
  );
  assertEquals(installed.paths, [`/tmp/a/${UUID}.mobileprovision`]);
  const expired = base64(profileBytes({ expires: "2026-05-01T00:00:00Z" }));
  await assertRejects(
    () =>
      ProvisioningProfileTasks.install((s) =>
        s.host(host).now(() => NOW).base64(expired)
      ),
    ProvisioningProfileError,
    "expired on 2026-05-01T00:00:00.000Z; renew it, or pass .allowExpired()",
  );
  await ProvisioningProfileTasks.install((s) =>
    s.host(host).now(() => NOW).allowExpired().directory("/tmp/b").base64(
      expired,
    )
  );
  await assertRejects(
    () =>
      ProvisioningProfileTasks.install((s) =>
        s.host(host).now(() => NOW).base64(
          base64(profileBytes({ uuid: "../../etc/passwd" })),
        )
      ),
    ProvisioningProfileError,
    "cannot name a file",
  );
});

Deno.test("temporary: a profile that was already installed is left in place", async () => {
  const host = new MemoryHost();
  const existing =
    `/Users/ci/Library/MobileDevice/Provisioning Profiles/${UUID}.mobileprovision`;
  host.files.set(existing, profileBytes());
  await ProvisioningProfileTasks.temporary(
    (s) => s.host(host).now(() => NOW).base64(base64(profileBytes())),
    () => Promise.resolve(),
  );
  assertEquals([...host.files.keys()], [existing]);
});

Deno.test("profile: a malformed plist keeps the parser's error as the cause", async () => {
  const error = await rejection(
    () =>
      ProvisioningProfileTasks.inspect((s) =>
        s.base64(
          base64(profileBytes({ plist: "<?xml?><plist><frob/></plist>" })),
        )
      ),
    ProvisioningProfileError,
  );
  assertEquals(error.cause instanceof Error, true);
});

Deno.test("install: a failed write removes what was written", async () => {
  const host = new MemoryHost();
  host.failWrite = (path) => path.includes("MobileDevice");
  await assertRejects(
    () =>
      ProvisioningProfileTasks.install((s) =>
        s.host(host).now(() => NOW).base64(base64(profileBytes()))
      ),
    Error,
    "disk full",
  );
  assertEquals(host.files.size, 0);
});

Deno.test("temporary: installed for the callback, removed after", async () => {
  const host = new MemoryHost();
  const seen = await ProvisioningProfileTasks.temporary(
    (s) => s.host(host).now(() => NOW).base64(base64(profileBytes())),
    (installed) => {
      assertEquals(host.files.size, 2);
      return Promise.resolve(installed.profile.name);
    },
  );
  assertEquals(seen, "Example App Store");
  assertEquals(host.files.size, 0);
});

Deno.test("temporary: removed when the callback throws, and its error kept", async () => {
  const host = new MemoryHost();
  await assertRejects(
    () =>
      ProvisioningProfileTasks.temporary(
        (s) => s.host(host).now(() => NOW).base64(base64(profileBytes())),
        () => Promise.reject(new Error("archive failed")),
      ),
    Error,
    "archive failed",
  );
  assertEquals(host.files.size, 0);
});

Deno.test("temporary: a removal that fails is reported, with the cause", async () => {
  const host = new MemoryHost();
  host.failRemove = (path) => path.includes("MobileDevice");
  const ok = await rejection(
    () =>
      ProvisioningProfileTasks.temporary(
        (s) => s.host(host).now(() => NOW).base64(base64(profileBytes())),
        () => Promise.resolve(1),
      ),
    ProvisioningProfileError,
  );
  assertEquals(
    ok.message.includes("could not remove /Users/ci/Library/MobileDevice"),
    true,
  );
  assertEquals(ok.cause, undefined);
  // The other directory's copy was still removed.
  assertEquals(host.files.size, 1);
  const fresh = new MemoryHost();
  fresh.failRemove = (path) => path.includes("MobileDevice");
  const failed = await rejection(
    () =>
      ProvisioningProfileTasks.temporary(
        (s) => s.host(fresh).now(() => NOW).base64(base64(profileBytes())),
        () => Promise.reject("not an Error"),
      ),
    ProvisioningProfileError,
  );
  assertEquals(failed.message.includes("busy"), true);
  assertEquals(failed.cause, "not an Error");
});
