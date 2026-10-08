// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  homeRelative,
  lockedCoreVersions,
  projectLockPath,
} from "../src/version_report.ts";

Deno.test("lockedCoreVersions reads the core a lock resolves, once per version", () => {
  const lock = JSON.stringify({
    version: "5",
    specifiers: {
      "jsr:@zuke/core@^1.31.0": "1.42.0",
      "jsr:@zuke/core@^1.40.0": "1.42.0",
      "jsr:@zuke/deno@^1": "1.3.0",
      "jsr:@zuke/core-extra@^1": "9.9.9",
    },
  });
  assertEquals(lockedCoreVersions(lock), ["1.42.0"]);
  const split = JSON.stringify({
    specifiers: {
      "jsr:@zuke/core@^0.9": "0.9.4",
      "jsr:@zuke/core@^1": "1.66.0",
    },
  });
  assertEquals(lockedCoreVersions(split), ["0.9.4", "1.66.0"]);
});

Deno.test("lockedCoreVersions is empty for a lock without core, or not a lock", () => {
  assertEquals(
    lockedCoreVersions(JSON.stringify({ specifiers: { "npm:x@1": "1.0.0" } })),
    [],
  );
  assertEquals(lockedCoreVersions("not json"), []);
});

Deno.test("homeRelative writes home as ~, and only a whole leading directory", () => {
  assertEquals(
    homeRelative("/home/me/work/app", "/home/me", false),
    "~/work/app",
  );
  assertEquals(
    homeRelative("/home/me/work/app", "/home/me/", false),
    "~/work/app",
  );
  assertEquals(homeRelative("/home/me", "/home/me", false), "~");
  assertEquals(
    homeRelative("/home/me2/app", "/home/me", false),
    "/home/me2/app",
  );
  assertEquals(homeRelative("/srv/app", undefined, false), "/srv/app");
  assertEquals(homeRelative("/srv/app", "relative/home", false), "/srv/app");
  assertEquals(homeRelative("/srv/app", "/", false), "/srv/app");
  // POSIX paths are case-sensitive: a differently cased home is another one.
  assertEquals(homeRelative("/Home/me/app", "/home/me", false), "/Home/me/app");
});

Deno.test("homeRelative matches a Windows home given with backslashes, ignoring case", () => {
  if (Deno.build.os !== "windows") return; // absolutePath reads Windows paths only there.
  assertEquals(
    homeRelative("C:/Users/Me/proj", "C:\\Users\\me", true),
    "~/proj",
  );
  assertEquals(
    homeRelative("C:/Users/me/proj", "C:\\", true),
    "C:/Users/me/proj",
  );
});

Deno.test("lockedCoreVersions drops a resolved value that is not a release version", () => {
  const lock = JSON.stringify({
    specifiers: {
      "jsr:@zuke/core@^1": "1.2.3\n::error::forged",
      "jsr:@zuke/core@^2": "\u001b[31m2.0.0",
      "jsr:@zuke/core@^3": "3.0.0-rc.1",
    },
  });
  assertEquals(lockedCoreVersions(lock), ["3.0.0-rc.1"]);
});

Deno.test("projectLockPath follows Deno's lock setting", () => {
  const root = "/work/app";
  assertEquals(projectLockPath(root, undefined), "/work/app/deno.lock");
  assertEquals(projectLockPath(root, "{}"), "/work/app/deno.lock");
  assertEquals(projectLockPath(root, '{"lock": true}'), "/work/app/deno.lock");
  assertEquals(projectLockPath(root, '{"lock": false}'), null);
  assertEquals(
    projectLockPath(root, '{"lock": "locks/z.lock"}'),
    "/work/app/locks/z.lock",
  );
  assertEquals(
    projectLockPath(root, '{"lock": {"path": "../shared.lock"}}'),
    "/work/shared.lock",
  );
  // An object that only freezes the lock keeps the default file.
  assertEquals(
    projectLockPath(root, '{"lock": {"frozen": true}}'),
    "/work/app/deno.lock",
  );
  // A config that is not an object carries no lock setting.
  assertEquals(projectLockPath(root, "[]"), "/work/app/deno.lock");
});

Deno.test("projectLockPath keeps an absolute lock path as it is", () => {
  if (Deno.build.os === "windows") return; // "/x" has no drive there.
  assertEquals(
    projectLockPath("/work/app", '{"lock": "/elsewhere/z.lock"}'),
    "/elsewhere/z.lock",
  );
});

Deno.test("projectLockPath reads a config the way Deno does, comments and trailing commas included", () => {
  const root = "/work/app";
  // A commented config with no lock setting keeps deno.lock, as before.
  assertEquals(
    projectLockPath(root, '{\n  // project config\n  "tasks": {},\n}'),
    "/work/app/deno.lock",
  );
  assertEquals(
    projectLockPath(root, '{ /* off */ "lock": false, }'),
    null,
  );
  assertEquals(
    projectLockPath(root, '{ "lock": { "path": "a//b.lock", }, // here\n}'),
    "/work/app/a/b.lock",
  );
  // A string holding comment markers, quotes and commas is left as written.
  assertEquals(
    projectLockPath(root, '{ "x": "/* \\" , ]", "lock": "z.lock" }'),
    "/work/app/z.lock",
  );
  // A comment at the end with no newline, and a run of commas, stay handled.
  assertEquals(projectLockPath(root, '{"lock": false} // end'), null);
  assertEquals(projectLockPath(root, '{"a": 1,, "lock": false}'), null);
});

Deno.test("projectLockPath refuses to guess at a config it cannot parse", () => {
  assertEquals(projectLockPath("/work/app", '{ "lock": false'), null);
  assertEquals(projectLockPath("/work/app", '{ "lock": false, /* open'), null);
  assertEquals(projectLockPath("/work/app", "[1,"), null);
});
