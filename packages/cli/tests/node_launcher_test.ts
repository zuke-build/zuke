// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import {
  nodeLauncherBash,
  nodeLauncherPowerShell,
} from "../src/node_launcher.ts";
import {
  NODE_PIN,
  NODE_POSIX_PLATFORMS,
  NODE_WINDOWS_PLATFORMS,
  type NodePlatform,
} from "../src/node_pin.ts";

Deno.test("the node pin has a well-formed checksum for every platform", () => {
  assertEquals(
    Object.keys(NODE_PIN.checksums).sort(),
    [...NODE_POSIX_PLATFORMS, ...NODE_WINDOWS_PLATFORMS].sort(),
  );
  for (const hash of Object.values(NODE_PIN.checksums)) {
    assertEquals(/^[0-9a-f]{64}$/.test(hash), true);
  }
});

const LAUNCHERS: ReadonlyArray<
  readonly [string, string, readonly NodePlatform[]]
> = [
  ["bash", nodeLauncherBash({ buildFile: "build.ts" }), NODE_POSIX_PLATFORMS],
  [
    "powershell",
    nodeLauncherPowerShell({ buildFile: "build.ts" }),
    NODE_WINDOWS_PLATFORMS,
  ],
];
for (const [name, script, platforms] of LAUNCHERS) {
  Deno.test(`the ${name} node launcher carries the pin, header and build file`, () => {
    assertStringIncludes(script, "SPDX-License-Identifier: MIT");
    assertStringIncludes(script, NODE_PIN.version);
    assertStringIncludes(script, "build.ts");
    assertStringIncludes(script, "--ignore-scripts");
    assertStringIncludes(script, "NODE_SHA256");
    for (const platform of platforms) {
      assertStringIncludes(script, platform);
      assertStringIncludes(script, NODE_PIN.checksums[platform]);
    }
    assertEquals(
      /deno/i.test(script),
      false,
      "a Node launcher never names Deno",
    );
  });
}

Deno.test("the node launchers default to zuke.ts and refuse an unsafe build file", () => {
  assertStringIncludes(nodeLauncherBash(), 'exec node zuke.ts "$@"');
  assertThrows(() => nodeLauncherBash({ buildFile: "x; rm -rf ~.ts" }));
  assertThrows(() => nodeLauncherPowerShell({ buildFile: "../x.ts" }));
});
