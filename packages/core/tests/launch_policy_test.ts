// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: {@link launchDenial} — the policy deciding whether a registry
 * descriptor's launch location may be spawned. The registry server runs what
 * the registry tells it to, so a descriptor pointing at a remote entry module is
 * a remote code-execution primitive unless the operator named its origin.
 */

import { assertEquals } from "./_assert.ts";
import {
  LAUNCH_HOSTS_ENV,
  launchDenial,
} from "../src/registry/launch_policy.ts";
import { ALLOW_INSECURE_ENV } from "../src/http.ts";
import type { BuildLocation } from "../src/registry/descriptor.ts";

/** Build a `readEnv` over a plain record. */
function env(
  vars: Record<string, string> = {},
): (name: string) => string | undefined {
  return (name) => vars[name];
}

/** A module-kind location for `module`. */
function moduleAt(module: string): BuildLocation {
  return { kind: "module", module, cwd: "/work" };
}

Deno.test("a local entry module is always allowed", () => {
  for (
    const module of [
      "file:///srv/app/zuke.ts", // what `zuke register` writes (Deno.mainModule)
      "/srv/app/zuke.ts",
      "./zuke.ts",
      "zuke.ts",
      "C:\\src\\app\\zuke.ts",
      "c:/src/app/zuke.ts",
    ]
  ) {
    assertEquals(launchDenial(moduleAt(module), env()), null, module);
  }
});

Deno.test("a remote entry module is refused unless its origin is allow-listed", () => {
  const denial = launchDenial(
    moduleAt("https://attacker.example/x.ts"),
    env(),
  );
  assertEquals(denial?.reason, "launch_origin_not_allowed");
  assertEquals(denial?.detail.includes("attacker.example"), true);
  assertEquals(denial?.detail.includes(LAUNCH_HOSTS_ENV), true);

  assertEquals(
    launchDenial(
      moduleAt("https://builds.example.com/zuke.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" }),
    ),
    null,
  );
  // A list, with either separator, and matched case-insensitively.
  assertEquals(
    launchDenial(
      moduleAt("https://Builds.Example.com/zuke.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "a.example, builds.example.com  b.example" }),
    ),
    null,
  );
  // Allow-listing one host does not admit another.
  assertEquals(
    launchDenial(
      moduleAt("https://attacker.example/x.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" }),
    )?.reason,
    "launch_origin_not_allowed",
  );
  // A suffix of an allow-listed host is a different host.
  assertEquals(
    launchDenial(
      moduleAt("https://evil-builds.example.com/x.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" }),
    )?.reason,
    "launch_origin_not_allowed",
  );
});

Deno.test("a wildcard allow-list admits any origin", () => {
  assertEquals(
    launchDenial(
      moduleAt("https://anywhere.example/x.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "*" }),
    ),
    null,
  );
});

Deno.test("a remote specifier with no hostname is named by its scheme", () => {
  // `deno run jsr:@scope/build` fetches and executes code just as an https URL
  // does, but has no hostname — so the scheme is what an operator allow-lists.
  assertEquals(
    launchDenial(moduleAt("jsr:@scope/build"), env())?.reason,
    "launch_origin_not_allowed",
  );
  assertEquals(
    launchDenial(
      moduleAt("jsr:@scope/build"),
      env({ [LAUNCH_HOSTS_ENV]: "jsr:" }),
    ),
    null,
  );
  assertEquals(
    launchDenial(moduleAt("npm:some-build"), env())?.reason,
    "launch_origin_not_allowed",
  );
  assertEquals(
    launchDenial(moduleAt("data:text/plain,console.log(1)"), env())?.reason,
    "launch_origin_not_allowed",
  );
});

Deno.test("an allow-listed plaintext origin still needs the insecure opt-out", () => {
  const allowed = env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" });
  const denial = launchDenial(
    moduleAt("http://builds.example.com/zuke.ts"),
    allowed,
  );
  assertEquals(denial?.reason, "insecure_launch_url");
  assertEquals(denial?.detail.includes(ALLOW_INSECURE_ENV), true);

  assertEquals(
    launchDenial(
      moduleAt("http://builds.example.com/zuke.ts"),
      env({
        [LAUNCH_HOSTS_ENV]: "builds.example.com",
        [ALLOW_INSECURE_ENV]: "1",
      }),
    ),
    null,
  );
  // Loopback needs no opt-out — there is no path to sit on — but it is still
  // remote code, so it is still allow-listed.
  assertEquals(
    launchDenial(
      moduleAt("http://localhost:8000/zuke.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "localhost" }),
    ),
    null,
  );
  assertEquals(
    launchDenial(moduleAt("http://localhost:8000/zuke.ts"), env())?.reason,
    "launch_origin_not_allowed",
  );
});

Deno.test("a command location is not scheme-checked", () => {
  // Its argv names programs already on the machine; there is no fetch to gate,
  // and `--allow-run`/`--protect` are what bound it.
  assertEquals(
    launchDenial(
      { kind: "command", command: ["./zuke", "--"], cwd: "/work" },
      env(),
    ),
    null,
  );
});
