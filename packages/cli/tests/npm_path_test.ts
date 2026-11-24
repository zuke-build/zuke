// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../core/tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import type { DenoHost } from "../src/deno_path.ts";
import { NODE_PIN } from "../src/node_pin.ts";
import { npmCandidates, runNpm } from "../src/npm_path.ts";

/** A {@link DenoHost} over `env`, on Windows when `windows`. */
function hostOf(env: Record<string, string>, windows = false): DenoHost {
  return {
    standalone: () => true,
    env: (name) => env[name],
    windows: () => windows,
  };
}

const release = `v${NODE_PIN.version}`;

test("npmCandidates tries PATH, then the pinned Node the launchers cache", () => {
  assertEquals(npmCandidates(hostOf({ HOME: "/home/u" })), [
    "npm",
    `/home/u/.zuke/node/${release}/bin/npm`,
  ]);
  assertEquals(
    npmCandidates(hostOf({ ZUKE_NODE_HOME: "/opt/node", HOME: "/home/u" })),
    ["npm", `/opt/node/${release}/bin/npm`],
  );
  const windows = npmCandidates(hostOf({ USERPROFILE: "C:\\Users\\u" }, true));
  assertEquals(windows[0], "npm");
  assertStringIncludes(windows[1], release);
  assertEquals(windows[1].endsWith("npm.cmd"), true, windows[1]);
  // No absolute directory to look in: PATH alone.
  assertEquals(npmCandidates(hostOf({})), ["npm"]);
  assertEquals(npmCandidates(hostOf({ ZUKE_NODE_HOME: "relative" })), ["npm"]);
});

test("runNpm skips a candidate that is not installed, and names every one when none is", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const missing = `${dir}/no-such-npm`;
    // The running deno stands in for an npm that exits 3.
    const code = await runNpm(
      ["eval", "Deno.exit(3)"],
      dir,
      [missing, Deno.execPath()],
    );
    assertEquals(code, 3);
    const error = await assertRejects(() => runNpm(["-v"], dir, [missing]));
    assertStringIncludes(String(error), missing);
    assertStringIncludes(String(error), "./zuke once");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
