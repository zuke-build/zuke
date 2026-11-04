// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the engine a binary carries: which release serves which
 * version, and the resolver over the releases compiled in.
 */

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { embeddedTools, servesRelease } from "../src/embedded.ts";

Deno.test("servesRelease: the same major, at the version asked for or newer", () => {
  assertEquals(servesRelease("1.4.0", "1.4.0"), true);
  assertEquals(servesRelease("1.4.2", "1.4.0"), true);
  assertEquals(servesRelease("1.5.0", "1.4.9"), true);
  assertEquals(servesRelease("1.10.0", "1.9.3"), true);
  // Older than asked for: a setter the build uses may not be there yet.
  assertEquals(servesRelease("1.4.0", "1.4.1"), false);
  assertEquals(servesRelease("1.3.9", "1.4.0"), false);
  // Another major is another contract, in either direction.
  assertEquals(servesRelease("2.0.0", "1.4.0"), false);
  assertEquals(servesRelease("1.4.0", "2.0.0"), false);
  // A prerelease is older than its release, newer than the one before.
  assertEquals(servesRelease("1.4.0-rc.1", "1.4.0"), false);
  assertEquals(servesRelease("1.4.0-rc.1", "1.4.0-rc.1"), true);
  assertEquals(servesRelease("1.4.0-rc.1", "1.3.9"), true);
  assertEquals(servesRelease("1.4.0", "1.4.0-rc.1"), true);
  // Not an exact release on either side: nothing to compare.
  assertEquals(servesRelease("^1.4.0", "1.4.0"), false);
  assertEquals(servesRelease("1.4.0", "latest"), false);
});

Deno.test("embeddedTools loads the release a call is served by", async () => {
  const module = { DockerTasks: {} };
  let loads = 0;
  const resolve = embeddedTools({
    docker: {
      version: "1.4.0",
      load: () => {
        loads++;
        return Promise.resolve(module);
      },
    },
  });
  assertEquals(await resolve("docker", "1.3.2"), module);
  assertEquals(loads, 1);
});

Deno.test("embeddedTools refuses a release it does not carry or cannot serve, naming the fix", async () => {
  const resolve = embeddedTools({
    docker: { version: "1.4.0", load: () => Promise.resolve({}) },
  });
  await assertRejects(
    () => resolve("helm", "1.0.0"),
    Error,
    "this zuke carries no @zuke/helm: update this zuke to a release that " +
      "carries it, or run the project's ./zuke launcher, which runs the " +
      "pinned engine on Deno",
  );
  await assertRejects(
    () => resolve("docker", "1.5.0"),
    Error,
    "this zuke carries @zuke/docker 1.4.0, which cannot serve 1.5.0: update " +
      "this zuke",
  );
  // A name on Object.prototype is not a release the binary holds.
  await assertRejects(
    () => resolve("constructor", "1.0.0"),
    Error,
    "carries no @zuke/constructor",
  );
});
